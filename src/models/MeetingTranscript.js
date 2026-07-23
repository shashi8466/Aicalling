const supabase = require('../db/supabase');
const { Document, toSnake } = require('../db/document');

const TABLE = 'meeting_transcripts';
const W = row => row ? new Document(TABLE, row) : null;

function applyFilter(q, filter = {}) {
  for (const [key, val] of Object.entries(filter)) {
    const col = toSnake(key);
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      for (const [op, opVal] of Object.entries(val)) {
        const ts = v => (v instanceof Date ? v.toISOString() : v);
        switch (op) {
          case '$gte': q = q.gte(col, ts(opVal)); break;
          case '$lte': q = q.lte(col, ts(opVal)); break;
          case '$in':  q = q.in(col, opVal);      break;
        }
      }
    } else {
      q = val == null ? q.is(col, null) : q.eq(col, val);
    }
  }
  return q;
}

const MeetingTranscript = {
  async find(filter = {}, opts = {}) {
    let q = supabase.from(TABLE).select('*');
    q = applyFilter(q, filter);
    const { data, error } = await q.order('created_at', { ascending: false }).limit(opts.limit || 300);
    if (error) throw new Error(error.message);
    return (data || []).map(W);
  },

  async findOne(filter = {}) {
    const rows = await MeetingTranscript.find(filter, { limit: 1 });
    return rows[0] || null;
  },

  async findById(id) {
    if (!id) return null;
    const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).single();
    if (error || !data) return null;
    return W(data);
  },

  async create(data) {
    const now = new Date().toISOString();
    const row = { full_text: '', segments: [], language: '', created_at: now, updated_at: now };
    for (const [k, v] of Object.entries(data)) {
      if (k === '_id') continue;
      row[toSnake(k)] = v instanceof Date ? v.toISOString() : v;
    }
    const { data: created, error } = await supabase.from(TABLE).insert(row).select().single();
    if (error) throw new Error(error.message);
    return W(created);
  },

  async findByIdAndUpdate(id, update) {
    if (!id) return null;
    const row = { updated_at: new Date().toISOString() };
    for (const [k, v] of Object.entries(update)) {
      if (k === '_id') continue;
      row[toSnake(k)] = v instanceof Date ? v.toISOString() : v;
    }
    const { data, error } = await supabase.from(TABLE).update(row).eq('id', id).select().single();
    if (error || !data) return null;
    return W(data);
  },
};

module.exports = MeetingTranscript;
