/**
 * Automated Follow-up Engine
 * Runs every 15 minutes, processes due follow-ups.
 *
 * Day 1  → Email + WhatsApp (logged)
 * Day 3  → AI follow-up call
 * Day 5  → Success stories email
 * Day 7  → Counselor reminder (dashboard alert)
 * Day 10 → Enrollment reminder email
 */
const cron      = require('node-cron');
const Lead      = require('../models/Lead');
const FollowUp  = require('../models/FollowUp');
const emailSvc  = require('../services/emailService');
const twilioSvc = require('../services/twilioService');
const cfg       = require('../config');
const logger    = require('../logger');

let running = false;

async function runFollowUps() {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    const due = await FollowUp.find({ completed: false, scheduledDate: { $lte: now } })
      .sort({ scheduledDate: 1 })
      .limit(50);

    if (!due.length) { running = false; return; }
    logger.info(`FollowUpEngine: ${due.length} due`);

    for (const fu of due) {
      try {
        await processFollowUp(fu);
      } catch(err) {
        logger.error('FollowUp error', { id: fu._id, type: fu.followupType, msg: err.message });
      }
    }
  } catch(err) {
    logger.error('FollowUpEngine run error', { msg: err.message });
  } finally {
    running = false;
  }
}

async function processFollowUp(fu) {
  const lead = await Lead.findById(fu.leadId);
  if (!lead) {
    fu.completed = true; fu.completedAt = new Date(); fu.result = 'lead-not-found';
    await fu.save(); return;
  }

  // Skip if lead is enrolled or do-not-call
  if (['enrolled','do-not-call','lost'].includes(lead.status)) {
    fu.completed = true; fu.completedAt = new Date(); fu.result = 'skipped-status';
    await fu.save(); return;
  }

  let result = 'processed';

  switch (fu.followupType) {
    case 'email-day1': {
      const r = await emailSvc.sendEnrollmentFollowup(lead);
      result = r.ok ? `email-sent:${r.messageId}` : `email-failed:${r.error}`;
      break;
    }

    case 'whatsapp-day1': {
      // WhatsApp via Twilio (if configured); otherwise log as pending
      result = 'whatsapp-logged'; // placeholder — extend with Twilio WhatsApp API
      logger.info(`WhatsApp follow-up due for ${lead.fullName} (${lead.phone}) — Day 1`);
      break;
    }

    case 'ai-call-day3': {
      // Trigger AI follow-up call if attempts remain and we have a valid URL
      const { getCurrentUrl } = require('../utils/tunnel');
      const baseUrl = getCurrentUrl() || cfg.server.baseUrl;
      if (baseUrl && !baseUrl.includes('localhost')) {
        try {
          await _placeFollowUpCall(lead, baseUrl);
          result = 'ai-call-initiated';
        } catch(e) {
          result = `ai-call-failed:${e.message}`;
        }
      } else {
        result = 'ai-call-skipped:no-public-url';
      }
      break;
    }

    case 'success-stories-day5': {
      // Send a success stories / social proof email
      const r = await emailSvc.sendSuccessStories(lead).catch(() => ({ ok: false, error: 'method-missing' }));
      result = r?.ok ? `email-sent` : 'email-sent-fallback';
      // Fallback to enrollment followup email
      if (!r?.ok) await emailSvc.sendEnrollmentFollowup(lead).catch(() => {});
      break;
    }

    case 'counselor-reminder-day7': {
      // No external action — just marks it in the DB for the counselor to see
      result = 'counselor-alert-created';
      logger.info(`📋 COUNSELOR REMINDER: Follow up manually with ${lead.fullName} (${lead.phone}) — Day 7`);
      break;
    }

    case 'enrollment-reminder-day10': {
      const r = await emailSvc.sendEnrollmentReminder(lead).catch(() => ({ ok: false }));
      result = r?.ok ? 'enrollment-reminder-sent' : 'enrollment-reminder-fallback';
      if (!r?.ok) await emailSvc.sendEnrollmentFollowup(lead).catch(() => {});
      break;
    }

    default:
      result = 'unknown-type';
  }

  fu.completed   = true;
  fu.completedAt = new Date();
  fu.result      = result;
  await fu.save();
  logger.info(`FollowUp done: ${fu.followupType} for ${lead.fullName} → ${result}`);
}

async function _placeFollowUpCall(lead, baseUrl) {
  if (!lead.phone || !/^\+[1-9]\d{6,14}$/.test(lead.phone)) {
    throw new Error('invalid-phone');
  }
  if (['enrolled','do-not-call','calling'].includes(lead.status)) return;
  if (lead.totalCallAttempts >= cfg.call.maxAttempts) {
    throw new Error('max-attempts-reached');
  }

  lead.status           = 'calling';
  lead.totalCallAttempts += 1;
  lead.lastCallAt       = new Date();
  lead.callAttempts.push({ attemptNumber: lead.totalCallAttempts, startTime: new Date(), status: 'initiated' });
  await lead.save();

  try {
    const { callSid } = await twilioSvc.callFollowUp(lead, baseUrl);
    lead.callAttempts[lead.callAttempts.length - 1].callSid = callSid;
    await lead.save();
    logger.info(`Follow-up call initiated: ${lead.fullName} → ${callSid}`);
  } catch(err) {
    lead.status = 'contacted';
    lead.totalCallAttempts -= 1;
    lead.callAttempts.pop();
    await lead.save();
    throw err;
  }
}

function start() {
  // Run every 15 minutes
  cron.schedule('*/15 * * * *', runFollowUps);
  logger.info('Follow-up engine started — checks every 15 min');
  // Run once 30 seconds after boot
  setTimeout(runFollowUps, 30_000);
}

module.exports = { start, runFollowUps };
