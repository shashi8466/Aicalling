/**
 * Helper to detect lead's timezone, country, and country code.
 */

// Mapping of USA states/abbreviations to time zones
const US_STATE_TIMEZONES = {
  // California -> Pacific
  'california': 'America/Los_Angeles',
  'ca': 'America/Los_Angeles',
  
  // Texas -> Central
  'texas': 'America/Chicago',
  'tx': 'America/Chicago',
  
  // Florida -> Eastern
  'florida': 'America/New_York',
  'fl': 'America/New_York',
  
  // Arizona -> Mountain (Phoenix does not observe DST, standard for AZ)
  'arizona': 'America/Phoenix',
  'az': 'America/Phoenix'
};

/**
 * Normalizes phone number to extract country code.
 * Supported: +1 (USA/Canada), +91 (India)
 */
function detectCountry(phone) {
  if (!phone) return { countryCode: '', country: '', timeZone: 'America/New_York' };
  
  // Remove all non-digit characters except leading plus
  const cleanPhone = phone.trim().replace(/[^\d+]/g, '');
  
  if (cleanPhone.startsWith('+91') || cleanPhone.startsWith('91') && cleanPhone.length > 10) {
    return {
      countryCode: '+91',
      country: 'India',
      timeZone: 'Asia/Kolkata'
    };
  }
  
  if (cleanPhone.startsWith('+1') || cleanPhone.startsWith('1') && cleanPhone.length > 10) {
    return {
      countryCode: '+1',
      country: 'United States',
      timeZone: 'America/New_York' // Default to Eastern Time
    };
  }

  // Generic fallback if not matched
  return {
    countryCode: cleanPhone.startsWith('+') ? cleanPhone.slice(0, 3) : '',
    country: 'Other',
    timeZone: 'America/New_York'
  };
}

/**
 * Resolves the timezone based on phone and state.
 */
function detectTimeZone(phone, state) {
  const countryInfo = detectCountry(phone);
  
  if (countryInfo.country === 'United States' && state) {
    const cleanState = state.trim().toLowerCase();
    if (US_STATE_TIMEZONES[cleanState]) {
      countryInfo.timeZone = US_STATE_TIMEZONES[cleanState];
    }
  }
  
  return countryInfo;
}

module.exports = {
  detectCountry,
  detectTimeZone
};
