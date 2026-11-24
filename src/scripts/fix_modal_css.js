const fs = require('fs');
const path = require('path');

const htmlPath = 'c:/Users/user/Downloads/Ai calling (2)/Ai calling/Ai calling/dashboard/index.html';
let html = fs.readFileSync(htmlPath, 'utf8');

// Ensure .modal-bg.active and .modal-backdrop.active have display: flex !important
html = html.replace(
  '.modal-bg.active {',
  '.modal-bg.active, .modal-backdrop.active {'
);

fs.writeFileSync(htmlPath, html, 'utf8');
console.log('Updated index.html modal backdrop active class.');
