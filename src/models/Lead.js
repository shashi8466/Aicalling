/**
 * Lead model — Supabase-backed, Mongoose-compatible API.
 *
 * All methods return Document instances that have:
 *   - camelCase fields (fullName, leadScore, callAttempts, meeting, …)
 *   - _id alias for id
 *   - .save() method that persists mutations back to Supabase
 */
const supabase          = require('../db/supabase');
const { Document, rowToAPI, toSnake } = require('../db/document');
const { randomUUID }    = require('crypto');

const TABLE = 'leads';

// Wrap a raw Supabase row into a Document instance
function W(row) {
  if (!row) return null;
  return new Document(TABLE, row);
}

// ── Internal: translate a camelCase filter object → Supabase query ─────────
// JSONB-path filters (key contains '.') are returned separately for JS-side
// post-filtering because PostgREST can't handle them in a generic way.
function applyFilter(q, filter = {}) {
  for (const [key, val] of Object.entries(filter)) {
    if (key === '$or') {
      // Build PostgREST OR string for simple field=value conditions
      const parts = [];
      for (const cond of val) {
        for (const [k, v] of Object.entries(cond)) {
          const col = toSnake(k);
          if (v instanceof RegExp) {
            const pattern = v.source.replace(/\.\*/g, '%').replace(/[.*+?^${}()|[\]\\]/g, c =>
              c === '*' ? '%' : c === '.' ? '' : c);
            parts.push(`${col}.ilike.%${pattern}%`);
          } else {
            parts.push(`${col}.eq.${v}`);
          }
        }
      }
      if (parts.length) q = q.or(parts.join(','));
      continue;
    }

    if (key.includes('.')) continue; // JSONB path — handled in JS post-filter

    const col = toSnake(key);

    if (val === null || val === undefined) {
      q = q.is(col, null);
    } else if (val instanceof RegExp) {
      q = q.ilike(col, `%${val.source}%`);
    } else if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      for (const [op, opVal] of Object.entries(val)) {
        const ts = v => (v instanceof Date ? v.toISOString() : v);
        switch (op) {
          case '$eq':     q = q.eq(col, ts(opVal));  break;
          case '$ne':     q = q.neq(col, ts(opVal)); break;
          case '$gt':     q = q.gt(col, ts(opVal));  break;
          case '$gte':    q = q.gte(col, ts(opVal)); break;
          case '$lt':     q = q.lt(col, ts(opVal));  break;
          case '$lte':    q = q.lte(col, ts(opVal)); break;
          case '$in':     q = q.in(col, opVal);      break;
          case '$nin':    q = q.not(col, 'in', `(${opVal.map(v => `"${v}"`).join(',')})`); break;
          case '$exists': q = opVal ? q.not(col, 'is', null) : q.is(col, null); break;
        }
      }
    } else {
      q = q.eq(col, val);
    }
  }
  return q;
}

// JS-side filter for JSONB-path conditions e.g. 'meeting.scheduledAt'
function jsFilter(doc, filter = {}) {
  for (const [key, val] of Object.entries(filter)) {
    if (!key.includes('.')) continue;
    const parts = key.split('.');
    let cur = doc;
    for (const p of parts) cur = cur?.[p];

    if (val === null || val === undefined) {
      if (cur !== null && cur !== undefined) return false;
    } else if (typeof val === 'object') {
      if ('$exists' in val) {
        const exists = cur !== undefined && cur !== null && cur !== '';
        if (val.$exists !== exists) return false;
      }
      if ('$ne' in val && cur === val.$ne) return false;
      if ('$gte' in val && new Date(cur) < new Date(val.$gte)) return false;
      if ('$gt'  in val && new Date(cur) <= new Date(val.$gt))  return false;
      if ('$lte' in val && new Date(cur) > new Date(val.$lte))  return false;
      if ('$lt'  in val && new Date(cur) >= new Date(val.$lt))  return false;
    } else if (key === 'callAttempts.0') {
      const ok = Array.isArray(doc.callAttempts) && doc.callAttempts.length > 0;
      if (val?.$exists && !ok) return false;
    } else {
      if (cur !== val) return false;
    }
  }
  return true;
}

function sortDocs(docs, spec) {
  const entries = Object.entries(spec);
  return [...docs].sort((a, b) => {
    for (const [k, dir] of entries) {
      const av = a[k], bv = b[k];
      if (av == null && bv == null) continue;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return dir > 0 ? -1 : 1;
      if (av > bv) return dir > 0 ? 1 : -1;
    }
    return 0;
  });
}

function applySelect(docs, select) {
  if (!select) return docs;
  const excl = (typeof select === 'string' ? select : '')
    .split(/\s+/)
    .filter(s => s.startsWith('-'))
    .map(s => s.slice(1));

  return docs.map(doc => {
    if (excl.includes('callAttempts.transcript') && doc.callAttempts) {
      doc.callAttempts = doc.callAttempts.map(({ transcript, ...rest }) => rest);
    }
    return doc;
  });
}

