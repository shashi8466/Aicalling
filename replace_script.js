const fs = require('fs');

const files = [
  'src/campaigns/registry.js',
  'src/services/aiService.js',
  'src/services/twilioService.js',
  'src/routes/webhook.js',
  'src/services/emailService.js',
  'src/services/calendarService.js',
  'dashboard/index.html',
  'dashboard/home.html',
  'dashboard/meeting.html',
  'start.js',
  'src/config.js',
  'test_js.js',
  'temp_7.js'
];

// Replace all signature variations in emailService.js
let emailFile = 'src/services/emailService.js';
if (fs.existsSync(emailFile)) {
  let content = fs.readFileSync(emailFile, 'utf-8');
  
  // Replace logos/new/logo.png with logos/logo1.png
  content = content.replace(/logos\/new\/logo\.png/g, 'logos/logo1.png');

  // Regex to match the signature block
  content = content.replace(/<div class="sig">[\s\S]*?<\/div>/g, 
`<div class="sig">
  <strong>Regards,</strong><br><br>
  <strong>Test Prep Pundits Team</strong><br>
  📧 <strong><a href="mailto:Info@testpreppundits.com" style="color:inherit;text-decoration:none;">Info@testpreppundits.com</a></strong><br>
  🌐 <strong><a href="http://www.testpreppundits.com" style="color:inherit;text-decoration:none;">www.testpreppundits.com</a></strong>
</div>`);

  // In case some were plain text:
  content = content.replace(/Best regards,\\nThe Admissions Team/g, 
`Regards,\\n\\nTest Prep Pundits Team\\n📧 Info@testpreppundits.com\\n🌐 www.testpreppundits.com`);

  fs.writeFileSync(emailFile, content, 'utf-8');
  console.log('Updated signatures and logo in emailService.js');
}

// Global Email Replacements
for (const file of files) {
  if (!fs.existsSync(file)) continue;
  let content = fs.readFileSync(file, 'utf-8');
  let original = content;

  // Replace emails
  content = content.replace(/admin@aiprep365\.com/gi, 'Info@testpreppundits.com');
  content = content.replace(/admin@testpreppundits\.com/gi, 'Info@testpreppundits.com');
  content = content.replace(/admissions@testpreppundits\.com/gi, 'Info@testpreppundits.com');
  content = content.replace(/admissions@aiprep365\.com/gi, 'Info@testpreppundits.com');
  content = content.replace(/partner@aiprep365\.com/gi, 'Info@testpreppundits.com');
  content = content.replace(/partner@testpreppundits\.com/gi, 'Info@testpreppundits.com');
  content = content.replace(/Info@testpreppundits\.com/gi, 'Info@testpreppundits.com'); // normalize case

  if (content !== original) {
    fs.writeFileSync(file, content, 'utf-8');
    console.log('Updated emails in', file);
  }
}
