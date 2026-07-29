const moment = require('moment-timezone');
const OpenAI = require('openai');
const CallbackRequest = require('../models/CallbackRequest');
const Lead = require('../models/Lead');
const logger = require('../logger');
const cfg = require('../config');

const openai = new OpenAI({ apiKey: cfg.openai.apiKey });

const mockMailbox = [];

async function parseCallbackEmail(subject, body, fromEmail, fromName) {
  const email = fromEmail || '';
  const name = fromName || 'Unknown Student';
  
  const phoneMatch = body.match(/(\+?\d[\d-\s()]{8,15}\d)/);
  const phone = phoneMatch ? phoneMatch[0].trim() : '';
  
  // Use AI Intent Detection
  let aiDetectedIntent = 'Unknown';
  let requestedTime = 'Immediate';
  let requestedDate = 'Today';
  
  try {
    const prompt = `You are an AI assistant that analyzes incoming email replies. 
Analyze the following email to detect if the user is asking for a callback, and if so, extract the intent, date, and time.
Email Subject: ${subject}
Email Body: ${body}

Respond in JSON format only with the following keys:
{
  "isCallbackRequest": true/false,
  "intent": "Brief 3-5 word summary of intent, e.g. 'Wants callback tomorrow'",
  "requested_time": "Extracted time (e.g. '5 PM', 'Morning', 'Immediate' if unspecified)",
  "requested_date": "Extracted date (e.g. 'Tomorrow', 'Oct 15', 'Today' if unspecified)"
}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    });
    
    const aiData = JSON.parse(response.choices[0].message.content);
    if (aiData.isCallbackRequest) {
      aiDetectedIntent = aiData.intent;
      requestedTime = aiData.requested_time;
      requestedDate = aiData.requested_date;
    } else {
      aiDetectedIntent = 'Not a callback request';
    }
  } catch (err) {
    logger.error('AI Intent Detection failed: ' + err.message);
  }

  // Parse time and timezone, e.g. "5pm cst", "10:30 am ist"
  const timeRegex = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(cst|est|pst|mst|ist|gmt|utc)/i;
  const match = body.match(timeRegex) || subject.match(timeRegex);
  
  let explicitTimezone = null;
  let parsedTime = null; 

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
    requestedDate,
    explicitTimezone,
    parsedTime,
    aiDetectedIntent
  };
}

async function processEmail(subject, body, fromEmail, fromName, mailObj = null) {
  logger.info('Processing callback request email from ' + fromEmail);
  
  const parsed = await parseCallbackEmail(subject, body, fromEmail, fromName);
  
  if (parsed.aiDetectedIntent === 'Not a callback request') {
    logger.info('Skipping email, not a callback request.');
    return null;
  }

  let lead = await Lead.findOne({ email: parsed.email });

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

  let scheduledAt = new Date();
  if (parsed.parsedTime) {
    const calculationTz = resolvedTz || 'America/New_York';
    let target = moment().tz(calculationTz);
    let targetHour = parsed.parsedTime.hour;
    if (parsed.parsedTime.ampm === 'pm' && parsed.parsedTime.hour < 12) targetHour += 12;
    if (parsed.parsedTime.ampm === 'am' && parsed.parsedTime.hour === 12) targetHour = 0;
    target.hour(targetHour).minute(parsed.parsedTime.min).second(0).millisecond(0);
    if (target.isBefore(moment())) target.add(1, 'day');
    scheduledAt = target.toDate();
  }

  if (!lead) {
    lead = await Lead.create({
      fullName: parsed.studentName,
      email: parsed.email,
      phone: parsed.phone || '+15555555555',
      status: 'queued',
      meetingStatus: 'Not Booked',
      timeZone: finalTimezone === 'Unknown' ? 'America/New_York' : finalTimezone,
      notes: 'Auto-created from Callback Email Request: ' + body
    });
  } else {
    if (parsed.phone && (!lead.phone || lead.phone.includes('555-'))) lead.phone = parsed.phone;
    if (lead.timeZone === 'America/New_York' && finalTimezone !== 'Unknown' && finalTimezone !== 'America/New_York') lead.timeZone = finalTimezone;
    await lead.save();
  }

  const originalEmail = mailObj ? (mailObj.text || mailObj.html || body) : body;

  const request = await CallbackRequest.create({
    leadId: lead._id,
    studentName: parsed.studentName,
    parentName: '',
    email: parsed.email,
    phone: lead.phone,
    requestedTime: parsed.requestedTime,
    requestedDate: parsed.requestedDate,
    timezone: finalTimezone,
    scheduledAt: scheduledAt,
    status: 'Pending',
    notes: 'Email: ' + subject,
    originalEmail: originalEmail,
    emailSubject: subject,
    aiDetectedIntent: parsed.aiDetectedIntent,
    assignedCounselor: cfg.admin.email || ''
  });

  lead.nextScheduledCall = scheduledAt;
  await lead.save();

  logger.info('Callback request successfully scheduled for ' + lead.fullName + ' at ' + scheduledAt.toISOString());
  
  try {
    const crmRoutes = require('../routes/crm');
    if (crmRoutes.broadcastUpdate) {
      crmRoutes.broadcastUpdate('callback_new', request);
    }
  } catch (err) {}
  
  return request;
}

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
  setInterval(pollInbox, 60000);
  logger.info('Email Callback Poller dummy loop started');
}

module.exports = { start, parseCallbackEmail, processEmail, mockMailbox };
