/**
 * Meeting Reminder Poller Job
 * Polls the meeting_reminders table to send reminders at the scheduled times.
 */
const supabase = require('../db/supabase');
const Lead = require('../models/Lead');
const emailSvc = require('../services/emailService');
const logger = require('../logger');

async function checkAndSendReminders() {
  try {
    const now = new Date().toISOString();

    // Query due and unsent reminders
    const { data: reminders, error } = await supabase
      .from('meeting_reminders')
      .select('*')
      .eq('sent', false)
      .lte('scheduled_at', now)
      .limit(100);

    if (error) {
      logger.error('Error fetching due meeting reminders', error);
      return;
    }

    if (!reminders || reminders.length === 0) return;

    logger.info(`meetingReminderPoller: Processing ${reminders.length} due reminders.`);

    for (const r of reminders) {
      try {
        const lead = await Lead.findById(r.lead_id);
        if (!lead || lead.status !== 'meeting-scheduled') {
          // If lead no longer exists or meeting has been cancelled/rescheduled, mark as sent/cancelled
          await supabase
            .from('meeting_reminders')
            .update({ sent: true })
            .eq('id', r.id);
          continue;
        }

        logger.info(`Sending ${r.reminder_type} meeting reminder email to ${lead.fullName}`);
        const result = await emailSvc.sendMeetingReminder(lead, r.reminder_type);

        if (result.ok) {
          await supabase
            .from('meeting_reminders')
            .update({ sent: true, updated_at: new Date().toISOString() })
            .eq('id', r.id);
        } else {
          logger.error(`Failed to send ${r.reminder_type} reminder for ${lead.fullName}: ${result.error}`);
        }
      } catch (err) {
        logger.error(`Error processing reminder ${r.id}`, err);
      }
    }
  } catch (err) {
    logger.error('Error in checkAndSendReminders lifecycle', err);
  }
}

function start() {
  // Check every 1 minute
  setInterval(checkAndSendReminders, 60_000);
  logger.info('Meeting Reminder Poller job started');
}

module.exports = {
  start,
  checkAndSendReminders
};
