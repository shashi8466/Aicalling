/**
 * Billing Poller Job
 * ──────────────────────────────────────────────────────────
 * Twilio populates a call's `price` on the Call resource a short while after
 * the call ends. This job re-checks every billing row still marked 'pending'
 * and finalizes it once the real price is available. See billingService.
 */
const billingService = require('../services/billingService');
const logger         = require('../logger');

const INTERVAL_MS = 90_000; // every 90 seconds

function start() {
  setInterval(() => {
    billingService.backfillPending().catch(err =>
      logger.error('billingPoller tick failed', { msg: err.message }));
  }, INTERVAL_MS);
  logger.info('Billing Poller job started');
}

module.exports = { start, backfillPending: billingService.backfillPending };
