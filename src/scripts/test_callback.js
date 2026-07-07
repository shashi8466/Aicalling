require('dotenv').config();
const poller = require('../jobs/emailCallbackPoller');

const testEmails = [
  {
    subject: 'Callback Request',
    body: 'Call me at 5pm cst. Regards, Rafeeq.',
    fromEmail: 'anwar@testpreppundits.com',
    fromName: 'rafeeq anwar mohammad'
  },
  {
    subject: 'Please Call Back',
    body: 'Can we chat at 10:30 am ist? Phone: +91 84669 24574',
    fromEmail: 'shiva@gmail.com',
    fromName: 'shiva'
  },
  {
    subject: 'Schedule call',
    body: 'Please call me at 11:00 pm est. Thank you.',
    fromEmail: 'kumar@gmail.com',
    fromName: 'kumar'
  }
];

console.log('Testing Email Parser & Timezone Resolver:\n');

testEmails.forEach((email, i) => {
  const result = poller.parseCallbackEmail(email.subject, email.body, email.fromEmail, email.fromName);
  console.log(`Test Case ${i + 1}:`);
  console.log(`  From: ${result.studentName} <${result.email}>`);
  console.log(`  Phone: ${result.phone || 'None'}`);
  console.log(`  Requested time text: ${result.requestedTime}`);
  console.log(`  Explicit Time Zone: ${result.explicitTimezone || 'None'}`);
  console.log(`--------------------------------------------------\n`);
});
