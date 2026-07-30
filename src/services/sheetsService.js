/**
 * Google Sheets Service
 * – Polls for new rows (leads)
 * – Writes back AI status, score and summary
 *
 * Uses a Service Account (recommended for server-side).
 * Grant the service-account email Editor access to your Sheet.
 */
const { google } = require('googleapis');
const cfg    = require('../config');
const logger = require('../logger');

class SheetsService {
  constructor() {
    const auth = new google.auth.JWT({
      email: cfg.google.clientEmail,
      key:   cfg.google.privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    this.sheets        = google.sheets({ version: 'v4', auth });
    this.spreadsheetId = cfg.google.sheetsId;
    this.cols          = cfg.sheets.cols;
  }

  async getTabName() {
    if (this._tabName) return this._tabName;
    try {
      const meta = await this.sheets.spreadsheets.get({ spreadsheetId: this.spreadsheetId });
      this._tabName = meta.data.sheets[0].properties.title;
      return this._tabName;
    } catch(e) {
      return 'Sheet1';
    }
  }

  /**
   * Read ALL rows from the sheet every poll.
   * Deduplication is done in the poller against MongoDB.
   * This way edits/new rows are always detected, even if the server restarted.
   */
  async getAllLeads() {
    try {
      const tabName = await this.getTabName();
      const res = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `'${tabName}'!A:L`,
      });

      const rows = res.data.values || [];
      if (rows.length <= 1) return [];   // only header or empty

      const c   = this.cols;
      const out = [];

      // Start from row 2 (skip header)
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r || r.length < 3) continue;

        const phone = this._normalizePhone(r[c.phone]);
        const email = (r[c.email] || '').trim().toLowerCase();
        const name  = (r[c.fullName] || '').trim();

        if (!phone || !email || !name) continue;

        const aiStatus = (r[c.aiStatus] || '').trim();
        if (aiStatus === 'Deleted' || aiStatus.includes('permanently deleted')) continue;

        out.push({
          fullName:       name,
          grade:          (r[c.grade]          || '').trim(),
          email,
          phone,
          parentName:     (r[c.parentName]     || '').trim(),
          parentEmail:    (r[c.parentEmail]    || '').trim().toLowerCase(),
          courseInterest: (r[c.courseInterest] || '').trim(),
          submissionDate: r[c.submissionDate]  ? new Date(r[c.submissionDate]) : new Date(),
          sheetRowIndex:  i + 1,   // 1-based for Sheets API
          aiStatus:       aiStatus,  // existing status in sheet
        });
      }

      return out;
    } catch (err) {
      logger.error('Sheets.getAllLeads error', { msg: err.message });
      return [];
    }
  }

  /** Backward-compat alias */
  async getNewLeads() { return this.getAllLeads(); }

  /**
   * Write AI status + scoring + meeting fields back to the sheet.
   * Columns I–O.
   *
   * Accepts: {
   *   status, score, summary,
   *   meetingDate, meetingTime, meetLink   (optional — only set when booking)
   * }
   */
  async updateRow(rowIndex, opts = {}) {
    const {
      status      = '',
      score       = '',
      summary     = '',
      meetingDate = '',
      meetingTime = '',
      meetLink    = '',
    } = opts;

    try {
      const tabName = await this.getTabName();
      await this.sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: [
            { range: `'${tabName}'!I${rowIndex}`, values: [[status]] },
            { range: `'${tabName}'!J${rowIndex}`, values: [[score]] },
            { range: `'${tabName}'!K${rowIndex}`, values: [[summary]] },
            ...(meetingDate ? [{ range: `'${tabName}'!L${rowIndex}`, values: [[meetingDate]] }] : []),
            ...(meetingTime ? [{ range: `'${tabName}'!M${rowIndex}`, values: [[meetingTime]] }] : []),
            ...(meetLink    ? [{ range: `'${tabName}'!N${rowIndex}`, values: [[meetLink]] }]    : []),
            { range: `'${tabName}'!O${rowIndex}`, values: [[new Date().toLocaleString()]] },
          ],
        },
      });
      logger.info(`Sheet row ${rowIndex} updated → "${status}" score=${score}${meetingDate ? ` | meeting=${meetingDate} ${meetingTime}` : ''}`);
    } catch (err) {
      logger.error('Sheets.updateRow error', { msg: err.message, rowIndex });
    }
  }

  /**
   * Sync lead details edited in the CRM back to Google Sheets.
   * Columns A–G: Name, Grade, Email, Phone, Parent Name, Parent Email, Course Interest
   */
  async updateLeadFields(rowIndex, lead = {}) {
    if (!rowIndex) return;
    try {
      const tabName = await this.getTabName();
      const data = [];

      if (lead.fullName !== undefined)       data.push({ range: `'${tabName}'!A${rowIndex}`, values: [[lead.fullName]] });
      if (lead.grade !== undefined)          data.push({ range: `'${tabName}'!B${rowIndex}`, values: [[lead.grade]] });
      if (lead.email !== undefined)          data.push({ range: `'${tabName}'!C${rowIndex}`, values: [[lead.email]] });
      if (lead.phone !== undefined)          data.push({ range: `'${tabName}'!D${rowIndex}`, values: [[lead.phone]] });
      if (lead.parentName !== undefined)     data.push({ range: `'${tabName}'!E${rowIndex}`, values: [[lead.parentName]] });
      if (lead.parentEmail !== undefined)    data.push({ range: `'${tabName}'!F${rowIndex}`, values: [[lead.parentEmail]] });
      if (lead.courseInterest !== undefined) data.push({ range: `'${tabName}'!G${rowIndex}`, values: [[lead.courseInterest]] });

      if (data.length) {
        await this.sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          requestBody: {
            valueInputOption: 'USER_ENTERED',
            data,
          },
        });
        logger.info(`Sheet row ${rowIndex} lead fields updated from CRM edit`);
      }
    } catch (err) {
      logger.error('Sheets.updateLeadFields error', { msg: err.message, rowIndex });
    }
  }

  /** Ensure header row has AI columns labelled */
  async ensureHeaders() {
    try {
      const tabName = await this.getTabName();
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `'${tabName}'!I1:O1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [['AI Status', 'Lead Score', 'AI Summary', 'Meeting Date', 'Meeting Time', 'Meet Link', 'Last Updated']] },
      });
    } catch (_) {}
  }

  _normalizePhone(raw) {
    if (!raw) return '';

    // Strip everything before the first digit or +
    // Handles stray characters like leading dots, spaces, dashes
    const cleaned = raw.replace(/^[^+\d]+/, '').trim();

    // Already has + country code — strip spaces/dashes only
    if (cleaned.startsWith('+')) {
      const e164 = '+' + cleaned.slice(1).replace(/\D/g, '');
      return e164;
    }

    // Digits only from here
    const d = cleaned.replace(/\D/g, '');

    // Indian formats
    if (d.length === 12 && d.startsWith('91'))  return `+${d}`;          // 918466924574
    if (d.length === 11 && d.startsWith('091')) return `+91${d.slice(3)}`; // 0918466924574 (rare)
    if (d.length === 11 && d.startsWith('0'))   return `+91${d.slice(1)}`; // 08466924574

    // US / Canada
    if (d.length === 11 && d.startsWith('1'))   return `+${d}`;           // 18005551234
    if (d.length === 10)                         return `+1${d}`;          // 8005551234

    // Any other country — assume already correct digit string, just add +
    if (d.length > 7) return `+${d}`;

    return cleaned; // return as-is if unrecognisable
  }
}

module.exports = new SheetsService();
