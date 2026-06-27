# 🚀 Production Deployment Guide

Pick the option that fits you. **Render.com** is recommended — free tier works, easy setup, 5 minutes total.

---

## Option 1: Render.com (Recommended — Free)

### Step 1 — Push code to GitHub
```bash
cd "C:\Users\user\Documents\Ai calling"
git init
git add .
git commit -m "Initial commit"
# Create a new repo at https://github.com/new (private is fine)
git remote add origin https://github.com/YOUR_USERNAME/aiprep365-agent.git
git branch -M main
git push -u origin main
```

### Step 2 — Deploy on Render
1. Go to **[https://dashboard.render.com](https://dashboard.render.com)** → sign up free
2. Click **New** → **Blueprint**
3. Connect your GitHub repo → Render auto-detects `render.yaml`
4. Click **Apply** — service builds in ~2 minutes
5. Get your URL: `https://aiprep365-ai-agent.onrender.com`

### Step 3 — Set environment variables
In Render dashboard → your service → **Environment** → add these:

| Key | Value |
|-----|-------|
| `BASE_URL` | Set to your Render URL (from step 2) |
| `TWILIO_ACCOUNT_SID` | *from your `.env`* |
| `TWILIO_AUTH_TOKEN` | *from your `.env`* |
| `TWILIO_PHONE_NUMBER` | *from your `.env`* |
| `OPENAI_API_KEY` | *from your `.env`* |
| `BREVO_API_KEY` | *from your `.env`* |
| `BREVO_FROM_EMAIL` | *from your `.env`* |
| `BREVO_FROM_NAME` | *from your `.env`* |
| `GOOGLE_CLIENT_EMAIL` | *from your `.env`* |
| `GOOGLE_PRIVATE_KEY` | *whole `-----BEGIN PRIVATE KEY-----` block, paste as ONE line with `\n` characters preserved* |
| `GOOGLE_SHEETS_ID` | *from your `.env`* |
| `SUPABASE_URL` | *from your `.env`* |
| `SUPABASE_SERVICE_ROLE_KEY` | *from your `.env`* |
| `SUPABASE_ANON_KEY` | *from your `.env`* |
| `COUNSELOR_EMAIL` | *from your `.env`* |
| `COUNSELOR_PHONE` | *from your `.env`* |

> **All values are already in your local `.env` file. Just copy/paste each one.** Never commit `.env` to git.

Click **Save Changes** — Render will auto-restart with the new env.

### Step 4 — Free-tier note
Render's free tier **spins down after 15 min of inactivity**. A scheduled call could be missed if no one hits the URL. Two fixes:
- **Upgrade to "Starter" ($7/mo)** — always-on, no spin-down.
- **Use [UptimeRobot](https://uptimerobot.com)** (free) to ping `/health` every 5 min — keeps it warm.

---

## Option 2: Railway ($5/mo, no sleep)

1. Go to **[https://railway.app](https://railway.app)** → New Project → Deploy from GitHub
2. Pick your repo → Railway detects Node.js automatically
3. Settings → Variables → paste all env vars from the table above
4. Settings → Networking → **Generate Domain** → copy your `.up.railway.app` URL
5. Update `BASE_URL` env var to that URL
6. Done. Always-on, no sleep.

---

## Option 3: Fly.io (Free tier with always-on)

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

cd "C:\Users\user\Documents\Ai calling"
fly launch                          # auto-detects Dockerfile
fly secrets set OPENAI_API_KEY=...  # add each secret
fly deploy
```

---

## Option 4: Docker (Any VPS or local server)

```bash
docker build -t tpp-agent .
docker run -d -p 3000:3000 \
  -e BASE_URL=https://yourdomain.com \
  -e SUPABASE_URL=https://your-project.supabase.co \
  -e SUPABASE_SERVICE_ROLE_KEY=ey... \
  -e SUPABASE_ANON_KEY=ey... \
  -e OPENAI_API_KEY=sk-... \
  -e TWILIO_ACCOUNT_SID=... \
  -e TWILIO_AUTH_TOKEN=... \
  -e TWILIO_PHONE_NUMBER=... \
  -e BREVO_API_KEY=... \
  -e BREVO_FROM_EMAIL=... \
  -e BREVO_FROM_NAME=... \
  -e GOOGLE_CLIENT_EMAIL=... \
  -e GOOGLE_PRIVATE_KEY="..." \
  -e GOOGLE_SHEETS_ID=... \
  tpp-agent
```

Then point your domain at the server + add HTTPS via Cloudflare or Caddy.

---

## ✅ Post-Deploy Verification Checklist

After deploy, hit your URL in a browser. You should see the dashboard.

```bash
# Health check
curl https://YOUR-URL.onrender.com/health
# → {"status":"ok","uptime":N,"ts":"..."}

# Stats
curl https://YOUR-URL.onrender.com/api/stats

# Trigger a manual poll
curl -X POST https://YOUR-URL.onrender.com/api/poll
```

If all three succeed → you're live. Add new rows to your Google Sheet and the agent will call them within 30 seconds + the configured delay.

---

## 🔒 GOOGLE_PRIVATE_KEY Note

On Render/Railway, when pasting the multi-line private key:
- Replace **actual newlines** with the literal text `\n`
- Wrap in quotes only if the platform requires it
- Render handles this automatically — just paste the whole `-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----\n` value

Your current `.env` already has it in this format — just copy that exact value.
