require('dotenv').config();
const { google } = require('googleapis');
const cfg = require('../config');

async function run() {
  const auth = new google.auth.JWT({
    email:  cfg.google.clientEmail,
    key:    cfg.google.privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  // Read first 5 rows
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: cfg.google.sheetsId,
    range: 'Sheet1!A1:L6',
  });

  const rows = res.data.values || [];
  if (!rows.length) {
    console.log('⚠️  Sheet is empty — no rows found');
    return;
  }

  console.log('\n📋 Sheet: "Test Prep Pundits Leads Information"');
  console.log('   ID:', cfg.google.sheetsId);
  console.log('   Rows read:', rows.length);
  console.log('\n── Header Row (Row 1) ──────────────────────────');
  const header = rows[0];
  header.forEach((col, i) => console.log(`   Col ${String.fromCharCode(65+i)} (${i}): ${col}`));

  if (rows.length > 1) {
    console.log('\n── Sample Data Row (Row 2) ─────────────────────');
    const sample = rows[1];
    header.forEach((col, i) => {
      if (sample[i]) console.log(`   ${col}: ${sample[i]}`);
    });
  }

  // Check if AI columns I-L exist
  const hasAICols = header.length >= 9;
  console.log('\n── AI Status Columns ───────────────────────────');
  console.log(`   Col I (AI Status)  : ${header[8]  || '⚠️  missing — will be added on first lead'}`);
  console.log(`   Col J (Lead Score) : ${header[9]  || '⚠️  missing — will be added on first lead'}`);
  console.log(`   Col K (AI Summary) : ${header[10] || '⚠️  missing — will be added on first lead'}`);
  console.log(`   Col L (Updated)    : ${header[11] || '⚠️  missing — will be added on first lead'}`);

  console.log('\n✅ Sheet is accessible and ready!');
  process.exit(0);
}

run().catch(e => {
  console.error('❌ Sheet check failed:', e.message);
  if (e.message.includes('403')) {
    console.log('\n   → Share the Sheet with:');
    console.log('     aiprep365@dogwood-outcome-468516-v4.iam.gserviceaccount.com');
    console.log('     (give Editor access)');
  }
  process.exit(1);
});