// ── Public model API ──────────────────────────────────────────────────────────
const Lead = {

  async findById(id) {
    if (!id) return null;
    const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).single();
    if (error || !data) return null;
    return W(data);
  },

  async findOne(filter = {}) {
    let q = supabase.from(TABLE).select('*');
    q = applyFilter(q, filter);
    const { data } = await q.limit(100);
    const rows = (data || []).map(W).filter(d => jsFilter(d, filter));
    return rows[0] || null;
  },

  async find(filter = {}, opts = {}) {
    let q = supabase.from(TABLE).select('*');
    q = applyFilter(q, filter);
    const { data, error } = await q.limit(2000);
    if (error) throw new Error(error.message);

    let results = (data || []).map(W).filter(d => jsFilter(d, filter));

    if (opts.sort)   results = sortDocs(results, opts.sort);
    if (opts.limit)  results = results.slice(0, opts.limit);
    if (opts.select) results = applySelect(results, opts.select);

    return results;
  },

  async countDocuments(filter = {}) {
    // For JSONB-path filters, fall back to full fetch + JS count
    const hasJsonbFilter = Object.keys(filter).some(k => k.includes('.'));
    if (hasJsonbFilter) {
      const docs = await this.find(filter);
      return docs.length;
    }
    let q = supabase.from(TABLE).select('id', { count: 'exact', head: true });
    q = applyFilter(q, filter);
    const { count, error } = await q;
    if (error) throw new Error(error.message);
    return count || 0;
  },

  async create(data) {
    const now = new Date().toISOString();
    const tzHelper = require('../utils/timezoneHelper');
    const tzInfo = tzHelper.detectTimeZone(data.phone || '', data.state || '');

    const row = {
      call_attempts:       [],
      qualification:       {},
      meeting:             {},
      emails_sent:         [],
      whatsapp_sent:       [],
      lead_score:          0,
      lead_category:       'cold',
      total_call_attempts: 0,
      is_qualified:        false,
      status:              'new',
      source:              'google-sheets',
      notes:               '',
      created_at:          now,
      updated_at:          now,
      country_code:        data.countryCode || tzInfo.countryCode,
      country:             data.country || tzInfo.country,
      state:               data.state || '',
      time_zone:           data.timeZone || tzInfo.timeZone,
      meeting_status:      data.meetingStatus || 'Not Booked',
    };

    // Merge caller's data (convert to snake_case)
    for (const [k, v] of Object.entries(data)) {
      if (k === '_id' || k === 'aiStatus') continue;
      row[toSnake(k)] = v;
    }

    const { data: created, error } = await supabase.from(TABLE).insert(row).select().single();
    if (error) throw new Error(error.message);
    return W(created);
  },

  async findByIdAndUpdate(id, update, _opts = {}) {
    if (!id) return null;
    
    // Auto-detect country/timezone if phone or state changes and time_zone is not explicitly set
    if (update.phone !== undefined || update.state !== undefined) {
      const tzHelper = require('../utils/timezoneHelper');
      let currentPhone = update.phone;
      let currentState = update.state;
      if (currentPhone === undefined || currentState === undefined) {
        const { data: existing } = await supabase.from(TABLE).select('phone, state').eq('id', id).single();
        if (existing) {
          if (currentPhone === undefined) currentPhone = existing.phone;
          if (currentState === undefined) currentState = existing.state;
        }
      }
      const tzInfo = tzHelper.detectTimeZone(currentPhone || '', currentState || '');
      if (update.phone !== undefined) {
        if (update.countryCode === undefined) update.countryCode = tzInfo.countryCode;
        if (update.country === undefined) update.country = tzInfo.country;
      }
      if (update.timeZone === undefined) {
        update.timeZone = tzInfo.timeZone;
      }
    }

    const row = { updated_at: new Date().toISOString() };
    for (const [k, v] of Object.entries(update)) {
      if (k === '_id' || k === 'aiStatus') continue;
      row[toSnake(k)] = v;
    }
    const { data, error } = await supabase.from(TABLE).update(row).eq('id', id).select().single();
    if (error || !data) return null;
    return W(data);
  },

  async findByIdAndDelete(id) {
    if (!id) return null;
    
    // Safely delete related records that lack ON DELETE CASCADE
    await Promise.allSettled([
      supabase.from('payments').delete().eq('lead_id', id),
      supabase.from('enrollments').delete().eq('lead_id', id),
      supabase.from('meeting_outcomes').delete().eq('lead_id', id),
      supabase.from('lead_objections').delete().eq('lead_id', id),
      supabase.from('campaigns_leads').delete().eq('lead_id', id),
      supabase.from('follow_ups').delete().eq('lead_id', id),
      supabase.from('callback_requests').delete().eq('lead_id', id),
      supabase.from('meetings').delete().eq('lead_id', id)
    ]);

    const { data, error } = await supabase.from(TABLE).delete().eq('id', id).select().single();
    if (error || !data) {
      console.error('Lead delete error:', error);
      return null;
    }
    return W(data);
  },

  async deleteMany(ids) {
    if (!ids || !ids.length) return null;
    
    // Safely delete related records
    await Promise.allSettled([
      supabase.from('payments').delete().in('lead_id', ids),
      supabase.from('enrollments').delete().in('lead_id', ids),
      supabase.from('meeting_outcomes').delete().in('lead_id', ids),
      supabase.from('lead_objections').delete().in('lead_id', ids),
      supabase.from('campaigns_leads').delete().in('lead_id', ids),
      supabase.from('follow_ups').delete().in('lead_id', ids),
      supabase.from('callback_requests').delete().in('lead_id', ids),
      supabase.from('meetings').delete().in('lead_id', ids)
    ]);

    const { data, error } = await supabase.from(TABLE).delete().in('id', ids).select();
    if (error) {
      console.error('Lead bulk delete error:', error);
      return null;
    }
    return (data || []).map(W);
  },
};

module.exports = Lead;
