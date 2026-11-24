const axios = require('axios');
const cfg = require('../config');
const logger = require('../logger');
const prep365StudentStore = require('./prep365StudentStore');
const prep365SheetService = require('./prep365SheetService');

/**
 * Mask phone numbers for privacy in logs.
 * e.g. "+918466924574" -> "+91******4574"
 */
function maskPhone(phone) {
  if (!phone) return 'N/A';
  const clean = String(phone).trim();
  if (clean.length <= 6) return '***';
  const prefix = clean.startsWith('+') ? clean.slice(0, 3) : clean.slice(0, 2);
  const suffix = clean.slice(-4);
  return `${prefix}******${suffix}`;
}

/**
 * Accurately determines dryRun boolean.
 * Ensures string "false" is evaluated to boolean false (NOT truthy).
 */
function isDryRunMode(paramValue) {
  if (paramValue !== undefined && paramValue !== null && paramValue !== '') {
    if (typeof paramValue === 'boolean') return paramValue;
    return String(paramValue).trim().toLowerCase() === 'true';
  }
  return process.env.PREP365_DRY_RUN === 'true';
}

class Prep365Service {
  constructor() {
    this.baseUrl = (process.env.PREP365_BASE_URL || cfg.prep365?.baseUrl || 'https://www.prep365.ai/api/ai-calls').replace(/\/+$/, '');
    this.lastSync = null;
    this._recentCallsMem = []; // in-memory store of recent calls for fast retrieval
  }

  getApiKey() {
    return process.env.PREP365_API_KEY || cfg.prep365?.apiKey || '';
  }

  /**
   * 1. LOAD ALL STUDENTS WHO NEED ATTENTION
   * GET /candidates is read-only and never calls anyone.
   * Auto-refreshes, normalizes reasons, priority, and callable status.
   * Persists to Supabase prep365_students & local cache.
   * Rewrites Google Sheet "Students" tab on each sync.
   */
  async fetchCandidates() {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('PREP365_API_KEY is not configured in environment');
    }

    const url = `${this.baseUrl}/candidates`;
    logger.info(`[Prep365] Fetching candidates: GET ${url}`);

