/**
 * Google Sheets Poller
 * Runs on interval, picks up new rows, triggers the call pipeline.
 */
const cron      = require('node-cron');
const Lead      = require('../models/Lead');
const sheetsSvc = require('../services/sheetsService');
const twilioSvc = require('../services/twilioService');
const emailSvc  = require('../services/emailService');
const { scoreLead } = require('../services/leadScoring');
const cfg       = require('../config');
const logger    = require('../logger');

let isPolling   = false;
let retryTimers = [];

async function pollOnce() {
  if (isPolling) return;
  isPolling = true;

  try {
    const rows = await sheetsSvc.getAllLeads();
    if (!rows.length) { isPolling = false; return; }

    let newCount = 0, syncedCount = 0, skipCount = 0;

    for (const row of rows) {
      const outcome = await processRow(row);
      if (outcome === 'created')      newCount++;
      else if (outcome === 'synced')  syncedCount++;
      else                            skipCount++;
    }

    if (newCount || syncedCount) {
      logger.info(`Poller: ${newCount} new | ${syncedCount} synced | ${skipCount} skipped`);
    }
  } catch (err) {
    logger.error('Sheets poller error', { msg: err.message });
  } finally {
    isPolling = false;
  }
}

async function processRow(row) {
  try {
    // Look up by sheetRowIndex first, then by email/phone
    let exists = await Lead.findOne({ sheetRowIndex: row.sheetRowIndex });
    if (!exists) {
      exists = await Lead.findOne({ $or: [{ email: row.email }, { phone: row.phone }] });
    }

    if (exists) {
      // If the lead was edited in the CRM recently (within 5 minutes), preserve CRM fields and sync to Sheet
      const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000);
      const isRecentlyUpdated = exists.updatedAt && new Date(exists.updatedAt) > fiveMinsAgo;

      if (isRecentlyUpdated) {
        sheetsSvc.updateLeadFields(row.sheetRowIndex, exists).catch(() => {});
        return 'skipped';
      }

      let changed = false;
      const fieldsToSync = ['fullName','grade','email','phone','parentName','parentEmail','courseInterest'];
      for (const f of fieldsToSync) {
        if (row[f] && row[f] !== exists[f]) { exists[f] = row[f]; changed = true; }
      }
      if (exists.sheetRowIndex !== row.sheetRowIndex) {
        exists.sheetRowIndex = row.sheetRowIndex;
        changed = true;
      }
      if (changed) {
        await exists.save();
        logger.info(`Lead synced from sheet: ${exists.fullName} (row ${row.sheetRowIndex})`);
        return 'synced';
      }
      return 'skipped';
    }

    // Score before creating
    const { score, category } = scoreLead({ ...row });

    const lead = await Lead.create({
      ...row,
      status:       'queued',
      leadScore:    score,
      leadCategory: category,
    });

    logger.info(`Lead created: ${lead.fullName} | ${lead.phone} | Score=${score} [${category}]`);

    await sheetsSvc.updateRow(lead.sheetRowIndex, {
      status:  'Queued',
      score,
      summary: 'Lead received. Welcome email sent. Call pending.',
    });

    emailSvc.sendNewLeadWelcome(lead).catch(err =>
      logger.error('Welcome email failed', { msg: err.message, leadId: lead._id })
    );

    const delayMs = category === 'hot' ? 2 * 60_000 : 3 * 60_000;
    const timer = setTimeout(() => _placeCall(lead), delayMs);
    retryTimers.push(timer);

    return 'created';
  } catch (err) {
    logger.error('processRow error', { msg: err.message, email: row.email });
    return 'skipped';
  }
}

const processNewLead = processRow; // legacy alias

async function _placeCall(lead) {
  const fresh = await Lead.findById(lead._id);
  if (!fresh) return;
  if (['meeting-scheduled','enrolled','do-not-call','lost'].includes(fresh.status)) {
    logger.info(`Skipping call for ${fresh.fullName} – status=${fresh.status}`);
    return;
  }

  try {
    fresh.status            = 'calling';
    fresh.totalCallAttempts = (fresh.totalCallAttempts || 0) + 1;
    fresh.lastCallAt        = new Date();
    fresh.callAttempts      = fresh.callAttempts || [];
    fresh.callAttempts.push({
      attemptNumber: fresh.totalCallAttempts,
      startTime:     new Date(),
      status:        'initiated',
    });
    await fresh.save();

    const { callSid } = await twilioSvc.call(fresh, cfg.server.baseUrl);

    fresh.callAttempts[fresh.callAttempts.length - 1].callSid = callSid;
    await fresh.save();

    logger.info(`Call initiated for ${fresh.fullName}: SID=${callSid}`);
  } catch (err) {
    logger.error('_placeCall error', { msg: err.message, leadId: fresh._id });

    fresh.status            = 'queued';
    fresh.totalCallAttempts = Math.max(0, (fresh.totalCallAttempts || 1) - 1);
    await fresh.save();

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

async function retryPendingLeads() {
  try {
    const pending = await Lead.find({
      status:            'queued',
      nextRetryAt:       { $lte: new Date() },
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

async function unstickStaleCalls() {
  try {
    const cutoff = new Date(Date.now() - 15 * 60_000);
    const stuck  = await Lead.find({ status: 'calling', lastCallAt: { $lte: cutoff } });

    for (const lead of stuck) {
      lead.status = 'contacted';
      const last  = lead.callAttempts?.[lead.callAttempts.length - 1];
      if (last && !['completed','canceled','failed','no-answer','busy'].includes(last.status)) {
        last.status  = 'completed';
        last.endTime = last.endTime || new Date();
      }
      await lead.save();
      logger.warn(`Unstuck stale "calling" lead: ${lead.fullName} → contacted`);
    }
  } catch (err) {
    logger.error('unstickStaleCalls error', { msg: err.message });
  }
}

async function sendMeetingReminders() {
  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dayAfter = new Date(tomorrow);
    dayAfter.setDate(dayAfter.getDate() + 1);

    // JSONB path filters handled by Lead.find jsFilter
    const leads = await Lead.find({
      'meeting.scheduledAt':  { $gte: tomorrow, $lt: dayAfter },
      'meeting.status':       'scheduled',
      'meeting.reminderSent': false,
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

  cron.schedule(expr, pollOnce);
  cron.schedule('*/5 * * * *', retryPendingLeads);
  cron.schedule('*/5 * * * *', unstickStaleCalls);
  cron.schedule('0 9 * * *', sendMeetingReminders);

  logger.info(`Sheets poller started – checking every ${interval}s`);
  setTimeout(pollOnce, 4000);
}

function stop() {
  retryTimers.forEach(t => clearTimeout(t));
  retryTimers = [];
}

module.exports = { start, stop, pollOnce, processNewLead };
