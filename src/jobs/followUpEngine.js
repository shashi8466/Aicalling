/**
 * Continuous Lead Nurturing Engine
 * Runs every 15 minutes. Processes due follow-ups.
 *
 * Stops automation only when lead status is:
 *   enrolled | lost | do-not-call
 *
 * Week 1:  Day 1 email, Day 2 AI call, Day 3 success stories,
 *          Day 4 AI call, Day 5 email, Day 6 AI call, Day 7 counselor reminder
 * Week 2:  Day 8 email, Day 10 AI call, Day 12 email, Day 14 counselor reminder
 * Week 3:  AI call, success stories, parent discussion, enrollment reminder
 * Week 4:  AI call, success stories, program benefits, limited seat, counselor reach-out email
 * Monthly: Every 7d AI call, every 3d email, every 7d success stories,
 *          every 14d counselor reach-out email, every 30d re-engagement email
 */
const cron     = require('node-cron');
const Lead     = require('../models/Lead');
const FollowUp = require('../models/FollowUp');
const emailSvc = require('../services/emailService');
const twilioSvc = require('../services/twilioService');
const cfg      = require('../config');
const logger   = require('../logger');

let running = false;

// ── Recurring intervals for the ongoing monthly cadence ──────────────────────
const NURTURE_INTERVALS = {
  'nurture-ai-call':            7,   // days
  'nurture-email':              3,
  'nurture-success-stories':    7,   // every week
  'nurture-counselor-reminder': 14,
  'nurture-lead-review':        30,
};

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

  // Lead gone or automation should stop
  if (!lead) {
    return _complete(fu, 'lead-not-found');
  }
  if (['enrolled', 'do-not-call', 'lost'].includes(lead.status)) {
    return _complete(fu, 'skipped-status:' + lead.status);
  }

  let result = 'processed';

  switch (fu.followupType) {

    // ── Emails ─────────────────────────────────────────────────────────
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

    // ── AI Calls ───────────────────────────────────────────────────────
    case 'ai-call-day2':
    case 'ai-call-day4':
    case 'ai-call-day6':
    case 'ai-call-day10':
    case 'ai-call-week3':
    case 'ai-call-week4':
    case 'ai-call-day3':  // legacy
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

    // ── Counselor Reach-Out (automated email to lead) ──────────────────
    case 'counselor-reminder-day7':
    case 'counselor-reminder-day14':
    case 'counselor-reminder-week4':
    case 'nurture-counselor-reminder': {
      const r = await emailSvc.sendCounselorReachOut(lead);
      result = r.ok ? 'counselor-reachout-sent' : `email-failed:${r.error}`;
      break;
    }

    // ── Monthly Re-Engagement Email ────────────────────────────────────
    case 'nurture-lead-review': {
      const r = await emailSvc.sendReEngagement(lead);
      result = r.ok ? 're-engagement-sent' : `email-failed:${r.error}`;
      break;
    }

    // ── WhatsApp (placeholder) ─────────────────────────────────────────
    case 'whatsapp-day1': {
      logger.info(`WhatsApp follow-up due for ${lead.fullName} (${lead.phone})`);
      result = 'whatsapp-logged';
      break;
    }

    // ── Legacy ─────────────────────────────────────────────────────────
    case 'success-stories-day5': {
      const r = await emailSvc.sendSuccessStories(lead);
      result = r.ok ? 'success-stories-sent' : `email-failed:${r.error}`;
      break;
    }

    default:
      result = 'unknown-type:' + fu.followupType;
  }

  await _complete(fu, result);

  // Re-schedule nurture types for the next cycle
  if (fu.followupType in NURTURE_INTERVALS) {
    const nextCycle = (fu.cycle || 1) + 1;
    const intervalDays = NURTURE_INTERVALS[fu.followupType];
    const nextDate = new Date(Date.now() + intervalDays * 86400000);

    // Only re-schedule if lead is still active
    const fresh = await Lead.findById(fu.leadId).select('status');
    if (fresh && !['enrolled', 'do-not-call', 'lost'].includes(fresh.status)) {
      await FollowUp.create({
        leadId:       fu.leadId,
        followupType: fu.followupType,
        scheduledDate: nextDate,
        cycle:        nextCycle,
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
  if (!lead.phone || !/^\+[1-9]\d{6,14}$/.test(lead.phone)) {
    throw new Error('invalid-phone');
  }
  if (['enrolled', 'do-not-call', 'calling'].includes(lead.status)) return;
  if (lead.totalCallAttempts >= cfg.call.maxAttempts) {
    throw new Error('max-attempts-reached');
  }

  lead.status            = 'calling';
  lead.totalCallAttempts += 1;
  lead.lastCallAt        = new Date();
  lead.callAttempts.push({ attemptNumber: lead.totalCallAttempts, startTime: new Date(), status: 'initiated' });
  await lead.save();

  try {
    const { callSid } = await twilioSvc.callFollowUp(lead, baseUrl);
    lead.callAttempts[lead.callAttempts.length - 1].callSid = callSid;
    await lead.save();
    logger.info(`Follow-up call initiated: ${lead.fullName} → ${callSid}`);
  } catch (err) {
    lead.status = 'contacted';
    lead.totalCallAttempts -= 1;
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
