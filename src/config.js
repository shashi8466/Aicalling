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

  llm: {
    provider: process.env.LLM_PROVIDER || 'openai',
  },

  // Brevo transactional email (no SMTP needed — REST API only)
  brevo: {
    apiKey:    process.env.BREVO_API_KEY,
    fromEmail: process.env.BREVO_FROM_EMAIL || 'admissions@testpreppundits.com',
    fromName:  process.env.BREVO_FROM_NAME  || 'Shashi Kumar – Test Prep Pundits',
  },

  google: {
    clientEmail: process.env.GOOGLE_CLIENT_EMAIL,
    privateKey:  (process.env.GOOGLE_PRIVATE_KEY || '')
                   .replace(/^"|"$/g, '') // strip leading and trailing double quotes if added by cloud env managers
                   .replace(/\\n/g, '\n'),
    sheetsId:    process.env.GOOGLE_SHEETS_ID,
    calendarId:  process.env.GOOGLE_CALENDAR_ID || 'primary',
  },

  db: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/testpreppundits',
  },

  server: {
    port:    parseInt(process.env.PORT) || 3000,
    baseUrl: process.env.BASE_URL || 'http://localhost:3000',
    env:     process.env.NODE_ENV || 'development',
  },

  company: {
    counselorName:  process.env.COUNSELOR_NAME  || 'Shashi Kumar',
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
      lastUpdated: 11,  // column L
    },
  },
};
