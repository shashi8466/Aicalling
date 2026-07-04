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
const livekitSvc  = require('./livekitService');

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

  /**
   * Returns dynamic 4 available slots based on current call time:
   *   - Up to 2 slots TODAY (later than current time + 90 min, within business hours)
   *   - Remaining slots from TOMORROW (and beyond if needed)
   *
   * E.g. if call is at 10:00 AM:
   *   Option 1: Today at 12:00 PM
   *   Option 2: Today at 2:00 PM
   *   Option 3: Tomorrow at 10:00 AM
   *   Option 4: Tomorrow at 12:00 PM
   */
  async getAvailableSlots(count = 4) {
    try {
      const now  = moment().tz(TZ);
      const end  = moment().tz(TZ).add(DAYS_AHEAD, 'days');
      const busy = await this._getBusy(now, end);

      // ── Step 1: TODAY slots (max 2) ──────────────────────────────────
      const todaySlots = this._collectSlots({
        start:    now.clone().add(90, 'minutes').startOf('hour').add(1, 'hour'),
        endDay:   now.clone().endOf('day'),
        busy,
        max:      2,
        stepMins: 120,            // 2-hour gaps within today (12, 2, 4, etc.)
        formatToday: true,
      });

      // ── Step 2: TOMORROW slots to fill the rest ──────────────────────
      const tomorrowStart = now.clone().add(1, 'day').hour(BIZ_START).minute(0).second(0);
      const restSlots = this._collectSlots({
        start:    tomorrowStart,
        endDay:   end,
        busy,
        max:      count - todaySlots.length,
        stepMins: 120,
        formatToday: false,
      });

      return [...todaySlots, ...restSlots].slice(0, count);
    } catch (err) {
      logger.error('Calendar.getAvailableSlots error', { msg: err.message });
      return [];
    }
  }

  /** Internal slot collector */
  _collectSlots({ start, endDay, busy, max, stepMins, formatToday }) {
    const slots = [];
    let cur = start.clone();
    const now = moment().tz(TZ);
    const today = now.clone().startOf('day');

    while (slots.length < max && cur.isBefore(endDay)) {
      const dow  = cur.day();   // 0=Sun
      const hour = cur.hour();
      if (dow !== 0 && hour >= BIZ_START && hour < BIZ_END) {
        const slotEnd = cur.clone().add(SLOT_MINS, 'minutes');
        const free    = !busy.some(b =>
          moment(b.start).isBefore(slotEnd) && moment(b.end).isAfter(cur)
        );
        if (free) {
          const isToday    = cur.clone().startOf('day').isSame(today);
          const isTomorrow = cur.clone().startOf('day').isSame(today.clone().add(1, 'day'));
          let label;
          if (isToday)         label = `Today at ${cur.format('h:mm A')}`;
          else if (isTomorrow) label = `Tomorrow at ${cur.format('h:mm A')}`;
          else                 label = cur.format('dddd, MMMM Do [at] h:mm A');

          slots.push({
            start:       cur.toISOString(),
            end:         slotEnd.toISOString(),
            displayTime: label + ' ET',
            dateOnly:    cur.format('YYYY-MM-DD'),
            timeOnly:    cur.format('h:mm A') + ' ET',
          });
        }
      }
      cur.add(stepMins, 'minutes');
    }
    return slots;
  }

  async bookMeeting(lead, slot) {
    // Generate LiveKit room name + meeting URLs
    const roomName    = livekitSvc.generateRoomName(lead);
    const meetLink    = livekitSvc.generateMeetingUrl(roomName);   // guest URL
    const hostMeetLink = `${meetLink}?host=true`;                  // counselor URL

    const inviteeList = [lead.email];
    if (lead.parentEmail)            inviteeList.push(lead.parentEmail);
    if (cfg.company.counselorEmail)  inviteeList.push(cfg.company.counselorEmail);

    const baseBody = {
      summary:     `Admissions Consultation – ${lead.fullName} (${lead.courseInterest || 'Test Prep'})`,
      description: this._description(lead, meetLink) + `\n\nInvitees:\n${inviteeList.map(e => `  • ${e}`).join('\n')}`,
      location:    meetLink,
      start:       { dateTime: slot.start, timeZone: TZ },
      end:         { dateTime: slot.end,   timeZone: TZ },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 60 },
          { method: 'popup', minutes: 15 },
        ],
      },
    };

    // Order of calendars to try
    const calendarIds = [];
    if (this.calendarId && this.calendarId !== 'primary') calendarIds.push(this.calendarId);
    calendarIds.push('primary');

    let lastErr = null;
    for (const calId of calendarIds) {
      try {
        const event = await this.cal.events.insert({
          calendarId:  calId,
          requestBody: baseBody,
        });
        logger.info(`Meeting booked on "${calId}" | LiveKit room: ${roomName}`);
        return {
          googleEventId: event.data.id,
          meetLink,
          hostMeetLink,
          roomName,
          calendarUsed: calId,
          scheduledAt:  new Date(slot.start),
        };
      } catch (err) {
        lastErr = err;
        logger.warn(`bookMeeting on "${calId}" failed: ${err.message}`);
      }
    }

    logger.error('Calendar.bookMeeting — all calendar attempts failed', { msg: lastErr?.message });
    throw new Error(`Calendar booking failed: ${lastErr?.message || 'unknown error'}`);
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

  _description(lead, meetLink) {
    const q = lead.qualification || {};
    return [
      `📚 Aiprep365 – Admissions Consultation`,
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
      `🎥 Video Meeting Link: ${meetLink}`,
      `   (No login required — just enter your name and join)`,
      ``,
      `Booked by Shashi Kumar, AI Admissions Counselor.`,
    ].join('\n');
  }
}

module.exports = new CalendarService();
