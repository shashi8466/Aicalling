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

const webhookRouter = require('./routes/webhook');
const apiRouter     = require('./routes/api');

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
        logger.info(`🚀 Agent listening on port ${cfg.server.port}`);
        resolve();
      });
    });

    // 4. Public URL: in production (Render/Railway/Fly/etc.) we already have a real HTTPS URL.
    //    Only start a tunnel for local development.
    const skipTunnel = cfg.server.env === 'production' || process.env.SKIP_TUNNEL === 'true';
    if (skipTunnel) {
      logger.info(`🌍 Production mode — using BASE_URL from environment: ${cfg.server.baseUrl}`);
      logger.info(`📡 Twilio webhooks → ${cfg.server.baseUrl}/webhook/call/start`);
    } else {
      logger.info('Starting public tunnel for local development…');
      const tunnelUrl = await tunnelMgr.startTunnel(cfg.server.port).catch(e => {
        logger.error('Tunnel error:', e.message);
        return null;
      });
      if (tunnelUrl) {
        logger.info(`📡 Twilio webhooks → ${tunnelUrl}/webhook/call/start`);
      } else {
        logger.warn(`⚠️  Tunnel not started — using BASE_URL from .env: ${cfg.server.baseUrl}`);
      }
    }

    logger.info(`📞 Twilio caller ID : ${cfg.twilio.phoneNumber}`);

    // 5. Background jobs (sheets polling, reminders)
    poller.start();

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
