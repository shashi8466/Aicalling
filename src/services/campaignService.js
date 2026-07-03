/**
 * Campaign Service — Supabase-backed campaign management + stats.
 *
 * DESIGN SAFETY: Every DB call is wrapped so that a missing `campaigns` table
 * or `campaign_id` column NEVER breaks existing features. In particular,
 * `resolveForLead()` always returns a usable default (Demo Test Follow-up), so
 * the AI calling pipeline behaves exactly as before even if the campaigns
 * migration has not been applied yet.
 */
const supabase   = require('../db/supabase');
const logger     = require('../logger');
const registry   = require('../campaigns/registry');

const TABLE = 'campaigns';

// Statuses that indicate a lead progressed to (or past) a booked meeting.
const MEETING_STATUSES = [
  'meeting-scheduled', 'meeting-completed', 'proposal-sent', 'interested',
  'enrollment-pending', 'payment-pending', 'enrolled',
];
// Statuses that indicate genuine interest (used for "Interested Students").
const INTERESTED_STATUSES = [
  'qualified', 'interested', 'proposal-sent', 'meeting-scheduled',
  'meeting-completed', 'enrollment-pending', 'payment-pending', 'enrolled',
];

let _defaultDemoIdCache = null;

// ── Seeding ────────────────────────────────────────────────────────────────
/**
 * Ensure the 8 built-in campaigns exist. Idempotent. Never throws — logs a
 * warning if the campaigns table is not present yet.
 */
async function ensureDefaultCampaigns() {
  try {
    const { data: existing, error } = await supabase
      .from(TABLE)
      .select('type')
      .eq('is_default', true);

    if (error) {
      logger.warn(`Campaigns table not ready — skipping seed. (${error.message})`);
      return;
    }

    const have = new Set((existing || []).map(r => r.type));
    const toInsert = registry.defaultTypes()
      .filter(t => !have.has(t))
      .map(t => {
        const c = registry.getCampaign(t);
        return {
          name:       c.name,
          type:       c.type,
          program:    c.program || '',
          status:     'active',
          is_default: true,
        };
      });

    if (toInsert.length) {
      const { error: insErr } = await supabase.from(TABLE).insert(toInsert);
      if (insErr) logger.warn(`Campaign seed insert failed: ${insErr.message}`);
      else logger.info(`Seeded ${toInsert.length} default campaign(s)`);
    }
  } catch (e) {
    logger.warn(`ensureDefaultCampaigns skipped: ${e.message}`);
  }
}

// ── Resolution (used by the live-call pipeline) ──────────────────────────────
/**
 * Resolve a lead's campaign for scripting purposes.
 * Returns { type, row } — falls back to the default demo campaign on ANY issue.
 */
async function resolveForLead(lead) {
  const fallback = { type: registry.DEFAULT_TYPE, row: null };
  try {
    if (!lead || !lead.campaignId) return fallback;
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('id', lead.campaignId)
      .single();
    if (error || !data) return fallback;
    return { type: data.type || registry.DEFAULT_TYPE, row: data };
  } catch (e) {
    logger.warn(`resolveForLead fell back to default: ${e.message}`);
    return fallback;
  }
}

// ── CRUD ─────────────────────────────────────────────────────────────────────
async function list() {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

async function getById(id) {
  const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).single();
  if (error) return null;
  return data;
}

async function create({ name, type, program, goal, description, script, status }) {
  const row = {
    name:        (name || '').trim(),
    type:        (type || 'custom').trim(),
    program:     (program || '').trim(),
    goal:        (goal || '').trim(),
    description: (description || '').trim(),
    script:      script || {},
    status:      ['active', 'paused', 'completed'].includes(status) ? status : 'active',
    is_default:  false,
  };
  const { data, error } = await supabase.from(TABLE).insert(row).select().single();
  if (error) throw new Error(error.message);
  return data;
}

