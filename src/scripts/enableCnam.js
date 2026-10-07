/**
 * Enable outbound caller ID name (CNAM listing) on the Telnyx number.
 *
 * Usage:  node src/scripts/enableCnam.js ["CALLER NAME"]
 *
 * Only works for US local numbers — toll-free (8xx) numbers cannot carry CNAM.
 * Name: max 15 characters, letters/numbers/spaces. Takes 2–7 days to propagate.
 */
require('dotenv').config();
const axios = require('axios');

const API_KEY = process.env.TELNYX_API_KEY;
const NUMBER  = process.env.TELNYX_PHONE_NUMBER;
const NAME    = (process.argv[2] || process.env.TELNYX_CNAM_NAME || 'TESTPREPPUNDITS').toUpperCase();

const TOLL_FREE = /^\+1(800|833|844|855|866|877|888)/;

(async () => {
  if (!API_KEY || !NUMBER) throw new Error('TELNYX_API_KEY and TELNYX_PHONE_NUMBER must be set');
  if (TOLL_FREE.test(NUMBER)) {
    throw new Error(`${NUMBER} is toll-free — CNAM is not supported. Buy a US local number and set TELNYX_PHONE_NUMBER to it.`);
  }
  if (NAME.length > 15 || !/^[A-Z0-9 ]+$/.test(NAME)) {
    throw new Error(`"${NAME}" is invalid — use max 15 letters/numbers/spaces`);
  }

  const http = axios.create({
    baseURL: 'https://api.telnyx.com/v2',
    headers: { Authorization: `Bearer ${API_KEY}` }
  });

  const list = await http.get('/phone_numbers', { params: { 'filter[phone_number]': NUMBER } });
  const num = list.data?.data?.[0];
  if (!num) throw new Error(`${NUMBER} not found in this Telnyx account`);

  await http.patch(`/phone_numbers/${num.id}/voice`, {
    cnam_listing: { cnam_listing_enabled: true, cnam_listing_details: NAME }
  });

  console.log(`CNAM listing enabled on ${NUMBER} → "${NAME}"`);
  console.log('Allow 2–7 days for US carriers to start displaying it.');
})().catch(err => {
  console.error('Failed:', err.response?.data?.errors || err.message);
  process.exit(1);
});
