/**
 * Email Service — powered by Brevo (formerly Sendinblue)
 * Uses Brevo Transactional Email API (REST, no SMTP config needed).
 * Docs: https://developers.brevo.com/reference/sendtransacemail
 */
const axios  = require('axios');
const moment = require('moment-timezone');
const cfg    = require('../config');
const logger = require('../logger');

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

class EmailService {

  // ── Public senders ───────────────────────────────────────────────────

  async sendNewLeadWelcome(lead) {
    return this._send({
      to:      lead.email,
      cc:      lead.parentEmail,
      subject: `Welcome to Test Prep Pundits – We'll be in touch, ${lead.fullName}! 🎓`,
      html:    this._wrap(this._newLeadBody(lead)),
    });
  }

  async sendMeetingConfirmation(lead) {
    const t = moment(lead.meeting.scheduledAt)
      .tz('America/New_York')
      .format('dddd, MMMM Do [at] h:mm A [ET]');
    return this._send({
      to:      lead.email,
      cc:      lead.parentEmail,
      subject: `✅ Consultation Confirmed – ${t}`,
      html:    this._wrap(this._meetingConfBody(lead, t)),
    });
  }

  async sendNoAnswer(lead) {
    return this._send({
      to:      lead.email,
      cc:      lead.parentEmail,
      subject: `We tried to reach you – ${lead.fullName} | Test Prep Pundits`,
      html:    this._wrap(this._noAnswerBody(lead)),
    });
  }

  async sendMeetingReminder(lead) {
    const t = moment(lead.meeting.scheduledAt)
      .tz('America/New_York')
      .format('dddd, MMMM Do [at] h:mm A [ET]');
    return this._send({
      to:      lead.email,
      cc:      lead.parentEmail,
      subject: `⏰ Reminder: Your Consultation Tomorrow – ${t}`,
      html:    this._wrap(this._reminderBody(lead, t)),
    });
  }

  async sendEnrollmentFollowup(lead) {
    return this._send({
      to:      lead.email,
      cc:      lead.parentEmail,
      subject: `Ready to get started? – ${lead.fullName}'s ${lead.courseInterest || 'Test Prep'} Program`,
      html:    this._wrap(this._enrollmentBody(lead)),
    });
  }

  // ── Core Brevo API call ──────────────────────────────────────────────

  async _send({ to, cc, subject, html }) {
    const toArr = [{ email: to }];
    const ccArr = cc ? [{ email: cc }] : undefined;

    const payload = {
      sender:  { name: cfg.brevo.fromName, email: cfg.brevo.fromEmail },
      to:      toArr,
      cc:      ccArr,
      subject,
      htmlContent: html,
    };

    try {
      const res = await axios.post(BREVO_URL, payload, {
        headers: {
          'api-key':      cfg.brevo.apiKey,
          'Content-Type': 'application/json',
          'Accept':       'application/json',
        },
        timeout: 10_000,
      });
      const msgId = res.data.messageId || res.data.messageIds?.[0] || '—';
      logger.info(`Email sent via Brevo → ${to}  "${subject}"  [${msgId}]`);
      return { ok: true, messageId: msgId };
    } catch (err) {
      const detail = err.response?.data?.message || err.message;
      logger.error('Brevo email failed', { to, subject, detail });
      return { ok: false, error: detail };
    }
  }

  // ── HTML wrapper ─────────────────────────────────────────────────────

