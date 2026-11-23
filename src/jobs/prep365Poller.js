/**
 * Prep365 Candidate Poller / Sync Job
 * Runs on a schedule to claim candidates and queue outreach calls.
 */
const cron = require('node-cron');
const cfg = require('../config');
const logger = require('../logger');
const prep365Svc = require('../services/prep365Service');

let task = null;
let isSyncing = false;

async function syncOnce({ dryRun } = {}) {
  if (isSyncing) {
    logger.warn('[Prep365] Sync already in progress, skipping iteration.');
    return;
  }
  isSyncing = true;
  try {
    const res = await prep365Svc.sync({ dryRun });
    return res;
  } catch (err) {
    logger.error('[Prep365] Sync failed', { msg: err.message, stack: err.stack });
    throw err;
  } finally {
    isSyncing = false;
  }
}

function start() {
  const schedule = cfg.prep365?.cronSchedule || process.env.PREP365_CRON_SCHEDULE || '0 14 * * *';
  const isDryRun = process.env.PREP365_DRY_RUN === 'true';

  // Log startup line exactly as requested:
  logger.info(`Prep365 sync job started — schedule ${schedule}, dryRun=${isDryRun}`);

  try {
    task = cron.schedule(schedule, () => {
      syncOnce().catch(() => {});
    });
  } catch (cronErr) {
    logger.error('[Prep365] Failed to initialize cron schedule', { schedule, error: cronErr.message });
  }
}

function stop() {
  if (task) {
    task.stop();
    task = null;
    logger.info('[Prep365] Sync job stopped');
  }
}

module.exports = {
  start,
  stop,
  syncOnce,
};
