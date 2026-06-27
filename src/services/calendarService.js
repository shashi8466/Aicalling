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

  /** Book a meeting and return event details incl. Google Meet link.
   *  Resilient strategy:
   *   1. Try configured calendar with Google Meet
   *   2. If calendar unreachable → fallback to 'primary'
   *   3. If Meet conference creation fails → retry event without Meet (just calendar event)
   *   4. Always return SOMETHING so the call doesn't error out — even a basic event is success
   */
  async bookMeeting(lead, slot) {
    const inviteeList = [lead.email];
    if (lead.parentEmail)                       inviteeList.push(lead.parentEmail);
    if (cfg.company.counselorEmail)             inviteeList.push(cfg.company.counselorEmail);

    const baseBody = {
      summary:     `Admissions Consultation – ${lead.fullName} (${lead.courseInterest || 'Test Prep'})`,
      description: this._description(lead) + `\n\nInvitees to add manually:\n${inviteeList.map(e => `  • ${e}`).join('\n')}`,
      start:       { dateTime: slot.start, timeZone: TZ },
      end:         { dateTime: slot.end,   timeZone: TZ },
      reminders:   {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 60 },
          { method: 'popup', minutes: 15 },
        ],
      },
    };

    const meetBody = {
      ...baseBody,
      conferenceData: {
        createRequest: {
          requestId:             `tpp-${lead._id}-${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    };

    // Order of calendars to try
    const calendarIds = [];
    if (this.calendarId && this.calendarId !== 'primary') calendarIds.push(this.calendarId);
    calendarIds.push('primary');                       // service account's own — always works

    let lastErr = null;
    for (const calId of calendarIds) {
      // Try WITH Google Meet first
      try {
        const event = await this.cal.events.insert({
          calendarId:           calId,
          conferenceDataVersion: 1,
          requestBody:          meetBody,
        });
        const meetLink = event.data.conferenceData?.entryPoints?.find(e => e.entryPointType === 'video')?.uri;
        logger.info(`Meeting booked on calendar "${calId}" with Meet link: ${meetLink || '(none)'}`);
        return {
          googleEventId: event.data.id,
          meetLink:      meetLink || '',
          calendarUsed:  calId,
          scheduledAt:   new Date(slot.start),
        };
      } catch (err) {
        lastErr = err;
        const msg = err.message || 'unknown';
        logger.warn(`bookMeeting with Meet on "${calId}" failed: ${msg}`);

        // If the problem is Meet conferencing specifically, retry without it
        // and use Jitsi Meet (free, no signup) instead
        if (msg.toLowerCase().includes('conference') || msg.toLowerCase().includes('hangout')) {
          try {
            // Generate a unique Jitsi room name
            const jitsiRoom = `Aiprep365-${lead.fullName.replace(/\s+/g,'')}-${Date.now().toString(36)}`;
            const jitsiUrl  = `https://meet.jit.si/${jitsiRoom}`;

            const bodyWithJitsi = {
              ...baseBody,
              description: baseBody.description + `\n\n🎥 Video Meeting Link:\n${jitsiUrl}\n\n(Opens in any browser — no signup needed)`,
              location:    jitsiUrl,
            };

            const event = await this.cal.events.insert({
              calendarId:  calId,
              requestBody: bodyWithJitsi,
            });
            logger.info(`Meeting booked on "${calId}" with Jitsi: ${jitsiUrl}`);
            return {
              googleEventId: event.data.id,
              meetLink:      jitsiUrl,
              calendarUsed:  calId,
              scheduledAt:   new Date(slot.start),
            };
          } catch (err2) {
            lastErr = err2;
            logger.warn(`bookMeeting fallback on "${calId}" also failed: ${err2.message}`);
          }
        }
        // try next calendar in the list
      }
    }

    logger.error('Calendar.bookMeeting — all attempts failed', { msg: lastErr?.message });
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

  _description(lead) {
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
      `Booked by Shashi Kumar, AI Admissions Counselor.`,
    ].join('\n');
  }
}

module.exports = new CalendarService();