  _wrap(inner) {
    const year    = new Date().getFullYear();
    const website = cfg.company.website;
    const phone   = cfg.company.counselorPhone;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Helvetica Neue',Arial,sans-serif;background:#f0f4f8;color:#374151}
.wrap{max-width:600px;margin:28px auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,.10)}
.hdr{background:linear-gradient(135deg,#1a3c6e 0%,#2563eb 100%);padding:32px 40px;text-align:center}
.hdr h1{color:#fff;font-size:24px;font-weight:800;letter-spacing:-.3px}
.hdr p{color:rgba(255,255,255,.82);font-size:13px;margin-top:6px}
.body{padding:36px 40px;line-height:1.75;font-size:15px}
h2{color:#1a3c6e;font-size:20px;font-weight:700;margin-bottom:14px}
p{margin-bottom:12px}
ul{margin:8px 0 14px 20px}
li{margin-bottom:6px}
.box{background:#eff6ff;border-left:4px solid #2563eb;padding:16px 20px;border-radius:0 10px 10px 0;margin:20px 0;font-size:15px;line-height:1.7}
.grid{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0}
.cell{background:#f8fafc;padding:12px 16px;border-radius:10px;flex:1;min-width:130px}
.lbl{font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.6px;font-weight:600}
.val{font-weight:700;color:#1a3c6e;font-size:15px;margin-top:4px}
.btn{display:inline-block;background:#2563eb;color:#fff!important;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:15px;margin:20px 0;letter-spacing:.2px}
.sig{margin-top:32px;padding-top:20px;border-top:1px solid #e5e7eb;font-size:14px;color:#374151}
.sig strong{color:#1a3c6e;display:block;font-size:15px;margin-bottom:4px}
.ftr{background:#f8fafc;padding:22px 40px;text-align:center;color:#9ca3af;font-size:12px;border-top:1px solid #e5e7eb}
.ftr a{color:#2563eb;text-decoration:none}
</style>
</head>
<body>
<div class="wrap">
  <div class="hdr">
    <h1>🎓 Test Prep Pundits</h1>
    <p>Your Path to Academic Excellence</p>
  </div>
  <div class="body">${inner}</div>
  <div class="ftr">
    © ${year} Test Prep Pundits &nbsp;|&nbsp;
    <a href="${website}">${website}</a><br>
    Questions? Call or text ${phone}
  </div>
</div>
</body>
</html>`;
  }

  // ── Email bodies ─────────────────────────────────────────────────────

  _newLeadBody(l) {
    const c = cfg.company;
    return `
<h2>Hi ${l.parentName || l.fullName}! 👋</h2>
<p>Thank you for reaching out to <strong>Test Prep Pundits</strong>! I'm <strong>Shashi Kumar</strong>, your dedicated Admissions Counselor, and I'm genuinely excited to help <strong>${l.fullName}</strong> reach their academic goals.</p>

<div class="box">
  📞 <strong>We'll be calling you shortly</strong> at <strong>${l.phone}</strong> to learn more and answer any questions.<br>
  Prefer a specific time? Just reply to this email and we'll schedule a convenient call.
</div>

<div class="grid">
  <div class="cell"><div class="lbl">Student</div><div class="val">${l.fullName}</div></div>
  <div class="cell"><div class="lbl">Grade</div><div class="val">${l.grade || 'To confirm'}</div></div>
  <div class="cell"><div class="lbl">Program</div><div class="val">${l.courseInterest || 'To discuss'}</div></div>
  <div class="cell"><div class="lbl">Counselor</div><div class="val">Shashi Kumar</div></div>
</div>

<p><strong>🌟 Our most popular programs:</strong></p>
<ul>
  <li><strong>SAT / ACT Prep</strong> — Group classes from $599 | Private tutoring from $150/hr</li>
  <li><strong>AP Course Support</strong> — 10–16 week intensives from $749</li>
  <li><strong>College Admissions Counseling</strong> — Complete package from $2,999</li>
</ul>
<p>Students see an average of <strong>150–200 SAT point</strong> improvement or <strong>4–6 ACT composite points</strong> with our programs.</p>

<a href="${c.website}" class="btn">Explore All Programs</a>

<div class="sig">
  <strong>Shashi Kumar</strong>
  Admissions Counselor | Test Prep Pundits<br>
  📧 ${c.counselorEmail} &nbsp;|&nbsp; 📞 ${c.counselorPhone}<br>
  🌐 <a href="${c.website}">${c.website}</a>
</div>`;
  }

  _meetingConfBody(l, t) {
    const c = cfg.company;
    const meetLink = l.meeting?.meetLink;
    return `
<h2>Your Consultation is Confirmed! ✅</h2>
<p>Hi ${l.parentName || l.fullName}! Great news — your free admissions consultation is all set. We can't wait to connect with you!</p>

<div class="box">
  📅 <strong>${t}</strong><br>
  🎥 Format: Google Meet (video call)<br>
  ⏱ Duration: 45–60 minutes<br>
  👩‍💼 Counselor: ${c.counselorName}<br><br>
  ${meetLink ? `<a href="${meetLink}" style="color:#2563eb;font-weight:700">🔗 Click to Join Google Meet</a>` : 'A Google Meet link will be sent shortly.'}
</div>

<p><strong>Please bring to the meeting:</strong></p>
<ul>
  <li>Any recent SAT/ACT scores or practice test results</li>
  <li>Target college list (if you have one)</li>
  <li>Questions about programs, pricing, or schedule options</li>
  <li>Preferred days/times for tutoring sessions</li>
</ul>

<p>Need to reschedule? Just reply at least <strong>24 hours in advance</strong> and we'll find a new time that works.</p>

${meetLink ? `<a href="${meetLink}" class="btn">Join Google Meet</a>` : ''}

<div class="sig">
  <strong>Shashi Kumar</strong>
  Admissions Counselor | Test Prep Pundits<br>
  📧 ${c.counselorEmail} &nbsp;|&nbsp; 📞 ${c.counselorPhone}
</div>`;
  }

  _noAnswerBody(l) {
    const c = cfg.company;
    return `
<h2>We tried to reach you! 📞</h2>
<p>Hi ${l.parentName || l.fullName}! I'm <strong>Shashi Kumar</strong> from Test Prep Pundits. I recently called regarding <strong>${l.courseInterest || 'our test prep programs'}</strong> for ${l.fullName} but wasn't able to connect.</p>

<div class="box">
  📌 <strong>Let's find a time that works for you!</strong><br>
  Reply to this email or call us at <strong>${c.counselorPhone}</strong> — we're available 7 days a week.
</div>

<p>Here's a quick snapshot of what we offer:</p>
<ul>
  <li>✅ <strong>Free 45-min consultation</strong> — zero obligation</li>
  <li>📈 Average <strong>150–200 SAT point</strong> improvement</li>
  <li>💳 <strong>Flexible payment plans</strong> — 3 to 6 monthly installments</li>
  <li>🕐 Sessions available <strong>7 days/week, 7 AM – 10 PM</strong></li>
  <li>💻 Online or in-person options available</li>
</ul>

<a href="mailto:${c.counselorEmail}?subject=Callback Request – ${l.fullName}" class="btn">Request a Callback</a>

<div class="sig">
  <strong>Shashi Kumar</strong>
  Admissions Counselor | Test Prep Pundits<br>
  📧 ${c.counselorEmail} &nbsp;|&nbsp; 📞 ${c.counselorPhone}
</div>`;
  }

  _reminderBody(l, t) {
    const c = cfg.company;
    const meetLink = l.meeting?.meetLink;
    return `
<h2>See you tomorrow! ⏰</h2>
<p>Hi ${l.parentName || l.fullName}! This is a friendly reminder about <strong>${l.fullName}'s</strong> admissions consultation tomorrow.</p>

<div class="box">
  📅 <strong>Tomorrow: ${t}</strong><br>
  ${meetLink ? `🔗 <a href="${meetLink}" style="color:#2563eb;font-weight:700">Join Google Meet</a>` : ''}
</div>

<p>We're looking forward to discussing the best path for ${l.fullName}'s goals. If anything comes up, please let us know at least <strong>2 hours in advance</strong>.</p>

${meetLink ? `<a href="${meetLink}" class="btn">Join Tomorrow's Meeting</a>` : ''}

<div class="sig">
  <strong>Shashi Kumar</strong>
  Admissions Counselor | Test Prep Pundits<br>
  📧 ${c.counselorEmail} &nbsp;|&nbsp; 📞 ${c.counselorPhone}
</div>`;
  }

  _enrollmentBody(l) {
    const c = cfg.company;
    return `
<h2>Ready to take the next step? 🚀</h2>
<p>Hi ${l.parentName || l.fullName}! It was wonderful speaking with you about ${l.fullName}'s academic goals. I hope our consultation gave you a clear picture of how Test Prep Pundits can make a difference.</p>

<div class="box">
  🎯 <strong>Recommended Program for ${l.fullName}:</strong><br>
  ${l.courseInterest || 'Test Prep'} — ${l.qualification?.preferredFormat || 'One-on-One'} format<br>
  Lead Score: <strong>${l.leadScore}/100</strong> (${(l.leadCategory || 'warm').toUpperCase()} Lead)
</div>

<p>To secure your spot and lock in current pricing, you can enroll today:</p>
<ul>
  <li>📧 Reply directly to this email</li>
  <li>📞 Call or text <strong>${c.counselorPhone}</strong></li>
  <li>🌐 Visit <a href="${c.website}/enroll">${c.website}</a></li>
</ul>

<p>⚠️ <strong>Spots fill up fast</strong> — especially heading into the exam season. We'd hate for ${l.fullName} to miss out on their ideal slot.</p>

<a href="${c.website}" class="btn">Enroll Now →</a>

<div class="sig">
  <strong>Shashi Kumar</strong>
  Admissions Counselor | Test Prep Pundits<br>
  📧 ${c.counselorEmail} &nbsp;|&nbsp; 📞 ${c.counselorPhone}
</div>`;
  }
}

module.exports = new EmailService();
