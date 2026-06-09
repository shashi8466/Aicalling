/**
 * Google Calendar Service
 * – Find available slots
 * – Book consultation meeting + Google Meet link
 * Uses the same Service Account as Sheets.
 */
const { google }  = require('googleapis');
const moment      = require('moment-timezone');
const cfg         = require('../config');
const logger      = require('../logger');

const TZ            = 'America/New_York';
const SLOT_MINS     = 60;
const BIZ_START     = 9;    // 9 AM
const BIZ_END       = 20;   // 8 PM
const DAYS_AHEAD    = 7;

class CalendarService {
  constructor() {
    const auth = new google.auth.JWT({
      email:  cfg.google.clientEmail,
      key:    cfg.google.privateKey,
      scopes: [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events',
      ],
    });
    this.cal        = google.calendar({ version: 'v3', auth });
    this.calendarId = cfg.google.calendarId;
  }

  /** Returns up to `count` available 1-hour slots in the next DAYS_AHEAD days */
  async getAvailableSlots(count = 3) {
    try {
      const now  = moment().tz(TZ).add(90, 'minutes'); // earliest = 90 min from now
      const end  = moment().tz(TZ).add(DAYS_AHEAD, 'days');

      const busy = await this._getBusy(now, end);
      const slots = [];
      let cur = now.clone().startOf('hour').add(1, 'hour');

      while (slots.length < count && cur.isBefore(end)) {
        const dow  = cur.day();          // 0=Sun … 6=Sat
        const hour = cur.hour();

        if (dow !== 0 && hour >= BIZ_START && hour < BIZ_END) {
          const slotEnd = cur.clone().add(SLOT_MINS, 'minutes');
          const free    = !busy.some(b =>
            moment(b.start).isBefore(slotEnd) && moment(b.end).isAfter(cur)
          );
          if (free) {
            slots.push({
              start:       cur.toISOString(),
              end:         slotEnd.toISOString(),
              displayTime: cur.format('dddd, MMMM Do [at] h:mm A') + ' ET',
            });
          }
        }
        cur.add(1, 'hour');
      }
      return slots;
    } catch (err) {
      logger.error('Calendar.getAvailableSlots error', { msg: err.message });
      return [];
    }
  }

  /** Book a meeting and return event details incl. Google Meet link */
  async bookMeeting(lead, slot) {
    const attendees = [{ email: lead.email }];
    if (lead.parentEmail) attendees.push({ email: lead.parentEmail });
    if (cfg.company.counselorEmail) attendees.push({ email: cfg.company.counselorEmail });

    try {
      const event = await this.cal.events.insert({
        calendarId:           this.calendarId,
        conferenceDataVersion: 1,
        sendUpdates:          'all',
        requestBody: {
          summary:     `Admissions Consultation – ${lead.fullName} (${lead.courseInterest || 'Test Prep'})`,
          description: this._description(lead),
          start:       { dateTime: slot.start, timeZone: TZ },
          end:         { dateTime: slot.end,   timeZone: TZ },
          attendees,
          conferenceData: {
            createRequest: {
              requestId:             `tpp-${lead._id}-${Date.now()}`,
              conferenceSolutionKey: { type: 'hangoutsMeet' },
            },
          },
          reminders: {
            useDefault: false,
            overrides: [
              { method: 'email', minutes: 1440 },
              { method: 'email', minutes: 60 },
              { method: 'popup', minutes: 15 },
            ],
          },
        },
      });

      const meetLink = event.data.conferenceData
        ?.entryPoints
        ?.find(e => e.entryPointType === 'video')
        ?.uri;

      return {
        googleEventId: event.data.id,
        meetLink:      meetLink || '',
        scheduledAt:   new Date(slot.start),
      };
    } catch (err) {
      logger.error('Calendar.bookMeeting error', { msg: err.message });
      throw err;
    }
  }

  async _getBusy(from, to) {
    const res = await this.cal.freebusy.query({
      requestBody: {
        timeMin:  from.toISOString(),
        timeMax:  to.toISOString(),
        timeZone: TZ,
        items:    [{ id: this.calendarId }],
      },
    });
    return res.data.calendars[this.calendarId]?.busy || [];
  }

  _description(lead) {
    const q = lead.qualification || {};
    return [
      `📚 Test Prep Pundits – Admissions Consultation`,
      ``,
      `Student : ${lead.fullName}  |  Grade: ${lead.grade || 'N/A'}`,
      `Program : ${lead.courseInterest || 'N/A'}`,
      `Parent  : ${lead.parentName || 'N/A'}`,
      ``,
      `Current Score : ${q.currentScore || 'not provided'}`,
      `Target Score  : ${q.targetScore  || 'not provided'}`,
      `Exam Date     : ${q.targetExamDate || 'not provided'}`,
      `Format Pref   : ${q.preferredFormat || 'not provided'}`,
      `Lead Score    : ${lead.leadScore}/100 (${lead.leadCategory?.toUpperCase()})`,
      ``,
      `Booked by Shashi Kumar, AI Admissions Counselor.`,
    ].join('\n');
  }
}

module.exports = new CalendarService();
