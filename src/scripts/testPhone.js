require('dotenv').config();
const twilio = require('twilio');
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

function normalizePhone(raw) {
  if (!raw) return '';
  const cleaned = raw.replace(/^[^+\d]+/, '').trim();
  if (cleaned.startsWith('+')) return '+' + cleaned.slice(1).replace(/\D/g, '');
  const d = cleaned.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91'))  return '+' + d;
  if (d.length === 11 && d.startsWith('0'))   return '+91' + d.slice(1);
  if (d.length === 11 && d.startsWith('1'))   return '+' + d;
  // 10 digits without country code → default US/Canada
  // Indian numbers MUST include +91 or 91 prefix in the sheet
  if (d.length === 10)                         return '+1' + d;
  if (d.length > 7)                            return '+' + d;
  return cleaned;
}

const tests = [
  // ── Indian formats ──────────────────────────────────────────────────
  ['.+918466924574', '+918466924574',  'India — sheet dot prefix'],
  ['+91 8466924574', '+918466924574',  'India — +91 with space'],
  ['+91-846-692-4574','+918466924574', 'India — dashes'],
  ['918466924574',   '+918466924574',  'India — no plus (12 digits)'],
  ['08466924574',    '+918466924574',  'India — leading 0 (11 digits)'],
  ['8466924574',     '+18466924574',   'India — 10 digits NO prefix → treated as US (use +91 in sheet!)'],
  // ── US formats ──────────────────────────────────────────────────────
  ['+1 908 774 9227','+19087749227',   'USA   — +1 with spaces'],
  ['9087749227',     '+19087749227',   'USA   — 10 digits (not 6-9 mobile prefix)'],
  ['19087749227',    '+19087749227',   'USA   — 11 digits with 1'],
  ['+1-908-774-9227','+19087749227',   'USA   — dashes'],
  // ── International ───────────────────────────────────────────────────
  ['+447911123456',  '+447911123456',  'UK    — +44'],
  ['+4915112345678', '+4915112345678', 'Germany — +49'],
];

console.log('\n══════════════════════════════════════════════════════');
console.log('  Phone Normalisation — India + USA + International');
console.log('══════════════════════════════════════════════════════\n');

let pass = 0, fail = 0;
tests.forEach(([input, expected, label]) => {
  const got = normalizePhone(input);
  const ok  = got === expected;
  ok ? pass++ : fail++;
  console.log(`${ok ? '✅' : '❌'}  ${label}`);
  if (!ok) {
    console.log(`     Input   : ${input}`);
    console.log(`     Got     : ${got}`);
    console.log(`     Expected: ${expected}`);
  } else {
    console.log(`     ${input.padEnd(22)} →  ${got}`);
  }
});

console.log(`\n  ${pass}/${tests.length} passed\n`);

// ── Twilio geo permission check ───────────────────────────────────────────────
async function checkGeoPerms() {
  console.log('══════════════════════════════════════════════════════');
  console.log('  Twilio Geo Permissions');
  console.log('══════════════════════════════════════════════════════\n');

  for (const [iso, label] of [['US','USA'], ['IN','India']]) {
    try {
      const c = await client.voice.v1.dialingPermissions.countries(iso).fetch();
      const status = c.lowRiskNumbersEnabled ? '✅ ENABLED' : '❌ DISABLED';
      console.log(`  ${label.padEnd(8)} (${iso}): Low-risk calling ${status}`);
    } catch(e) {
      console.log(`  ${label}: ${e.message}`);
    }
  }

  // ── Twilio lookup: validate both numbers ─────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  Number Validation via Twilio Lookup');
  console.log('══════════════════════════════════════════════════════\n');

  for (const [num, label] of [['+918466924574','India lead'], ['+19087749227','Twilio phone']]) {
    try {
      const r = await client.lookups.v2.phoneNumbers(num).fetch();
      const valid = r.valid !== false;
      console.log(`  ${label.padEnd(14)}: ${num} → ${valid ? '✅ Valid' : '❌ Invalid'} | Country: ${r.countryCode}`);
    } catch(e) {
      // Fallback: E.164 regex check
      const valid = /^\+[1-9]\d{6,14}$/.test(num);
      console.log(`  ${label.padEnd(14)}: ${num} → ${valid ? '✅ Valid E.164 format' : '❌ Invalid'}`);
    }
  }
  console.log('');
}

checkGeoPerms().catch(console.error);
