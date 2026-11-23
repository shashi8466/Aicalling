const axios = require('axios');
const cfg = require('../config');
const logger = require('../logger');

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
  // In Render, PREP365_DRY_RUN is the string "false" in live mode
  return process.env.PREP365_DRY_RUN === 'true';
}

class Prep365Service {
  constructor() {
    this.baseUrl = (process.env.PREP365_BASE_URL || cfg.prep365?.baseUrl || 'https://www.prep365.ai/api/ai-calls').replace(/\/+$/, '');
  }

  getApiKey() {
    return process.env.PREP365_API_KEY || cfg.prep365?.apiKey || '';
  }

  /**
   * Claim candidates from Prep365.
   * In dry-run: body is {"dryRun": true}
   * In live mode: body does NOT contain dryRun:true (sends {})
   */
  async claimCandidates({ dryRun } = {}) {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('PREP365_API_KEY is not configured in environment');
    }

    const isDryRun = isDryRunMode(dryRun);
    const claimUrl = `${this.baseUrl}/claim`;
    const requestBody = isDryRun ? { dryRun: true } : {};

    logger.info(`[Prep365] Request: POST ${claimUrl} body=${JSON.stringify(requestBody)}`);

    const res = await axios.post(
      claimUrl,
      requestBody,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        timeout: 30000,
      }
    );

    const count = res.data?.count ?? (res.data?.batches ? res.data.batches.length : 0);
    logger.info(`[Prep365] Response: status=${res.status} count=${count} dryRun=${res.data?.dryRun}`);

    return { response: res, data: res.data };
  }

  /**
   * Report call outcome back to Prep365 to update ai_call_outreach.
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
    transcriptUrl = null,
    recordingUrl = null,
    followUpRequested = false,
    optOut = false,
    callbackUrl
  } = {}) {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      logger.warn('[Prep365] Cannot report call result: PREP365_API_KEY not configured');
      return null;
    }

    const targetUrl = callbackUrl || `${this.baseUrl}/call-results`;
    const finalDuration = durationSeconds !== undefined ? parseInt(durationSeconds, 10) : (parseInt(duration, 10) || 0);
    const finalSummary = summary || outcome || '';

    // Standardize status: 'completed' | 'no_answer' | 'failed'
    let normStatus = status || 'completed';
    if (normStatus === 'no-answer' || normStatus === 'busy' || normStatus === 'canceled') {
      normStatus = 'no_answer';
    }

    // Standardize answeredBy: 'human' | 'voicemail' | 'unknown'
    let normAnsweredBy = answeredBy || 'unknown';
    if (normAnsweredBy === 'machine') normAnsweredBy = 'voicemail';

    const payload = {
      outreachId: outreachId !== undefined && outreachId !== null ? Number(outreachId) : undefined,
      callId: callId || providerCallId || undefined,
      status: normStatus,
      summary: finalSummary,
      durationSeconds: finalDuration,
      answeredBy: normAnsweredBy,
      transcriptUrl: transcriptUrl || undefined,
      recordingUrl: recordingUrl || undefined,
      followUpRequested: Boolean(followUpRequested),
      optOut: Boolean(optOut),
    };

    logger.info(`[Prep365] Reporting result to ${targetUrl}: outreachId=${outreachId} status=${normStatus} duration=${finalDuration}s answeredBy=${normAnsweredBy}`);

    try {
      const res = await axios.post(targetUrl, payload, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        timeout: 15000,
      });
      logger.info(`[Prep365] Reported call result for outreach ${outreachId}: HTTP ${res.status} ok=${res.data?.ok}`);
      return res.data;
    } catch (err) {
      const errDetail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      logger.error(`[Prep365] Failed to report call result for outreach ${outreachId}`, { detail: errDetail });
      return null;
    }
  }

  /**
   * Perform a full sync from Prep365.
   */
  async sync({ dryRun } = {}) {
    const isDryRun = isDryRunMode(dryRun);
    logger.info(`[Prep365] Starting candidate sync (dryRun=${isDryRun})…`);

    const { data: result } = await this.claimCandidates({ dryRun: isDryRun });
    if (!result.ok) {
      throw new Error(`Prep365 /claim returned ok=false: ${result.error || 'Unknown error'}`);
    }

    const batches = result.batches || [];
    const count = result.count !== undefined ? result.count : batches.length;
    const totalCalls = result.calls !== undefined ? result.calls : batches.reduce((acc, b) => acc + (b.calls?.length || 0), 0);

    // If count is 0, log full response and stop immediately (do not loop)
    if (count === 0) {
      logger.warn(`[Prep365] count=0 received. Full response body: ${JSON.stringify(result)}`);
      return {
        ok: true,
        dryRun: isDryRun,
        studentCount: 0,
        callsCount: 0,
        plannedCalls: [],
        rawResponse: result,
        message: 'No candidate students available from Prep365 (count=0).'
      };
    }

    logger.info(`[Prep365] Fetched ${count} student(s) / ${totalCalls} planned call(s) (dryRun=${isDryRun})`);

    const plannedCalls = [];

    for (const batch of batches) {
      const studentInfo = batch.student?.student || {};
      const studentName = studentInfo.name || 'Unknown Student';
      const studentId = studentInfo.id || null;
      const studentGrade = studentInfo.grade || batch.student?.grade || '11th Grade';
      const rawReasons = batch.student?.reasons || [];
      const reasons = rawReasons.map(r => r.label || r.code).join('; ');
      const talkingPoints = batch.student?.talkingPoints || '';
      const snapshot = batch.student?.snapshot || {};
      const parents = batch.student?.parents || [];
      const parentName = parents[0]?.name || '';
      const parentEmail = parents[0]?.email || '';

      for (const call of (batch.calls || [])) {
        const masked = maskPhone(call.phone);
        logger.info(`[Prep365] Planned call: ${call.recipientName} (${call.recipientType}) → ${masked} | student: ${studentName}${reasons ? ' | ' + reasons : ''}`);

        plannedCalls.push({
          ...call,
          maskedPhone: masked,
          studentId,
          studentName,
          studentEmail: studentInfo.email || null,
          studentGrade,
          parentName,
          parentEmail,
          reasons,
          rawReasons,
          talkingPoints,
          snapshot,
          studentData: studentInfo,
          callbackUrl: result.callbackUrl || null,
        });
      }
    }

    // DRY RUN: place NO calls, return preview
    if (isDryRun) {
      logger.info('[Prep365] Dry-run enabled: no outbound calls placed.');
      this.lastSync = {
        timestamp: new Date().toISOString(),
        dryRun: true,
        studentsReceived: count,
        callsQueued: totalCalls,
        callsPlaced: 0,
        errors: 0,
      };
      return {
        ok: true,
        dryRun: true,
        studentCount: count,
        callsCount: totalCalls,
        plannedCalls,
        callbackUrl: result.callbackUrl,
        message: 'Dry-run sync complete. Zero calls placed.'
      };
    }

    // LIVE RUN: Dial via Telnyx immediately
    logger.info(`[Prep365] Live mode: placing Telnyx calls for ${plannedCalls.length} recipient(s)…`);
    const Lead = require('../models/Lead');
    const telnyxSvc = require('./telnyxService');
    const baseUrl = cfg.server.meetingBaseUrl || cfg.server.baseUrl || 'https://aicalling-xfyr.onrender.com';

    let campaignUuid = '4b6bb650-e951-4607-9624-02485f9f9d1c';
    try {
      const supabase = require('../db/supabase');
      const { data: camp } = await supabase.from('campaigns').select('id').eq('type', 'prep365-retention').single();
      if (camp?.id) campaignUuid = camp.id;
    } catch (_) {}

    const placedCalls = [];

    for (const item of plannedCalls) {
      try {
        let lead = await Lead.findOne({ phone: item.phone });
        if (!lead) {
          lead = await Lead.create({
            fullName: item.recipientName,
            phone: item.phone,
            email: item.studentEmail || '',
            parentName: item.parentName || '',
            parentEmail: item.parentEmail || '',
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
              prep365CallbackUrl: item.callbackUrl,
              prep365Reasons: item.rawReasons || [],
              prep365Snapshot: item.snapshot || {},
              prep365Student: item.studentData || {},
            }
          });
        } else {
          lead.status = 'calling';
          lead.campaignId = campaignUuid;
          lead.notes = item.talkingPoints || lead.notes;
          if (item.studentGrade) lead.grade = item.studentGrade;
          lead.qualification = {
            ...(lead.qualification || {}),
            prep365OutreachId: item.outreachId,
            prep365RecipientType: item.recipientType,
            prep365StudentId: item.studentId,
            prep365StudentName: item.studentName,
            prep365TalkingPoints: item.talkingPoints,
            prep365CallbackUrl: item.callbackUrl,
            prep365Reasons: item.rawReasons || lead.qualification?.prep365Reasons || [],
            prep365Snapshot: item.snapshot || lead.qualification?.prep365Snapshot || {},
            prep365Student: item.studentData || lead.qualification?.prep365Student || {},
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
          prep365OutreachId: item.outreachId,
        });
        await lead.save();

        logger.info(`[Prep365] Placing Telnyx call to ${item.recipientName} at ${item.phone} (outreachId: ${item.outreachId})…`);
        const { callSid } = await telnyxSvc.call(lead, baseUrl, campaignUuid);
        logger.info(`[Prep365] Telnyx call placed successfully: SID=${callSid}`);

        lead.callAttempts[lead.callAttempts.length - 1].callSid = callSid;
        await lead.save();

        // Notify Prep365 that call has been initiated / sent
        if (item.outreachId) {
          await this.reportCallResult({
            outreachId: item.outreachId,
            status: 'sent',
            providerCallId: callSid,
            callbackUrl: item.callbackUrl,
          }).catch(rErr => logger.warn('[Prep365] Initial sent status report warning', { msg: rErr.message }));
        }

        placedCalls.push({
          recipientName: item.recipientName,
          phone: item.phone,
          outreachId: item.outreachId,
          callSid,
        });
      } catch (err) {
        logger.error(`[Prep365] Failed placing Telnyx call to ${item.recipientName}`, { msg: err.message, stack: err.stack });
      }
    }

    this.lastSync = {
      timestamp: new Date().toISOString(),
      dryRun: false,
      studentsReceived: count,
      callsQueued: totalCalls,
      callsPlaced: placedCalls.length,
      errors: totalCalls - placedCalls.length,
    };

    return {
      ok: true,
      dryRun: false,
      studentCount: count,
      callsCount: totalCalls,
      plannedCalls,
      placedCalls,
      callbackUrl: result.callbackUrl,
    };
  }

  getLastSync() {
    return this.lastSync || {
      timestamp: null,
      dryRun: isDryRunMode(),
      studentsReceived: 0,
      callsQueued: 0,
      callsPlaced: 0,
      errors: 0,
    };
  }
}

module.exports = new Prep365Service();
