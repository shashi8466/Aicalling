#!/usr/bin/env node
/**
 * Standalone CLI script for Prep365 Sync
 * Usage:
 *   node src/scripts/syncPrep365.js          # uses PREP365_DRY_RUN from env (default false if PREP365_DRY_RUN !== 'true')
 *   node src/scripts/syncPrep365.js --live   # forces live mode
 *   node src/scripts/syncPrep365.js --dry-run # forces dry run mode
 */
require('dotenv').config();
const prep365Svc = require('../services/prep365Service');
const logger = require('../logger');

const isExplicitLive = process.argv.includes('--live');
const isExplicitDryRun = process.argv.includes('--dry-run');

let dryRun = undefined;
if (isExplicitLive) dryRun = false;
else if (isExplicitDryRun) dryRun = true;
else if (process.env.PREP365_DRY_RUN !== undefined) {
  dryRun = process.env.PREP365_DRY_RUN === 'true';
}

(async () => {
  try {
    const result = await prep365Svc.sync({ dryRun });
    logger.info('[CLI] Sync finished:', {
      ok: result.ok,
      dryRun: result.dryRun,
      studentCount: result.studentCount,
      callsCount: result.callsCount,
      placedCalls: result.placedCalls?.length || 0,
    });
    process.exit(0);
  } catch (err) {
    logger.error('[CLI] Prep365 sync error', { msg: err.message });
    process.exit(1);
  }
})();
