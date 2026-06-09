# Test Prep Pundits – AI Admissions Calling Agent

## Pipeline

```
Google Sheets (new row)
  ↓  poll every 30 s
Lead created in MongoDB + welcome email sent
  ↓  2–5 min delay
Twilio outbound call placed
  ↓  call connects
TwiML webhook → OpenAI / Claude ("Sarah" AI persona)
  ↓  conversational qualification
Meeting slots offered (Google Calendar)
  ↓  caller picks a slot
Google Calendar event created + Google Meet link
  ↓
Google Sheet row updated (status / score / summary)
  ↓
Email confirmation sent to student + parent
```

---

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
```
Edit `.env` and fill in:
- `OPENAI_API_KEY` **or** set `LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`
- `GOOGLE_CLIENT_EMAIL` + `GOOGLE_PRIVATE_KEY` (service account)
- `GOOGLE_SHEETS_ID` – the ID from your Sheet URL
- `SMTP_USER` + `SMTP_PASS` (Gmail app password)
- `BASE_URL` – your public URL (see ngrok below)

Twilio credentials need to be set in your `.env`:
```
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=your_twilio_phone_number
```

### 3. Verify setup
```bash
node src/scripts/setup.js
```

### 4. Expose localhost (Twilio needs a public URL)
```bash
ngrok http 3000
# Copy the https://xxxx.ngrok.io URL into BASE_URL in .env
```

### 5. Start
```bash
npm run dev       # development (auto-reload)
npm start         # production
```

---

## Google Sheets Setup

Grant your **service account email** (`GOOGLE_CLIENT_EMAIL`) **Editor** access to your sheet.

Expected columns (A–H):

| A | B | C | D | E | F | G | H |
|---|---|---|---|---|---|---|---|
| Full Name | Grade | Email | Phone | Parent Name | Parent Email | Course Interest | Submission Date |

The agent writes back to columns **I–L** automatically:

| I | J | K | L |
|---|---|---|---|
| AI Status | Lead Score | AI Summary | Last Updated |

---

## Google Service Account Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a project → Enable **Google Sheets API** + **Google Calendar API**
3. Create a **Service Account** → download JSON key
4. Copy `client_email` → `GOOGLE_CLIENT_EMAIL`
5. Copy `private_key` → `GOOGLE_PRIVATE_KEY` (keep `\n` escapes)
6. Share your Google Sheet **and** Calendar with the service account email

---

## Lead Scoring

| Factor | Max Points |
|--------|-----------|
| Student Grade (11th/12th highest) | 20 |
| Program Interest (College Counseling highest) | 18 |
| Score Gap (current vs target) | 20 |
| Exam Date Urgency | 20 |
| Parent Engagement | 12 |
| Call Sentiment | 10 |
| **Total** | **100** |

- **70–100** → 🔥 Hot Lead  
- **40–69**  → ⚡ Warm Lead  
- **0–39**   → ❄️ Cold Lead  

---

## Call Retry Logic

- Max attempts: `CALL_MAX_ATTEMPTS` (default 3)
- Retry delay: `CALL_RETRY_DELAY_MINUTES` (default 60)
- No-answer → email follow-up sent → retry queued
- After max attempts → status set to `lost`

---

## Environment Variables Reference

| Variable | Description |
|----------|-------------|
| `TWILIO_ACCOUNT_SID` | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_PHONE_NUMBER` | Outbound caller ID |
| `OPENAI_API_KEY` | OpenAI key (if using OpenAI) |
| `ANTHROPIC_API_KEY` | Claude key (if using Anthropic) |
| `LLM_PROVIDER` | `openai` or `anthropic` |
| `GOOGLE_CLIENT_EMAIL` | Service account email |
| `GOOGLE_PRIVATE_KEY` | Service account private key |
| `GOOGLE_SHEETS_ID` | Spreadsheet ID from URL |
| `GOOGLE_CALENDAR_ID` | Calendar ID (`primary` works) |
| `SMTP_HOST/PORT/USER/PASS` | Email credentials |
| `MONGODB_URI` | MongoDB connection string |
| `BASE_URL` | Public HTTPS URL for Twilio webhooks |
| `SHEETS_POLL_INTERVAL_SECONDS` | How often to check Sheets (default 30) |
| `CALL_MAX_ATTEMPTS` | Max outbound call tries per lead |
| `CALL_RETRY_DELAY_MINUTES` | Minutes between retry attempts |
