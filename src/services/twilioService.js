/**
 * twilioService.js — COMPATIBILITY SHIM
 * ─────────────────────────────────────
 * This project has migrated from Twilio to Telnyx for outbound AI calling.
 * All existing code continues to `require('../services/twilioService')` and
 * works unchanged because we simply re-export the Telnyx service here.
 *
 * The Telnyx service exposes an identical interface:
 *  .call(lead, baseUrl, campaignId, campaignVars)
 *  .callFollowUp(lead, baseUrl)
 *  .endCall(callControlId)
 *  ._client()
 *  .twimlStart / .twimlRespond / .twimlListen / .twimlOfferSlots
 *  .twimlBookingConfirm / .twimlVoicemail / .twimlHangup
 */
module.exports = require('./telnyxService');