async function update(id, patch) {
  const allowed = ['name', 'program', 'goal', 'description', 'script', 'status'];
  const row = {};
  for (const k of allowed) if (patch[k] !== undefined) row[k] = patch[k];
  if (row.status && !['active', 'paused', 'completed'].includes(row.status)) {
    throw new Error('Invalid status — must be active, paused, or completed');
  }
  const { data, error } = await supabase.from(TABLE).update(row).eq('id', id).select().single();
  if (error) throw new Error(error.message);
  return data;
}

/** Assign a set of leads to a campaign (or clear with campaignId = null). */
async function assignLeads(campaignId, leadIds) {
  if (!Array.isArray(leadIds) || !leadIds.length) return 0;
  const { data, error } = await supabase
    .from('leads')
    .update({ campaign_id: campaignId || null, updated_at: new Date().toISOString() })
    .in('id', leadIds)
    .select('id');
  if (error) throw new Error(error.message);
  return (data || []).length;
}

// ── Stats ──────────────────────────────────────────────────────────────────
/**
 * List every campaign with computed performance metrics. Leads with a NULL
 * campaign_id are attributed to the default Demo Test Follow-up campaign.
 */
async function listWithStats() {
  const campaigns = await list();

  // Identify the default demo campaign id (bucket for unassigned leads).
  const demo = campaigns.find(c => c.is_default && c.type === registry.DEFAULT_TYPE);
  const demoId = demo ? demo.id : null;
  _defaultDemoIdCache = demoId;

  // Pull the lead fields we need for aggregation in one query.
  const { data: leadRows, error: leadErr } = await supabase
    .from('leads')
    .select('id, campaign_id, status, is_qualified, call_attempts, meeting');
  if (leadErr) throw new Error(leadErr.message);
  const leads = leadRows || [];

  // Enrollments → map lead_id → count.
  let enrollByLead = {};
  try {
    const { data: enrolls } = await supabase.from('enrollments').select('lead_id');
    (enrolls || []).forEach(e => {
      if (e.lead_id) enrollByLead[e.lead_id] = (enrollByLead[e.lead_id] || 0) + 1;
    });
  } catch (_) { /* enrollments optional */ }

  // Bucket leads by effective campaign id (null → demo).
  const bucket = {};
  for (const l of leads) {
    const cid = l.campaign_id || demoId || '__unassigned__';
    (bucket[cid] = bucket[cid] || []).push(l);
  }

  const stats = campaigns.map(c => {
    const cleads = bucket[c.id] || [];
    const totalLeads = cleads.length;
    const callsCompleted = cleads.reduce((sum, l) =>
      sum + (l.call_attempts || []).filter(a => a && a.status === 'completed').length, 0);
    const meetingsBooked = cleads.filter(l =>
      (l.meeting && l.meeting.scheduledAt) || MEETING_STATUSES.includes(l.status)).length;
    const interested = cleads.filter(l =>
      l.is_qualified || INTERESTED_STATUSES.includes(l.status)).length;
    const enrollments = cleads.reduce((sum, l) => sum + (enrollByLead[l.id] || 0), 0);
    const conversionRate = totalLeads ? +((enrollments / totalLeads) * 100).toFixed(1) : 0;

    return {
      id: c.id,
      name: c.name,
      type: c.type,
      program: c.program,
      goal: c.goal,
      description: c.description,
      status: c.status,
      isDefault: c.is_default,
      createdAt: c.created_at,
      stats: { totalLeads, callsCompleted, meetingsBooked, interested, enrollments, conversionRate },
    };
  });

  // Report leads whose campaign_id points nowhere (orphaned) so nothing is hidden.
  const unassigned = (bucket['__unassigned__'] || []).length;
  return { campaigns: stats, unassignedLeads: unassigned };
}

module.exports = {
  ensureDefaultCampaigns,
  resolveForLead,
  list,
  getById,
  create,
  update,
  assignLeads,
  listWithStats,
};
