/**
 * Manual call trigger script
 * Usage:  node src/scripts/manualCall.js
 *
 * 1. Connects to MongoDB
 * 2. Reads shashi's lead from Google Sheets
 * 3. Creates / finds the Lead record
 * 4. Places the outbound Twilio call immediately
 */
require('dotenv').config();
const mongoose    = require('mongoose');
const cfg         = require('../config');
const logger      = require('../logger');
const sheetsService = require('../services/sheetsService');
const twilioSvc   = require('../services/twilioService');
const emailSvc    = require('../services/emailService');
const { scoreLead } = require('../services/leadScoring');
const Lead        = require('../models/Lead');

async function run() {
  console.log('\n══════════════════════════════════════════');
  console.log('  Manual Call Trigger – Test Prep Pundits');
  console.log('══════════════════════════════════════════\n');

  // 1. MongoDB
  try {
    await mongoose.connect(cfg.db.uri, { serverSelectionTimeoutMS: 5000 });
    console.log('✅ MongoDB connected:', cfg.db.uri);
  } catch(e) {
    console.log('❌ MongoDB failed:', e.message);
    console.log('\n💡 Fix: update MONGODB_URI in .env to your MongoDB Atlas connection string');
    console.log('   Get a free cluster at: https://cloud.mongodb.com\n');
    process.exit(1);
  }

  // 2. BASE_URL check
  if (!cfg.server.baseUrl || cfg.server.baseUrl.includes('your-ngrok')) {
    console.log('❌ BASE_URL not set in .env');
    console.log('   Twilio needs a public URL for webhooks.');
    console.log('   Run:  npx lt --port 3000  →  copy the URL → set BASE_URL in .env\n');
    process.exit(1);
  }
  console.log('✅ BASE_URL:', cfg.server.baseUrl);

  // 3. Find or create Shashi's lead
  let lead = await Lead.findOne({ $or: [{ email: 'shashiedula@gmail.com' }, { phone: '+918466924574' }] });

  if (!lead) {
    console.log('📋 Lead not found in DB — reading from Google Sheets…');
    // Reset the lastRow so getNewLeads picks up row 2
    sheetsService.lastRow = 1;
    const rows = await sheetsService.getNewLeads();

    if (!rows.length) {
      console.log('❌ No leads found in Sheet');
      process.exit(1);
    }

    const row = rows[0];
    console.log('   Found in Sheet:', row.fullName, '|', row.phone);

    lead = new Lead({ ...row, status: 'queued' });
    const { score, category } = scoreLead(lead);
    lead.leadScore    = score;
    lead.leadCategory = category;
    await lead.save();
    console.log('✅ Lead created:', lead.fullName, '| Score:', score, `(${category})`);

    // Update sheet
    await sheetsService.updateRow(lead.sheetRowIndex, {
      status:  'Calling Now',
      score,
      summary: 'Manual call triggered.',
    });
  } else {
    console.log('✅ Lead found in DB:', lead.fullName, '|', lead.phone, '| Status:', lead.status);
  }

  // 4. Send welcome email first
  console.log('\n📧 Sending welcome email…');
  const emailResult = await emailSvc.sendNewLeadWelcome(lead);
  console.log(emailResult.ok ? '✅ Welcome email sent' : '⚠️  Email failed: ' + emailResult.error);

  // 5. Place the call
  console.log('\n📞 Placing call to', lead.phone, '…');
  lead.status = 'calling';
  lead.totalCallAttempts += 1;
  lead.lastCallAt = new Date();
  lead.callAttempts.push({
    attemptNumber: lead.totalCallAttempts,
    startTime: new Date(),
    status: 'initiated',
  });
  await lead.save();

  try {
    const { callSid, status } = await twilioSvc.call(lead, cfg.server.baseUrl);
    // Save callSid
    lead.callAttempts[lead.callAttempts.length - 1].callSid = callSid;
    await lead.save();

    console.log('\n✅ CALL PLACED SUCCESSFULLY!');
    console.log('   Call SID   :', callSid);
    console.log('   Status     :', status);
    console.log('   Calling    :', lead.phone);
    console.log('   From       :', cfg.twilio.phoneNumber);
    console.log('   Webhook    :', cfg.server.baseUrl + '/webhook/call/start?leadId=' + lead._id);
    console.log('\n   Shashi Kumar will speak when the lead answers 📞\n');

    await sheetsService.updateRow(lead.sheetRowIndex, {
      status: 'Call Placed',
      score:  lead.leadScore,
      summary: `Call SID: ${callSid}. Calling ${lead.phone}.`,
    });
  } catch(e) {
    console.log('❌ Call failed:', e.message);
    if (e.message.includes('is not a valid phone number')) {
      console.log('   Phone issue. Number in DB:', lead.phone);
    }
    if (e.message.includes('Geo permission')) {
      console.log('   Enable India calling at: https://console.twilio.com/us1/develop/voice/settings/geo-permissions');
    }
    lead.status = 'queued';
    await lead.save();
  }

  await mongoose.connection.close();
  process.exit(0);
}

run().catch(e => { console.error(e.message); process.exit(1); });