    const res = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      timeout: 30000,
    });

    const data = res.data || {};
    const rawStudents = data.students || [];

    // Determine testMode and testStudentIds
    const isDryRun = isDryRunMode();
    const testMode = data.testMode !== undefined ? Boolean(data.testMode) : isDryRun;
    const testStudentIds = Array.isArray(data.testStudentIds) ? data.testStudentIds : [];

    // Read stored student states to preserve call history if present
    const existingStore = await prep365StudentStore.getStudents().catch(() => ({ students: [] }));
    const historyMap = new Map();
    for (const es of (existingStore.students || [])) {
      const sid = es.student?.id || es.id;
      if (sid && es.callStatus) {
        historyMap.set(sid, es.callStatus);
      }
    }

    const normalizedStudents = [];
    const seenIds = new Set(); // one row per student.id
    const byReason = {
      INACTIVE: 0,
      NO_RECENT_TESTS: 0,
      MISSED_ASSIGNED_TOPICS: 0,
      CUSTOM_PREP_BEHIND: 0,
      DECLINING_PERFORMANCE: 0,
    };

    let callableCount = 0;

    for (const item of rawStudents) {
      const student = item.student || item;
      const studentId = student.id || student.studentId;
      if (!studentId || seenIds.has(studentId)) continue;
      seenIds.add(studentId);
      const parents = item.parents || [];
      const activity = item.activity || {};
      const tests = item.tests || {};
      const customPrep = item.customPrep || [];
      const reasons = item.reasons || [];
      const talkingPoints = item.talkingPoints || '';
      const priority = item.priority || 0;

      // Tally reasons
      for (const r of reasons) {
        const code = r.code || r;
        if (byReason[code] !== undefined) {
          byReason[code]++;
        } else {
          byReason[code] = (byReason[code] || 0) + 1;
        }
      }

      // Collect callable phone numbers
      const phonesToCall = [];
      if (student.phone) phonesToCall.push({ recipientType: 'student', name: student.name, phone: student.phone });
      for (const p of parents) {
        if (p.phone) phonesToCall.push({ recipientType: 'parent', name: p.name, phone: p.phone });
      }

      // Call status: Prep365's callStatus is authoritative (callable / blockedReason /
      // cooldown / phonesToCall). Local history only fills in a missing lastCall.
      const localStatus = historyMap.get(studentId) || {};
      let callStatus;
      if (item.callStatus && typeof item.callStatus === 'object') {
        const cs = item.callStatus;
        callStatus = {
          callable: Boolean(cs.callable),
          blockedReason: cs.callable ? null : (cs.blockedReason || 'blocked'),
          inCooldown: Boolean(cs.inCooldown),
          phonesToCall: Array.isArray(cs.phonesToCall) ? cs.phonesToCall : phonesToCall,
          totalCalls: cs.totalCalls ?? localStatus.totalCalls ?? 0,
          lastCall: cs.lastCall || localStatus.lastCall || null,
        };
      } else {
        // Legacy response without callStatus: derive conservatively.
        let blockedReason = null;
        if (student.optedOut || item.optedOut) blockedReason = 'opted_out';
        else if (phonesToCall.length === 0) blockedReason = 'no_phone';
        else if (testMode && testStudentIds.length > 0 && !testStudentIds.includes(studentId)) blockedReason = 'test_mode';
        callStatus = {
          callable: !blockedReason,
          blockedReason,
          inCooldown: false,
          phonesToCall,
          totalCalls: localStatus.totalCalls || 0,
          lastCall: localStatus.lastCall || null,
        };
      }

      if (callStatus.callable) callableCount++;

      normalizedStudents.push({
        student: {
          id: studentId,
          name: student.name || 'Unknown',
          email: student.email || '',
          phone: student.phone || '',
          grade: student.grade || item.grade || '',
          optedOut: Boolean(student.optedOut)
        },
        parents,
        activity: {
          daysInactive: activity.daysInactive ?? 0,
          daysSinceLastTest: activity.daysSinceLastTest ?? 0,
          lastLoginAt: activity.lastLoginAt || null
        },
        tests,
        customPrep,
        reasons,
        talkingPoints,
        priority,
        callStatus
      });
    }

    // Sort students by priority descending
    normalizedStudents.sort((a, b) => (b.priority || 0) - (a.priority || 0));

    // Counts come straight from Prep365's response (fall back to our tallies).
    const finalResult = {
      testMode,
      testStudentIds,
      count: typeof data.count === 'number' ? data.count : normalizedStudents.length,
      callableCount: typeof data.callableCount === 'number' ? data.callableCount : callableCount,
      byReason: data.byReason || byReason,
      students: normalizedStudents,
      thresholds: data.thresholds || null, // Prep365's own selection rules (cooldown, daily limit, …)
      syncedAt: new Date().toISOString()
    };

    // Store in Supabase and local cache
    await prep365StudentStore.upsertStudents(finalResult).catch(err => {
      logger.warn('[Prep365] Failed to persist candidates to store:', err.message);
    });

    // Sync Google Sheet "Students" tab asynchronously
    prep365SheetService.syncStudentsTab(normalizedStudents).catch(err => {
      logger.warn('[Prep365] Google Sheets Students tab sync warning:', err.message);
    });

    this.lastSync = {
      timestamp: finalResult.syncedAt,
      dryRun: isDryRun,
      studentsReceived: finalResult.count,
      callsQueued: finalResult.callableCount,
      callsPlaced: 0,
      errors: 0
    };

    logger.info(`[Prep365] Candidates sync complete: ${finalResult.count} students, ${callableCount} callable, testMode=${testMode}`);
    return finalResult;
  }

  /**
   * 2. CLAIM SELECTED (Individual and Bulk Calling)
   * POST /claim-selected
   * Body: { studentIds: ["..."], dryRun: true|false }
   */
  async claimSelected({ studentIds = [], dryRun } = {}) {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('PREP365_API_KEY is not configured in environment');
    }

    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      throw new Error('studentIds must be a non-empty array of student IDs');
    }

    const isDryRun = isDryRunMode(dryRun);
    const body = {
      studentIds,
      ...(isDryRun ? { dryRun: true } : {})
    };

    logger.info(`[Prep365] Claiming ${studentIds.length} selected student(s) (dryRun=${isDryRun})`);

    // Only /claim-selected, never /claim: /claim may hand back students nobody selected.
    let res;
    try {
      res = await axios.post(`${this.baseUrl}/claim-selected`, body, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        timeout: 30000,
      });
    } catch (err) {
      const detail = err.response?.data?.error || err.response?.data?.message || err.message;
      throw new Error(`Prep365 claim-selected failed (${err.response?.status || 'network'}): ${detail}`);
    }

    const data = res.data || {};
    const count = data.count !== undefined ? data.count : (data.batches ? data.batches.length : 0);
    const totalCalls = data.calls !== undefined ? data.calls : (data.batches ? data.batches.reduce((acc, b) => acc + (b.calls?.length || 0), 0) : 0);
    const skipped = data.skipped || [];
    const batches = data.batches || [];

    logger.info(`[Prep365] Claim-selected response: count=${count}, calls=${totalCalls}, skipped=${skipped.length}`);

    return {
      count,
      calls: totalCalls,
      skipped,
      batches,
      dryRun: isDryRun,
      callbackUrl: data.callbackUrl || `${this.baseUrl}/call-results`
    };
  }

  /**
   * 3. PLACE BATCHED CALLS (Max 2 calls at a time)
   * Places ONLY the calls returned in batches: student and/or parent.
   * Parents hear about their child by name.
   */
  async placeBatchedCalls({ batches = [], dryRun } = {}) {
    const isDryRun = isDryRunMode(dryRun);
    const Lead = require('../models/Lead');
    const telnyxSvc = require('./telnyxService');
    const baseUrl = cfg.server.meetingBaseUrl || cfg.server.baseUrl || 'https://aicalling-xfyr.onrender.com';

    let campaignUuid = '4b6bb650-e951-4607-9624-02485f9f9d1c';
    try {
      const supabase = require('../db/supabase');
      const { data: camp } = await supabase.from('campaigns').select('id').eq('type', 'prep365-retention').single();
      if (camp?.id) campaignUuid = camp.id;
    } catch (_) {}

    const plannedCalls = [];
    for (const batch of batches) {
      const studentObj = batch.student?.student || batch.student || {};
      const studentName = studentObj.name || 'Unknown Student';
      const studentId = studentObj.id || null;
      const studentGrade = studentObj.grade || batch.student?.grade || '11th Grade';
      const rawReasons = batch.student?.reasons || [];
      const reasonsStr = Array.isArray(rawReasons)
        ? rawReasons.map(r => r.label || r.code).join('; ')
        : String(rawReasons);
      const talkingPoints = batch.student?.talkingPoints || '';
      const snapshot = batch.student?.snapshot || {};

      for (const call of (batch.calls || [])) {
        plannedCalls.push({
          outreachId: call.outreachId,
          recipientType: call.recipientType || 'student',
          recipientName: call.recipientName || studentName,
          phone: call.phone,
          maskedPhone: maskPhone(call.phone),
          studentId,
          studentName,
          studentEmail: studentObj.email || null,
          studentGrade,
          reasons: reasonsStr,
          rawReasons,
          talkingPoints,
          snapshot,
          studentData: studentObj
        });
      }
    }

    if (isDryRun) {
      logger.info(`[Prep365] DRY RUN: Simulation of ${plannedCalls.length} planned call(s) (no phones will ring).`);
      return {
        dryRun: true,
        callsQueued: plannedCalls.length,
        callsPlaced: 0,
        plannedCalls,
        message: `Dry-run completed successfully for ${plannedCalls.length} call(s). Zero real calls placed.`
      };
    }

    // LIVE RUN: Concurrency limit max 2 calls at a time
    logger.info(`[Prep365] LIVE MODE: Executing ${plannedCalls.length} call(s) with max concurrency = 2…`);
    const placed = [];
    const errors = [];

    // Helper to process calls with concurrency limit of 2
    const concurrency = 2;
    for (let i = 0; i < plannedCalls.length; i += concurrency) {
      const slice = plannedCalls.slice(i, i + concurrency);
      await Promise.all(slice.map(async (item) => {
        try {
          let lead = await Lead.findOne({ phone: item.phone });
          if (!lead) {
            lead = await Lead.create({
              fullName: item.recipientName,
              phone: item.phone,
              email: item.studentEmail || '',
              grade: item.studentGrade || '11th Grade',
              source: 'Prep365',
              status: 'calling',
              courseInterest: 'SAT Prep',
              notes: item.talkingPoints || item.reasons || '',
              campaignId: campaignUuid,
              qualification: {
                prep365OutreachId: item.outreachId,
                prep365RecipientType: item.recipientType,
                prep365StudentId: item.studentId,
                prep365StudentName: item.studentName,
                prep365TalkingPoints: item.talkingPoints,
                prep365Reasons: item.rawReasons || [],
                prep365Snapshot: item.snapshot || {},
                prep365Student: item.studentData || {}
              }
            });
          } else {
            lead.status = 'calling';
            lead.campaignId = campaignUuid;
            lead.notes = item.talkingPoints || lead.notes;
            lead.qualification = {
              ...(lead.qualification || {}),
              prep365OutreachId: item.outreachId,
              prep365RecipientType: item.recipientType,
              prep365StudentId: item.studentId,
              prep365StudentName: item.studentName,
              prep365TalkingPoints: item.talkingPoints,
              prep365Reasons: item.rawReasons || lead.qualification?.prep365Reasons || [],
              prep365Snapshot: item.snapshot || lead.qualification?.prep365Snapshot || {},
              prep365Student: item.studentData || lead.qualification?.prep365Student || {}
            };
            await lead.save();
          }

          lead.totalCallAttempts = (lead.totalCallAttempts || 0) + 1;
          lead.lastCallAt = new Date();
          lead.callAttempts = lead.callAttempts || [];
          lead.callAttempts.push({
            attemptNumber: lead.totalCallAttempts,
            startTime: new Date().toISOString(),
            status: 'initiated',
            campaignId: campaignUuid,
            prep365OutreachId: item.outreachId
          });
          await lead.save();

          logger.info(`[Prep365] Dialing Telnyx call to ${item.recipientName} (${item.recipientType}) at ${item.phone} (outreachId: ${item.outreachId})…`);
          const { callSid } = await telnyxSvc.call(lead, baseUrl, campaignUuid);
          logger.info(`[Prep365] Telnyx call dialed: SID=${callSid}`);

          lead.callAttempts[lead.callAttempts.length - 1].callSid = callSid;
          await lead.save();

          placed.push({
            outreachId: item.outreachId,
            recipientName: item.recipientName,
            recipientType: item.recipientType,
            phone: item.phone,
            callSid
          });
        } catch (err) {
          logger.error(`[Prep365] Error dialing ${item.recipientName}:`, err.message);
          errors.push({ recipientName: item.recipientName, phone: item.phone, error: err.message });
        }
      }));
    }

    return {
      dryRun: false,
      callsQueued: plannedCalls.length,
      callsPlaced: placed.length,
      placed,
      errors
    };
  }

  /**
   * 4. REPORT EVERY CALL BACK TO PREP365
   * POST /call-results
   * Appends / updates Google Sheet row.
   */
  async reportCallResult({
    outreachId,
    callId,
    status = 'completed',
    outcome = '',
    summary = '',
    providerCallId,
    duration = 0,
    durationSeconds,
    answeredBy = 'human',
    transcript = '',
    transcriptUrl = null,
    recordingUrl = null,
    nextSteps = '',
    followUpRequested = false,
    optOut = false,
    callbackUrl,
    studentName = '',
    studentEmail = '',
    grade = '',
    recipientType = 'student',
    recipientName = '',
    phone = '',
    reasons = ''
  } = {}) {
    const apiKey = this.getApiKey();
    const finalDuration = durationSeconds !== undefined ? parseInt(durationSeconds, 10) : (parseInt(duration, 10) || 0);
    const finalSummary = summary || outcome || '';

    // Standardize status: 'completed' | 'no_answer' | 'failed'
    let normStatus = status || 'completed';
    if (normStatus === 'no-answer' || normStatus === 'busy' || normStatus === 'canceled' || normStatus === 'timeout') {
      normStatus = 'no_answer';
    }

    // Standardize answeredBy: 'human' | 'voicemail' | 'unknown'
    let normAnsweredBy = answeredBy || 'unknown';
    if (normAnsweredBy === 'machine') normAnsweredBy = 'voicemail';

    const payload = {
      outreachId: outreachId !== undefined && outreachId !== null ? Number(outreachId) : undefined,
      callId: callId || providerCallId || undefined,
      status: normStatus,
      answeredBy: normAnsweredBy,
      durationSeconds: finalDuration,
      summary: finalSummary,
      transcript: transcript || '',
      nextSteps: nextSteps || '',
      followUpRequested: Boolean(followUpRequested),
      optOut: Boolean(optOut),
      recordingUrl: recordingUrl || undefined
    };

    const targetUrl = callbackUrl || `${this.baseUrl}/call-results`;

    if (apiKey) {
      try {
        logger.info(`[Prep365] Reporting call result to ${targetUrl}: outreachId=${outreachId} status=${normStatus} duration=${finalDuration}s answeredBy=${normAnsweredBy}`);
        await axios.post(targetUrl, payload, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          timeout: 15000,
        });
        logger.info(`[Prep365] Successfully posted call result for outreachId ${outreachId}`);
      } catch (err) {
        logger.warn(`[Prep365] Call result report HTTP error for outreach ${outreachId}: ${err.message}`);
      }
    }

    // Record in Google Sheet
    const sheetCallRecord = {
      timestamp: new Date().toISOString(),
      outreachId,
      studentName: studentName || recipientName || 'Student',
      studentEmail: studentEmail || '',
      grade: grade || '11th Grade',
      recipientType: recipientType || 'student',
      recipientName: recipientName || studentName,
      phone: phone || '',
      reasons: reasons || '',
      status: normStatus,
      answeredBy: normAnsweredBy,
      durationSeconds: finalDuration,
      summary: finalSummary,
      nextSteps: nextSteps || '',
      followUpRequested: Boolean(followUpRequested),
      optOut: Boolean(optOut),
      transcript: transcript || '',
      recordingUrl: recordingUrl || ''
    };

    this._recentCallsMem.unshift(sheetCallRecord);
    if (this._recentCallsMem.length > 200) this._recentCallsMem.pop();

    prep365SheetService.logCall(sheetCallRecord).catch(err => {
      logger.warn('[Prep365] Google Sheets logCall warning:', err.message);
    });

    return payload;
  }

  /**
   * 5. GET CALL LOG (JSON or CSV)
   */
  async getCallLog({ format, from, to, studentId } = {}) {
    // Only real calls placed by this server (no hard-coded sample rows).
    let calls = [...this._recentCallsMem];

    if (studentId) {
      calls = calls.filter(c => c.studentId === studentId || c.studentName?.toLowerCase() === studentId.toLowerCase());
    }

    if (from) {
      const fromDate = new Date(from).getTime();
      calls = calls.filter(c => new Date(c.timestamp).getTime() >= fromDate);
    }

    if (to) {
      const toDate = new Date(to).getTime();
      calls = calls.filter(c => new Date(c.timestamp).getTime() <= toDate);
    }

    if (format === 'csv') {
      const headers = [
        'Date', 'Time (IST)', 'Student', 'Student Email', 'Grade', 'Recipient Type',
        'Person Called', 'Phone', 'Reasons', 'Status', 'Answered By', 'Duration (s)',
        'Summary', 'Next Steps', 'Follow-up Requested', 'Opted Out', 'Full Conversation',
        'Recording Link', 'Outreach ID'
      ];
      const rows = calls.map(c => [
        c.timestamp ? c.timestamp.split('T')[0] : '',
        c.timestamp ? c.timestamp.split('T')[1].replace('Z', '') : '',
        `"${(c.studentName || '').replace(/"/g, '""')}"`,
        `"${(c.studentEmail || '').replace(/"/g, '""')}"`,
        `"${(c.grade || '').replace(/"/g, '""')}"`,
        `"${(c.recipientType || 'student').replace(/"/g, '""')}"`,
        `"${(c.recipientName || '').replace(/"/g, '""')}"`,
        `"${(c.phone || '').replace(/"/g, '""')}"`,
        `"${(c.reasons || '').replace(/"/g, '""')}"`,
        c.status || '',
        c.answeredBy || '',
        c.durationSeconds || 0,
        `"${(c.summary || '').replace(/"/g, '""')}"`,
        `"${(c.nextSteps || '').replace(/"/g, '""')}"`,
        c.followUpRequested ? 'Yes' : 'No',
        c.optOut ? 'Yes' : 'No',
        `"${(c.transcript || '').replace(/"/g, '""')}"`,
        `"${(c.recordingUrl || '').replace(/"/g, '""')}"`,
        c.outreachId || ''
      ]);

      const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      return { csv: csvContent };
    }

    return { calls, count: calls.length };
  }

  getLastSync() {
    return this.lastSync || {
      timestamp: null,
      dryRun: isDryRunMode(),
      studentsReceived: 0,
      callsQueued: 0,
      callsPlaced: 0,
      errors: 0
    };
  }
}

module.exports = new Prep365Service();
