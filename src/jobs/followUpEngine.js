/**
 * Continuous Lead Nurturing Engine — runs every 15 minutes.
 */
const cron     = require('node-cron');
const Lead     = require('../models/Lead');
const FollowUp = require('../models/FollowUp');
const emailSvc = require('../services/emailService');
const twilioSvc = require('../services/twilioService');
const cfg      = require('../config');
const logger   = require('../logger');

let running = false;

const NURTURE_INTERVALS = {
  'nurture-ai-call':            7,
  'nurture-email':              3,
  'nurture-success-stories':    7,
  'nurture-counselor-reminder': 14,
  'nurture-lead-review':        30,
};

async function runFollowUps() {
  if (running) return;
  running = true;
  try {
    const due = await FollowUp.find(
      { completed: false, scheduledDate: { $lte: new Date() } },
      { sort: { scheduledDate: 1 }, limit: 50 }
    );

    if (!due.length) { running = false; return; }
    logger.info(`FollowUpEngine: ${due.length} due`);

    for (const fu of due) {
      try {
        await processFollowUp(fu);
      } catch (err) {
        logger.error('FollowUp error', { id: fu._id, type: fu.followupType, msg: err.message });
      }
    }
  } catch (err) {
    logger.error('FollowUpEngine run error', { msg: err.message });
  } finally {
    running = false;
  }
}

async function processFollowUp(fu) {
  const lead = await Lead.findById(fu.leadId);

  if (!lead) return _complete(fu, 'lead-not-found');
  if (['enrolled','do-not-call','lost'].includes(lead.status)) {
    return _complete(fu, 'skipped-status:' + lead.status);
  }

  // Defer follow-up if a future nextScheduledCall exists
  if (lead.nextScheduledCall) {
    const moment = require('moment-timezone');
    if (moment().isBefore(moment(lead.nextScheduledCall))) {
      logger.info(`FollowUpEngine: Deferring ${fu.followupType} for ${lead.fullName} because nextScheduledCall is in the future (${lead.nextScheduledCall})`);
      return;
    }
  }

  let result = 'processed';

  switch (fu.followupType) {

    case 'email-day1':
    case 'email-day5':
    case 'email-day8':
    case 'email-day12':
    case 'nurture-email': {
      const r = await emailSvc.sendEnrollmentFollowup(lead);
      result = r.ok ? `email-sent:${r.messageId}` : `email-failed:${r.error}`;
      break;
    }

    case 'success-stories-day3':
    case 'success-stories-day9':
    case 'success-stories-week3':
    case 'success-stories-week4':
    case 'success-stories-day5':
    case 'nurture-success-stories': {
      const r = await emailSvc.sendSuccessStories(lead);
      result = r.ok ? 'success-stories-sent' : `email-failed:${r.error}`;
      break;
    }

    case 'parent-discussion-week3': {
      const r = await emailSvc.sendParentDiscussion(lead);
      result = r.ok ? 'parent-discussion-sent' : `email-failed:${r.error}`;
      break;
    }

    case 'enrollment-reminder-week3':
    case 'enrollment-reminder-day10': {
      const r = await emailSvc.sendEnrollmentReminder(lead);
      result = r.ok ? 'enrollment-reminder-sent' : `email-failed:${r.error}`;
      break;
    }

    case 'program-benefits-week4': {
      const r = await emailSvc.sendProgramBenefits(lead);
      result = r.ok ? 'program-benefits-sent' : `email-failed:${r.error}`;
      break;
    }

    case 'limited-seat-week4': {
      const r = await emailSvc.sendLimitedSeat(lead);
      result = r.ok ? 'limited-seat-sent' : `email-failed:${r.error}`;
      break;
    }

    case 'ai-call-day2':
    case 'ai-call-day4':
    case 'ai-call-day6':
    case 'ai-call-day10':
    case 'ai-call-week3':
    case 'ai-call-week4':
    case 'ai-call-day3':
    case 'nurture-ai-call': {
      const { getCurrentUrl } = require('../utils/tunnel');
      const baseUrl = getCurrentUrl() || cfg.server.baseUrl;
      if (baseUrl && !baseUrl.includes('localhost')) {
        try {
          await _placeFollowUpCall(lead, baseUrl);
          result = 'ai-call-initiated';
        } catch (e) {
          result = `ai-call-failed:${e.message}`;
        }
      } else {
        result = 'ai-call-skipped:no-public-url';
      }
      break;
    }

    case 'counselor-reminder-day7':
    case 'counselor-reminder-day14':
    case 'counselor-reminder-week4':
    case 'nurture-counselor-reminder': {
      const r = await emailSvc.sendCounselorReachOut(lead);
      result = r.ok ? 'counselor-reachout-sent' : `email-failed:${r.error}`;
      break;
    }

    case 'nurture-lead-review': {
      const r = await emailSvc.sendReEngagement(lead);
      result = r.ok ? 're-engagement-sent' : `email-failed:${r.error}`;
      break;
    }

    case 'whatsapp-day1': {
      logger.info(`WhatsApp follow-up due for ${lead.fullName} (${lead.phone})`);
      result = 'whatsapp-logged';
      break;
    }

    default:
      result = 'unknown-type:' + fu.followupType;
  }

  await _complete(fu, result);

  // Re-schedule recurring nurture types
  if (fu.followupType in NURTURE_INTERVALS) {
    const nextCycle    = (fu.cycle || 1) + 1;
    const intervalDays = NURTURE_INTERVALS[fu.followupType];
    const nextDate     = new Date(Date.now() + intervalDays * 86400000);

    // Reload status before scheduling — lead may have enrolled during processing
    const fresh = await Lead.findById(fu.leadId);
    if (fresh && !['enrolled','do-not-call','lost'].includes(fresh.status)) {
      await FollowUp.create({
        leadId:        fu.leadId,
        followupType:  fu.followupType,
        scheduledDate: nextDate,
        cycle:         nextCycle,
      });
      logger.info(`Rescheduled ${fu.followupType} cycle ${nextCycle} for ${lead.fullName} → ${nextDate.toDateString()}`);
    }
  }
}

