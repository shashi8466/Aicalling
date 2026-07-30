const fs = require('fs');

let emailFile = 'src/services/emailService.js';
if (fs.existsSync(emailFile)) {
  let content = fs.readFileSync(emailFile, 'utf-8');
  
  // 1. Replace the footer
  content = content.replace(/<div class="ftr">[\s\S]*?<\/div>/g, 
`<div class="ftr">
    <strong>Need Assistance?</strong><br>
    📧 <a href="mailto:Info@testpreppundits.com" style="color:inherit;text-decoration:none;">Info@testpreppundits.com</a><br>
    📞 +1 844-383-7844<br>
    📞 +1 210-457-1021<br>
    🌐 <a href="http://www.testpreppundits.com" style="color:inherit;text-decoration:none;">www.testpreppundits.com</a><br><br>
    <strong>Test Prep Pundits Team</strong>
  </div>`);

  // 2. Remove SAT score marketing
  content = content.replace(/<li>.*?150–200.*?<\/li>/gi, '');
  content = content.replace(/<p>.*?150–200.*?<\/p>`/gi, '`');
  content = content.replace(/<div class="cell"><div class="lbl">Average Score Gain<\/div><div class="val">150–200 pts SAT \/ 4–6 pts ACT<\/div><\/div>/gi, '');
  content = content.replace(/Our students at this stage see an average <strong>150–200 point SAT<\/strong> or <strong>4–6 point ACT<\/strong> improvement with the right program\./gi, '');
  content = content.replace(/→ Our students average a <strong>150–200 point SAT improvement<\/strong> with personalized weekly progress reports you can track\.<br><br>/gi, '');
  content = content.replace(/Students see an average of <strong>150–200 SAT point<\/strong> improvement or <strong>4–6 ACT composite points<\/strong> with our programs\./gi, '');

  // 3. Update the AI introduction in emails
  content = content.replace(/Hi \$\{l\.parentName \|\| l\.fullName\}! I'm <strong>Admissions Team<\/strong> from Test Prep Pundits\./g, 'Hello, I am an AI Representative from Test Prep Pundits.');
  content = content.replace(/This is <strong>Admissions Team<\/strong> from Test Prep Pundits\./g, 'Hello, I am an AI Representative from Test Prep Pundits.');
  content = content.replace(/Thank you for reaching out to <strong>Test Prep Pundits<\/strong>! I'm <strong>Admissions Team<\/strong>, your dedicated Admissions Counselor/g, 'Thank you for reaching out to <strong>Test Prep Pundits</strong>! I am an AI Representative from Test Prep Pundits');

  // Any remaining generic 'Admissions Team' -> 'Test Prep Pundits Team' in standard text if needed, but not signatures since signatures were already updated to Test Prep Pundits Team.
  content = content.replace(/<strong>Support Contact:<\/strong>.*?<br>/gi, 
`<strong>Support Contact:</strong><br>
📧 <a href="mailto:Info@testpreppundits.com">Info@testpreppundits.com</a><br>
📞 +1 844-383-7844<br>
📞 +1 210-457-1021<br>`);

  fs.writeFileSync(emailFile, content, 'utf-8');
  console.log('Updated emailService.js successfully');
}
