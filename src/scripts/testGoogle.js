require('dotenv').config();
const { google } = require('googleapis');
const cfg = require('../config');

async function test() {
  const auth = new google.auth.JWT({
    email:  cfg.google.clientEmail,
    key:    cfg.google.privateKey,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/calendar',
    ],
  });

  try {
    const tokens = await auth.authorize();
    console.log('✅ Google Service Account: AUTHORIZED');
    console.log('   Email :', cfg.google.clientEmail);
    console.log('   Scopes: Sheets + Calendar');
  } catch (err) {
    console.log('❌ Google Auth FAILED:', err.message);
  }

  // Test Sheets API (only if GOOGLE_SHEETS_ID is set)
  if (cfg.google.sheetsId && !cfg.google.sheetsId.includes('your_')) {
    try {
      const sheets = google.sheets({ version: 'v4', auth });
      const res    = await sheets.spreadsheets.get({ spreadsheetId: cfg.google.sheetsId });
      console.log('✅ Google Sheets :', res.data.properties.title);
    } catch (err) {
      console.log('❌ Google Sheets :', err.message);
    }
  } else {
    console.log('⚠️  Google Sheets : GOOGLE_SHEETS_ID not set yet — skipped');
  }

  // Test Calendar API
  try {
    const cal = google.calendar({ version: 'v3', auth });
    const res = await cal.calendarList.list({ maxResults: 3 });
    const names = res.data.items.map(c => c.summary).join(', ');
    console.log('✅ Google Calendar:', names || '(primary)');
  } catch (err) {
    console.log('❌ Google Calendar:', err.message);
    if (err.message.includes('Calendar API has not been used')) {
      console.log('   → Enable it at: https://console.cloud.google.com/apis/library/calendar-json.googleapis.com?project=dogwood-outcome-468516-v4');
    }
  }

  process.exit(0);
}

test();
