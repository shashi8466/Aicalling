require('dotenv').config();
const twilio = require('twilio');
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

async function run() {
  const callSid = 'CA138cf88fa3ed328a9396612f3e866356';
  console.log(`Fetching details for Call SID: ${callSid}`);
  try {
    const call = await client.calls(callSid).fetch();
    console.log(`Call Status: ${call.status}`);
    console.log(`Duration: ${call.duration}s`);
    console.log(`Price: ${call.price} ${call.priceUnit}`);
  } catch (e) {
    console.error(`Error fetching call: ${e.message}`);
  }

  console.log('\nFetching Twilio debugger alerts / notifications:');
  try {
    const notifications = await client.api.v2010.account.notifications.list({ limit: 10 });
    for (const n of notifications) {
      console.log(`\n- Date: ${n.messageDate}`);
      console.log(`  Log Level: ${n.log}`);
      console.log(`  Error Code: ${n.errorCode}`);
      console.log(`  More Info: ${n.moreInfo}`);
      console.log(`  Message Text: ${n.messageText}`);
      console.log(`  Request URL: ${n.requestUrl}`);
    }
  } catch (e) {
    console.error(`Error fetching notifications: ${e.message}`);
  }
}

run();
