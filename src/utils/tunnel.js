/**
 * SSH Tunnel Manager
 * Uses serveo.net (no account, no install needed — just SSH).
 * Falls back to pinggy.io if serveo is down.
 * Auto-reconnects on disconnect.
 */
const { spawn } = require('child_process');
const fs        = require('fs');
const path      = require('path');
const cfg       = require('../config');
const logger    = require('../logger');

let tunnelProc  = null;
let currentUrl  = null;

function updateEnvBaseUrl(url) {
  try {
    const envPath = path.join(__dirname, '../../.env');
    let content   = fs.readFileSync(envPath, 'utf8');
    content       = content.replace(/^BASE_URL=.*/m, `BASE_URL=${url}`);
    fs.writeFileSync(envPath, content);
    process.env.BASE_URL = url;
    cfg.server.baseUrl   = url;
    logger.info(`BASE_URL updated → ${url}`);
  } catch(e) {
    logger.warn('Could not update .env BASE_URL:', e.message);
  }
}

/**
 * Start an SSH reverse tunnel via serveo.net
 * serveo assigns a stable subdomain based on your SSH key.
 * URL format: https://<random>.serveo.net
 */
function startServeoTunnel(port, onUrl) {
  logger.info('Starting SSH tunnel via serveo.net…');

  const args = [
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'ExitOnForwardFailure=yes',
    '-R', `80:localhost:${port}`,
    'serveo.net',
  ];

  tunnelProc = spawn('ssh', args, { stdio: ['ignore', 'pipe', 'pipe'] });

  // serveo prints to stderr with ANSI codes:
  // "\x1b[32mForwarding HTTP traffic from https://xxxx.serveousercontent.com\x1b[0m"
  function parseServeoUrl(text) {
    // Strip ANSI escape codes first
    const clean = text.replace(/\x1b\[[0-9;]*m/g, '');
    const match = clean.match(/https?:\/\/[a-z0-9][a-z0-9\-]+\.serveousercontent\.com/i);
    return match ? match[0] : null;
  }

  tunnelProc.stdout.on('data', (data) => {
    const text = data.toString();
    const url  = parseServeoUrl(text);
    if (url && url !== currentUrl) {
      currentUrl = url;
      updateEnvBaseUrl(currentUrl);
      logger.info(`✅ Tunnel LIVE: ${currentUrl}`);
      if (onUrl) onUrl(currentUrl);
    }
  });

  tunnelProc.stderr.on('data', (data) => {
    const text = data.toString();
    // serveo sometimes prints URL to stderr too
    const url  = parseServeoUrl(text);
    if (url && url !== currentUrl) {
      currentUrl = url;
      updateEnvBaseUrl(currentUrl);
      logger.info(`✅ Tunnel LIVE (stderr): ${currentUrl}`);
      if (onUrl) onUrl(currentUrl);
    }
    logger.debug('Tunnel:', text.trim());
  });

  tunnelProc.on('close', (code) => {
    logger.warn(`Tunnel closed (code ${code}) — reconnecting in 5s…`);
    tunnelProc = null;
    currentUrl = null;
    setTimeout(() => startServeoTunnel(port, onUrl), 5000);
  });

  tunnelProc.on('error', (err) => {
    logger.error('Tunnel process error:', err.message);
    setTimeout(() => startServeoTunnel(port, onUrl), 5000);
  });
}

/**
 * Start tunnel — returns promise that resolves with the public URL.
 * Rejects after 30 s if no URL is found.
 */
function startTunnel(port) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Tunnel URL not received within 30s'));
    }, 30000);

    startServeoTunnel(port, (url) => {
      clearTimeout(timeout);
      resolve(url);
    });
  });
}

function stopTunnel() {
  if (tunnelProc) {
    tunnelProc.kill();
    tunnelProc = null;
  }
}

function getCurrentUrl() { return currentUrl; }

module.exports = { startTunnel, stopTunnel, getCurrentUrl };
