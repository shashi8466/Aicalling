/**
 * Prep365 helpers.
 *
 * POLICY: Prep365 students are NEVER called automatically. A Prep365 call is placed
 * only from POST /api/prep365/call-students (src/services/prep365Calling.js), which
 * an admin/counselor triggers by clicking "Call" on a row or "Call selected" and
 * confirming. Those calls run in the shared bulk queue tagged source
 * 'prep365-checkins'; every other dialer (tzScheduler callbacks / scheduled calls,
 * Leads/Classes bulk runs, follow-up engine) skips leads where isPrep365Lead() is true.
 */
const PREP365_CAMPAIGN_ID = '4b6bb650-e951-4607-9624-02485f9f9d1c';

function isPrep365Lead(lead) {
  if (!lead) return false;
  const q = lead.qualification || {};
  return lead.source === 'Prep365'
    || lead.campaignId === PREP365_CAMPAIGN_ID
    || lead.campaign_id === PREP365_CAMPAIGN_ID
    || Boolean(q.prep365OutreachId || q.prep365StudentId);
}

module.exports = { isPrep365Lead, PREP365_CAMPAIGN_ID };
