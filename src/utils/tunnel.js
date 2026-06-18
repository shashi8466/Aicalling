/**
 * Resilient SSH Tunnel Manager (no reconnect-loop)
 *  - Tries localhost.run first, serveo.net as fallback
 *  - Single global "starting" lock to prevent race conditions
 *  - Health-check every 60s; only rebuilds if dead
 *  - Auto-updates BASE_URL in .env and runtime config
 */
const { spawn } = require('child_process');
const fs        = require('fs');
const path      = require('path');
const http      = require('http');
const https     = require('https');
const cfg       = require('../config');
const logger    = require('../logger');

let currentProc   = null;
let currentUrl    = null;
let providerIdx   = 0;
let healthTimer   = null;
let onUrlCallback = null;
let isStarting    = false;          // ← prevents reconnect race
let manualStop    = false;          // ← stop everything on shutdown
let startResolver = null;           // resolves first start()

const PROVIDERS = [
  {
    name:  'localtunnel',       // npm package — most reliable
    type:  'npm',
  },
  {
    name:  'serveo.net',
    type:  'ssh',
    host:  'serveo.net',
    parse: (txt) => {
      const m = txt.replace(/\x1b\[[0-9;]*m/g, '').match(/https?:\/\/[a-z0-9][a-z0-9\-]+\.serveousercontent\.com/i);
      return m ? m[0] : null;
    },
  },
  {
    name:  'localhost.run',
    type:  'ssh',
    host:  'nokey@localhost.run',
    parse: (txt) => {
      const m = txt.replace(/\x1b\[[0-9;]*m/g, '').match(/https?:\/\/[a-z0-9\-]+\.lhr\.life/i);
      return m ? m[0] : null;
    },
  },
];

function updateEnvBaseUrl(url) {
  try {
    const envPath = path.join(__dirname, '../../.env');
    let content   = fs.readFileSync(envPath, 'utf8');
    content       = content.replace(/^BASE_URL=.*/m, `BASE_URL=${url}`);
    fs.writeFileSync(envPath, content);
    process.env.BASE_URL = url;
    cfg.server.baseUrl   = url;
    logger.info(`📡 BASE_URL set to: ${url}`);
  } catch(e) {
    logger.warn('Could not update .env:', e.message);
  }
}

function killCurrentProc() {
  if (currentProc) {
    try {
      currentProc.removeAllListeners('close');  // suppress reconnect triggers
      currentProc.removeAllListeners('error');
      currentProc.kill('SIGKILL');
    } catch(_) {}
    currentProc = null;
  }
}

/** Test if the tunnel URL is actually serving traffic */
function testTunnel(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(false);
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url + '/health', { timeout: 8000, headers: { 'User-Agent': 'health-check' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          resolve(j.status === 'ok');
        } catch { resolve(false); }
      });
    });
    req.on('error',   () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/** Try the npm localtunnel package — works without SSH */
async function attemptLocalTunnel(port) {
  logger.info(`🌐 Trying localtunnel (npm)…`);
  try {
    const lt = require('localtunnel');
    const tunnel = await lt({ port });
    const url = tunnel.url;
    if (!url) return null;

    currentUrl = url;
    updateEnvBaseUrl(url);
    logger.info(`✅ Tunnel: ${url}`);

    // Treat the tunnel object like a "proc" for cleanup
    currentProc = {
      kill: () => { try { tunnel.close(); } catch(_){} },
      removeAllListeners: () => {},
    };

    tunnel.on('close', () => {
      if (currentProc && currentUrl === url) {
        logger.warn('localtunnel closed — rebuilding…');
        currentProc = null;
        currentUrl  = null;
        if (!manualStop) setTimeout(() => safeStart(port), 8000);
      }
    });
    tunnel.on('error', (err) => {
      logger.warn('localtunnel error:', err.message);
    });

    return url;
  } catch(e) {
    logger.warn(`localtunnel failed: ${e.message}`);
    return null;
  }
}

/** Single provider attempt — returns URL string or null */
function attemptSshProvider(provider, port) {
  return new Promise((resolve) => {
    logger.info(`🌐 Trying ${provider.name}…`);

    const args = [
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'UserKnownHostsFile=/dev/null',
      '-o', 'ServerAliveInterval=60',
      '-o', 'ServerAliveCountMax=5',
      '-o', 'ExitOnForwardFailure=yes',
      '-o', 'LogLevel=ERROR',
      // NOTE: do NOT use -N flag — localhost.run / serveo print the URL via
      // the interactive session and the URL never arrives if no TTY.
      '-R', `80:localhost:${port}`,
      provider.host,
    ];

    const proc = spawn('ssh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let urlFound = false;
    let resolved = false;

    const safeResolve = (val) => {
      if (!resolved) {
        resolved = true;
        resolve(val);
      }
    };

    const giveUp = setTimeout(() => {
      if (!urlFound) {
        logger.warn(`${provider.name}: no URL within 25s`);
        try { proc.kill(); } catch(_){}
        safeResolve(null);
      }
    }, 25000);

    const handleData = (data) => {
      const text = data.toString();
      const url  = provider.parse(text);
      if (url && !urlFound) {
        urlFound = true;
        clearTimeout(giveUp);
        currentProc = proc;        // assign only on success
        currentUrl  = url;
        updateEnvBaseUrl(url);
        logger.info(`✅ Tunnel: ${url}`);

        // Attach close handler AFTER success
        proc.on('close', (code) => {
          if (currentProc === proc) {
            logger.warn(`Tunnel (${provider.name}) closed (code ${code}). Will rebuild if needed.`);
            currentProc = null;
            currentUrl  = null;
            if (!manualStop) {
              // delay before retry to prevent rapid-fire loops
              setTimeout(() => safeStart(port), 8000);
            }
          }
        });
        proc.on('error', (e) => {
          logger.error(`Tunnel process error (${provider.name}):`, e.message);
        });

        safeResolve(url);
      }
    };

    proc.stdout.on('data', handleData);
    proc.stderr.on('data', handleData);

    // Handlers in case proc dies BEFORE URL ever arrives
    proc.on('close', () => {
      if (!urlFound) {
        clearTimeout(giveUp);
        safeResolve(null);
      }
    });
    proc.on('error', (e) => {
      logger.warn(`${provider.name} spawn error:`, e.message);
      if (!urlFound) {
        clearTimeout(giveUp);
        safeResolve(null);
      }
    });
  });
}

/** Single source of truth: only one start() at a time */
async function safeStart(port) {
  if (isStarting) {
    logger.debug('Tunnel start already in progress — skipping');
    return null;
  }
  if (manualStop) return null;
  isStarting = true;

  try {
    // Kill any stale process before starting fresh
    killCurrentProc();

    for (let i = 0; i < PROVIDERS.length; i++) {
      if (manualStop) break;
      const idx = (providerIdx + i) % PROVIDERS.length;
      const provider = PROVIDERS[idx];

      const url = provider.type === 'npm'
        ? await attemptLocalTunnel(port)
        : await attemptSshProvider(provider, port);

      if (url) {
        providerIdx = idx;
        startHealthCheck(port);
        if (startResolver) {
          startResolver(url);
          startResolver = null;
        }
        return url;
      }
    }
    logger.error('❌ All tunnel providers failed. Retrying in 30s.');
    setTimeout(() => safeStart(port), 30000);
    return null;
  } finally {
    isStarting = false;
  }
}

function startHealthCheck(port) {
  if (healthTimer) clearInterval(healthTimer);
  healthTimer = setInterval(async () => {
    if (!currentUrl || manualStop) return;
    const alive = await testTunnel(currentUrl);
    if (!alive) {
      logger.warn(`⚠️  Tunnel health-check FAILED for ${currentUrl} — rebuilding…`);
      providerIdx = (providerIdx + 1) % PROVIDERS.length;
      const oldUrl = currentUrl;
      currentUrl = null;
      killCurrentProc();
      safeStart(port);
    } else {
      logger.debug(`💚 Tunnel healthy: ${currentUrl}`);
    }
  }, 60000);
}

/** Public API */
function startTunnel(port) {
  manualStop = false;
  return new Promise((resolve, reject) => {
    const grace = setTimeout(() => {
      reject(new Error('Tunnel did not come up in 60s'));
    }, 60000);

    startResolver = (url) => {
      clearTimeout(grace);
      resolve(url);
    };
    safeStart(port);
  });
}

function stopTunnel() {
  manualStop = true;
  if (healthTimer) { clearInterval(healthTimer); healthTimer = null; }
  killCurrentProc();
}

function getCurrentUrl() { return currentUrl; }

module.exports = { startTunnel, stopTunnel, getCurrentUrl };
