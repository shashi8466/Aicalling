/**
 * Aiprep365 – AI Admissions Agent
 * Entry point — auto-starts localtunnel so Twilio webhooks always work.
 *
 * Pipeline:
 *   Google Sheets → Twilio call → OpenAI/Claude → Qualification
 *   → Google Calendar booking → Sheet update → Email follow-up
 */
require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const path     = require('path');
const fs       = require('fs');

const cfg    = require('./config');
const logger = require('./logger');
const poller = require('./jobs/poller');

const webhookRouter    = require('./routes/webhook');
const apiRouter        = require('./routes/api');
const crmRouter        = require('./routes/crm');
const authRouter       = require('./routes/auth');
const counselorsRouter = require('./routes/counselors');
const campaignsRouter  = require('./routes/campaigns');
const { requireAuth, requireAdmin } = require('./middleware/auth');
const followUpEngine   = require('./jobs/followUpEngine');
const livekitSvc       = require('./services/livekitService');
const tzScheduler      = require('./jobs/tzScheduler');
const emailCallbackPoller = require('./jobs/emailCallbackPoller');
const meetingReminderPoller = require('./jobs/meetingReminderPoller');

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
// Twilio webhooks — NO auth (Twilio posts without our JWT)
app.use('/webhook', webhookRouter);

// Public auth bootstrap (returns Supabase URL + anon key)
app.use('/auth', authRouter);

// Public API endpoint for meeting tokens (no JWT required)
app.post('/api/meeting/token', async (req, res) => {
  try {
    const { roomName, participantName, isHost } = req.body;
    if (!roomName || !participantName) {
      return res.status(400).json({ error: 'roomName and participantName are required' });
    }
    const token = await livekitSvc.generateToken(roomName, participantName, { isHost });
    res.json({ token, url: cfg.livekit.url });
  } catch (err) {
    logger.error('Failed to generate LiveKit token', { msg: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Protected dashboard API — all /api/* (except public routes above) require a valid Supabase JWT
app.use('/api', requireAuth);
app.use('/api', apiRouter);
app.use('/api/crm', crmRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/counselors', requireAdmin, counselorsRouter);

app.get('/health', (_req, res) =>
  res.json({ status: 'ok', uptime: Math.round(process.uptime()), ts: new Date() })
);

app.post('/admin/poll', (_req, res) => {
  poller.pollOnce();
  res.json({ message: 'Poll triggered' });
});

const dashDir = path.join(__dirname, '../dashboard');

// Redirect legacy/explicit .html paths to clean URLs
app.get('/login.html', (req, res) => {
  res.redirect(301, '/login');
});
app.get('/index.html', (req, res) => {
  res.redirect(301, '/');
});

// Route for clean login URL
app.get('/login', (req, res) => {
  res.sendFile(path.join(dashDir, 'login.html'));
});

// Redirect legacy explicit .html path to clean URL
app.get('/reset-password.html', (req, res) => {
  res.redirect(301, '/reset-password' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''));
});

// Route for clean password-reset URL (target of the Supabase recovery email link)
app.get('/reset-password', (req, res) => {
  res.sendFile(path.join(dashDir, 'reset-password.html'));
});

// Route for meeting UI
app.get('/meeting/:roomName', (req, res) => {
  res.sendFile(path.join(dashDir, 'meeting.html'));
});

if (fs.existsSync(dashDir)) {
  app.use('/', express.static(dashDir, {
    setHeaders: (res, path) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }));
}

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
    // 1. Supabase — verify connectivity
    const supabase = require('./db/supabase');
    const { error: pingErr } = await supabase.from('leads').select('id').limit(1);
    if (pingErr) throw new Error(`Supabase connection failed: ${pingErr.message}`);
    logger.info('Supabase connected ✅');

    // 1b. Seed default campaigns (no-op if the campaigns table isn't set up yet)
    require('./services/campaignService').ensureDefaultCampaigns().catch(() => {});

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

    // 5. Background jobs (sheets polling, reminders, follow-up engine, timezone scheduler)
    poller.start();
    followUpEngine.start();
    tzScheduler.start();
    emailCallbackPoller.start();
    meetingReminderPoller.start();

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

    console.log('\n\x1b[1m\x1b[32m  🚀 Aiprep365 — AI Admissions Agent is READY!\x1b[0m');
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
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

boot();
