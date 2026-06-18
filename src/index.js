/**
 * Test Prep Pundits – AI Admissions Agent
 * Entry point — auto-starts localtunnel so Twilio webhooks always work.
 *
 * Pipeline:
 *   Google Sheets → Twilio call → OpenAI/Claude → Qualification
 *   → Google Calendar booking → Sheet update → Email follow-up
 */
require('dotenv').config();
const express  = require('express');
const mongoose = require('mongoose');
const cors     = require('cors');
const helmet   = require('helmet');
const path     = require('path');
const fs       = require('fs');

const cfg    = require('./config');
const logger = require('./logger');
const poller = require('./jobs/poller');

const webhookRouter  = require('./routes/webhook');
const apiRouter      = require('./routes/api');
const crmRouter      = require('./routes/crm');
const followUpEngine = require('./jobs/followUpEngine');

const app = express();

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.urlencoded({ extended: false }));   // Twilio posts form-encoded
app.use(express.json());

app.use((req, res, next) => {
  logger.debug(`${req.method} ${req.path}`);
  next();
});

// ── Routes ──────────────────────────────────────────────────────────────────
app.use('/webhook', webhookRouter);
app.use('/api',     apiRouter);
app.use('/api/crm', crmRouter);

app.get('/health', (_req, res) =>
  res.json({ status: 'ok', uptime: Math.round(process.uptime()), ts: new Date() })
);

app.post('/admin/poll', (_req, res) => {
  poller.pollOnce();
  res.json({ message: 'Poll triggered' });
});

const dashDir = path.join(__dirname, '../dashboard');
if (fs.existsSync(dashDir)) app.use('/', express.static(dashDir));

// ── Global error handler ────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  logger.error('Unhandled error', { msg: err.message, stack: err.stack?.split('\n').slice(0,3), path: req.path });

  // For Twilio webhooks, ALWAYS return valid TwiML (status 200) so the caller
  // hears a polite message instead of "application error"
  if (req.path.includes('/webhook/call/')) {
    res.type('text/xml').status(200).send(
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Response>' +
        '<Say voice="Polly.Matthew-Neural">' +
          'I apologize, we are experiencing a brief technical issue. ' +
          'A team member will call you back shortly. Thank you for your patience.' +
        '</Say>' +
        '<Hangup/>' +
      '</Response>'
    );
    return;
  }

  res.status(500).json({ error: 'Internal server error', detail: err.message });
});

// ── Tunnel (serveo.net SSH — no browser bypass, no account needed) ───────────
const tunnelMgr = require('./utils/tunnel');

// ── Boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  try {
    // 1. MongoDB
    await mongoose.connect(cfg.db.uri);
    logger.info('MongoDB connected ✅');

    // 2. Google Sheet headers
    const sheetsSvc = require('./services/sheetsService');
    await sheetsSvc.ensureHeaders().catch(() => {});

    // 3. HTTP server
    await new Promise((resolve) => {
      app.listen(cfg.server.port, () => {
        logger.info(`🚀 Agent listening on http://localhost:${cfg.server.port}`);
        resolve();
      });
    });

    // 4. Public URL: in production (Render/Railway/Fly/etc.) we already have a real HTTPS URL.
    //    Only start a tunnel for local development.
    const skipTunnel = cfg.server.env === 'production' || process.env.SKIP_TUNNEL === 'true';
    let tunnelUrl = null;
    if (skipTunnel) {
      logger.info(`🌍 Production mode — using BASE_URL: ${cfg.server.baseUrl}`);
    } else {
      logger.info('Starting public tunnel for local development…');
      tunnelUrl = await tunnelMgr.startTunnel(cfg.server.port).catch(e => {
        logger.error('Tunnel error:', e.message);
        return null;
      });
    }

    // 5. Background jobs (sheets polling, reminders, follow-up engine)
    poller.start();
    followUpEngine.start();

    // 5b. Keep-alive self-ping for free hosting (Render)
    setInterval(() => {
      const pingUrl = tunnelUrl || cfg.server.baseUrl;
      if (pingUrl && pingUrl.startsWith('http')) {
        fetch(`${pingUrl}/health`).catch(() => {});
      }
    }, 14 * 60 * 1000); // Ping every 14 minutes

    // 6. Beautiful Ready Summary (Guarantees clean, clickable links in console)
    const localUrl = `http://localhost:${cfg.server.port}`;
    const activeUrl = tunnelUrl || cfg.server.baseUrl;
    const webhookUrl = `${activeUrl}/webhook/call/start`;

    console.log('\n\x1b[1m\x1b[32m  🚀 Test Prep Pundits — AI Admissions Agent is READY!\x1b[0m');
    console.log('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`  \x1b[1m➜\x1b[0m  \x1b[1mLocal URL:\x1b[0m     \x1b[36m${localUrl}\x1b[0m`);
    if (tunnelUrl) {
      console.log(`  \x1b[1m➜\x1b[0m  \x1b[1mTunnel URL:\x1b[0m    \x1b[36m${activeUrl}\x1b[0m`);
    } else {
      console.log(`  \x1b[1m➜\x1b[0m  \x1b[1mBase URL:\x1b[0m      \x1b[36m${activeUrl}\x1b[0m`);
    }
    console.log(`  \x1b[1m➜\x1b[0m  \x1b[1mTwilio Webhook:\x1b[0m \x1b[36m${webhookUrl}\x1b[0m`);
    console.log(`  \x1b[1m➜\x1b[0m  \x1b[1mCaller ID:\x1b[0m      \x1b[32m${cfg.twilio.phoneNumber}\x1b[0m`);
    console.log('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (err) {
    logger.error('Boot failed', { msg: err.message });
    process.exit(1);
  }
}

async function shutdown(signal) {
  logger.info(`${signal} received — shutting down…`);
  tunnelMgr.stopTunnel();
  poller.stop();
  await mongoose.connection.close();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

boot();
