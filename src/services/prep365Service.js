const axios = require('axios');
const cfg = require('../config');
const logger = require('../logger');

/**
 * Mask phone numbers for privacy in logs.
 * e.g. "+918466924574" -> "+91846***574"
 */
function maskPhone(phone) {
  if (!phone) return 'N/A';
  const clean = String(phone).trim();
  if (clean.length <= 6) return '***';
  const prefixLen = clean.startsWith('+') ? 6 : 4;
  const prefix = clean.slice(0, Math.min(prefixLen, Math.floor(clean.length / 2)));
  const suffix = clean.slice(-3);
  const maskCount = Math.max(3, clean.length - prefix.length - suffix.length);
  return `${prefix}${'*'.repeat(maskCount)}${suffix}`;
}

class Prep365Service {
  constructor() {
    this.baseUrl = (process.env.PREP365_BASE_URL || cfg.prep365?.baseUrl || 'https://www.prep365.ai/api/ai-calls').replace(/\/+$/, '');
  }

  getApiKey() {
    return process.env.PREP365_API_KEY || cfg.prep365?.apiKey || '';
  }

  isDryRunConfigured() {
    const envVal = process.env.PREP365_DRY_RUN;
    if (envVal !== undefined) return envVal !== 'false';
    return cfg.prep365?.dryRun !== false;
  }

  /**
   * Claim candidates from Prep365.
   * If dryRun is true, Prep365 previews candidates without creating permanent outreach rows.
   */
  async claimCandidates({ dryRun } = {}) {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('PREP365_API_KEY is not configured in environment');
    }

    const isDryRun = dryRun !== undefined ? Boolean(dryRun) : this.isDryRunConfigured();
    const claimUrl = `${this.baseUrl}/claim`;

    const res = await axios.post(
      claimUrl,
      { dryRun: isDryRun },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        timeout: 30000,
      }
    );

    return res.data;
  }

  /**
   * Report call outcome back to Prep365 to update ai_call_outreach.
   */
  async reportCallResult({ outreachId, callId, status, outcome, providerCallId, duration, callbackUrl } = {}) {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      logger.warn('[Prep365] Cannot report call result: PREP365_API_KEY not configured');
      return null;
    }

    const targetUrl = callbackUrl || `${this.baseUrl}/call-results`;
    const payload = {
      outreachId: outreachId || undefined,
      callId: callId || undefined,
      status: status || 'completed',
      outcome: outcome || '',
      providerCallId: providerCallId || undefined,
      duration: duration !== undefined ? parseInt(duration, 10) : 0,
    };

    try {
      const res = await axios.post(targetUrl, payload, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        timeout: 15000,
      });
      logger.info(`[Prep365] Reported call result for outreach ${outreachId}: ${status}`);
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
    const isDryRun = dryRun !== undefined ? Boolean(dryRun) : this.isDryRunConfigured();
    logger.info(`[Prep365] Starting candidate sync (dryRun=${isDryRun})…`);

    const result = await this.claimCandidates({ dryRun: isDryRun });
    if (!result.ok) {
      throw new Error(`Prep365 /claim returned ok=false: ${result.error || 'Unknown error'}`);
    }

    const batches = result.batches || [];
    const studentCount = result.count !== undefined ? result.count : batches.length;
    const callsCount = result.calls !== undefined ? result.calls : batches.reduce((acc, b) => acc + (b.calls?.length || 0), 0);

    logger.info(`[Prep365] Fetched ${studentCount} student(s) / ${callsCount} planned call(s) (dryRun=${isDryRun})`);

    const plannedCalls = [];

    for (const batch of batches) {
      const studentInfo = batch.student?.student || {};
      const studentName = studentInfo.name || 'Unknown Student';
      const studentId = studentInfo.id || null;
      const reasons = (batch.student?.reasons || []).map(r => r.label || r.code).join('; ');
      const talkingPoints = batch.student?.talkingPoints || '';

      for (const call of (batch.calls || [])) {
        const masked = maskPhone(call.phone);
        logger.info(`[Prep365] Planned call: ${call.recipientName} (${call.recipientType}) → ${masked} | student: ${studentName}${reasons ? ' | ' + reasons : ''}`);

        plannedCalls.push({
          ...call,
          maskedPhone: masked,
          studentId,
          studentName,
          studentEmail: studentInfo.email || null,
          reasons,
          talkingPoints,
          callbackUrl: result.callbackUrl || null,
        });
      }
    }

    // DRY RUN: place NO calls, return planned calls preview
    if (isDryRun) {
      logger.info('[Prep365] Dry-run enabled: no outbound calls placed.');
      return {
        ok: true,
        dryRun: true,
        studentCount,
        callsCount,
        plannedCalls,
        callbackUrl: result.callbackUrl,
        message: 'Dry-run sync complete. No calls were placed.'
      };
    }

    // LIVE RUN: Dispatch calls and notify Prep365
    logger.info(`[Prep365] Live mode: processing ${plannedCalls.length} call(s)…`);
    const Lead = require('../models/Lead');
    const bulkCallService = require('./bulkCallService');

    const queuedLeadIds = [];

    for (const item of plannedCalls) {
      try {
        let lead = await Lead.findOne({ phone: item.phone });
        if (!lead) {
          lead = new Lead({
            fullName: item.recipientName,
            phone: item.phone,
            email: item.studentEmail || '',
            source: 'Prep365',
            status: 'queued',
            courseInterest: 'SAT Prep',
            notes: item.talkingPoints || item.reasons || '',
            campaignId: 'prep365-retention',
            qualification: {
              prep365OutreachId: item.outreachId,
              prep365RecipientType: item.recipientType,
              prep365StudentId: item.studentId,
              prep365StudentName: item.studentName,
              prep365TalkingPoints: item.talkingPoints,
              prep365CallbackUrl: item.callbackUrl,
            }
          });
          await lead.save();
        } else {
          lead.campaignId = 'prep365-retention';
          lead.notes = item.talkingPoints || lead.notes;
          lead.qualification = {
            ...(lead.qualification || {}),
            prep365OutreachId: item.outreachId,
            prep365RecipientType: item.recipientType,
            prep365StudentId: item.studentId,
            prep365StudentName: item.studentName,
            prep365TalkingPoints: item.talkingPoints,
            prep365CallbackUrl: item.callbackUrl,
          };
          await lead.save();
        }

        // Notify Prep365 that call was queued/sent
        if (item.outreachId) {
          await this.reportCallResult({
            outreachId: item.outreachId,
            status: 'sent',
            callbackUrl: item.callbackUrl,
          }).catch(() => {});
        }

        queuedLeadIds.push(lead._id.toString());
      } catch (err) {
        logger.error(`[Prep365] Error preparing lead for ${item.recipientName}`, { msg: err.message });
      }
    }

    if (queuedLeadIds.length > 0) {
      try {
        await bulkCallService.enqueue({
          leadIds: queuedLeadIds,
          campaignId: 'prep365-retention',
          label: 'Prep365 Retention Outreach'
        });
        logger.info(`[Prep365] Enqueued ${queuedLeadIds.length} lead(s) into bulk calling queue.`);
      } catch (qErr) {
        logger.error('[Prep365] Failed enqueuing leads into bulk call queue', { msg: qErr.message });
      }
    }

    return {
      ok: true,
      dryRun: false,
      studentCount,
      callsCount,
      plannedCalls,
      queuedCallsCount: queuedLeadIds.length,
      callbackUrl: result.callbackUrl,
    };
  }
}

module.exports = new Prep365Service();
