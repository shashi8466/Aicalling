require('dotenv').config();
const meetingService = require('../services/meetingService');
const Lead = require('../models/Lead');

async function run() {
  console.log('Testing Meeting Booking & Reminder Automation Flow...\n');

  // 1. Fetch or create a test lead
  let lead = await Lead.findOne({ email: 'test_meeting@gmail.com' });
  if (!lead) {
    lead = await Lead.create({
      fullName: 'Test Student',
      email: 'test_meeting@gmail.com',
      phone: '+15551234567',
      status: 'new'
    });
    console.log(`Created new test lead: ${lead.fullName}`);
  }

  // 2. Mock meeting data
  const mockMeeting = {
    googleEventId: 'mock-event-123',
    meetLink: 'https://meet.livekit.io/rooms/test-room',
    hostMeetLink: 'https://meet.livekit.io/rooms/test-room-host',
    roomName: 'test-room',
    scheduledAt: new Date(Date.now() + 2 * 24 * 3600 * 1000) // 2 days in future
  };

  console.log(`Scheduling mock meeting for: ${mockMeeting.scheduledAt.toISOString()}`);

  // 3. Trigger meeting service
  await meetingService.createMeetingAndReminders(lead, mockMeeting);

  // 4. Verify DB changes
  const updatedLead = await Lead.findById(lead._id);
  console.log('\nVerification details:');
  console.log(`  Lead Status: ${updatedLead.status} (Expected: meeting-scheduled)`);
  console.log(`  Meeting Status field: ${updatedLead.meetingStatus} (Expected: Booked)`);
  console.log(`  Qualified flag: ${updatedLead.isQualified} (Expected: true)`);
  console.log(`  Meeting link saved: ${updatedLead.meeting.meetLink}`);
  console.log(`  CRM notes timeline updated: ${updatedLead.notes.includes('Meeting scheduled') ? 'Yes ✅' : 'No ❌'}`);

  console.log('\nMeeting Booking automation flow completed successfully!');
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
