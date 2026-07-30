require('dotenv').config();
const emailSvc = require('./src/services/emailService');

const dummyLead = {
  _id: 'test_lead_id',
  fullName: 'Test Student',
  parentName: 'Test Parent',
  email: 'test@example.com',
  meeting: {
    scheduledAt: new Date().toISOString(),
    meetLink: 'https://meet.google.com/test-link'
  }
};

async function run() {
  console.log('Sending test confirmation email...');
  const result = await emailSvc.sendMeetingConfirmation(dummyLead);
  console.log('Result:', result);
}

run().catch(console.error);
