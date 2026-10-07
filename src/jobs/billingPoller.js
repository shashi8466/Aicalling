/**
 * Billing Poller Job
 * ──────────────────────────────────────────────────────────
 *  • Every 5 min: reconcile recent Telnyx calls against Telnyx Detail Records
 *    (estimated cost → actual Telnyx cost). See telnyxBilling.reconcile.
 *  • Every 90 s: finalize any pre-Telnyx (historical Twilio) rows still pending.
 */
const billingService = require('../services/billingService');
const telnyxBilling  = require('../services/telnyxBilling');
const logger         = require('../logger');

const INTERVAL_MS = 90_000;              // historical Twilio finalizer
const RECONCILE_INTERVAL_MS = 5 * 60_000; // Telnyx reconciliation

function start() {
  setInterval(() => {
    billingService.backfillPending().catch(err =>
      logger.error('billingPoller tick failed', { msg: err.message }));
  }, INTERVAL_MS);
  setInterval(() => {
    telnyxBilling.reconcileIfNeeded().catch(err =>
      logger.error('Telnyx reconcile tick failed', { msg: err.message }));
  }, RECONCILE_INTERVAL_MS);
  logger.info('Billing Poller job started');
}

module.exports = { start, backfillPending: billingService.backfillPending };