async function _complete(fu, result) {
  fu.completed   = true;
  fu.completedAt = new Date();
  fu.result      = result;
  await fu.save();
  logger.info(`FollowUp done: ${fu.followupType} → ${result}`);
}

async function _placeFollowUpCall(lead, baseUrl) {
  if (!lead.phone || !/^\+[1-9]\d{6,14}$/.test(lead.phone)) throw new Error('invalid-phone');
  if (['enrolled','do-not-call','calling'].includes(lead.status)) return;
  if ((lead.totalCallAttempts || 0) >= cfg.call.maxAttempts) throw new Error('max-attempts-reached');

  lead.status             = 'calling';
  lead.totalCallAttempts  = (lead.totalCallAttempts || 0) + 1;
  lead.lastCallAt         = new Date();
  lead.callAttempts       = lead.callAttempts || [];
  lead.callAttempts.push({ attemptNumber: lead.totalCallAttempts, startTime: new Date(), status: 'initiated' });
  await lead.save();

  try {
    const { callSid } = await twilioSvc.callFollowUp(lead, baseUrl);
    lead.callAttempts[lead.callAttempts.length - 1].callSid = callSid;
    await lead.save();
    logger.info(`Follow-up call initiated: ${lead.fullName} → ${callSid}`);
  } catch (err) {
    lead.status            = 'contacted';
    lead.totalCallAttempts = Math.max(0, lead.totalCallAttempts - 1);
    lead.callAttempts.pop();
    await lead.save();
    throw err;
  }
}

function start() {
  cron.schedule('*/15 * * * *', runFollowUps);
  logger.info('Follow-up engine started — checks every 15 min');
  setTimeout(runFollowUps, 30_000);
}

module.exports = { start, runFollowUps };
