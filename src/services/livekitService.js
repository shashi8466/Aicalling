/**
 * LiveKit Meeting Service
 * ─────────────────────────────────────────────────────────
 * Replaces Jitsi (meet.jit.si) for consultation video meetings.
 *
 * • generateRoomName(lead)          → unique URL-safe room name
 * • generateMeetingUrl(roomName)    → public guest join URL
 * • generateToken(roomName, name)   → short-lived LiveKit JWT
 */
const { AccessToken } = require('livekit-server-sdk');
const cfg    = require('../config');
const logger = require('../logger');

/**
 * Generates a unique, URL-safe LiveKit room name for a lead.
 * Format: aiprep365-{SafeName}-{base36 timestamp}
 */
function generateRoomName(lead) {
  const safeName = (lead.fullName || 'consultation')
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9-]/g, '')
    .toLowerCase()
    .slice(0, 40);
  return `aiprep365-${safeName}-${Date.now().toString(36)}`;
}

/**
 * Returns the public URL that students and counselors open to join.
 * Uses MEETING_BASE_URL (permanent production domain) — NEVER a tunnel URL.
 * Served by: GET /meeting/:roomName in index.js
 *
 * Throws if MEETING_BASE_URL is missing or is a tunnel/localhost domain.
 */
const UNSAFE_MEETING_DOMAINS = [
  'serveousercontent.com',
  'lhr.life',
  'ngrok',
  'localhost.run',
  'localtunnel.me',
  'localhost',
  '127.0.0.1',
];

function generateMeetingUrl(roomName) {
  // Always read live from process.env so restarts can fix a misconfigured value
  const meetingBase = (
    process.env.MEETING_BASE_URL ||
    cfg.server.meetingBaseUrl    ||
    cfg.server.baseUrl           ||
    ''
  ).replace(/\/$/, '');

  // Hard block — refuse to generate a link using a tunnel/temporary domain
  const isBadDomain = UNSAFE_MEETING_DOMAINS.some(d => meetingBase.toLowerCase().includes(d));
  if (isBadDomain || !meetingBase || !meetingBase.startsWith('http')) {
    const msg = [
      `🚨 Cannot generate meeting link — MEETING_BASE_URL is unsafe or missing!`,
      `   Current value: "${meetingBase}"`,
      `   Set MEETING_BASE_URL=https://aicalling-xfyr.onrender.com in your .env`,
      `   Room: ${roomName}`,
    ].join('\n');
    logger.error(msg);
    // In production throw — callers must handle this gracefully
    throw new Error(`MEETING_BASE_URL must be a permanent HTTPS domain. Got: "${meetingBase}"`);
  }

  return `${meetingBase}/meeting/${roomName}`;
}


/**
 * Generates a short-lived LiveKit access token.
 * Called by POST /api/meeting/token — NEVER expose the secret to the frontend.
 *
 * @param {string} roomName      - LiveKit room identifier
 * @param {string} participantName - Display name entered by the user
 * @param {object} [opts]        - Optional overrides
 * @param {boolean} [opts.isHost=false] - If true, grants room-admin grants
 * @returns {Promise<string>}    JWT token string
 */
async function generateToken(roomName, participantName, opts = {}) {
  if (!cfg.livekit.apiKey || !cfg.livekit.apiSecret) {
    throw new Error('LiveKit API key/secret not configured. Set LIVEKIT_API_KEY and LIVEKIT_API_SECRET env vars.');
  }

  // Sanitize identity: LiveKit identity must be unique and URL-safe
  const safeName = participantName.trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-_]/g, '').slice(0, 40) || 'guest';
  const identity = `${safeName}-${Date.now().toString(36)}`;

  const at = new AccessToken(cfg.livekit.apiKey, cfg.livekit.apiSecret, {
    identity,
    name: participantName.trim().slice(0, 64),
    ttl: '4h',
  });

  at.addGrant({
    roomJoin:       true,
    room:           roomName,
    canPublish:     true,
    canSubscribe:   true,
    canPublishData: true,
    // roomAdmin only for hosts (counselors) — allows ending the room
    ...(opts.isHost ? { roomAdmin: true } : {}),
  });

  const token = await at.toJwt();
  logger.info(`LiveKit token generated | room=${roomName} | identity=${identity} | host=${!!opts.isHost}`);
  return token;
}

module.exports = { generateRoomName, generateMeetingUrl, generateToken };
