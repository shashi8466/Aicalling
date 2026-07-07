/**
 * Email Callback Request Poller Job
 * Automatically monitors email inbox or receives simulated callback emails.
 */
const moment = require('moment-timezone');
const CallbackRequest = require('../models/CallbackRequest');
const Lead = require('../models/Lead');
const logger = require('../logger');

// Simulated mock mailbox for local testing
const mockMailbox = [];

/**
 * Parses email content to extract callback parameters.
 */
function parseCallbackEmail(subject, body, fromEmail, fromName) {
  const email = fromEmail || '';
  const name = fromName || 'Unknown Student';
  
  // Phone regex
  const phoneMatch = body.match(/(\+?\d[\d-\s()]{8,15}\d)/);
  const phone = phoneMatch ? phoneMatch[0].trim() : '';

  // Parse time and timezone, e.g. "5pm cst", "10:30 am ist"
  const timeRegex = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(cst|est|pst|mst|ist|gmt|utc)/i;
  const match = body.match(timeRegex) || subject.match(timeRegex);
  
  let requestedTime = 'Immediate';
  let explicitTimezone = null;
  let parsedTime = null; // { hour, min, ampm }

  if (match) {
    requestedTime = match[0];
    const hour = parseInt(match[1]);
    const min = match[2] ? parseInt(match[2]) : 0;
    const ampm = match[3] ? match[3].toLowerCase() : '';
    const tzName = match[4].toLowerCase();

    const tzMap = {
      cst: 'America/Chicago',
      est: 'America/New_York',
      pst: 'America/Los_Angeles',
      mst: 'America/Phoenix',
      ist: 'Asia/Kolkata',
      gmt: 'Etc/GMT',
      utc: 'UTC'
    };
    explicitTimezone = tzMap[tzName] || null;
    parsedTime = { hour, min, ampm };
  }

  return {
    studentName: name,
    email,
    phone,
    requestedTime,
    explicitTimezone,
    parsedTime
  };
}

/**
 * Process a single callback request email.
 */
async function processEmail(subject, body, fromEmail, fromName) {
  logger.info(`Processing callback request email from ${fromEmail}`);
  
  // 1. Get parsed text details
  const parsed = parseCallbackEmail(subject, body, fromEmail, fromName);

  // Find existing lead
  let lead = await Lead.findOne({ email: parsed.email });

  // 2. Resolve timezone according to priorities:
  // First: Check if lead has timezone in database.
  // Second: If no timezone exists, determine from phone number's country code.
  // Third: If explicitly mentioned in callback email, use that.
  // Fallback: "Unknown"
  let resolvedTz = null;

  if (lead && lead.timeZone) {
    resolvedTz = lead.timeZone;
  }

  if (!resolvedTz) {
    const phoneToUse = parsed.phone || (lead ? lead.phone : '');
    if (phoneToUse) {
      const tzHelper = require('../utils/timezoneHelper');
      const detected = tzHelper.detectTimeZone(phoneToUse, lead ? lead.state : '');
      if (detected && detected.countryCode) {
        resolvedTz = detected.timeZone;
      }
    }
  }

  if (!resolvedTz) {
    resolvedTz = parsed.explicitTimezone;
  }

  const finalTimezone = resolvedTz || 'Unknown';

  // 3. Construct target scheduled date/time using the resolved timezone (or America/New_York fallback for calculation math only)
  let scheduledAt = new Date();
  if (parsed.parsedTime) {
    const calculationTz = resolvedTz || 'America/New_York';
    let target = moment().tz(calculationTz);
    let targetHour = parsed.parsedTime.hour;
    if (parsed.parsedTime.ampm === 'pm' && parsed.parsedTime.hour < 12) targetHour += 12;
    if (parsed.parsedTime.ampm === 'am' && parsed.parsedTime.hour === 12) targetHour = 0;
    
    target.hour(targetHour).minute(parsed.parsedTime.min).second(0).millisecond(0);
    
    if (target.isBefore(moment())) {
      target.add(1, 'day');
    }
    scheduledAt = target.toDate();
  }

  // 4. Create lead if needed
  if (!lead) {
    lead = await Lead.create({
      fullName: parsed.studentName,
      email: parsed.email,
      phone: parsed.phone || '+15555555555',
      status: 'queued',
      meetingStatus: 'Not Booked',
      timeZone: finalTimezone === 'Unknown' ? 'America/New_York' : finalTimezone,
      notes: `Auto-created from Callback Email Request: "${body}"`
    });
  } else {
    if (parsed.phone && (!lead.phone || lead.phone.includes('555-'))) {
      lead.phone = parsed.phone;
    }
    if (lead.timeZone === 'America/New_York' && finalTimezone !== 'Unknown' && finalTimezone !== 'America/New_York') {
      lead.timeZone = finalTimezone;
    }
    await lead.save();
  }

  // 5. Schedule callback request in DB
  const request = await CallbackRequest.create({
    leadId: lead._id,
    studentName: parsed.studentName,
    email: parsed.email,
    phone: lead.phone,
    requestedTime: parsed.requestedTime,
    timezone: finalTimezone,
    scheduledAt: scheduledAt,
    status: 'Scheduled',
    notes: `Email: "${subject}" | Content: "${body}"`
  });

  // 6. Mark the lead's nextScheduledCall to ensure calls align
  lead.nextScheduledCall = scheduledAt;
  await lead.save();

  logger.info(`Callback request successfully scheduled for ${lead.fullName} at ${scheduledAt.toISOString()} (Tz: ${finalTimezone})`);
  return request;
}

/**
 * Main polling cycle
 */
async function pollInbox() {
  try {
    while (mockMailbox.length > 0) {
      const email = mockMailbox.shift();
      await processEmail(email.subject, email.body, email.fromEmail, email.fromName);
    }
  } catch (err) {
    logger.error('emailCallbackPoller poll error', { msg: err.message });
  }
}

function start() {
  setInterval(pollInbox, 60_000);
  logger.info('Email Callback Poller job started');
}

module.exports = {
  start,
  parseCallbackEmail,
  processEmail,
  mockMailbox
};
