/**
 * Resync DB with the current Google Sheet contents.
 * Use when sheet rows have been edited (names changed, etc.).
 *
 *   - Updates existing leads' name/grade/program if changed in sheet
 *   - Creates new leads for rows that don't exist in DB
 *   - Does NOT delete leads removed from the sheet (preserves history)
 *   - Skips leads with status 'meeting-scheduled' or 'contacted' from re-calling
 */
require('dotenv').config();
const mongoose      = require('mongoose');
const cfg           = require('../config');
const logger        = require('../logger');
const Lead          = require('../models/Lead');
const sheetsService = require('../services/sheetsService');
const emailSvc      = require('../services/emailService');
const twilioSvc     = require('../services/twilioService');
const { scoreLead } = require('../services/leadScoring');

const args = process.argv.slice(2);
const FORCE_CALL   = args.includes('--force-call');
const RESET_STALE  = args.includes('--reset-stale');

async function run() {
  await mongoose.connect(cfg.db.uri);
  console.log('✅ MongoDB connected\n');

  console.log('📋 Reading sheet…');
  const rows = await sheetsService.getAllLeads();
  console.log(`   Found ${rows.length} row(s) in sheet:\n`);
  rows.forEach(r => console.log(`   Row ${r.sheetRowIndex}: ${r.fullName} | Grade ${r.grade} | ${r.email} | ${r.phone} | ${r.courseInterest}`));
  console.log();

  console.log('🔍 Comparing to database…\n');
  for (const row of rows) {
    // Look up by sheetRowIndex first
    let lead = await Lead.findOne({ sheetRowIndex: row.sheetRowIndex });

    if (lead) {
      const changed = [];
      ['fullName','grade','email','phone','parentName','parentEmail','courseInterest'].forEach(f => {
        if (row[f] && row[f] !== lead[f]) {
          changed.push(`${f}: "${lead[f]}" → "${row[f]}"`);
          lead[f] = row[f];
        }
      });

      if (changed.length) {
        // Reset status so it gets called again with correct data
        if (RESET_STALE) {
          lead.status = 'queued';
          lead.callAttempts = [];
          lead.totalCallAttempts = 0;
          lead.qualification = undefined;
          lead.isQualified = false;
          changed.push('status → queued (reset)');
        }
        await lead.save();
        console.log(`🔄 Row ${row.sheetRowIndex}: SYNCED — ${changed.join(', ')}`);
      } else {
        console.log(`✅ Row ${row.sheetRowIndex}: already in sync (${lead.status})`);
      }
    } else {
      // Check if a lead exists by email/phone (sheetRowIndex changed)
      const dup = await Lead.findOne({ $or: [{ email: row.email }, { phone: row.phone }] });
      if (dup) {
        dup.sheetRowIndex = row.sheetRowIndex;
        // Also sync other fields
        ['fullName','grade','parentName','parentEmail','courseInterest'].forEach(f => {
          if (row[f]) dup[f] = row[f];
        });
        await dup.save();
        console.log(`🔄 Row ${row.sheetRowIndex}: re-linked existing lead (${dup.fullName})`);
      } else {
        // Brand new lead
        const lead = new Lead({ ...row, status: 'queued' });
        const { score, category } = scoreLead(lead);
        lead.leadScore    = score;
        lead.leadCategory = category;
        await lead.save();
        console.log(`✨ Row ${row.sheetRowIndex}: CREATED — ${lead.fullName} | Score ${score} [${category}]`);

        await sheetsService.updateRow(lead.sheetRowIndex, {
          status:  'Queued',
          score,
          summary: 'Lead synced. Call pending.',
        });

        // Send welcome email
        await emailSvc.sendNewLeadWelcome(lead).catch(e => logger.error('Welcome email failed', { msg: e.message }));

        if (FORCE_CALL) {
          console.log(`   📞 Placing call now (--force-call)…`);
          lead.status = 'calling';
          lead.totalCallAttempts += 1;
          lead.lastCallAt = new Date();
          lead.callAttempts.push({ attemptNumber: lead.totalCallAttempts, startTime: new Date(), status: 'initiated' });
          await lead.save();

          try {
            const { callSid } = await twilioSvc.call(lead, cfg.server.baseUrl);
            lead.callAttempts[lead.callAttempts.length - 1].callSid = callSid;
            await lead.save();
            console.log(`   ✅ Call SID: ${callSid}`);
            // Stagger calls 10s apart to avoid Twilio rate limits
            await new Promise(r => setTimeout(r, 10000));
          } catch(e) {
            console.log(`   ❌ Call failed: ${e.message}`);
          }
        }
      }
    }
  }

  console.log('\n✅ Resync complete');
  await mongoose.connection.close();
  process.exit(0);
}

run().catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
