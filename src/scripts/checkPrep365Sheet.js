require('dotenv').config();
const { google } = require('googleapis');
const cfg = require('../config');

async function checkSheet() {
  const auth = new google.auth.JWT({
    email: cfg.google.clientEmail,
    key: cfg.google.privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });
  const sheetId = process.env.PREP365_CALL_LOG_SHEET_ID;

  console.log('Reading Calls tab from', sheetId, '...');
  const res1 = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "'Calls'!A1:S5"
  });
  console.log('Calls tab rows count:', res1.data.values?.length);
  if (res1.data.values) {
    res1.data.values.forEach((r, idx) => console.log('Row ' + (idx+1) + ':', r.slice(0, 12).join(' | '), '... Outreach ID:', r[18]));
  }

  console.log('\nReading Students tab from', sheetId, '...');
  const res2 = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "'Students'!A1:M5"
  });
  console.log('Students tab rows count:', res2.data.values?.length);
  if (res2.data.values) {
    res2.data.values.forEach((r, idx) => console.log('Row ' + (idx+1) + ':', r.join(' | ')));
  }
}
checkSheet();
