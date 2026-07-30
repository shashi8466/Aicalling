/**
 * Email Service — powered by Nodemailer (SMTP)
 */
const axios = require('axios');
const moment = require('moment-timezone');
const cfg    = require('../config');
const logger = require('../logger');

// Parent-notification campaigns → email content. Used by sendParentCampaignEmail
// so a summary email is always sent after a parent AI call, whether answered or not.
const PARENT_TEMPLATES = {
  'parent-homework': {
    name: 'Homework Campaign',
    subject: s => `Homework Reminder for ${s}`,
    intro:  s => `This is an automated follow-up from Test Prep Pundits. Today our AI assistant contacted you regarding your child ${s}.`,
    reason: `Your child has not completed today's homework assignment.`,
    action: `Please ask your child to complete the homework as soon as possible.`,
    help:   `If you need any assistance, please contact our support team or post your question in the WhatsApp group.`,
  },
  'parent-absent': {
    name: 'Absent Campaign',
    subject: s => `Attendance Reminder for ${s}`,
    intro:  s => `Today our AI assistant contacted you regarding your child ${s}.`,
    reason: `Your child was absent today.`,
    action: `If you have already informed Test Prep Pundits, please ignore this reminder. Otherwise, kindly post your child's absence in the WhatsApp group so our support team can update the attendance.`,
    help:   ``,
  },
  'parent-flt': {
    name: 'Full Length Test Campaign',
    subject: s => `Full Length Test Reminder for ${s}`,
    intro:  s => `Our AI assistant recently contacted you regarding your child ${s}.`,
    reason: `Your child has not completed today's Full Length Test.`,
    action: `Please encourage your child to complete the test at the earliest convenience.`,
    help:   `If you need any assistance, our support team is always happy to help.`,
  },
};

class EmailService {

  constructor() {
    // No initialization needed for Brevo API
  }

  // ── Public senders ───────────────────────────────────────────────────

  // ── Helper to resolve brand details based on campaign ────────────────
  // `overrideType` (optional) forces the campaign type — used by callers that
  // already know it (e.g. the live call passes session.campaignType). This
  // avoids depending on resolveForLead(lead), which can fall back to the
  // default brand when the lead's campaignId isn't persisted in the DB.
  async _getBrand(lead, overrideType = null) {
    let companyName = 'Test Prep Pundits';
    let logoPath = 'logos/logo1.png';
    let website = 'https://testpreppundits.com';
    let companyDesc = 'AI Admissions Agent · Your Path to Academic Excellence';

    if (lead || overrideType) {
      try {
        let type = overrideType;
        if (!type) {
          const campaignSvc = require('./campaignService');
          ({ type } = await campaignSvc.resolveForLead(lead));
        }
        const pundits = ['sat-batch', 'act-batch', 'ap-course', 'business-partner',
                         'parent-absent', 'parent-homework', 'parent-flt'];
        if (pundits.includes(type)) {
          logoPath = 'logos/logo1.png';
          companyName = type === 'business-partner' ? 'HGI' : 'Test Prep Pundits';
          companyDesc = 'Your Path to Academic Excellence';
          website = 'https://testpreppundits.com';
        }
      } catch (e) {
        logger.warn('Failed to resolve brand for lead', e);
      }
    }
    return { companyName, logoPath, website, companyDesc };
  }

  async sendNewLeadWelcome(lead) {
    if (!lead.email) {
      const err = `Lead ${lead._id} missing email address`;
      logger.error(err);
      return { ok: false, error: err };
    }
    const brand = await this._getBrand(lead);
    const subject = `Welcome to ${brand.companyName} – We'll be in touch, ${lead.fullName}! 🎓`;
    const html = await this._wrap(this._newLeadBody(lead), lead);
    return this._send({
      to:      lead.email,
      cc:      lead.parentEmail,
      subject,
      html,
    });
  }

