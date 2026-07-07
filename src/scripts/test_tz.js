const tzHelper = require('../utils/timezoneHelper');

const testCases = [
  { phone: '+918466924574', state: '', expectedCountry: 'India', expectedTz: 'Asia/Kolkata' },
  { phone: '+14155551234', state: 'California', expectedCountry: 'United States', expectedTz: 'America/Los_Angeles' },
  { phone: '12145551234', state: 'TX', expectedCountry: 'United States', expectedTz: 'America/Chicago' },
  { phone: '+19087749227', state: 'Florida', expectedCountry: 'United States', expectedTz: 'America/New_York' },
  { phone: '+16025551234', state: 'Arizona', expectedCountry: 'United States', expectedTz: 'America/Phoenix' },
  { phone: '+16025551234', state: '', expectedCountry: 'United States', expectedTz: 'America/New_York' }
];

console.log('Testing Time Zone Detection Helper:\n');
testCases.forEach((tc, i) => {
  const result = tzHelper.detectTimeZone(tc.phone, tc.state);
  const success = result.country === tc.expectedCountry && result.timeZone === tc.expectedTz;
  console.log(`Test Case ${i + 1}:`);
  console.log(`  Input: Phone=${tc.phone}, State=${tc.state}`);
  console.log(`  Output: Country=${result.country}, Code=${result.countryCode}, TimeZone=${result.timeZone}`);
  console.log(`  Result: ${success ? '✅ PASS' : '❌ FAIL'}\n`);
});
