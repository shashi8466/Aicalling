#!/usr/bin/env node
/**
 * fix_meeting_links.js
 * ─────────────────────────────────────────────────────────────────────
 * Finds every meeting in Supabase whose `meet_link` contains a tunnel /
 * temporary domain and rewrites it to use MEETING_BASE_URL.
 *
 * Run:  node src/scripts/fix_meeting_links.js
 *
 * Safe to run multiple times — skips rows that are already correct.
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const MEETING_BASE_URL = (process.env.MEETING_BASE_URL || '').replace(/\/$/, '');
const SUPABASE_URL     = process.env.SUPABASE_URL;
const SERVICE_KEY      = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Tunnel / temporary domain patterns to replace
const BAD_PATTERNS = [
  /https?:\/\/[a-z0-9\-]+\.serveousercontent\.com/gi,
  /https?:\/\/[a-z0-9\-]+\.lhr\.life/gi,
  /https?:\/\/[a-z0-9\-]+\.ngrok\.io/gi,
  /https?:\/\/[a-z0-9\-]+\.ngrok-free\.app/gi,
  /https?:\/\/[a-z0-9\-]+\.localtunnel\.me/gi,
  /https?:\/\/localhost:\d+/gi,
  /http:\/\/localhost:\d+/gi,
];

function isBadLink(url) {
  if (!url) return false;
  // Reset lastIndex for global regexes
  return BAD_PATTERNS.some(p => { p.lastIndex = 0; return p.test(url); });
}

function rewriteLink(url) {
  // Extract the /meeting/<roomName>[?...] path
  const m = url.match(/\/meeting\/([^?#\s]+)([\?#].*)?$/);
  if (!m) return null; // Can't parse room name — skip
  const roomName = m[1];
  const qs       = m[2] || '';
  return `${MEETING_BASE_URL}/meeting/${roomName}${qs}`;
}

async function main() {
  if (!MEETING_BASE_URL || !MEETING_BASE_URL.startsWith('https')) {
    console.error('ERROR: MEETING_BASE_URL must be a permanent HTTPS URL. Got:', MEETING_BASE_URL);
    process.exit(1);
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  console.log('\nScanning meetings table for bad links...');
  console.log('Target base URL:', MEETING_BASE_URL, '\n');

  // 1. Fix meetings table
  const { data: meetings, error: fetchErr } = await supabase
    .from('meetings')
    .select('id, meet_link, lead_id')
    .not('meet_link', 'is', null)
    .neq('meet_link', '');

  if (fetchErr) { console.error('Failed to fetch meetings:', fetchErr.message); process.exit(1); }

  let meetFixed = 0, meetSkipped = 0, meetFailed = 0;
  for (const row of meetings || []) {
    const old = row.meet_link;
    if (!isBadLink(old)) { meetSkipped++; continue; }

    const fixed = rewriteLink(old);
    if (!fixed) {
      console.warn('  WARNING: Could not rewrite:', old, '(room name not parseable)');
      meetFailed++;
      continue;
    }

    const { error: updateErr } = await supabase
      .from('meetings')
      .update({ meet_link: fixed })
      .eq('id', row.id);

    if (updateErr) {
      console.error('  ERROR updating meeting', row.id, ':', updateErr.message);
      meetFailed++;
    } else {
      console.log('  FIXED meeting', row.id);
      console.log('    OLD:', old);
      console.log('    NEW:', fixed);
      meetFixed++;
    }
  }

  // 2. Fix leads table (meeting embedded in lead record)
  console.log('\nScanning leads table for embedded bad meeting links...');

  const { data: leads, error: leadErr } = await supabase
    .from('leads')
    .select('id, meeting')
    .not('meeting', 'is', null);

  if (leadErr) { console.error('Failed to fetch leads:', leadErr.message); process.exit(1); }

  let leadFixed = 0, leadSkipped = 0;
  for (const row of leads || []) {
    const mtg = row.meeting;
    if (!mtg || (!mtg.meetLink && !mtg.hostMeetLink)) { leadSkipped++; continue; }

    let changed = false;
    const updated = { ...mtg };

    if (mtg.meetLink && isBadLink(mtg.meetLink)) {
      const fixed = rewriteLink(mtg.meetLink);
      if (fixed) { updated.meetLink = fixed; changed = true; }
    }
    if (mtg.hostMeetLink && isBadLink(mtg.hostMeetLink)) {
      const fixed = rewriteLink(mtg.hostMeetLink);
      if (fixed) { updated.hostMeetLink = fixed; changed = true; }
    }

    if (!changed) { leadSkipped++; continue; }

    const { error: updateErr } = await supabase
      .from('leads')
      .update({ meeting: updated })
      .eq('id', row.id);

    if (updateErr) {
      console.error('  ERROR updating lead', row.id, ':', updateErr.message);
    } else {
      console.log('  FIXED lead', row.id, 'meeting links');
      leadFixed++;
    }
  }

  console.log('\n================================================');
  console.log('MEETING LINK FIX COMPLETE');
  console.log('================================================');
  console.log('meetings table: ', meetFixed, 'fixed,', meetSkipped, 'already OK,', meetFailed, 'errors');
  console.log('leads table:    ', leadFixed, 'fixed,', leadSkipped, 'already OK');
  console.log('\nAll future meetings will use:', MEETING_BASE_URL);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