  _buildIcsAttachment(lead, tStr) {
    try {
      const start = moment(lead.meeting.scheduledAt);
      const end = start.clone().add(10, 'minutes'); // 10 mins
      const formatDate = (m) => m.utc().format('YYYYMMDDTHHmmss[Z]');
      const meetLink = lead.meeting.meetLink || '';

      const ics = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Test Prep Pundits//NONSGML Event//EN',
        'CALSCALE:GREGORIAN',
        'BEGIN:VEVENT',
        `DTSTART:${formatDate(start)}`,
        `DTEND:${formatDate(end)}`,
        `SUMMARY:Test Prep Pundits Free Admissions Consultation - ${lead.fullName}`,
        `DESCRIPTION:Our Admissions Team will call you at ${lead.phone}. Format: Phone Call. Duration: 10 minutes.`,
        `LOCATION:Phone Call`,
        'STATUS:CONFIRMED',
        'END:VEVENT',
        'END:VCALENDAR'
      ].join('\r\n');

      return {
        name: 'consultation.ics',
        content: Buffer.from(ics).toString('base64'),
      };
    } catch (e) {
      logger.error('Failed to generate ICS attachment', e);
      return null;
    }
  }

  async sendMeetingConfirmation(lead, overrideCampaignType = null) {
    if (!lead.meeting?.scheduledAt) {
      const err = `Lead ${lead._id} missing meeting.scheduledAt`;
      logger.error(err);
      return { ok: false, error: err };
    }

    // Deduplication check: if confirmation email was sent within the last 2 minutes, skip to avoid duplicates
    const twoMinsAgo = new Date(Date.now() - 2 * 60 * 1000);
    if (lead.meeting?.confirmationSentAt && new Date(lead.meeting.confirmationSentAt) > twoMinsAgo) {
      logger.info(`Confirmation email already sent recently for lead ${lead._id}, skipping duplicate.`);
      return { ok: true, skipped: true };
    }

    const campaignSvc = require('./campaignService');
    const resolved = await campaignSvc.resolveForLead(lead);
    const campaignType = overrideCampaignType || resolved.type;
    const isBusiness = campaignType === 'business-partner';

    const t = moment(lead.meeting.scheduledAt)
      .tz('America/New_York')
      .format('dddd, MMMM Do [at] h:mm A [ET]');

    const html = isBusiness
      ? await this._wrap(this._businessMeetingConfBody(lead, t), lead, campaignType)
      : await this._wrap(this._meetingConfBody(lead, t), lead, campaignType);

    const attachment = this._buildIcsAttachment(lead, t);

    // Subject
    const subject = isBusiness
      ? `Business Partnership Consultation Confirmed – ${lead.fullName}`
      : `✅ Consultation Confirmed – ${t}`;

    const counselorEmail = cfg.company.counselorEmail || cfg.brevo.fromEmail;

    let resStudent = { ok: false, error: 'No student email' };
    
    // Send email to contact (and CC parent if not business)
    if (lead.email) {
      resStudent = await this._send({
        to:      lead.email,
        cc:      isBusiness ? undefined : lead.parentEmail,
        subject,
        html,
        attachment,
      });
    } else {
      logger.warn(`Skipping student confirmation email for lead ${lead._id} because they have no email address, but will still send counselor copy.`);
    }

    // Send email to counselor independently
    if (counselorEmail) {
      await this._send({
        to:      counselorEmail,
        subject: `[Counselor Copy] ${subject}`,
        html,
        attachment,
      }).catch(e => logger.error('Counselor notification copy failed', e));
    }

    // Mark confirmation email sent timestamp on lead
    if (lead.meeting) {
      lead.meeting.confirmationSentAt = new Date().toISOString();
      if (typeof lead.save === 'function') {
        await lead.save().catch(() => {});
      }
    }

    return resStudent;
  }

  async sendNoAnswer(lead) {
    if (!lead.email) {
      const err = `Lead ${lead._id} missing email address`;
      logger.error(err);
      return { ok: false, error: err };
    }
    const brand = await this._getBrand(lead);
    const html = await this._wrap(this._noAnswerBody(lead), lead);
    return this._send({
      to:      lead.email,
      cc:      lead.parentEmail,
      subject: `We tried to reach you – ${lead.fullName} | ${brand.companyName}`,
      html,
    });
  }

  /**
   * Parent Campaign summary email — sent after EVERY parent AI call, regardless
   * of outcome. `answered` picks the campaign-specific template (call connected)
   * vs the generic "we were unable to reach you" template.
   * @returns {ok, messageId?, error?, to}
   */
  async sendParentCampaignEmail(lead, { campaignType, answered = false } = {}) {
    const t = PARENT_TEMPLATES[campaignType];
    if (!t) return { ok: false, error: `Not a parent notification campaign: ${campaignType}` };

    // The Parent Email stored in the CRM (fall back to the lead's own email).
    const to = (lead.parentEmail && lead.parentEmail.includes('@'))
      ? lead.parentEmail
      : (lead.email || '');
    if (!to || !to.includes('@')) {
      return { ok: false, error: `No parent email on file for lead ${lead._id}` };
    }

    const parentName  = lead.parentName || 'Parent';
    const studentName = lead.fullName || 'your child';

    const subject = answered
      ? t.subject(studentName)
      : `Important Reminder Regarding ${studentName}`;

    const body = answered
      ? this._parentAnsweredBody(t, parentName, studentName)
      : this._parentMissedBody(t, parentName, studentName);

    const html = await this._wrap(body, lead, campaignType);
    const res = await this._send({ to, subject, html });
    return { ...res, to };
  }

  _parentAnsweredBody(t, parentName, studentName) {
    const c = cfg.company;
    return `
<h2>Hello ${parentName},</h2>
<p>${t.intro(studentName)}</p>
<div class="box">
  <strong>Reason for the call:</strong><br>
  ${t.reason}
</div>
<p>${t.action}</p>
${t.help ? `<p>${t.help}</p>` : ''}
<p>Thank you.</p>
<div class="sig">
  <strong>Regards,</strong><br><br>
  <strong>Test Prep Pundits Team</strong><br>
  📧 <strong><a href="mailto:Info@testpreppundits.com" style="color:inherit;text-decoration:none;">Info@testpreppundits.com</a></strong><br>
  🌐 <strong><a href="http://www.testpreppundits.com" style="color:inherit;text-decoration:none;">www.testpreppundits.com</a></strong>
</div>`;
  }

  _parentMissedBody(t, parentName, studentName) {
    const c = cfg.company;
    return `
<h2>Hello ${parentName},</h2>
<p>We recently attempted to contact you regarding your child <strong>${studentName}</strong>, but we were unable to reach you.</p>
<div class="box">
  <strong>Reason:</strong><br>
  ${t.reason}
</div>
<p>${t.action}</p>
${t.help ? `<p>${t.help}</p>` : ''}
<p>Please review the above reminder and contact us if you have any questions.</p>
<p>Thank you.</p>
<div class="sig">
  <strong>Regards,</strong><br><br>
  <strong>Test Prep Pundits Team</strong><br>
  📧 <strong><a href="mailto:Info@testpreppundits.com" style="color:inherit;text-decoration:none;">Info@testpreppundits.com</a></strong><br>
  🌐 <strong><a href="http://www.testpreppundits.com" style="color:inherit;text-decoration:none;">www.testpreppundits.com</a></strong>
</div>`;
  }

  async sendMeetingReminder(lead, reminderType = '24h') {
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
    
    let subject = `⏰ Reminder: Your Consultation Tomorrow – ${t}`;
    let body = this._reminderBody(lead, t);

    if (reminderType === '1h') {
      subject = `⏰ Reminder: Your Consultation is in 1 Hour – ${t}`;
      body = `
        <h2>See you in 1 Hour! ⏰</h2>
        <p>Hi ${lead.parentName || lead.fullName}! This is a friendly reminder that your free admissions consultation is starting in 1 hour.</p>
        ${this._meetingDetailsBox(t)}
      `;
    } else if (reminderType === '10m') {
      subject = `🚨 Starting in 10 Mins: Your Consultation – ${t}`;
      body = `
        <h2>Starting in 10 Minutes! 🚨</h2>
        <p>Hi ${lead.parentName || lead.fullName}! We are ready for you. Your free admissions consultation is starting in 10 minutes.</p>
        ${this._meetingDetailsBox(t)}
      `;
    }

    const html = await this._wrap(body, lead);
    const attachment = this._buildIcsAttachment(lead, t);

    // Send to student
    const resStudent = await this._send({
      to:      lead.email,
      cc:      lead.parentEmail,
      subject,
      html,
      attachment,
    });

    // Send to counselor independently
    const counselorEmail = cfg.company.counselorEmail || cfg.brevo.fromEmail;
    if (counselorEmail && counselorEmail !== lead.email) {
      await this._send({
        to:      counselorEmail,
        subject: `[Counselor Copy] ${subject}`,
        html,
        attachment,
      }).catch(e => logger.error('Counselor reminder copy failed', e));
    }

    return resStudent;
  }

  async sendMeetingRescheduled(lead, oldTimeStr = null) {
    if (!lead.email) return { ok: false, error: `Lead ${lead._id} missing email address` };
    if (!lead.meeting?.scheduledAt) return { ok: false, error: `Lead ${lead._id} missing meeting.scheduledAt` };
    
    const t = moment(lead.meeting.scheduledAt)
      .tz('America/New_York')
      .format('dddd, MMMM Do [at] h:mm A [ET]');
      
    const subject = `🔄 Consultation Rescheduled – ${t}`;
    const body = `
      <h2>Meeting Rescheduled 🔄</h2>
      <p>Hi ${lead.parentName || lead.fullName},</p>
      <p>Your free admissions consultation has been successfully rescheduled${oldTimeStr ? ' from ' + oldTimeStr : ''}. Here are the updated details:</p>
      ${this._meetingDetailsBox(t)}
    `;
    
    const html = await this._wrap(body, lead);
    const attachment = this._buildIcsAttachment(lead, t);
    
    const resStudent = await this._send({
      to:      lead.email,
      cc:      lead.parentEmail,
      subject,
      html,
      attachment,
    });

    const counselorEmail = cfg.company.counselorEmail || cfg.brevo.fromEmail;
    if (counselorEmail && counselorEmail !== lead.email) {
      await this._send({
        to:      counselorEmail,
        subject: `[Counselor Copy] ${subject}`,
        html,
        attachment,
      }).catch(e => logger.error('Counselor rescheduled copy failed', e));
    }

    return resStudent;
  }

  async sendMeetingCancelled(lead, reason = null) {
    if (!lead.email) return { ok: false, error: `Lead ${lead._id} missing email address` };
    
    const subject = `❌ Consultation Cancelled – ${lead.fullName}`;
    const body = `
      <h2>Meeting Cancelled ❌</h2>
      <p>Hi ${lead.parentName || lead.fullName},</p>
      <p>Your free admissions consultation has been cancelled.</p>
      ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
      <div class="box" style="background:#fef2f2;padding:15px;border-radius:8px;border-left:4px solid #ef4444;margin:15px 0;line-height:1.6;">
        <p>If you'd like to rebook at a more convenient time, please reply to this email and we'll be happy to assist you.</p>
      </div>
    `;
    
    const html = await this._wrap(body, lead);
    
    const resStudent = await this._send({
      to:      lead.email,
      cc:      lead.parentEmail,
      subject,
      html,
    });

    const counselorEmail = cfg.company.counselorEmail || cfg.brevo.fromEmail;
    if (counselorEmail && counselorEmail !== lead.email) {
      await this._send({
        to:      counselorEmail,
        subject: `[Counselor Copy] ${subject}`,
        html,
      }).catch(e => logger.error('Counselor cancelled copy failed', e));
    }

    return resStudent;
  }

  async sendSuccessStories(lead) {
    if (!lead.email) {
      const err = `Lead ${lead._id} missing email address`;
      logger.error(err);
      return { ok: false, error: err };
    }
    const html = await this._wrap(this._successStoriesBody(lead), lead);
    return this._send({
      to:      lead.email,
      cc:      lead.parentEmail,
      subject: `🌟 ${lead.fullName}, see how students like you achieved their goals`,
      html,
    });
  }

  async sendEnrollmentReminder(lead) {
    if (!lead.email) {
      const err = `Lead ${lead._id} missing email address`;
      logger.error(err);
      return { ok: false, error: err };
    }
    const html = await this._wrap(this._enrollmentReminderBody(lead), lead);
    return this._send({
      to:      lead.email,
      cc:      lead.parentEmail,
      subject: `⏳ Last chance to secure ${lead.fullName}'s spot — enrollment closing soon`,
      html,
    });
  }

  async sendParentDiscussion(lead) {
    if (!lead.email) return { ok: false, error: `Lead ${lead._id} missing email` };
    const html = await this._wrap(this._parentDiscussionBody(lead), lead);
    return this._send({
      to:      lead.email,
      cc:      lead.parentEmail,
      subject: `${lead.parentName || 'A note for parents'} — Let's discuss ${lead.fullName}'s academic future`,
      html,
    });
  }

  async sendProgramBenefits(lead) {
    if (!lead.email) return { ok: false, error: `Lead ${lead._id} missing email` };
    const brand = await this._getBrand(lead);
    const html = await this._wrap(this._programBenefitsBody(lead), lead);
    return this._send({
      to:      lead.email,
      cc:      lead.parentEmail,
      subject: `Why students choose ${brand.companyName} — ${lead.fullName}'s program breakdown`,
      html,
    });
  }

  async sendLimitedSeat(lead) {
    if (!lead.email) return { ok: false, error: `Lead ${lead._id} missing email` };
    const html = await this._wrap(this._limitedSeatBody(lead), lead);
    return this._send({
      to:      lead.email,
      cc:      lead.parentEmail,
      subject: `⚠️ Limited seats remaining — secure ${lead.fullName}'s spot now`,
      html,
    });
  }

  async sendCounselorReachOut(lead) {
    if (!lead.email) return { ok: false, error: `Lead ${lead._id} missing email` };
    const html = await this._wrap(this._counselorReachOutBody(lead), lead);
    return this._send({
      to:      lead.email,
      cc:      lead.parentEmail,
      subject: `${lead.fullName}, I wanted to personally check in 👋`,
      html,
    });
  }

  async sendReEngagement(lead) {
    if (!lead.email) return { ok: false, error: `Lead ${lead._id} missing email` };
    const html = await this._wrap(this._reEngagementBody(lead), lead);
    return this._send({
      to:      lead.email,
      cc:      lead.parentEmail,
      subject: `Still thinking about it? We're here for ${lead.fullName} whenever you're ready`,
      html,
    });
  }

  async sendEnrollmentFollowup(lead) {
    if (!lead.email) {
      const err = `Lead ${lead._id} missing email address`;
      logger.error(err);
      return { ok: false, error: err };
    }
    const html = await this._wrap(this._enrollmentBody(lead), lead);
    return this._send({
      to:      lead.email,
      cc:      lead.parentEmail,
      subject: `Ready to get started? – ${lead.fullName}'s ${lead.courseInterest || 'Test Prep'} Program`,
      html,
    });
  }

  // ── Core API/SMTP call ──────────────────────────────────────────────

  async _send({ to, cc, bcc, subject, html, attachment }) {
    if (!to) {
      logger.error('Email failed: No "to" address provided.');
      return { ok: false, error: 'No to address' };
    }

    try {
      // If the sender is a Gmail account and they provided an app password, use Nodemailer
      // to bypass DMARC/spoofing policies that cause Brevo to silently drop the emails.
      if (cfg.brevo.fromEmail.toLowerCase().includes('@gmail.com') && cfg.gmail?.appPassword) {
        const nodemailer = require('nodemailer');
        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: cfg.brevo.fromEmail,
            pass: cfg.gmail.appPassword,
          },
        });

        const mailOptions = {
          from: `"${cfg.brevo.fromName}" <${cfg.brevo.fromEmail}>`,
          to,
          subject,
          html,
          replyTo: cfg.brevo.fromEmail,
        };

        if (cc && cc.includes('@')) mailOptions.cc = cc;
        if (bcc && bcc.includes('@')) mailOptions.bcc = bcc;
        
        if (attachment) {
          const attArray = Array.isArray(attachment) ? attachment : [attachment];
          mailOptions.attachments = attArray.map(att => ({
            filename: att.name,
            content: Buffer.from(att.content, 'base64'),
            contentType: 'text/calendar',
          }));
        }

        const info = await transporter.sendMail(mailOptions);
        logger.info(`Email sent via Gmail SMTP to ${to} (Message ID: ${info.messageId})`);
        return { ok: true, data: info };
      }

      // Fallback to Brevo API
      if (!cfg.brevo.apiKey) {
        const err = 'BREVO_API_KEY missing in environment';
        logger.error(err);
        return { ok: false, error: err };
      }

      const payload = {
        sender: { email: cfg.brevo.fromEmail, name: cfg.brevo.fromName },
        to: [{ email: to }],
        subject,
        htmlContent: html,
        replyTo: { email: cfg.brevo.fromEmail, name: cfg.brevo.fromName },
      };

      if (cc && cc.includes('@')) payload.cc = [{ email: cc }];
      if (bcc && bcc.includes('@')) payload.bcc = [{ email: bcc }];
      
      if (attachment) {
        payload.attachment = Array.isArray(attachment) ? attachment : [attachment];
      }

      const res = await axios.post('https://api.brevo.com/v3/smtp/email', payload, {
        headers: {
          'api-key': cfg.brevo.apiKey,
          'Content-Type': 'application/json',
        },
      });

      logger.info(`Email sent via Brevo → ${to} "${subject}" [${res.data?.messageId}]`);
      return { ok: true, messageId: res.data?.messageId };
    } catch (error) {
      const detail = error.response?.data?.message || error.message || error;
      logger.error('Brevo API email failed', { to, subject, detail });
      return { ok: false, error: detail };
    }
  }

  // ── HTML wrapper ─────────────────────────────────────────────────────

  async _wrap(inner, lead, overrideType = null) {
    const year    = new Date().getFullYear();
    const phone   = cfg.company.counselorPhone;

    const brand = await this._getBrand(lead, overrideType);

    // Adapt the inner HTML content to match the resolved company brand
    let adaptedInner = inner;
    if (brand.companyName !== 'Test Prep Pundits') {
      adaptedInner = adaptedInner
        .replace(/Test Prep Pundits/g, brand.companyName)
        .replace(/testpreppundits\.com/gi, 'testpreppundits.com');
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Helvetica Neue',Arial,sans-serif;background:#f0f4f8;color:#374151;-webkit-font-smoothing:antialiased}
img{max-width:100%;height:auto;display:block}
a{color:#2563eb}
.wrap{max-width:600px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,.10)}
.hdr{background:linear-gradient(135deg,#1a3c6e 0%,#2563eb 100%);padding:32px 40px;text-align:center}
.hdr h1{color:#fff;font-size:24px;font-weight:800;letter-spacing:-.3px;margin:0}
.hdr p{color:rgba(255,255,255,.82);font-size:13px;margin:6px 0 0}
.body{padding:36px 40px;line-height:1.75;font-size:15px}
h2{color:#1a3c6e;font-size:20px;font-weight:700;margin:0 0 14px;line-height:1.3}
p{margin:0 0 12px;font-size:15px;line-height:1.6}
ul{margin:8px 0 14px 20px;padding:0}
li{margin:0 0 6px;font-size:15px;line-height:1.6}
.box{background:#eff6ff;border-left:4px solid #2563eb;padding:16px 20px;border-radius:0 10px 10px 0;margin:20px 0;font-size:15px;line-height:1.7}
.grid{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0}
.cell{background:#f8fafc;padding:12px 16px;border-radius:10px;flex:1;min-width:130px}
.lbl{font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.6px;font-weight:600;margin:0;display:block}
.val{font-weight:700;color:#1a3c6e;font-size:15px;margin:4px 0 0;display:block;word-break:break-word}
.btn{display:inline-block;background:#2563eb;color:#fff!important;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:15px;margin:20px 0;letter-spacing:.2px;border:0;cursor:pointer;mso-padding-alt:14px 32px}
.sig{margin:32px 0 0;padding:20px 0 0;border-top:1px solid #e5e7eb;font-size:14px;color:#374151;line-height:1.6}
.sig strong{color:#1a3c6e;display:block;font-size:15px;margin:0 0 4px;font-weight:700}
.ftr{background:#f8fafc;padding:22px 40px;text-align:center;color:#9ca3af;font-size:12px;border-top:1px solid #e5e7eb;line-height:1.6}
.ftr a{color:#2563eb;text-decoration:none}
/* Email client safe table styles */
table{border-collapse:collapse;border-spacing:0;width:100%}
td{border-collapse:collapse}
/* Mobile responsiveness for email */
@media only screen and (max-width:600px){
  body{width:100% !important;min-width:100% !important}
  .wrap{max-width:100% !important;width:100% !important;margin:0 !important;border-radius:0 !important}
  .hdr{padding:24px 20px !important}
  .hdr h1{font-size:20px !important}
  .hdr p{font-size:12px !important}
  .hdr img{width:100px !important}
  .body{padding:20px 16px !important;font-size:14px !important}
  h2{font-size:18px !important;margin-bottom:12px !important}
  p{font-size:14px !important;margin-bottom:10px !important}
  ul{margin:6px 0 12px 18px !important}
  li{font-size:14px !important;margin-bottom:5px !important}
  .box{padding:14px 16px !important;margin:16px 0 !important;font-size:14px !important}
  .grid{flex-direction:column !important;gap:8px !important;margin:14px 0 !important}
  .cell{min-width:100% !important}
  .btn{display:block !important;width:100% !important;text-align:center !important;padding:12px 20px !important;font-size:14px !important;margin:16px 0 !important}
  .sig{margin:24px 0 0 !important;padding:16px 0 0 !important;font-size:12px !important}
  .sig strong{font-size:14px !important}
  .ftr{padding:16px 20px !important;font-size:11px !important}
  /* Success stories — stack two-col layouts */
  .m-stack{display:block !important;width:100% !important}
  .m-stack td{display:block !important;width:100% !important;padding:8px 0 !important}
  /* Scorer grid — 2 per row on mobile */
  .scorer-td{width:50% !important;display:inline-block !important;vertical-align:top}
  /* Section card padding */
  .ss-card{padding:14px 12px !important;border-radius:10px !important;margin-bottom:12px !important}
}
@media only screen and (max-width:480px){
  .hdr{padding:20px 16px !important}
  .hdr h1{font-size:18px !important}
  .body{padding:14px 12px !important}
  .box{padding:12px 14px !important;border-radius:6px !important}
  .btn{padding:10px 16px !important;font-size:13px !important;margin:12px 0 !important}
  .scorer-td{width:33% !important}
}
</style>
</head>
<body>
<div class="wrap">
  <div class="hdr">
    <img src="${cfg.server.baseUrl || cfg.company.website}/${brand.logoPath}" alt="${brand.companyName}" style="width:120px;height:auto;background:#fff;padding:10px;border-radius:12px;display:inline-block;margin-bottom:8px"/>
    <h1>${brand.companyName}</h1>
    <p>${brand.companyDesc}</p>
  </div>
  <div class="body">${adaptedInner}</div>
  <div class="ftr">
    <strong>Need Assistance?</strong><br>
    📧 <a href="mailto:Info@testpreppundits.com" style="color:inherit;text-decoration:none;">Info@testpreppundits.com</a><br>
    📞 +1 844-383-7844<br>
    📞 +1 210-457-1021<br>
    🌐 <a href="http://www.testpreppundits.com" style="color:inherit;text-decoration:none;">www.testpreppundits.com</a><br><br>
    <strong>Test Prep Pundits Team</strong>
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
<p>Thank you for reaching out to <strong>Test Prep Pundits</strong>! I am Annie, from Test Prep Pundits, and I'm genuinely excited to help <strong>${l.fullName}</strong> reach their academic goals.</p>

<div class="box">
  📞 <strong>We'll be calling you shortly</strong> at <strong>${l.phone}</strong> to learn more and answer any questions.<br>
  Prefer a specific time? Just reply to this email and we'll schedule a convenient call.
</div>

<div class="grid">
  <div class="cell"><div class="lbl">Student</div><div class="val">${l.fullName}</div></div>
  <div class="cell"><div class="lbl">Grade</div><div class="val">${l.grade || 'To confirm'}</div></div>
  <div class="cell"><div class="lbl">Program</div><div class="val">${l.courseInterest || 'To discuss'}</div></div>
  <div class="cell"><div class="lbl">Counselor</div><div class="val">Admissions Team</div></div>
</div>

${this._programCards(l.courseInterest)}

<a href="${c.website}" class="btn">Explore All Programs</a>

<div class="sig">
  <strong>Regards,</strong><br><br>
  <strong>Test Prep Pundits Team</strong><br>
  📧 <strong><a href="mailto:Info@testpreppundits.com" style="color:inherit;text-decoration:none;">Info@testpreppundits.com</a></strong><br>
  🌐 <strong><a href="http://www.testpreppundits.com" style="color:inherit;text-decoration:none;">www.testpreppundits.com</a></strong>
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
`;
  }

  _meetingDetailsBox(t) {
    return `
<div class="box" style="background:#eff6ff;padding:16px;border-radius:8px;border-left:4px solid #2563eb;margin:16px 0;line-height:1.7;">
  📅 <strong>Meeting Date &amp; Time:</strong> ${t}<br>
  📞 <strong>Format:</strong> Phone Call<br>
  ⏱️ <strong>Duration:</strong> 10 minutes<br>
  👨‍🏫 <strong>Counselor:</strong> Admissions Team<br><br>
  📱 <strong>Our Admissions Team will call you at your scheduled consultation time using the phone number you provided during registration.</strong><br><br>
  Please keep your phone nearby and available during your scheduled consultation.<br><br>
  If you need to reschedule or have any questions before the call, please contact our support team.
</div>`;
  }

  _businessMeetingConfBody(l, t) {
    const c = cfg.company;
    const companyName = l.companyName || l.qualification?.companyName || 'HGI';
    return `
<h2>Business Partnership Consultation Confirmed – ${l.fullName}</h2>
<p>Your Business Partnership consultation has been successfully scheduled.</p>

${this._meetingDetailsBox(t)}

<p><strong>Discussion Agenda:</strong></p>
<ul>
  <li>How the business model and revenue share works</li>
  <li>Income and growth opportunities in your region</li>
  <li>Training, support, and resource provisions</li>
  <li>Next steps for onboarding and launch</li>
</ul>

<div class="sig">
  <strong>Regards,</strong><br><br>
  <strong>Test Prep Pundits Team</strong><br>
  📧 <strong><a href="mailto:Info@testpreppundits.com" style="color:inherit;text-decoration:none;">Info@testpreppundits.com</a></strong><br>
  🌐 <strong><a href="http://www.testpreppundits.com" style="color:inherit;text-decoration:none;">www.testpreppundits.com</a></strong>
</div>`;
  }

  _meetingConfBody(l, t) {
    const c = cfg.company;
    return `
<h2>Your Consultation is Confirmed! ✅</h2>
<p>Hi ${l.parentName || l.fullName}! Great news — your free admissions consultation is all set. We can't wait to connect with you!</p>

${this._meetingDetailsBox(t)}

<p><strong>Please bring to the meeting:</strong></p>
<ul>
  <li>Any recent SAT/ACT scores or practice test results</li>
  <li>Target college list (if you have one)</li>
  <li>Questions about programs, pricing, or schedule options</li>
  <li>Preferred days/times for tutoring sessions</li>
</ul>

<div class="sig">
  <strong>Regards,</strong><br><br>
  <strong>Test Prep Pundits Team</strong><br>
  📧 <strong><a href="mailto:Info@testpreppundits.com" style="color:inherit;text-decoration:none;">Info@testpreppundits.com</a></strong><br>
  🌐 <strong><a href="http://www.testpreppundits.com" style="color:inherit;text-decoration:none;">www.testpreppundits.com</a></strong>
</div>`;
  }

  _noAnswerBody(l) {
    const c = cfg.company;
    return `
<h2>We tried to reach you! 📞</h2>
<p>Hi, this is Annie, from Test Prep Pundits. I recently called regarding <strong>${l.courseInterest || 'our test prep programs'}</strong> for ${l.fullName} but wasn't able to connect.</p>

<div class="box">
  📌 <strong>Let's find a time that works for you!</strong><br>
  Reply to this email or call us at <strong>${c.counselorPhone}</strong> — we're available 7 days a week.
</div>

<p>Here's a quick snapshot of what we offer:</p>
<ul>
  <li>✅ <strong>Free 10-min consultation</strong> — zero obligation</li>
  
  <li>💳 <strong>Flexible payment plans</strong> — 3 to 6 monthly installments</li>
  <li>🕐 Sessions available <strong>7 days/week, 7 AM – 10 PM</strong></li>
  <li>💻 Online or in-person options available</li>
</ul>

<a href="mailto:${c.counselorEmail}?subject=Callback Request – ${l.fullName}" class="btn">Request a Callback</a>

<div class="sig">
  <strong>Regards,</strong><br><br>
  <strong>Test Prep Pundits Team</strong><br>
  📧 <strong><a href="mailto:Info@testpreppundits.com" style="color:inherit;text-decoration:none;">Info@testpreppundits.com</a></strong><br>
  🌐 <strong><a href="http://www.testpreppundits.com" style="color:inherit;text-decoration:none;">www.testpreppundits.com</a></strong>
</div>`;
  }

  _reminderBody(l, t) {
    const c = cfg.company;
    return `
<h2>See you tomorrow! ⏰</h2>
<p>Hi ${l.parentName || l.fullName}! This is a friendly reminder about <strong>${l.fullName}'s</strong> admissions consultation tomorrow.</p>

${this._meetingDetailsBox(t)}

<p>We're looking forward to discussing the best path for ${l.fullName}'s goals.</p>

<div class="sig">
  <strong>Regards,</strong><br><br>
  <strong>Test Prep Pundits Team</strong><br>
  📧 <strong><a href="mailto:Info@testpreppundits.com" style="color:inherit;text-decoration:none;">Info@testpreppundits.com</a></strong><br>
  🌐 <strong><a href="http://www.testpreppundits.com" style="color:inherit;text-decoration:none;">www.testpreppundits.com</a></strong>
</div>`;
  }

  _successStoriesBody(l) {
    const c = cfg.company;
    const site = c.website || 'https://Test Prep Pundits.com';

    // SAT Top 1% Scorers — exact names & scores from Test Prep Pundits.com
    const satScorers = [
      { name: 'Shiva Sai Teja Kalva',   score: 1590, school: 'Academy for Math, Science, and Engineering, Rockaway, NJ' },
      { name: 'Keshif Rahiman Shaik',   score: 1580, school: 'Sri Chaitanya Techno School Hyderabad, India' },
      { name: 'Arnav Kamineni',          score: 1570, school: 'Glastonbury High School Glastonbury, CT' },
      { name: 'Ananya Pantangi',         score: 1570, school: 'Argyle ISD Texas, Denton county' },
      { name: 'Sai Kosthala',            score: 1560, school: 'Carnigie Vanguard High School HISD, Texas' },
      { name: 'Sai Vignesh Vajinapelly', score: 1560, school: '' },
      { name: 'Manas Vadlamudi',         score: 1540, school: '' },
      { name: 'Farah Khaleel',           score: 1540, school: '' },
      { name: 'Avyay Chamunthala',       score: 1530, school: '' },
      { name: 'Kamal Deep Vasireddy',    score: 1530, school: '' },
      { name: 'Dhashana Sivaneson',      score: 1530, school: '' },
      { name: 'Krishna Gajjela',         score: 1510, school: '' },
      { name: 'Kunal Sharma',            score: 1510, school: '' },
    ];

    // Latest SAT Success Stories (banner)
    const latestSAT = [
      { name: 'Anish Miryala',   score: 1510, school: 'Crooms Academy of Information Technology, FL' },
      { name: 'Vishnu Venkatesh', score: 1480, school: 'John P. Stevens High School, Edison, NJ' },
    ];

    const actScorers = [
      { name: 'Akahara Balakrishnan', score: 36 },
      { name: 'Gauthamm Mandala',     score: 35 },
      { name: 'Farah Khaleel',        score: 35 },
      { name: 'Kamal Deep Vasireddy', score: 34 },
      { name: 'Avyay Chamunthala',    score: 34 },
      { name: 'Ansul',                score: 32 },
    ];

    const nationalMerit = ['Farah Khaleel', 'Gauthamm Mandala'];

    // ── Reusable avatar circle (email-safe) ──────────────────────────────
    const avatar = (name, size = 56, bg = '#1a3c6e', color = '#fff', border = 'none') => {
      const initials = name.split(' ').map(w => w[0]).slice(0, 2).join('');
      return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${bg};border:${border};margin:0 auto 6px;line-height:${size}px;text-align:center;font-size:${Math.round(size*0.3)}px;font-weight:800;color:${color};font-family:Arial,sans-serif">${initials}</div>`;
    };

    // SAT scorer grid: 5 per row
    const satGrid = (scorers) => {
      const rows = [];
      for (let i = 0; i < scorers.length; i += 5) {
        const chunk = scorers.slice(i, i + 5);
        rows.push(`<tr>${chunk.map(s => `
          <td class="scorer-td" style="text-align:center;padding:6px 4px;vertical-align:top;width:20%">
            ${avatar(s.name, 52, '#1a3c6e')}
            <div style="font-size:10px;font-weight:700;color:#1a3c6e;line-height:1.3;margin-bottom:2px">${s.name}</div>
            <div style="font-size:14px;font-weight:900;color:#ea580c">${s.score}</div>
          </td>`).join('')}</tr>`);
      }
      return rows.join('');
    };

    return `
<!-- ══ Header greeting ═══════════════════════════════════════════════════ -->
<h2 style="color:#1a3c6e;font-size:22px;font-weight:900;margin:0 0 6px">🏆 Real Students. Real Results.</h2>
<p style="color:#374151;font-size:15px;margin:0 0 20px">Hi ${l.parentName || l.fullName}! We wanted to share what Test Prep Pundits students have achieved — because these aren't just numbers, they're futures changed.</p>

<!-- ══ Latest SAT Stories banner ════════════════════════════════════════ -->
<table cellpadding="0" cellspacing="0" border="0" width="100%" class="ss-card" style="background:linear-gradient(135deg,#f97316 0%,#1a3c6e 100%);border-radius:14px;margin:0 0 16px">
  <tr><td style="padding:20px">
    <p style="color:#fff;font-size:15px;font-weight:800;text-align:center;margin:0 0 16px;letter-spacing:.3px">Our Latest SAT Success Stories</p>
    <table cellpadding="0" cellspacing="0" border="0" width="100%" class="m-stack"><tr>
      ${latestSAT.map(s => `
      <td class="m-stack" style="text-align:center;padding:0 8px 12px;width:50%;vertical-align:top">
        <div style="background:rgba(255,255,255,.15);border-radius:12px;padding:14px 10px">
          ${avatar(s.name, 64, 'rgba(255,255,255,.9)', '#1a3c6e', '3px solid #fff')}
          <p style="color:#fbbf24;font-size:13px;font-weight:800;margin:0 0 10px">${s.name}</p>
          <div style="background:#0d9488;color:#fff;font-size:13px;font-weight:900;padding:7px 14px;border-radius:8px;letter-spacing:.5px">SAT SCORE ${s.score}</div>
        </div>
      </td>`).join('')}
    </tr></table>
    <p style="color:rgba(255,255,255,.75);font-size:11px;text-align:center;margin:14px 0 0">Want to be our next SAT success story? 🌟</p>
  </td></tr>
</table>

<!-- ══ Top 1% SAT Scorers ════════════════════════════════════════════════ -->
<table cellpadding="0" cellspacing="0" border="0" width="100%" class="ss-card" style="background:#f0f6ff;border-radius:14px;margin:0 0 16px">
  <tr><td style="padding:18px">
    <p style="font-size:15px;font-weight:800;color:#1a3c6e;text-align:center;margin:0 0 14px">⭐ Our Top 1% SAT Scorers</p>
    <table cellpadding="0" cellspacing="0" border="0" width="100%">
      ${satGrid(satScorers)}
    </table>
  </td></tr>
</table>

<!-- ══ National Merit Finalists ══════════════════════════════════════════ -->
<table cellpadding="0" cellspacing="0" border="0" width="100%" class="ss-card" style="background:#fff7ed;border-radius:14px;margin:0 0 16px">
  <tr><td style="padding:18px">
    <p style="font-size:15px;font-weight:800;color:#1a3c6e;text-align:center;margin:0 0 14px">🎖️ National Merit Finalists</p>
    <table cellpadding="0" cellspacing="0" border="0" width="100%" class="m-stack"><tr>
      ${nationalMerit.map(name => `
      <td class="m-stack" style="text-align:center;padding:0 10px 10px;width:50%">
        ${avatar(name, 60, '#fff', '#1a3c6e', '3px solid #ea580c')}
        <div style="font-size:12px;font-weight:700;color:#1a3c6e">${name}</div>
      </td>`).join('')}
    </tr></table>
  </td></tr>
</table>

<!-- ══ ACT Top 1% ════════════════════════════════════════════════════════ -->
<table cellpadding="0" cellspacing="0" border="0" width="100%" class="ss-card" style="background:#f0f6ff;border-radius:14px;margin:0 0 16px">
  <tr><td style="padding:18px">
    <p style="font-size:15px;font-weight:800;color:#1a3c6e;text-align:center;margin:0 0 14px">🎯 ACT Top 1% Scorers</p>
    <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
      ${actScorers.map(s => `
      <td class="scorer-td" style="text-align:center;padding:6px 4px;vertical-align:top;width:16%">
        ${avatar(s.name, 48, '#1a3c6e')}
        <div style="font-size:10px;font-weight:700;color:#1a3c6e;margin-bottom:2px">${s.name.split(' ')[0]}</div>
        <div style="font-size:12px;font-weight:900;color:#ea580c">ACT ${s.score}</div>
      </td>`).join('')}
    </tr></table>
  </td></tr>
</table>

<!-- ══ Mission footer CTA ════════════════════════════════════════════════ -->
<table cellpadding="0" cellspacing="0" border="0" width="100%" class="ss-card" style="background:linear-gradient(135deg,#1a3c6e 0%,#2563eb 100%);border-radius:14px;margin:0 0 20px">
  <tr><td style="padding:24px;text-align:center">
    <p style="color:#fbbf24;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin:0 0 6px">🎓 Your Dream Score Is Our Mission</p>
    <p style="color:rgba(255,255,255,.85);font-size:13px;margin:0 0 16px;line-height:1.6">Join thousands of motivated students achieving their goals with the right guidance and strategy.</p>
    <a href="${site}" style="background:#ea580c;color:#fff;text-decoration:none;padding:12px 28px;border-radius:10px;font-weight:800;font-size:14px;display:inline-block;letter-spacing:.3px">Get Started Today →</a>
  </td></tr>
</table>

<div class="sig">
  <strong>Regards,</strong><br><br>
  <strong>Test Prep Pundits Team</strong><br>
  📧 <strong><a href="mailto:Info@testpreppundits.com" style="color:inherit;text-decoration:none;">Info@testpreppundits.com</a></strong><br>
  🌐 <strong><a href="http://www.testpreppundits.com" style="color:inherit;text-decoration:none;">www.testpreppundits.com</a></strong>
</div>`;
  }

  _parentDiscussionBody(l) {
    const c = cfg.company;
    return `
<h2>A Note for ${l.parentName || 'Parents'} 👨‍👩‍👧</h2>
<p>Hi ${l.parentName || l.fullName}! As a parent, you play the most important role in <strong>${l.fullName}'s</strong> academic journey — and we want to make sure you have everything you need to make the best decision.</p>

<div class="box">
  💬 <strong>Common questions from parents:</strong><br><br>
  ❓ <em>"How do I know this program will actually improve scores?"</em><br>
  
  ❓ <em>"My child already has a tutor — do they need this?"</em><br>
  → Our structured program complements existing tutors. Many of our top scorers used both.<br><br>
  ❓ <em>"Is the investment worth it?"</em><br>
  → A 150-point SAT improvement can mean <strong>$20,000–$100,000 more</strong> in scholarship eligibility.
</div>

<p>We'd love to answer your questions in a free, no-pressure 15-minute call — just you, ${l.fullName}, and our counselor.</p>

<a href="mailto:${c.counselorEmail}?subject=Parent Discussion – ${l.fullName}" class="btn">Schedule a Parent Discussion →</a>

<div class="sig">
  <strong>Regards,</strong><br><br>
  <strong>Test Prep Pundits Team</strong><br>
  📧 <strong><a href="mailto:Info@testpreppundits.com" style="color:inherit;text-decoration:none;">Info@testpreppundits.com</a></strong><br>
  🌐 <strong><a href="http://www.testpreppundits.com" style="color:inherit;text-decoration:none;">www.testpreppundits.com</a></strong>
</div>`;
  }

  _programBenefitsBody(l) {
    const c = cfg.company;
    const prog = (l.courseInterest || 'Test Prep');
    return `
<h2>Why ${l.fullName}'s ${prog} Program Works 📈</h2>
<p>Hi ${l.parentName || l.fullName}! We know you're evaluating your options — here's a clear breakdown of what makes Test Prep Pundits different.</p>

<div class="grid">
  
  <div class="cell"><div class="lbl">Class Size</div><div class="val">12–15 students (small group)</div></div>
  <div class="cell"><div class="lbl">Schedule</div><div class="val">7 days/week, 7 AM–10 PM</div></div>
  <div class="cell"><div class="lbl">Duration</div><div class="val">8–12 weeks</div></div>
</div>

<p><strong>What's included in every program:</strong></p>
<ul>
  <li>✅ Diagnostic assessment to identify ${l.fullName}'s exact weak areas</li>
  <li>✅ Personalized study plan updated weekly</li>
  <li>✅ Full-length practice tests with detailed score analytics</li>
  <li>✅ Expert video solutions for every missed question</li>
  <li>✅ Parent progress updates every 2 weeks</li>
  <li>✅ 1-Year digital license access — review anytime</li>
  <li>✅ Flexible payment plans (3–6 monthly installments)</li>
</ul>

<div class="box">
  🎯 <strong>Our promise:</strong> If ${l.fullName} follows the program, we guarantee measurable improvement — or we'll extend at no charge.
</div>

<a href="${c.website}" class="btn">See All Programs & Pricing →</a>

<div class="sig">
  <strong>Regards,</strong><br><br>
  <strong>Test Prep Pundits Team</strong><br>
  📧 <strong><a href="mailto:Info@testpreppundits.com" style="color:inherit;text-decoration:none;">Info@testpreppundits.com</a></strong><br>
  🌐 <strong><a href="http://www.testpreppundits.com" style="color:inherit;text-decoration:none;">www.testpreppundits.com</a></strong>
</div>`;
  }

  _limitedSeatBody(l) {
    const c = cfg.company;
    return `
<h2>⚠️ Limited Seats — Don't Miss ${l.fullName}'s Spot</h2>
<p>Hi ${l.parentName || l.fullName}! I wanted to send a quick heads-up: our upcoming ${l.courseInterest || 'test prep'} session is filling up fast — and we're keeping class sizes small by design (12–15 students max).</p>

<div class="box" style="background:#fff7ed;border-left:4px solid #ea580c">
  🔴 <strong>Current availability is limited.</strong><br>
  We cannot guarantee ${l.fullName}'s preferred time slot will still be open next week.<br>
  Students who secure their spot early also lock in <strong>current pricing</strong> before any increases.
</div>

<p>Here's what ${l.fullName} gets by enrolling today:</p>
<ul>
  <li>✅ Guaranteed spot in the next available session</li>
  <li>✅ Current pricing locked in — no future increases</li>
  <li>✅ Free 15-min kick-off consultation with your counselor</li>
  <li>✅ Payment plan options — as low as 3 monthly installments</li>
</ul>

<p>To confirm, simply reply to this email or give us a call. Takes less than 5 minutes.</p>

<a href="mailto:${c.counselorEmail}?subject=Reserve Spot – ${l.fullName}" class="btn">Reserve ${l.fullName}'s Spot →</a>

<div class="sig">
  <strong>Regards,</strong><br><br>
  <strong>Test Prep Pundits Team</strong><br>
  📧 <strong><a href="mailto:Info@testpreppundits.com" style="color:inherit;text-decoration:none;">Info@testpreppundits.com</a></strong><br>
  🌐 <strong><a href="http://www.testpreppundits.com" style="color:inherit;text-decoration:none;">www.testpreppundits.com</a></strong>
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
  <li>🆓 Free 10-minute kick-off consultation included</li>
</ul>

<p>To lock in ${l.fullName}'s spot at the current pricing, simply reply to this email or call us directly.</p>

<a href="mailto:${c.counselorEmail}?subject=Enrollment – ${l.fullName}" class="btn">Confirm Enrollment →</a>

<div class="sig">
  <strong>Regards,</strong><br><br>
  <strong>Test Prep Pundits Team</strong><br>
  📧 <strong><a href="mailto:Info@testpreppundits.com" style="color:inherit;text-decoration:none;">Info@testpreppundits.com</a></strong><br>
  🌐 <strong><a href="http://www.testpreppundits.com" style="color:inherit;text-decoration:none;">www.testpreppundits.com</a></strong>
</div>`;
  }

  _counselorReachOutBody(l) {
    const c = cfg.company;
    return `
<h2>Hi ${l.parentName || l.fullName}! I wanted to check in 👋</h2>
<p>Hi, this is Annie, from Test Prep Pundits. I've been following up because I genuinely believe ${l.fullName} has what it takes to hit an incredible score — and I don't want them to miss the window.</p>

<div class="box">
  📌 <strong>Where ${l.fullName} stands right now:</strong><br><br>
  Program of Interest: <strong>${l.courseInterest || 'Test Prep'}</strong><br>
  Grade: <strong>${l.grade || 'To confirm'}</strong><br><br>
  
</div>

<p>I know you're busy — so here are the three most common questions I get at this stage:</p>

<ul>
  <li>❓ <em>"When does the next session start?"</em> → We start new cohorts every 2–3 weeks. The next one is filling up.</li>
  <li>❓ <em>"Can we try before committing?"</em> → Yes! We offer a <strong>free 10-min consultation</strong> — zero obligation.</li>
  <li>❓ <em>"What if it doesn't work?"</em> → We extend the program at no charge if ${l.fullName} follows the plan and doesn't see improvement.</li>
</ul>

<p>I'd love to hop on a quick 15-minute call to answer any remaining questions. Just reply to this email or call me directly.</p>

<a href="mailto:${c.counselorEmail}?subject=Quick Question – ${l.fullName}" class="btn">Reply to Annie →</a>

<div class="sig">
  <strong>Regards,</strong><br><br>
  <strong>Test Prep Pundits Team</strong><br>
  📧 <strong><a href="mailto:Info@testpreppundits.com" style="color:inherit;text-decoration:none;">Info@testpreppundits.com</a></strong><br>
  🌐 <strong><a href="http://www.testpreppundits.com" style="color:inherit;text-decoration:none;">www.testpreppundits.com</a></strong>
</div>`;
  }

  _reEngagementBody(l) {
    const c = cfg.company;
    return `
<h2>We're still rooting for ${l.fullName}! 🎓</h2>
<p>Hi ${l.parentName || l.fullName}! It's been a little while since we last connected, and I just wanted you to know — we haven't forgotten about <strong>${l.fullName}</strong>, and we're still here whenever the timing feels right.</p>

<div class="box">
  💡 <strong>Did you know?</strong><br>
  Students who start ${l.courseInterest || 'test prep'} at least <strong>8–12 weeks before their exam date</strong> see the greatest score gains. If ${l.fullName} has an upcoming test date, now is a great time to get the plan in motion.
</div>

<p><strong>What's changed since we last spoke?</strong></p>
<ul>
  <li>✅ New cohorts starting — flexible Saturday/Sunday and weekday options</li>
  <li>✅ Payment plans now available from just 3 monthly installments</li>
  <li>✅ Recent student wins — see our latest success stories below</li>
</ul>

<p>No pressure, no commitment — just a quick reply or call to see where ${l.fullName} is in the journey. We're happy to answer any questions at all.</p>

<a href="mailto:${c.counselorEmail}?subject=Re: ${l.fullName} – Checking In" class="btn">Reconnect With Us →</a>

<div class="sig">
  <strong>Regards,</strong><br><br>
  <strong>Test Prep Pundits Team</strong><br>
  📧 <strong><a href="mailto:Info@testpreppundits.com" style="color:inherit;text-decoration:none;">Info@testpreppundits.com</a></strong><br>
  🌐 <strong><a href="http://www.testpreppundits.com" style="color:inherit;text-decoration:none;">www.testpreppundits.com</a></strong>
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
  <strong>Regards,</strong><br><br>
  <strong>Test Prep Pundits Team</strong><br>
  📧 <strong><a href="mailto:Info@testpreppundits.com" style="color:inherit;text-decoration:none;">Info@testpreppundits.com</a></strong><br>
  🌐 <strong><a href="http://www.testpreppundits.com" style="color:inherit;text-decoration:none;">www.testpreppundits.com</a></strong>
</div>`;
  }

  async sendAdminNotification(subject, content) {
    const adminEmail = cfg.adminEmail || 'Info@testpreppundits.com';
    return this._send({
      to: adminEmail,
      subject,
      html: `
        <div style="font-family:sans-serif;padding:20px;color:#333;">
          <h2 style="color:#ef4444;">Test Prep Pundits Notification</h2>
          <p>${content}</p>
          <hr style="border:none;border-top:1px solid #ddd;margin:20px 0;">
          <p style="font-size:12px;color:#888;">This is an automated message sent from your AI Admissions Agent Platform.</p>
        </div>
      `
    });
  }
}

module.exports = new EmailService();
