/**
 * Prep365 Student Check-ins — this app's own calling workflow.
 *
 * Eligibility (decided here, NOT by Prep365's test mode / cooldown):
 *   callable  = has a valid phone (student first, else a parent) AND
 *               not opted out (Prep365 student/parent flags) AND
 *               not Do-Not-Contact (any lead with that phone marked do-not-call /
 *               do-not-contact, which includes opt-outs said during our own calls).
 * Prep365's callStatus is kept as `prep365CallStatus` for information only.
 *
 * Calls are placed ONLY by startCalls(), which the admin triggers from the
 * Check-ins page (row "Call" or "Call selected" + confirm). Calls run through the
 * shared bulkCallService queue (four-ring timeout, sequential, Stop, history).
 */
const supabase = require('../db/supabase');
const logger = require('../logger');
const Lead = require('../models/Lead');
const prep365Store = require('./prep365StudentStore');
const bulkCallService = require('./bulkCallService');
const { PREP365_CAMPAIGN_ID } = require('../utils/prep365');

const DNC_STATUSES = ['do-not-call', 'do-not-contact'];
const RUN_SOURCE = 'prep365-checkins';

const normalisePhone = bulkCallService.normalisePhone;
const hasValue = v => v !== undefined && v !== null && String(v).trim() !== '';

/** Phones of every lead marked Do-Not-Contact (normalised). */
async function getDncPhones() {
  const { data, error } = await supabase.from('leads').select('phone').in('status', DNC_STATUSES);
  if (error) throw new Error('Could not load Do-Not-Contact list: ' + error.message);
  return new Set((data || []).map(r => normalisePhone(r.phone)).filter(Boolean));
}

/**
 * App eligibility for one synced student.
 * @returns {{callable:boolean, blockedReason:string|null, blockedDetail:string, contact:object|null}}
 */
function evaluate(s, dncPhones) {
  const st = s.student || {};
  const p365 = s.prep365CallStatus || s.callStatus || {};
  const studentOptedOut = Boolean(st.optedOut) || p365.blockedReason === 'opted_out';

  const candidates = [];
  if (hasValue(st.phone)) candidates.push({ type: 'student', name: st.name || 'Student', raw: st.phone, optedOut: studentOptedOut });
  for (const p of (s.parents || [])) {
    if (hasValue(p.phone)) candidates.push({ type: 'parent', name: p.name || 'Parent', raw: p.phone, optedOut: Boolean(p.optedOut) });
  }

  if (!candidates.length) return { callable: false, blockedReason: 'no_phone', blockedDetail: 'No student or parent phone number in Prep365', contact: null };
  if (studentOptedOut) return { callable: false, blockedReason: 'opted_out', blockedDetail: 'Student opted out of calls', contact: null };

  const valid = candidates.map(c => ({ ...c, phone: normalisePhone(c.raw) })).filter(c => c.phone);
  if (!valid.length) return { callable: false, blockedReason: 'invalid_phone', blockedDetail: 'Phone number on file is not a valid number', contact: null };

  const usable = valid.filter(c => !c.optedOut);
  if (!usable.length) return { callable: false, blockedReason: 'opted_out', blockedDetail: 'All contacts opted out of calls', contact: null };

  const allowed = usable.filter(c => !dncPhones.has(c.phone));
  if (!allowed.length) return { callable: false, blockedReason: 'do_not_contact', blockedDetail: 'Number is on the Do-Not-Contact list', contact: null };

  const c = allowed[0]; // student's own phone first, otherwise the first parent
  return { callable: true, blockedReason: null, blockedDetail: '', contact: { type: c.type, name: c.name, phone: c.phone } };
}

/** Latest local call state per Prep365 student (from leads this app created). */
async function getLocalCallState() {
  const { data, error } = await supabase.from('leads')
    .select('id, status, last_call_at, call_attempts, qualification')
    .eq('source', 'Prep365');
  if (error) return new Map();
  const map = new Map();
  for (const l of data || []) {
    const sid = l.qualification?.prep365StudentId;
    if (!sid) continue;
    const attempts = Array.isArray(l.call_attempts) ? l.call_attempts : [];
    const last = attempts[attempts.length - 1] || null;
    const prev = map.get(sid);
    if (prev && Date.parse(prev.lastCallAt || 0) >= Date.parse(l.last_call_at || 0)) continue;
    map.set(sid, {
      leadId: l.id,
      leadStatus: l.status,
      lastCallAt: l.last_call_at,
      lastCall: last ? {
        status: last.status, at: last.startTime, durationSeconds: last.duration || last.durationSeconds || 0,
        summary: last.aiSummary || last.summary || '', callSid: last.callSid || null,
      } : null,
      totalCalls: attempts.length,
    });
  }
  return map;
}

/**
 * Overlay app eligibility + local call state on the synced list.
 * Callable students first (stable: keeps Prep365 priority order inside each group).
 */
async function decorateStudents(students) {
  const [dnc, local] = await Promise.all([getDncPhones().catch(e => { logger.warn('[Prep365] ' + e.message); return new Set(); }), getLocalCallState()]);
  const out = students.map((s, i) => {
    const prep365CallStatus = s.prep365CallStatus || s.callStatus || {};
    const elig = evaluate({ ...s, prep365CallStatus }, dnc);
    const loc = local.get((s.student || {}).id);
    const live = loc && ['queued', 'calling'].includes(loc.leadStatus) ? loc.leadStatus : null;
    return {
      ...s,
      _order: i,
      prep365CallStatus,
      callStatus: {
        callable: elig.callable,
        blockedReason: elig.blockedReason,
        blockedDetail: elig.blockedDetail,
        contact: elig.contact,
        phonesToCall: elig.contact ? [elig.contact] : [],
        liveStatus: live,                                   // queued / calling right now
        lastCall: (loc && loc.lastCall) || prep365CallStatus.lastCall || null,
        totalCalls: (loc ? loc.totalCalls : 0) + (prep365CallStatus.totalCalls || 0),
        prep365Cooldown: Boolean(prep365CallStatus.inCooldown) || prep365CallStatus.blockedReason === 'cooldown',
      },
    };
  });
  out.sort((a, b) => (Number(b.callStatus.callable) - Number(a.callStatus.callable)) || (a._order - b._order));
  out.forEach(s => delete s._order);
  return out;
}

