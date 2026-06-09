/**
 * Setup verification script
 * Run: node src/scripts/setup.js
 * Checks every external service before you start.
 */
require('dotenv').config();
const twilio    = require('twilio');
const { google } = require('googleapis');
const mongoose  = require('mongoose');
const axios     = require('axios');
const OpenAI    = require('openai');
const cfg       = require('../config');

const OK   = '✅';
const FAIL = '❌';
const WARN = '⚠️ ';

async function run() {
  console.log('\n══════════════════════════════════════════════════');
  console.log('  Test Prep Pundits – AI Agent  |  Setup Check');
  console.log('══════════════════════════════════════════════════\n');

  // 1 ─ Twilio
  try {
    const client  = twilio(cfg.twilio.accountSid, cfg.twilio.authToken);
    const numbers = await client.incomingPhoneNumbers.list({ limit: 20 });
    const matched = numbers.find(n => n.phoneNumber === cfg.twilio.phoneNumber);
    console.log(`${OK}  Twilio        → connected | ${cfg.twilio.phoneNumber} ${matched ? '(verified)' : WARN + '(number not found in account)'}`);
  } catch (e) {
    console.log(`${FAIL}  Twilio        → ${e.message}`);
  }

  // 2 ─ OpenAI
  try {
    const client = new OpenAI({ apiKey: cfg.openai.apiKey });
    const models = await client.models.list();
    const haGPT4 = models.data.some(m => m.id.includes('gpt-4'));
    console.log(`${OK}  OpenAI        → API key valid ${haGPT4 ? '| GPT-4 available' : ''}`);
  } catch (e) {
    console.log(`${FAIL}  OpenAI        → ${e.message}`);
  }

  // 3 ─ Brevo (send a test to the from-address itself)
  try {
    const res = await axios.get('https://api.brevo.com/v3/account', {
      headers: { 'api-key': cfg.brevo.apiKey, 'Accept': 'application/json' },
      timeout: 8000,
    });
    const plan = res.data.plan?.[0]?.type || 'unknown';
    console.log(`${OK}  Brevo Email   → account: ${res.data.email} | plan: ${plan}`);
  } catch (e) {
    const detail = e.response?.data?.message || e.message;
    console.log(`${FAIL}  Brevo Email   → ${detail}`);
  }

  // 4 ─ Google Sheets
  try {
    const auth = new google.auth.JWT({
      email:  cfg.google.clientEmail,
      key:    cfg.google.privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const res    = await sheets.spreadsheets.get({ spreadsheetId: cfg.google.sheetsId });
    console.log(`${OK}  Google Sheets → "${res.data.properties.title}"`);
  } catch (e) {
    const tip = e.message.includes('invalid_grant') || e.message.includes('DECODER')
      ? '  Tip: check GOOGLE_PRIVATE_KEY has real \\n newlines'
      : e.message.includes('403') ? '  Tip: share the Sheet with the service account email (Editor)'
      : '';
    console.log(`${FAIL}  Google Sheets → ${e.message}${tip}`);
  }

  // 5 ─ Google Calendar
  try {
    const auth = new google.auth.JWT({
      email:  cfg.google.clientEmail,
      key:    cfg.google.privateKey,
      scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    });
    const cal = google.calendar({ version: 'v3', auth });
    const res = await cal.calendarList.get({ calendarId: cfg.google.calendarId });
    console.log(`${OK}  Google Cal    → "${res.data.summary}"`);
  } catch (e) {
    console.log(`${FAIL}  Google Cal    → ${e.message}`);
  }

  // 6 ─ MongoDB
  try {
    await mongoose.connect(cfg.db.uri, { serverSelectionTimeoutMS: 4000 });
    console.log(`${OK}  MongoDB       → connected`);
    await mongoose.connection.close();
  } catch (e) {
    console.log(`${FAIL}  MongoDB       → ${e.message}`);
    console.log(`       Tip: make sure MongoDB is running  →  mongod`);
  }

  // 7 ─ BASE_URL
  const base = cfg.server.baseUrl;
  if (base.includes('localhost') || base.includes('your-ngrok')) {
    console.log(`${WARN}  BASE_URL      → "${base}"  ← update this to your public ngrok URL before calls will work`);
  } else {
    console.log(`${OK}  BASE_URL      → ${base}`);
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log('  Fix any ❌ items above, then start with:');
  console.log('    npm run dev');
  console.log('══════════════════════════════════════════════════\n');
  process.exit(0);
}

run();
