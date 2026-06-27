const supabase = require('../db/supabase');
const { Document, toSnake } = require('../db/document');

const TABLE = 'follow_ups';
const W = row => row ? new Document(TABLE, row) : null;

function applyFilter(q, filter = {}) {
  for (const [key, val] of Object.entries(filter)) {
    const col = toSnake(key);
    if (val === null || val === undefined) {
      q = q.is(col, null);
    } else if (typeof val === 'object' && !Array.isArray(val)) {
      for (const [op, opVal] of Object.entries(val)) {
        const ts = v => (v instanceof Date ? v.toISOString() : v);
        switch (op) {
          case '$lte': q = q.lte(col, ts(opVal)); break;
          case '$gte': q = q.gte(col, ts(opVal)); break;
          case '$lt':  q = q.lt(col, ts(opVal));  break;
          case '$gt':  q = q.gt(col, ts(opVal));  break;
          case '$eq':  q = q.eq(col, ts(opVal));  break;
          case '$ne':  q = q.neq(col, ts(opVal)); break;
        }
      }
    } else {
      q = q.eq(col, val);
    }
  }
  return q;
}

const FollowUp = {
  async find(filter = {}, opts = {}) {
    let q = supabase.from(TABLE).select('*');
    q = applyFilter(q, filter);
    if (opts.sort) {
      const [[col, dir]] = Object.entries(opts.sort);
      q = q.order(toSnake(col), { ascending: dir >= 0 });
    }
    const { data, error } = await q.limit(opts.limit || 1000);
    if (error) throw new Error(error.message);
    return (data || []).map(W);
  },

  async findOne(filter = {}) {
    let q = supabase.from(TABLE).select('*');
    q = applyFilter(q, filter);
    const { data } = await q.limit(1);
    return data?.[0] ? W(data[0]) : null;
  },

  async create(data) {
    const now = new Date().toISOString();
    const row = { completed: false, cycle: 0, notes: '', result: '', created_at: now, updated_at: now };
    for (const [k, v] of Object.entries(data)) {
      if (k === '_id') continue;
      row[toSnake(k)] = v instanceof Date ? v.toISOString() : v;
    }
    const { data: created, error } = await supabase.from(TABLE).insert(row).select().single();
    if (error) throw new Error(error.message);
    return W(created);
  },

  async findByIdAndUpdate(id, update, _opts = {}) {
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

module.exports = FollowUp;
