/**
 * Document base class — wraps a Supabase row and provides a Mongoose-compatible
 * save() interface so existing code (webhook, poller, followUpEngine) can do:
 *
 *   const lead = await Lead.findById(id);
 *   lead.status = 'calling';
 *   lead.callAttempts.push({ ... });
 *   await lead.save();
 */
const { randomUUID } = require('crypto');

// ── snake_case ↔ camelCase ────────────────────────────────────────────────────
function toCamel(s) {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}
function toSnake(s) {
  return s.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
}

/**
 * Convert a DB row (snake_case keys) → camelCase API object.
 * JSONB columns are returned by Supabase already parsed — preserve contents.
 * Adds `_id` alias for `id` for Mongoose backward-compat.
 */
function rowToAPI(row) {
  if (!row) return null;
  const out = { _id: row.id };
  for (const [k, v] of Object.entries(row)) {
    out[toCamel(k)] = v;
  }
  return out;
}

/**
 * Convert a camelCase API object → snake_case DB row for insert/update.
 * Skips `_id` (it's just an alias for `id`).
 */
function apiToRow(obj) {
  if (!obj) return {};
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === '_id' || k === 'aiStatus') continue;
    out[toSnake(k)] = v;
  }
  return out;
}

class Document {
  constructor(tableName, row) {
    this.__table = tableName;
    // Assign all camelCase fields from the row
    const api = rowToAPI(row);
    Object.assign(this, api);
  }

  async save() {
    const supabase = require('./supabase');

    if (this.__table === 'leads') {
      const tzHelper = require('../utils/timezoneHelper');
      const tzInfo = tzHelper.detectTimeZone(this.phone || '', this.state || '');
      this.countryCode = this.countryCode || tzInfo.countryCode;
      this.country = this.country || tzInfo.country;
      this.timeZone = this.timeZone || tzInfo.timeZone;
      this.meetingStatus = this.meetingStatus || 'Not Booked';
    }

    // Auto-assign _ids to any callAttempt items that don't have one
    if (Array.isArray(this.callAttempts)) {
      this.callAttempts = this.callAttempts.map(a =>
        a._id ? a : { _id: randomUUID(), ...a }
      );
    }

    // Build update payload — skip internal/virtual fields
    const skip = new Set(['__table', '_id', 'aiStatus']);
    const updateRow = {};
    for (const [k, v] of Object.entries(this)) {
      if (skip.has(k)) continue;
      updateRow[toSnake(k)] = v;
    }
    updateRow.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from(this.__table)
      .update(updateRow)
      .eq('id', this.id)
      .select()
      .single();

    if (error) throw new Error(error.message);

    // Refresh fields from the saved row
    const refreshed = rowToAPI(data);
    Object.assign(this, refreshed);
    return this;
  }

  toJSON() {
    // eslint-disable-next-line no-unused-vars
    const { __table, ...rest } = this;
    return rest;
  }
}

module.exports = { Document, rowToAPI, apiToRow, toCamel, toSnake };
