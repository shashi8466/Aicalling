/**
 * Prep365 Google Sheet Call Log Service
 * Handles logging every AI student/parent outreach call to Google Sheets.
 *
 * Tab 1: "Calls"
 * Date | Time (IST) | Student | Student email | Grade | Called (Student/Parent) | Person called | Phone | Reasons | Status | Answered by | Duration (s) | Summary | Next steps | Follow-up requested | Opted out | Full conversation | Recording link | Outreach ID
 *
 * Tab 2: "Students"
 * Student | Email | Grade | Phone | Parent | Parent phone | Reasons | Days inactive | Days since last test | Called? (Yes/No) | Student called on | Parent called on | Last status
 */
const { google } = require('googleapis');
const cfg = require('../config');
const logger = require('../logger');

const CALLS_HEADERS = [
  'Date',
  'Time (IST)',
  'Student',
  'Student email',
  'Grade',
  'Called (Student/Parent)',
  'Person called',
  'Phone',
  'Reasons',
  'Status',
  'Answered by',
  'Duration (s)',
  'Summary',
  'Next steps',
  'Follow-up requested',
  'Opted out',
  'Full conversation',
  'Recording link',
  'Outreach ID'
];

const STUDENTS_HEADERS = [
  'Student',
  'Email',
  'Grade',
  'Phone',
  'Parent',
  'Parent phone',
  'Reasons',
  'Days inactive',
  'Days since last test',
  'Called? (Yes/No)',
  'Student called on',
  'Parent called on',
  'Last status'
];

