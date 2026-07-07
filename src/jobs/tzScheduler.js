/**
 * Time Zone Scheduling & Automated Call Automation Job
 * Runs periodically to place AI Calls at appropriate local times.
 */
const cron = require('node-cron');
const moment = require('moment-timezone');
const Lead = require('../models/Lead');
const twilioSvc = require('../services/twilioService');
const cfg = require('../config');
const logger = require('../logger');

let isRunning = false;

async function checkAndPlaceCalls() {
  if (isRunning) return;
  isRunning = true;

  try {
    // 1. Get baseUrl/tunnelUrl for Twilio webhooks
    const { getCurrentUrl } = require('../utils/tunnel');
    const baseUrl = getCurrentUrl() || cfg.server.baseUrl;

    if (!baseUrl || baseUrl.includes('localhost') || baseUrl.includes('your-ngrok')) {
      logger.warn('tzScheduler: Public URL/tunnel is not active. Skipping automated calls.');
      isRunning = false;
      return;
    }

    // 2. Find all active leads with Meeting Status = Not Booked
    // Active means status is NOT enrolled, lost, do-not-call
    const leads = await Lead.find({
      meetingStatus: 'Not Booked',
      status: { $nin: ['enrolled', 'lost', 'do-not-call', 'do-not-contact'] }
    });

    if (!leads.length) {
      isRunning = false;
      return;
    }

    logger.debug(`tzScheduler: Processing ${leads.length} active leads for timezone scheduling.`);

    for (const lead of leads) {
      try {
        const tz = lead.timeZone || 'America/New_York';
        const nowLocal = moment().tz(tz);
        const currentHour = nowLocal.hour();
        const currentDateStr = nowLocal.format('YYYY-MM-DD');

        // Check if morning or evening call is due
        const lastMorningDate = lead.lastMorningCall ? moment(lead.lastMorningCall).tz(tz).format('YYYY-MM-DD') : null;
        const lastEveningDate = lead.lastEveningCall ? moment(lead.lastEveningCall).tz(tz).format('YYYY-MM-DD') : null;

        // Morning Call: 10:00 AM local time (we check hour 10 & 11 to give a 2-hour window)
        const isMorningDue = (currentHour >= 10 && currentHour < 12) && (lastMorningDate !== currentDateStr);

        // Evening Call: 6:00 PM local time (we check hour 18 & 19 to give a 2-hour window)
        const isEveningDue = (currentHour >= 18 && currentHour < 20) && (lastEveningDate !== currentDateStr);

        if (isMorningDue) {
          logger.info(`tzScheduler: Placing Morning Call (10:00 AM local) to ${lead.fullName} (${lead.phone})`);
          
          // Mark morning call timestamp
          lead.lastMorningCall = new Date();
          lead.lastCallAt = new Date();
          lead.totalCallAttempts = (lead.totalCallAttempts || 0) + 1;
          lead.status = 'calling';
          lead.callAttempts = lead.callAttempts || [];
          lead.callAttempts.push({
            attemptNumber: lead.totalCallAttempts,
            startTime: new Date(),
            status: 'initiated'
          });
          await lead.save();

          try {
            const { callSid } = await twilioSvc.call(lead, baseUrl);
            lead.callAttempts[lead.callAttempts.length - 1].callSid = callSid;
            await lead.save();
            logger.info(`tzScheduler: Morning call connected. SID=${callSid}`);
          } catch (callErr) {
            logger.error(`tzScheduler: Twilio Morning Call failed for ${lead.fullName}`, { msg: callErr.message });
            lead.status = 'queued';
            lead.totalCallAttempts = Math.max(0, lead.totalCallAttempts - 1);
            lead.callAttempts.pop();
            await lead.save();
          }
        } else if (isEveningDue) {
          logger.info(`tzScheduler: Placing Evening Call (6:00 PM local) to ${lead.fullName} (${lead.phone})`);

          // Mark evening call timestamp
          lead.lastEveningCall = new Date();
          lead.lastCallAt = new Date();
          lead.totalCallAttempts = (lead.totalCallAttempts || 0) + 1;
          lead.status = 'calling';
          lead.callAttempts = lead.callAttempts || [];
          lead.callAttempts.push({
            attemptNumber: lead.totalCallAttempts,
            startTime: new Date(),
            status: 'initiated'
          });
          await lead.save();

          try {
            const { callSid } = await twilioSvc.call(lead, baseUrl);
            lead.callAttempts[lead.callAttempts.length - 1].callSid = callSid;
            await lead.save();
            logger.info(`tzScheduler: Evening call connected. SID=${callSid}`);
          } catch (callErr) {
            logger.error(`tzScheduler: Twilio Evening Call failed for ${lead.fullName}`, { msg: callErr.message });
            lead.status = 'queued';
            lead.totalCallAttempts = Math.max(0, lead.totalCallAttempts - 1);
            lead.callAttempts.pop();
            await lead.save();
          }
        }
      } catch (leadErr) {
        logger.error(`tzScheduler: Error processing lead ${lead.fullName}`, { msg: leadErr.message });
      }
    }
  } catch (err) {
    logger.error('tzScheduler run error', { msg: err.message });
  } finally {
    isRunning = false;
  }
}

function start() {
  // Check every 15 minutes
  cron.schedule('*/15 * * * *', checkAndPlaceCalls);
  logger.info('Time Zone scheduler job started — checks every 15 min');
  // Run once shortly after startup
  setTimeout(checkAndPlaceCalls, 15_000);
}

module.exports = { start, checkAndPlaceCalls };
