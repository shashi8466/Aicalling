/**
 * start.js — One-command launcher
 *
 * 1. Opens a localtunnel (public HTTPS URL)
 * 2. Updates BASE_URL in .env automatically
 * 3. Starts the Express server (AI agent)
 * 4. Poller auto-detects shashi and calls within 5 min
 *    OR run:  node src/scripts/manualCall.js  to call immediately
 */
require('dotenv').config();
const lt   = require('localtunnel');
const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT    = parseInt(process.env.PORT) || 3000;
const ENVFILE = path.join(__dirname, '.env');

async function main() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║   Aiprep365 — AI Admissions Agent        ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  // 1. Open localtunnel
  console.log('🌐 Opening public tunnel on port', PORT, '…');
  let tunnel;
  try {
    tunnel = await lt({ port: PORT, subdomain: 'Aiprep365' });
  } catch(e) {
    // Random subdomain if preferred one is taken
    tunnel = await lt({ port: PORT });
  }

  const publicUrl = tunnel.url;
  console.log('✅ Public URL:', publicUrl);

  // 2. Update BASE_URL in .env
  let env = fs.readFileSync(ENVFILE, 'utf8');
  env = env.replace(/^BASE_URL=.*/m, `BASE_URL=${publicUrl}`);
  fs.writeFileSync(ENVFILE, env);
  process.env.BASE_URL = publicUrl;
  console.log('✅ BASE_URL updated in .env\n');

  // 3. Start the main server
  console.log('🚀 Starting AI Admissions Agent…\n');
  const server = spawn('node', ['src/index.js'], {
    stdio: 'inherit',
    env: { ...process.env, BASE_URL: publicUrl },
  });

  server.on('exit', (code) => {
    console.log('\nServer exited with code', code);
    tunnel.close();
    process.exit(code);
  });

  tunnel.on('close', () => {
    console.log('\nTunnel closed. Shutting down…');
    server.kill();
    process.exit(0);
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\nShutting down…');
    server.kill();
    tunnel.close();
    process.exit(0);
  });

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📞 To call shashi RIGHT NOW, open another terminal:');
  console.log('   node src/scripts/manualCall.js');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main().catch(e => {
  console.error('Startup error:', e.message);
  process.exit(1);
});
