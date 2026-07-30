require('dotenv').config();
const emailSvc = require('./src/services/emailService');

const dummyLead = {
  _id: 'test_lead_id',
  fullName: 'Test Student',
  parentName: 'Test Parent',
  email: 'test@example.com'
};

async function run() {
  console.log('Sending test welcome email...');
  const result = await emailSvc.sendNewLeadWelcome(dummyLead);
  console.log('Result:', result);
}

run().catch(console.error);
