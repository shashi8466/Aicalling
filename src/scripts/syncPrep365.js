#!/usr/bin/env node
/**
 * Standalone CLI script for Prep365 Sync
 * Useful for Render Cron Jobs, GitHub Actions, or manual terminal execution.
 * 
 * Usage:
 *   node src/scripts/syncPrep365.js
 *   node src/scripts/syncPrep365.js --live
 */
require('dotenv').config();
const prep365Svc = require('../services/prep365Service');
const logger = require('../logger');

const isLiveArg = process.argv.includes('--live') || process.env.PREP365_DRY_RUN === 'false';
const dryRun = !isLiveArg;

(async () => {
  try {
    logger.info(`[CLI] Running Prep365 candidate sync (dryRun=${dryRun})…`);
    const result = await prep365Svc.sync({ dryRun });
    logger.info('[CLI] Prep365 sync finished successfully:', {
      studentCount: result.studentCount,
      callsCount: result.callsCount,
      dryRun: result.dryRun,
    });
    process.exit(0);
  } catch (err) {
    logger.error('[CLI] Prep365 sync failed', { msg: err.message });
    process.exit(1);
  }
})();
