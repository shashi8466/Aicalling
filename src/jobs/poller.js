/**
 * Google Sheets Poller
 * Runs on interval, picks up new rows, triggers the call pipeline.
 *
 * Pipeline per new lead:
 *   1. Create Lead in DB
 *   2. Send welcome email
 *   3. Initiate Twilio outbound call (after short delay)
 *   4. Webhook handles conversation → qualification → booking
 *   5. Sheet updated at each step
 */
const cron      = require('node-cron');
const Lead      = require('../models/Lead');
const sheetsSvc = require('../services/sheetsService');
const twilioSvc = require('../services/twilioService');
const emailSvc  = require('../services/emailService');
const { scoreLead } = require('../services/leadScoring');
const cfg       = require('../config');
const logger    = require('../logger');

let isPolling   = false;   // prevent overlapping runs
let retryTimers = [];      // pending retry setTimeout handles

async function pollOnce() {
  if (isPolling) return;
  isPolling = true;

  try {
    const rows = await sheetsSvc.getNewLeads();
    if (!rows.length) { isPolling = false; return; }

    logger.info(`Sheets poller: ${rows.length} new lead(s) detected`);

    for (const row of rows) {
      await processNewLead(row);
    }
  } catch (err) {
    logger.error('Sheets poller error', { msg: err.message });
  } finally {
    isPolling = false;
  }
}

async function processNewLead(row) {
  try {
    // Deduplicate by email or phone
    const exists = await Lead.findOne({ $or: [{ email: row.email }, { phone: row.phone }] });
    if (exists) {
      logger.debug(`Skipped duplicate: ${row.email}`);
      return;
    }

    // 1. Create lead
    const lead = new Lead({ ...row, status: 'queued' });

    // Initial score before any call data
    const { score, category } = scoreLead(lead);
    lead.leadScore    = score;
    lead.leadCategory = category;
    await lead.save();

    logger.info(`Lead created: ${lead.fullName} | ${lead.phone} | Score=${score} [${category}]`);

    // 2. Update sheet – mark as Queued
    await sheetsSvc.updateRow(lead.sheetRowIndex, {
      status:  'Queued',
      score,
      summary: 'Lead received. Welcome email sent. Call pending.',
    });

    // 3. Welcome email (fire-and-forget)
    emailSvc.sendNewLeadWelcome(lead).catch(err =>
      logger.error('Welcome email failed', { msg: err.message, leadId: lead._id })
    );

    // 4. Place call after delay
    //    Hot leads → 2 min  |  Others → 5 min
    const delayMs = category === 'hot' ? 2 * 60_000 : 5 * 60_000;
    const timer = setTimeout(() => _placeCall(lead), delayMs);
    retryTimers.push(timer);

  } catch (err) {
    logger.error('processNewLead error', { msg: err.message, email: row.email });
  }
}

async function _placeCall(lead) {
  // Reload to get latest status (may have changed while waiting)
  const fresh = await Lead.findById(lead._id);
  if (!fresh) return;
  if (['meeting-scheduled','enrolled','do-not-call','lost'].includes(fresh.status)) {
    logger.info(`Skipping call for ${fresh.fullName} – status=${fresh.status}`);
    return;
  }

  try {
    fresh.status           = 'calling';
    fresh.totalCallAttempts += 1;
    fresh.lastCallAt       = new Date();
    fresh.callAttempts.push({
      attemptNumber: fresh.totalCallAttempts,
      startTime:     new Date(),
      status:        'initiated',
    });
    await fresh.save();

    const { callSid } = await twilioSvc.call(fresh, cfg.server.baseUrl);

    // Store callSid on the attempt record
    const att = fresh.callAttempts[fresh.callAttempts.length - 1];
    att.callSid = callSid;
    await fresh.save();

    logger.info(`Call initiated for ${fresh.fullName}: SID=${callSid}`);
  } catch (err) {
    logger.error('_placeCall error', { msg: err.message, leadId: fresh._id });

    fresh.status = 'queued';
    fresh.totalCallAttempts -= 1;   // rollback
    await fresh.save();

    // Retry if attempts remain
    if (fresh.totalCallAttempts < cfg.call.maxAttempts) {
      const retryMs = cfg.call.retryDelayMinutes * 60_000;
      logger.info(`Retrying call for ${fresh.fullName} in ${cfg.call.retryDelayMinutes} min`);
      const timer = setTimeout(() => _placeCall(fresh), retryMs);
      retryTimers.push(timer);
    } else {
      fresh.status = 'lost';
      await fresh.save();
      await sheetsSvc.updateRow(fresh.sheetRowIndex, {
        status:  'Lost – No Contact',
        score:   fresh.leadScore,
        summary: `Max call attempts reached (${cfg.call.maxAttempts}).`,
      });
    }
  }
}

/** Also retry leads whose nextRetryAt has passed (for server restarts) */
async function retryPendingLeads() {
  try {
    const pending = await Lead.find({
      status:       'queued',
      nextRetryAt:  { $lte: new Date() },
      totalCallAttempts: { $lt: cfg.call.maxAttempts },
    });

    for (const lead of pending) {
      logger.info(`Retrying pending lead: ${lead.fullName}`);
      await _placeCall(lead);
    }
  } catch (err) {
    logger.error('retryPendingLeads error', { msg: err.message });
  }
}

/** Also send reminders for meetings tomorrow */
async function sendMeetingReminders() {
  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dayAfter = new Date(tomorrow);
    dayAfter.setDate(dayAfter.getDate() + 1);

    const leads = await Lead.find({
      'meeting.scheduledAt':   { $gte: tomorrow, $lt: dayAfter },
      'meeting.status':        'scheduled',
      'meeting.reminderSent':  false,
    });

    for (const lead of leads) {
      await emailSvc.sendMeetingReminder(lead);
      lead.meeting.reminderSent = true;
      await lead.save();
      logger.info(`Reminder sent for ${lead.fullName}`);
    }
  } catch (err) {
    logger.error('sendMeetingReminders error', { msg: err.message });
  }
}

function start() {
  const interval = cfg.sheets.pollIntervalSeconds;
  const expr     = `*/${Math.min(59, Math.max(1, interval))} * * * * *`;

  // Main polling loop
  cron.schedule(expr, pollOnce);

  // Retry pending leads every 5 minutes
  cron.schedule('*/5 * * * *', retryPendingLeads);

  // Meeting reminders at 9 AM daily
  cron.schedule('0 9 * * *', sendMeetingReminders);

  logger.info(`Sheets poller started – checking every ${interval}s`);

  // Run immediately on boot
  setTimeout(pollOnce, 4000);
}

function stop() {
  retryTimers.forEach(t => clearTimeout(t));
  retryTimers = [];
}

module.exports = { start, stop, pollOnce, processNewLead };
