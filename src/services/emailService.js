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
    if (!lead.email) {
      const err = `Lead ${lead._id} missing email address`;
      logger.error(err);
      return { ok: false, error: err };
    }
    return this._send({
      to:      lead.email,
      cc:      lead.parentEmail,
      subject: `Welcome to Test Prep Pundits – We'll be in touch, ${lead.fullName}! 🎓`,
      html:    this._wrap(this._newLeadBody(lead)),
    });
  }

  async sendMeetingConfirmation(lead) {
    if (!lead.email) {
      const err = `Lead ${lead._id} missing email address`;
      logger.error(err);
      return { ok: false, error: err };
    }
    if (!lead.meeting?.scheduledAt) {
      const err = `Lead ${lead._id} missing meeting.scheduledAt`;
      logger.error(err);
      return { ok: false, error: err };
    }
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
    if (!lead.email) {
      const err = `Lead ${lead._id} missing email address`;
      logger.error(err);
      return { ok: false, error: err };
    }
    return this._send({
      to:      lead.email,
      cc:      lead.parentEmail,
      subject: `We tried to reach you – ${lead.fullName} | Test Prep Pundits`,
      html:    this._wrap(this._noAnswerBody(lead)),
    });
  }

  async sendMeetingReminder(lead) {
    if (!lead.email) {
      const err = `Lead ${lead._id} missing email address`;
      logger.error(err);
      return { ok: false, error: err };
    }
    if (!lead.meeting?.scheduledAt) {
      const err = `Lead ${lead._id} missing meeting.scheduledAt`;
      logger.error(err);
      return { ok: false, error: err };
    }
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

  async sendSuccessStories(lead) {
    if (!lead.email) {
      const err = `Lead ${lead._id} missing email address`;
      logger.error(err);
      return { ok: false, error: err };
    }
    return this._send({
      to:      lead.email,
      cc:      lead.parentEmail,
      subject: `🌟 ${lead.fullName}, see how students like you achieved their goals`,
      html:    this._wrap(this._successStoriesBody(lead)),
    });
  }

  async sendEnrollmentReminder(lead) {
    if (!lead.email) {
      const err = `Lead ${lead._id} missing email address`;
      logger.error(err);
      return { ok: false, error: err };
    }
    return this._send({
      to:      lead.email,
      cc:      lead.parentEmail,
      subject: `⏳ Last chance to secure ${lead.fullName}'s spot — enrollment closing soon`,
      html:    this._wrap(this._enrollmentReminderBody(lead)),
    });
  }

  async sendEnrollmentFollowup(lead) {
    if (!lead.email) {
      const err = `Lead ${lead._id} missing email address`;
      logger.error(err);
      return { ok: false, error: err };
    }
    return this._send({
      to:      lead.email,
      cc:      lead.parentEmail,
      subject: `Ready to get started? – ${lead.fullName}'s ${lead.courseInterest || 'Test Prep'} Program`,
      html:    this._wrap(this._enrollmentBody(lead)),
    });
  }

  // ── Core Brevo API call ──────────────────────────────────────────────

  async _send({ to, cc, subject, html }) {
    // Validate required config
    if (!cfg.brevo.apiKey) {
      const err = 'BREVO_API_KEY not configured in environment';
      logger.error(err);
      return { ok: false, error: err };
    }
    if (!cfg.brevo.fromEmail) {
      const err = 'BREVO_FROM_EMAIL not configured in environment';
      logger.error(err);
      return { ok: false, error: err };
    }

    // Validate email addresses
    if (!to || !to.includes('@')) {
      const err = `Invalid recipient email: "${to}"`;
      logger.error(err);
      return { ok: false, error: err };
    }
    if (cc && !cc.includes('@')) {
      const err = `Invalid cc email: "${cc}"`;
      logger.error(err);
      return { ok: false, error: err };
    }

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
      logger.error('Brevo email failed', { to, subject, detail, status: err.response?.status });
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
    <img src="${cfg.server.baseUrl || cfg.company.website}/assets/logo.png" alt="Test Prep Pundits" style="width:120px;height:auto;background:#fff;padding:10px;border-radius:12px;display:inline-block;margin-bottom:8px"/>
    <h1>Test Prep Pundits</h1>
    <p>AI Admissions Agent · Your Path to Academic Excellence</p>
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

${this._programCards(l.courseInterest)}

<a href="${c.website}" class="btn">Explore All Programs</a>

<div class="sig">
  <strong>Shashi Kumar</strong>
  Admissions Counselor | Test Prep Pundits<br>
  📧 ${c.counselorEmail} &nbsp;|&nbsp; 📞 ${c.counselorPhone}<br>
  🌐 <a href="${c.website}">${c.website}</a>
</div>`;
  }

  /** Renders two program cards based on the student's course interest */
  _programCards(courseInterest) {
    const prog = (courseInterest || '').toLowerCase();
    const isSAT = prog.includes('sat');
    const isACT = prog.includes('act');

    // ── Stripe Buy Now links ─────────────────────────────────────────
    const STRIPE = {
      prestigiousSAT:  'https://buy.stripe.com/6oEcO6baZb5w2HKcN9',
      selfPacedSAT:    'https://buy.stripe.com/3cs4hA6UJ8Xo968dRc',  // same $199 as Self-Paced ACT
      selfPacedACT:    'https://buy.stripe.com/3cs4hA6UJ8Xo968dRc',
      prestigiousACT:  'https://buy.stripe.com/7sI29s4MBgpQ6Y0bJ3',
    };

    // ── Shared card styles (inline, email-safe) ──────────────────────
    const wrap = `
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:24px 0">
        <tr><td style="padding:0 0 14px">
          <p style="font-size:16px;font-weight:700;color:#1a3c6e;margin:0">
            🎯 Programs for ${isSAT ? 'SAT' : isACT ? 'ACT' : 'Your'} Preparation:
          </p>
        </td></tr>
        <tr><td>
          <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>`;

    const cardStyle = `vertical-align:top;width:48%;padding:0 6px 0 0`;
    const cardInner = `background:#f0f6ff;border:2px solid #2563eb;border-radius:14px;padding:22px 20px;font-size:14px;line-height:1.7;color:#374151`;
    const titleStyle = `font-size:15px;font-weight:800;color:#1a3c6e;text-transform:uppercase;letter-spacing:.3px;margin:0 0 4px`;
    const subtitleStyle = `font-size:13px;font-weight:700;color:#ea580c;margin:0 0 14px`;
    const priceStyle = `font-size:17px;font-weight:800;color:#ea580c;margin:12px 0 4px`;
    const noteStyle = `font-size:12px;color:#6b7280;margin:0 0 14px`;
    const btnStyle = `display:inline-block;background:#ea580c;color:#fff;text-decoration:none;padding:10px 22px;border-radius:8px;font-weight:700;font-size:13px;margin-top:8px`;
    const divider = `</td><td style="width:4%"></td><td style="${cardStyle}">`;
    const close   = `</td></tr></table></td></tr></table>`;

    if (isSAT) {
      return `${wrap}
        <td style="${cardStyle}">
          <div style="${cardInner}">
            <p style="${titleStyle}">Prestigious Digital SAT Prep</p>
            <p style="${subtitleStyle}">66 Hours · Weekend Course</p>
            <ul style="margin:0 0 10px 18px;padding:0">
              <li>12–15 Students Per Group</li>
              <li>8–12 Weeks · Weekly Twice</li>
              <li>You pay only <strong>$10/hr</strong></li>
            </ul>
            <p style="${priceStyle}">Price: $720 only</p>
            <p style="${noteStyle}">Includes 1-Year Digital License + 8 Full-Length Tests + 548-Page Digital Workbook + Registration Fee (worth $199)</p>
            <a href="${STRIPE.prestigiousSAT}" style="${btnStyle}">BUY NOW</a>
          </div>
        </td>
        ${divider}
          <div style="${cardInner}">
            <p style="${titleStyle}">Self-Paced Digital SAT Prep</p>
            <p style="${subtitleStyle}">Online $199 only</p>
            <ul style="margin:0 0 10px 18px;padding:0">
              <li>Learn when it is convenient for you</li>
              <li>548-Page Digital Workbook</li>
              <li>Expert Video Solutions</li>
              <li>Math, Reading &amp; Writing</li>
              <li>5 Full-Length Tests</li>
              <li>Score with Detailed Analytics</li>
              <li>Learn Your Strengths &amp; Weaknesses</li>
            </ul>
            <a href="${STRIPE.selfPacedSAT}" style="${btnStyle}">BUY NOW</a>
          </div>
        ${close}`;
    }

    if (isACT) {
      return `${wrap}
        <td style="${cardStyle}">
          <div style="${cardInner}">
            <p style="${titleStyle}">Splendid Self-Paced ACT Prep</p>
            <p style="${subtitleStyle}">Go at Your Own Pace @ $199</p>
            <ul style="margin:0 0 10px 18px;padding:0">
              <li>Well-designed course for sequential growth</li>
              <li>Learn anywhere, anytime</li>
              <li>You are the boss of your schedule</li>
              <li>18-week structured course</li>
              <li>Learn from your mistakes with expert teacher videos</li>
            </ul>
            <a href="${STRIPE.selfPacedACT}" style="${btnStyle}">BUY NOW</a>
          </div>
        </td>
        ${divider}
          <div style="${cardInner}">
            <p style="${titleStyle}">Prestigious ACT Prep</p>
            <p style="${subtitleStyle}">66 Hours · Weekend Course</p>
            <ul style="margin:0 0 10px 18px;padding:0">
              <li>12–15 Students Per Group</li>
              <li>8–12 Weeks · Weekly Twice</li>
              <li>You pay only <strong>$10/hr</strong></li>
            </ul>
            <p style="${priceStyle}">Price: $720 only</p>
            <p style="${noteStyle}">Includes 1-Year Digital License + 15 Full-Length Tests + 548-Page Digital Workbook + Registration Fee (worth $199)</p>
            <a href="${STRIPE.prestigiousACT}" style="${btnStyle}">BUY NOW</a>
          </div>
        ${close}`;
    }

    // ── Fallback: generic program list (AP, College Admissions, or unknown) ──
    return `
<p><strong>🌟 Our most popular programs:</strong></p>
<ul>
  <li><strong>SAT / ACT Prep</strong> — Group classes from $599 | Private tutoring from $150/hr</li>
  <li><strong>AP Course Support</strong> — 10–16 week intensives from $749</li>
  <li><strong>College Admissions Counseling</strong> — Complete package from $2,999</li>
</ul>
<p>Students see an average of <strong>150–200 SAT point</strong> improvement or <strong>4–6 ACT composite points</strong> with our programs.</p>`;
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

  _successStoriesBody(l) {
    const c = cfg.company;
    return `
<h2>See What Students Like ${l.fullName} Achieved 🌟</h2>
<p>Hi ${l.parentName || l.fullName}! We wanted to share a few of our recent student success stories — because seeing real results speaks louder than any brochure.</p>

<div class="box">
  🎓 <strong>Sarah M. (Grade 11):</strong> Improved SAT from 1080 → 1360 in 8 weeks<br>
  🎓 <strong>Rahul P. (Grade 10):</strong> ACT composite jumped from 22 → 29 after one prep cycle<br>
  🎓 <strong>Emma L. (Grade 12):</strong> Scored 5s on AP Calculus and AP Chemistry<br>
  🎓 <strong>James W. (Grade 11):</strong> Earned $40,000 merit scholarship with improved SAT score
</div>

<p><strong>The #1 reason students succeed with us:</strong></p>
<ul>
  <li>📊 Personalized study plan based on individual strength & weakness analysis</li>
  <li>👩‍🏫 Expert tutors with 10+ years of test prep experience</li>
  <li>📈 Weekly progress tracking with adaptive content</li>
  <li>🕐 Flexible scheduling — 7 days/week, morning to evening</li>
</ul>

<p>We'd love to add <strong>${l.fullName}</strong> to our success stories. Let's get started!</p>

<a href="${c.website}" class="btn">Schedule Your Free Consultation →</a>

<div class="sig">
  <strong>Shashi Kumar</strong>
  Admissions Counselor | Test Prep Pundits<br>
  📧 ${c.counselorEmail} &nbsp;|&nbsp; 📞 ${c.counselorPhone}
</div>`;
  }

  _enrollmentReminderBody(l) {
    const c = cfg.company;
    return `
<h2>⏳ Enrollment Closing Soon — Secure ${l.fullName}'s Spot Today</h2>
<p>Hi ${l.parentName || l.fullName}! We wanted to reach out one more time regarding <strong>${l.fullName}'s</strong> ${l.courseInterest || 'test prep'} program.</p>

<div class="box">
  ⚠️ <strong>Limited spots available</strong> — especially for one-on-one and small-group formats.<br>
  Current session enrollment is filling up fast heading into exam season.
</div>

<p>Here's a quick reminder of what's included:</p>
<ul>
  <li>✅ Personalized study plan tailored to ${l.fullName}'s goals</li>
  <li>📊 Score improvement guarantee</li>
  <li>💳 Flexible payment plans starting at 3 monthly installments</li>
  <li>🆓 Free 45-minute kick-off consultation included</li>
</ul>

<p>To lock in ${l.fullName}'s spot at the current pricing, simply reply to this email or call us directly.</p>

<a href="mailto:${c.counselorEmail}?subject=Enrollment – ${l.fullName}" class="btn">Confirm Enrollment →</a>

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