class Prep365SheetService {
  constructor() {
    this.sheetId = process.env.PREP365_CALL_LOG_SHEET_ID || cfg.google.sheetsId || '1BXutZ1i9zn4Te2cc66Dlm-CXcURsCHRXdL67N4JFiyE';
    this.auth = new google.auth.JWT({
      email: cfg.google.clientEmail,
      key: cfg.google.privateKey,
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive'
      ],
    });
    this.sheets = google.sheets({ version: 'v4', auth: this.auth });
    this.drive = google.drive({ version: 'v3', auth: this.auth });
    this._initialized = false;
  }

  getSheetUrl() {
    return `https://docs.google.com/spreadsheets/d/${this.sheetId}/edit`;
  }

  /**
   * Ensure both "Calls" and "Students" tabs exist with proper header formatting.
   */
  async initSheet() {
    if (this._initialized) return true;
    try {
      const meta = await this.sheets.spreadsheets.get({ spreadsheetId: this.sheetId });
      const existingTabs = meta.data.sheets.map(s => s.properties.title);
      const requests = [];

      if (!existingTabs.includes('Calls')) {
        requests.push({ addSheet: { properties: { title: 'Calls' } } });
      }
      if (!existingTabs.includes('Students')) {
        requests.push({ addSheet: { properties: { title: 'Students' } } });
      }

      if (requests.length > 0) {
        await this.sheets.spreadsheets.batchUpdate({
          spreadsheetId: this.sheetId,
          requestBody: { requests }
        });
        logger.info('[Prep365Sheet] Created missing tabs in spreadsheet.');
      }

      // Check header row in Calls
      const callsRes = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.sheetId,
        range: "'Calls'!A1:S1"
      });
      if (!callsRes.data.values || callsRes.data.values.length === 0 || callsRes.data.values[0].length === 0) {
        await this.sheets.spreadsheets.values.update({
          spreadsheetId: this.sheetId,
          range: "'Calls'!A1:S1",
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [CALLS_HEADERS] }
        });
        logger.info('[Prep365Sheet] Initialized Calls header row.');
      }

      // Check header row in Students
      const stuRes = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.sheetId,
        range: "'Students'!A1:M1"
      });
      if (!stuRes.data.values || stuRes.data.values.length === 0 || stuRes.data.values[0].length === 0) {
        await this.sheets.spreadsheets.values.update({
          spreadsheetId: this.sheetId,
          range: "'Students'!A1:M1",
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [STUDENTS_HEADERS] }
        });
        logger.info('[Prep365Sheet] Initialized Students header row.');
      }

      this._initialized = true;
      return true;
    } catch (err) {
      logger.error('[Prep365Sheet] initSheet error:', { msg: err.message });
      return false;
    }
  }

  /**
   * Format timestamp into IST date and time strings.
   */
  _toIST(dateInput) {
    const d = dateInput ? new Date(dateInput) : new Date();
    // Indian Standard Time: UTC + 5:30
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(d.getTime() + (d.getTimezoneOffset() * 60 * 1000) + istOffset);

    const yyyy = istDate.getFullYear();
    const mm = String(istDate.getMonth() + 1).padStart(2, '0');
    const dd = String(istDate.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;

    let hours = istDate.getHours();
    const minutes = String(istDate.getMinutes()).padStart(2, '0');
    const seconds = String(istDate.getSeconds()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    const timeStr = `${hours}:${minutes}:${seconds} ${ampm} IST`;

    return { dateStr, timeStr };
  }

  /**
   * Log or update a call row in the "Calls" tab.
   * Matches by Outreach ID (Column S, index 18) to prevent duplicate entries when
   * summaries or recording URLs arrive asynchronously.
   */
  async logCall(callData) {
    await this.initSheet();
    try {
      const { dateStr, timeStr } = this._toIST(callData.timestamp || callData.at);
      const outreachIdStr = callData.outreachId !== undefined && callData.outreachId !== null ? String(callData.outreachId).trim() : '';

      const rowValues = [
        dateStr,
        timeStr,
        callData.studentName || callData.student || '',
        callData.studentEmail || '',
        callData.grade || '',
        callData.recipientType === 'parent' ? 'Parent' : 'Student',
        callData.recipientName || callData.personCalled || callData.studentName || '',
        callData.phone || '',
        Array.isArray(callData.reasons) ? callData.reasons.map(r => typeof r === 'string' ? r : (r.label || r.code)).join('; ') : (callData.reasons || ''),
        callData.status || 'completed',
        callData.answeredBy || 'human',
        callData.durationSeconds !== undefined ? String(callData.durationSeconds) : String(callData.duration || 0),
        callData.summary || '',
        callData.nextSteps || '',
        callData.followUpRequested ? 'Yes' : 'No',
        callData.optOut ? 'Yes' : 'No',
        callData.transcript || '',
        callData.recordingUrl || '',
        outreachIdStr
      ];

      // Read existing rows to check if outreach ID already exists
      const existing = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.sheetId,
        range: "'Calls'!A:S"
      });

      const rows = existing.data.values || [];
      let foundIndex = -1;

      if (outreachIdStr && rows.length > 1) {
        for (let i = 1; i < rows.length; i++) {
          const rowOutreachId = rows[i][18] ? String(rows[i][18]).trim() : '';
          if (rowOutreachId === outreachIdStr) {
            foundIndex = i + 1; // 1-based index in sheet
            break;
          }
        }
      }

      if (foundIndex > 0) {
        // Update existing row
        await this.sheets.spreadsheets.values.update({
          spreadsheetId: this.sheetId,
          range: `'Calls'!A${foundIndex}:S${foundIndex}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [rowValues] }
        });
        logger.info(`[Prep365Sheet] Updated existing Calls row ${foundIndex} for outreachId=${outreachIdStr}`);
      } else {
        // Append new row
        await this.sheets.spreadsheets.values.append({
          spreadsheetId: this.sheetId,
          range: "'Calls'!A:S",
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: [rowValues] }
        });
        logger.info(`[Prep365Sheet] Appended new row in Calls tab for outreachId=${outreachIdStr}`);
      }

      return true;
    } catch (err) {
      logger.error('[Prep365Sheet] logCall error:', { msg: err.message, stack: err.stack });
      return false;
    }
  }

  /**
   * Completely rewrite the "Students" tab on each candidates sync.
   * Student | Email | Grade | Phone | Parent | Parent phone | Reasons | Days inactive | Days since last test | Called? (Yes/No) | Student called on | Parent called on | Last status
   */
  async syncStudentsTab(students = []) {
    await this.initSheet();
    try {
      const rows = [STUDENTS_HEADERS];

      for (const s of students) {
        const student = s.student || s;
        const parents = s.parents || [];
        const primaryParent = parents[0] || {};
        const activity = s.activity || {};
        const callStatus = s.callStatus || {};
        const lastCall = callStatus.lastCall || {};

        const rawReasons = s.reasons || [];
        const reasonsStr = Array.isArray(rawReasons)
          ? rawReasons.map(r => typeof r === 'string' ? r : (r.label || r.code)).join('; ')
          : String(rawReasons);

        const wasCalled = (callStatus.totalCalls > 0 || lastCall.status) ? 'Yes' : 'No';
        const studentCalledOn = callStatus.studentLastCallAt ? this._toIST(callStatus.studentLastCallAt).dateStr : (wasCalled === 'Yes' ? this._toIST(lastCall.at).dateStr : '—');
        const parentCalledOn = callStatus.parentLastCallAt ? this._toIST(callStatus.parentLastCallAt).dateStr : '—';
        const lastStatusStr = lastCall.status || callStatus.status || 'Not called yet';

        rows.push([
          student.name || 'Unknown',
          student.email || '',
          student.grade || '11th Grade',
          student.phone || '',
          primaryParent.name || '',
          primaryParent.phone || '',
          reasonsStr,
          activity.daysInactive !== undefined ? String(activity.daysInactive) : '—',
          activity.daysSinceLastTest !== undefined ? String(activity.daysSinceLastTest) : '—',
          wasCalled,
          studentCalledOn,
          parentCalledOn,
          lastStatusStr
        ]);
      }

      // Clear existing values in Students tab
      await this.sheets.spreadsheets.values.clear({
        spreadsheetId: this.sheetId,
        range: "'Students'!A:M"
      });

      // Write updated rows
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.sheetId,
        range: "'Students'!A1:M" + rows.length,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: rows }
      });

      logger.info(`[Prep365Sheet] Successfully synced ${students.length} student(s) to Students tab.`);
      return true;
    } catch (err) {
      logger.error('[Prep365Sheet] syncStudentsTab error:', { msg: err.message });
      return false;
    }
  }

  /**
   * Backfill past calls (e.g. outreach 1 for Shashi, 61s).
   */
  async backfillCalls(pastCalls = []) {
    await this.initSheet();
    logger.info(`[Prep365Sheet] Starting backfill for ${pastCalls.length} past call(s)...`);
    for (const c of pastCalls) {
      await this.logCall(c);
    }
    logger.info('[Prep365Sheet] Backfill completed.');
  }
}

module.exports = new Prep365SheetService();
