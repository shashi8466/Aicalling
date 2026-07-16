/**
 * CallBilling model — Supabase-backed, mirrors the MeetingOutcome pattern.
 *
 * One row per Twilio call (unique call_sid). Stores the ACTUAL Twilio price.
 * Rows begin as billing_status='pending' and are finalized by the billing
 * poller once Twilio populates the price on the Call resource.
 */
const supabase = require('../db/supabase');
const { Document, toSnake } = require('../db/document');

const TABLE = 'call_billing';
const W = row => (row ? new Document(TABLE, row) : null);

// Convert a camelCase field object → snake_case DB row (skips _id).
function toRow(obj = {}) {
  const row = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === '_id' || v === undefined) continue;
    row[toSnake(k)] = v;
  }
  return row;
}

const CallBilling = {
  /** Find the single billing row for a Twilio call SID (or null). */
  async findBySid(callSid) {
    if (!callSid) return null;
    const { data } = await supabase.from(TABLE).select('*').eq('call_sid', callSid).maybeSingle();
    return W(data);
  },

  async findById(id) {
    if (!id) return null;
    const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).single();
    if (error || !data) return null;
    return W(data);
  },

  async find(filter = {}, opts = {}) {
    let q = supabase.from(TABLE).select('*');
    if (filter.leadId)       q = q.eq('lead_id', filter.leadId);
    if (filter.campaignId)   q = q.eq('campaign_id', filter.campaignId);
    if (filter.counselorId)  q = q.eq('counselor_id', filter.counselorId);
    if (filter.billingStatus)q = q.eq('billing_status', filter.billingStatus);
    const { data, error } = await q
      .order('created_at', { ascending: false })
      .limit(opts.limit || 500);
    if (error) throw new Error(error.message);
    return (data || []).map(W);
  },

  /**
   * Idempotent create-or-update keyed on call_sid.
   *  - No existing row → INSERT.
   *  - Existing row still 'pending'/'unavailable' → UPDATE (lets the poller
   *    fill in the real price later).
   *  - Existing row already 'final' → DO NOTHING (never clobber a real price).
   * Returns the resulting Document.
   */
  async upsertBySid(fields = {}) {
    const callSid = fields.callSid;
    if (!callSid) throw new Error('upsertBySid requires callSid');

    const existing = await this.findBySid(callSid);

    if (existing) {
      if (existing.billingStatus === 'final') return existing; // locked — keep Twilio's price
      const row = toRow(fields);
      delete row.call_sid;          // never change the key
      delete row.created_at;        // preserve original timestamp
      const { data, error } = await supabase
        .from(TABLE).update(row).eq('call_sid', callSid).select().single();
      if (error) throw new Error(error.message);
      return W(data);
    }

    // Insert — tolerate a concurrent insert (unique violation) by falling back to update.
    const row = toRow(fields);
    const { data, error } = await supabase.from(TABLE).insert(row).select().single();
    if (error) {
      if (/duplicate|unique/i.test(error.message)) {
        const raced = await this.findBySid(callSid);
        if (raced) return raced;
      }
      throw new Error(error.message);
    }
    return W(data);
  },
};

module.exports = CallBilling;
