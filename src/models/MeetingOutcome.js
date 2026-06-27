const supabase = require('../db/supabase');
const { Document, toSnake } = require('../db/document');

const TABLE = 'meeting_outcomes';
const W = row => row ? new Document(TABLE, row) : null;

const MeetingOutcome = {
  async find(filter = {}, opts = {}) {
    let q = supabase.from(TABLE).select('*');
    if (filter.leadId) q = q.eq('lead_id', filter.leadId);
    const { data, error } = await q.order('created_at', { ascending: false }).limit(opts.limit || 300);
    if (error) throw new Error(error.message);
    return (data || []).map(W);
  },

  async findById(id) {
    if (!id) return null;
    const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).single();
    if (error || !data) return null;
    return W(data);
  },

  async create(data) {
    const now = new Date().toISOString();
    const row = { notes: '', counselor_id: 'shashi-kumar', meeting_id: '', created_at: now, updated_at: now };
    for (const [k, v] of Object.entries(data)) {
      if (k === '_id') continue;
      row[toSnake(k)] = v;
    }
    const { data: created, error } = await supabase.from(TABLE).insert(row).select().single();
    if (error) throw new Error(error.message);
    return W(created);
  },

  async findByIdAndDelete(id) {
    if (!id) return null;
    const { data, error } = await supabase.from(TABLE).delete().eq('id', id).select().single();
    if (error || !data) return null;
    return W(data);
  },
};

module.exports = MeetingOutcome;
