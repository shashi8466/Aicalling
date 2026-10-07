/**
 * Phone number → E.164 + destination country.
 *
 * Used to rate Telnyx calls by destination. Country calling codes are matched
 * longest-prefix-first; +1 (NANP) numbers are split into US / Canada /
 * Caribbean territories by area code, since Telnyx prices them differently.
 */

// ITU country calling codes → [ISO alpha-2, name]. (+1 handled separately.)
const DIAL_CODES = {
  '7': ['RU', 'Russia'], '20': ['EG', 'Egypt'], '27': ['ZA', 'South Africa'],
  '30': ['GR', 'Greece'], '31': ['NL', 'Netherlands'], '32': ['BE', 'Belgium'],
  '33': ['FR', 'France'], '34': ['ES', 'Spain'], '36': ['HU', 'Hungary'],
  '39': ['IT', 'Italy'], '40': ['RO', 'Romania'], '41': ['CH', 'Switzerland'],
  '43': ['AT', 'Austria'], '44': ['GB', 'United Kingdom'], '45': ['DK', 'Denmark'],
  '46': ['SE', 'Sweden'], '47': ['NO', 'Norway'], '48': ['PL', 'Poland'],
  '49': ['DE', 'Germany'], '51': ['PE', 'Peru'], '52': ['MX', 'Mexico'],
  '53': ['CU', 'Cuba'], '54': ['AR', 'Argentina'], '55': ['BR', 'Brazil'],
  '56': ['CL', 'Chile'], '57': ['CO', 'Colombia'], '58': ['VE', 'Venezuela'],
  '60': ['MY', 'Malaysia'], '61': ['AU', 'Australia'], '62': ['ID', 'Indonesia'],
  '63': ['PH', 'Philippines'], '64': ['NZ', 'New Zealand'], '65': ['SG', 'Singapore'],
  '66': ['TH', 'Thailand'], '81': ['JP', 'Japan'], '82': ['KR', 'South Korea'],
  '84': ['VN', 'Vietnam'], '86': ['CN', 'China'], '90': ['TR', 'Turkey'],
  '91': ['IN', 'India'], '92': ['PK', 'Pakistan'], '93': ['AF', 'Afghanistan'],
  '94': ['LK', 'Sri Lanka'], '95': ['MM', 'Myanmar'], '98': ['IR', 'Iran'],
  '211': ['SS', 'South Sudan'], '212': ['MA', 'Morocco'], '213': ['DZ', 'Algeria'],
  '216': ['TN', 'Tunisia'], '218': ['LY', 'Libya'], '220': ['GM', 'Gambia'],
  '221': ['SN', 'Senegal'], '225': ['CI', "Côte d'Ivoire"], '233': ['GH', 'Ghana'],
  '234': ['NG', 'Nigeria'], '237': ['CM', 'Cameroon'], '249': ['SD', 'Sudan'],
  '251': ['ET', 'Ethiopia'], '254': ['KE', 'Kenya'], '255': ['TZ', 'Tanzania'],
  '256': ['UG', 'Uganda'], '260': ['ZM', 'Zambia'], '263': ['ZW', 'Zimbabwe'],
  '351': ['PT', 'Portugal'], '352': ['LU', 'Luxembourg'], '353': ['IE', 'Ireland'],
  '354': ['IS', 'Iceland'], '356': ['MT', 'Malta'], '357': ['CY', 'Cyprus'],
  '358': ['FI', 'Finland'], '359': ['BG', 'Bulgaria'], '370': ['LT', 'Lithuania'],
  '371': ['LV', 'Latvia'], '372': ['EE', 'Estonia'], '380': ['UA', 'Ukraine'],
  '381': ['RS', 'Serbia'], '385': ['HR', 'Croatia'], '386': ['SI', 'Slovenia'],
  '420': ['CZ', 'Czechia'], '421': ['SK', 'Slovakia'], '852': ['HK', 'Hong Kong'],
  '853': ['MO', 'Macau'], '855': ['KH', 'Cambodia'], '880': ['BD', 'Bangladesh'],
  '886': ['TW', 'Taiwan'], '960': ['MV', 'Maldives'], '961': ['LB', 'Lebanon'],
  '962': ['JO', 'Jordan'], '963': ['SY', 'Syria'], '964': ['IQ', 'Iraq'],
  '965': ['KW', 'Kuwait'], '966': ['SA', 'Saudi Arabia'], '967': ['YE', 'Yemen'],
  '968': ['OM', 'Oman'], '970': ['PS', 'Palestine'], '971': ['AE', 'United Arab Emirates'],
  '972': ['IL', 'Israel'], '973': ['BH', 'Bahrain'], '974': ['QA', 'Qatar'],
  '975': ['BT', 'Bhutan'], '976': ['MN', 'Mongolia'], '977': ['NP', 'Nepal'],
  '992': ['TJ', 'Tajikistan'], '993': ['TM', 'Turkmenistan'], '994': ['AZ', 'Azerbaijan'],
  '995': ['GE', 'Georgia'], '996': ['KG', 'Kyrgyzstan'], '998': ['UZ', 'Uzbekistan'],
};

