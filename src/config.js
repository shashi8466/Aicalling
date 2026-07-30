require('dotenv').config();

module.exports = {
  twilio: {
    accountSid:  process.env.TWILIO_ACCOUNT_SID,
    authToken:   process.env.TWILIO_AUTH_TOKEN,
    phoneNumber: process.env.TWILIO_PHONE_NUMBER,
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY,
  },

  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || null,
  },

  // LiveKit video meetings (replaces Jitsi)
  livekit: {
    url:       process.env.LIVEKIT_URL       || '',   // wss://xxx.livekit.cloud
    apiKey:    process.env.LIVEKIT_API_KEY   || '',
    apiSecret: process.env.LIVEKIT_API_SECRET || '',
  },

  llm: {
    provider: process.env.LLM_PROVIDER || 'openai',
  },

  // Brevo email configuration
  brevo: {
    apiKey:    process.env.BREVO_API_KEY,
    fromEmail: process.env.BREVO_FROM_EMAIL || 'Info@testpreppundits.com',
    fromName:  process.env.BREVO_FROM_NAME  || 'Test Prep Pundits Admissions',
  },

  // IMAP email polling configuration
  imap: {
    host:     process.env.IMAP_HOST || process.env.SMTP_HOST || 'imap.gmail.com',
    port:     parseInt(process.env.IMAP_PORT) || 993,
    user:     process.env.IMAP_USER || process.env.SMTP_USER || 'antratestpreppundits@gmail.com',
    password: process.env.IMAP_PASSWORD || process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD || '',
    tls:      process.env.IMAP_TLS !== 'false',
  },

  google: {
    clientEmail: process.env.GOOGLE_CLIENT_EMAIL,
    privateKey:  (process.env.GOOGLE_PRIVATE_KEY || '')
                   .replace(/^"|"$/g, '') // strip leading and trailing double quotes if added by cloud env managers
                   .replace(/\\n/g, '\n'),
    sheetsId:    process.env.GOOGLE_SHEETS_ID,
    calendarId:  process.env.GOOGLE_CALENDAR_ID || 'primary',
  },

  supabase: {
    url:             process.env.SUPABASE_URL || '',
    serviceRoleKey:  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    anonKey:         process.env.SUPABASE_ANON_KEY || '',
  },

  // Supabase Storage (S3-compatible) — destination for LiveKit Egress meeting
  // recordings. Separate from the service-role key above: these are the S3
  // connection credentials generated under Supabase → Storage → S3 Connection.
  supabaseStorage: {
    bucket:     process.env.SUPABASE_STORAGE_BUCKET   || 'meeting-recordings',
    endpoint:   process.env.SUPABASE_S3_ENDPOINT       || '',
    region:     process.env.SUPABASE_S3_REGION         || 'us-east-1',
    accessKey:  process.env.SUPABASE_S3_ACCESS_KEY      || '',
    secretKey:  process.env.SUPABASE_S3_SECRET_KEY      || '',
  },

  // Legacy — kept so existing config-check endpoint still shows the field.
  db: {
    uri: process.env.MONGODB_URI || '',
  },

  server: {
    port:    parseInt(process.env.PORT) || 3000,
    baseUrl: process.env.BASE_URL || 'http://localhost:3000',
    // MEETING_BASE_URL is the permanent production domain used for meeting links.
    // This must NEVER be a tunnel/ngrok/serveo URL.
    // Falls back to BASE_URL for development; in production, always set this explicitly.
    meetingBaseUrl: process.env.MEETING_BASE_URL || process.env.BASE_URL || 'http://localhost:3000',
    env:     process.env.NODE_ENV || 'development',
  },

  company: {
    counselorName:  process.env.COUNSELOR_NAME  || 'Admissions Team',
    counselorEmail: process.env.COUNSELOR_EMAIL || process.env.BREVO_FROM_EMAIL || '',
    counselorPhone: process.env.COUNSELOR_PHONE || '',
    website:        process.env.COMPANY_WEBSITE || 'https://testpreppundits.com',
  },

  call: {
    maxAttempts:       parseInt(process.env.CALL_MAX_ATTEMPTS)       || 3,
    retryDelayMinutes: parseInt(process.env.CALL_RETRY_DELAY_MINUTES) || 60,
  },

  sheets: {
    pollIntervalSeconds: parseInt(process.env.SHEETS_POLL_INTERVAL_SECONDS) || 30,
    // 0-indexed column positions in the Sheet (A=0, B=1 …)
    cols: {
      fullName:       0,
      grade:          1,
      email:          2,
      phone:          3,
      parentName:     4,
      parentEmail:    5,
      courseInterest: 6,
      submissionDate: 7,
      // Written back by the agent:
      aiStatus:    8,   // column I
      leadScore:   9,   // column J
      aiSummary:   10,  // column K
      meetingDate: 11,  // column L
      meetingTime: 12,  // column M
      meetLink:    13,  // column N
      lastUpdated: 14,  // column O
    },
  },
};