async function getPrep365CampaignId() {
  try {
    const { data } = await supabase.from('campaigns').select('id').eq('type', 'prep365-retention').limit(1);
    if (data && data[0]?.id) return data[0].id;
  } catch (_) {}
  return PREP365_CAMPAIGN_ID;
}

/** Create or update the lead that represents this student's call. */
async function upsertCallLead(s, contact, campaignId) {
  const st = s.student || {};
  const qual = {
    prep365StudentId: st.id,
    prep365StudentName: st.name,
    prep365RecipientType: contact.type,
    prep365TalkingPoints: s.talkingPoints || '',
    prep365Reasons: s.reasons || [],
    prep365Snapshot: { activity: s.activity || {}, tests: s.tests || {}, customPrep: s.customPrep || [] },
    prep365Student: st,
  };
  const notes = s.talkingPoints || (s.reasons || []).map(r => r.label || r.code).join('; ');

  // Reuse this student's Prep365 lead for the same number, if any.
  const { data: rows } = await supabase.from('leads').select('id, qualification')
    .eq('source', 'Prep365').eq('phone', contact.phone);
  const existing = (rows || []).find(r => r.qualification?.prep365StudentId === st.id) || null;

  if (existing) {
    const lead = await Lead.findById(existing.id);
    lead.fullName = contact.name;
    lead.campaignId = campaignId;
    lead.notes = notes;
    lead.qualification = { ...(lead.qualification || {}), ...qual };
    await lead.save();
    return lead;
  }
  return Lead.create({
    fullName: contact.name,
    phone: contact.phone,
    email: contact.type === 'student' ? (st.email || '') : ((s.parents || []).find(p => normalisePhone(p.phone) === contact.phone)?.email || ''),
    grade: st.grade || '',
    source: 'Prep365',
    status: 'new',
    courseInterest: 'Prep365 Check-in',
    notes,
    campaignId,
    qualification: qual,
  });
}

/**
 * Start calls for the students the admin selected.
 * @returns plan (dry run) or the bulk run summary, plus per-student skipped reasons.
 */
async function startCalls({ studentIds, campaignId, user, dryRun }) {
  const ids = [...new Set((studentIds || []).map(String))];
  if (!ids.length) throw new Error('Select at least one student');

  const store = await prep365Store.getStudents();
  const byId = new Map((store.students || []).map(s => [String((s.student || {}).id), s]));
  const decorated = await decorateStudents(ids.map(id => byId.get(id)).filter(Boolean));
  const decoratedById = new Map(decorated.map(s => [String(s.student.id), s]));

  const skipped = [];
  const toCall = [];
  const seenPhones = new Set();
  for (const id of ids) {
    const s = decoratedById.get(id);
    if (!s) { skipped.push({ studentId: id, name: '', reason: 'Not in the synced list (sync again)' }); continue; }
    const cs = s.callStatus;
    if (!cs.callable) { skipped.push({ studentId: id, name: s.student.name, reason: cs.blockedDetail }); continue; }
    if (cs.liveStatus) { skipped.push({ studentId: id, name: s.student.name, reason: `Already ${cs.liveStatus}` }); continue; }
    if (seenPhones.has(cs.contact.phone)) { skipped.push({ studentId: id, name: s.student.name, reason: 'Same number already in this batch (sibling)' }); continue; }
    seenPhones.add(cs.contact.phone);
    toCall.push(s);
  }

  const finalCampaignId = campaignId || await getPrep365CampaignId();
  const plan = toCall.map(s => ({ studentId: s.student.id, name: s.student.name, contactType: s.callStatus.contact.type, contactName: s.callStatus.contact.name }));

  logger.info(`[Prep365] Manual call requested by ${user || 'unknown'}: selected=${ids.length} toCall=${toCall.length} skipped=${skipped.length} dryRun=${Boolean(dryRun)}`);

  if (dryRun || !toCall.length) {
    return { dryRun: Boolean(dryRun), queued: 0, plan, skipped, campaignId: finalCampaignId };
  }

  const leadIds = [];
  for (const s of toCall) {
    try {
      const lead = await upsertCallLead(s, s.callStatus.contact, finalCampaignId);
      leadIds.push(String(lead._id || lead.id));
    } catch (err) {
      skipped.push({ studentId: s.student.id, name: s.student.name, reason: 'Could not prepare call: ' + err.message });
    }
  }
  if (!leadIds.length) return { dryRun: false, queued: 0, plan, skipped, campaignId: finalCampaignId };

  const run = await bulkCallService.enqueue({
    leadIds,
    campaignId: finalCampaignId,
    counselor: user || 'admin',
    label: `Prep365 Check-ins (${leadIds.length})`,
    source: RUN_SOURCE,
  });
  for (const d of run.skippedDetails || []) skipped.push({ studentId: null, name: d.name, reason: d.reason });
  return { dryRun: false, queued: run.queued, runId: run.runId, run, plan, skipped, campaignId: finalCampaignId };
}

module.exports = { evaluate, decorateStudents, startCalls, getDncPhones, RUN_SOURCE };
