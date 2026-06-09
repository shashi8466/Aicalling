require('dotenv').config();
const mongoose = require('mongoose');
const cfg = require('../config');
const Lead = require('../models/Lead');
const sheetsService = require('../services/sheetsService');

async function run() {
  await mongoose.connect(cfg.db.uri);

  console.log('\n═══ LEADS IN DATABASE ═══\n');
  const leads = await Lead.find({}).sort({ createdAt: 1 });
  leads.forEach((l, i) => {
    console.log(`${i+1}. ${l.fullName} | Grade ${l.grade} | ${l.email} | ${l.phone}`);
    console.log(`   Status: ${l.status} | Score: ${l.leadScore} | Attempts: ${l.totalCallAttempts}`);
    console.log(`   Sheet row: ${l.sheetRowIndex}`);
    if (l.callAttempts.length > 0) {
      const last = l.callAttempts[l.callAttempts.length - 1];
      console.log(`   Last call: ${last.status} | Sentiment: ${last.sentiment}`);
      if (last.transcript) console.log(`   Transcript snippet: "${last.transcript.slice(0, 150)}..."`);
    }
    console.log();
  });

  console.log('\n═══ LIVE SHEET READ ═══\n');
  sheetsService.lastRow = 1; // reset to read all
  const rows = await sheetsService.getNewLeads();
  rows.forEach((r, i) => {
    console.log(`Sheet Row ${r.sheetRowIndex}: ${r.fullName} | Grade ${r.grade} | ${r.email} | ${r.phone}`);
  });

  await mongoose.connection.close();
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
