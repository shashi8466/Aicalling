/**
 * Call every lead in the DB that hasn't been successfully contacted yet.
 * Runs all calls in sequence with 30s gap between each.
 */
require('dotenv').config();
const mongoose      = require('mongoose');
const cfg           = require('../config');
const Lead          = require('../models/Lead');
const twilioSvc     = require('../services/twilioService');
const emailSvc      = require('../services/emailService');
const sheetsSvc     = require('../services/sheetsService');

async function run() {
  await mongoose.connect(cfg.db.uri);
  console.log('✅ MongoDB connected\n');

  // Optionally: filter who to call. Default = anyone not already scheduled or enrolled.
  const callable = await Lead.find({
    status: { $nin: ['meeting-scheduled', 'enrolled', 'do-not-call'] },
  }).sort({ leadScore: -1 });

  console.log(`Found ${callable.length} callable lead(s):\n`);
  callable.forEach((l, i) => console.log(`${i+1}. ${l.fullName} | ${l.phone} | Status: ${l.status} | Score: ${l.leadScore}`));
  console.log();

  for (let i = 0; i < callable.length; i++) {
    const lead = callable[i];
    console.log(`\n─── [${i+1}/${callable.length}] ${lead.fullName} ──────────────────`);

    // Validate phone first
    const phoneOk = /^\+[1-9]\d{6,14}$/.test(lead.phone);
    if (!phoneOk) {
      console.log(`❌ Skipping ${lead.fullName} — invalid phone format: "${lead.phone}"`);
      await sheetsSvc.updateRow(lead.sheetRowIndex, {
        status: 'Invalid Phone',
        score: lead.leadScore,
        summary: `Phone "${lead.phone}" is not a valid E.164 number. Please fix the sheet.`,
      });
      continue;
    }

    try {
      // Welcome email first
      await emailSvc.sendNewLeadWelcome(lead).catch(() => {});

      lead.status = 'calling';
      lead.totalCallAttempts += 1;
      lead.lastCallAt = new Date();
      lead.callAttempts.push({
        attemptNumber: lead.totalCallAttempts,
        startTime: new Date(),
        status: 'initiated',
      });
      await lead.save();

      const { callSid } = await twilioSvc.call(lead, cfg.server.baseUrl);
      lead.callAttempts[lead.callAttempts.length - 1].callSid = callSid;
      await lead.save();
      console.log(`✅ Calling ${lead.phone} | SID: ${callSid}`);

      await sheetsSvc.updateRow(lead.sheetRowIndex, {
        status: 'Calling',
        score: lead.leadScore,
        summary: `Call placed. SID: ${callSid}`,
      });

      if (i < callable.length - 1) {
        console.log('   ⏱  Waiting 30s before next call…');
        await new Promise(r => setTimeout(r, 30000));
      }
    } catch(e) {
      console.log(`❌ ${lead.fullName} call failed: ${e.message}`);
      lead.status = 'queued';
      await lead.save();
    }
  }

  console.log('\n✅ All calls dispatched');
  await mongoose.connection.close();
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
