const supabase = require('../db/supabase');
const logger = require('../logger');
const moment = require('moment-timezone');

class MeetingService {
  /**
   * Creates a meeting record in PostgreSQL, schedules reminder automations,
   * updates the lead status, meetingStatus, qualified, CRM timeline/notes,
   * and saves the meeting data directly to the lead.
   */
  async createMeetingAndReminders(lead, meetingData) {
    try {
      const scheduledAt = new Date(meetingData.scheduledAt);
      const est = moment(scheduledAt).tz('America/New_York');

      // 1. Create meeting record in meetings table
      const { data: meeting, error: mErr } = await supabase
        .from('meetings')
        .insert({
          lead_id: lead._id,
          campaign_id: lead.campaignId || null,
          scheduled_at: scheduledAt.toISOString(),
          date: est.format('YYYY-MM-DD'),
          time: est.format('h:mm A z'),
          timezone: lead.timeZone || 'America/New_York',
          room_name: meetingData.roomName || 'Consultation',
          meet_link: meetingData.meetLink || '',
          status: 'Scheduled'
        })
        .select()
        .single();

      if (mErr) {
        logger.error('Failed to insert meeting record in PostgreSQL', mErr);
      } else {
        logger.info(`✅ Meeting record created in database, ID=${meeting.id}`);

        // 2. Schedule reminder automations (24h, 1h, 10m before meeting)
        const scheduledTime = scheduledAt.getTime();
        const reminders = [
          { type: '24h', offset: 24 * 3600 * 1000 },
          { type: '1h', offset: 3600 * 1000 },
          { type: '10m', offset: 10 * 60 * 1000 },
        ];

        for (const r of reminders) {
          const reminderTime = new Date(scheduledTime - r.offset);
          if (reminderTime > new Date()) {
            const { error: rErr } = await supabase
              .from('meeting_reminders')
              .insert({
                meeting_id: meeting.id,
                lead_id: lead._id,
                reminder_type: r.type,
                scheduled_at: reminderTime.toISOString(),
                sent: false
              });
            if (rErr) {
              logger.error(`Failed to schedule ${r.type} reminder`, rErr);
            } else {
              logger.info(`Scheduled ${r.type} reminder at ${reminderTime.toISOString()}`);
            }
          }
        }
      }

      // 3. Update the CRM timeline/notes
      const timelineEntry = `\n[Timeline - ${new Date().toLocaleString()}] Meeting scheduled for ${est.format('MMMM Do [at] h:mm A z')}. format: Phone Call. Link: ${meetingData.meetLink || ''}`;
      lead.notes = (lead.notes || '') + timelineEntry;

      // 4. Update Lead fields
      lead.meeting = {
        googleEventId: meetingData.googleEventId || null,
        meetLink:      meetingData.meetLink || '',
        hostMeetLink:  meetingData.hostMeetLink || '',
        roomName:      meetingData.roomName || 'Consultation',
        scheduledAt:   scheduledAt,
        status:        'scheduled',
      };
      lead.status = 'meeting-scheduled';
      lead.meetingStatus = 'Booked';
      lead.isQualified = true;
      await lead.save();

      logger.info(`Lead ${lead.fullName} successfully updated with meeting status`);
    } catch (err) {
      logger.error('Error in createMeetingAndReminders', { msg: err.message });
    }
  }
}

module.exports = new MeetingService();