const CANADA_AREA_CODES = new Set([
  '204', '226', '236', '249', '250', '257', '263', '289', '306', '343', '354', '365', '367',
  '368', '382', '387', '403', '416', '418', '428', '431', '437', '438', '450', '460', '468',
  '474', '506', '514', '519', '548', '579', '581', '584', '587', '600', '604', '613', '639',
  '647', '672', '683', '705', '709', '742', '753', '778', '780', '782', '807', '819', '825',
  '867', '873', '879', '902', '905',
]);

// Non-US/CA NANP territories (priced as international by most carriers).
const NANP_TERRITORIES = {
  '242': ['BS', 'Bahamas'], '246': ['BB', 'Barbados'], '264': ['AI', 'Anguilla'],
  '268': ['AG', 'Antigua and Barbuda'], '284': ['VG', 'British Virgin Islands'],
  '340': ['VI', 'US Virgin Islands'], '345': ['KY', 'Cayman Islands'], '441': ['BM', 'Bermuda'],
  '473': ['GD', 'Grenada'], '649': ['TC', 'Turks and Caicos'], '658': ['JM', 'Jamaica'],
  '664': ['MS', 'Montserrat'], '670': ['MP', 'Northern Mariana Islands'], '671': ['GU', 'Guam'],
  '684': ['AS', 'American Samoa'], '721': ['SX', 'Sint Maarten'], '758': ['LC', 'Saint Lucia'],
  '767': ['DM', 'Dominica'], '784': ['VC', 'Saint Vincent'], '787': ['PR', 'Puerto Rico'],
  '809': ['DO', 'Dominican Republic'], '829': ['DO', 'Dominican Republic'],
  '849': ['DO', 'Dominican Republic'], '868': ['TT', 'Trinidad and Tobago'],
  '869': ['KN', 'Saint Kitts and Nevis'], '876': ['JM', 'Jamaica'], '939': ['PR', 'Puerto Rico'],
};

const NAMES = { US: 'United States', CA: 'Canada' };
for (const [, [iso, name]] of Object.entries(DIAL_CODES)) NAMES[iso] = name;
for (const [, [iso, name]] of Object.entries(NANP_TERRITORIES)) NAMES[iso] = name;

/** Normalize to E.164 ('+<digits>'); 10-digit numbers are assumed NANP. */
function toE164(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  s = s.replace(/[^\d+]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (!s.startsWith('+')) {
    if (/^\d{10}$/.test(s)) s = '+1' + s;
    else if (/^1\d{10}$/.test(s)) s = '+' + s;
    else s = '+' + s;
  }
  return /^\+[1-9]\d{6,14}$/.test(s) ? s : '';
}

/** → { e164, dialCode, country (ISO2 or ''), countryName } */
function lookup(raw) {
  const e164 = toE164(raw);
  if (!e164) return { e164: '', dialCode: '', country: '', countryName: 'Unknown' };
  const digits = e164.slice(1);

  if (digits.startsWith('1')) {
    const area = digits.slice(1, 4);
    if (CANADA_AREA_CODES.has(area)) return { e164, dialCode: '1', country: 'CA', countryName: 'Canada' };
    if (NANP_TERRITORIES[area]) {
      const [iso, name] = NANP_TERRITORIES[area];
      return { e164, dialCode: '1' + area, country: iso, countryName: name };
    }
    return { e164, dialCode: '1', country: 'US', countryName: 'United States' };
  }

  for (let len = 3; len >= 1; len--) {
    const code = digits.slice(0, len);
    if (DIAL_CODES[code]) {
      const [iso, name] = DIAL_CODES[code];
      return { e164, dialCode: code, country: iso, countryName: name };
    }
  }
  return { e164, dialCode: '', country: '', countryName: 'Unknown' };
}

function countryName(iso) {
  return NAMES[String(iso || '').toUpperCase()] || iso || 'Unknown';
}

module.exports = { toE164, lookup, countryName };
