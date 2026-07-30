const fs = require('fs');
let file = 'dashboard/index.html';
let content = fs.readFileSync(file, 'utf-8');

const functionsToToast = [
  'loadMeetingOutcomes',
  'loadEmailAnalytics',
  'loadBilling',
  'loadCampaigns',
  'refreshCampaignLeads',
  'loadParentCampaigns',
  'refreshParentCampaignLeads'
];

functionsToToast.forEach(fn => {
  let regex = new RegExp('onclick="' + fn + '\\(\\)"', 'g');
  content = content.replace(regex, 'onclick="' + fn + '().then(() => { if(typeof toast===\'function\') toast(\'Refreshed\', \'success\'); }).catch(()=>{})"');
});

let classesFn = ['loadClasses', 'refreshClassDetails'];
classesFn.forEach(fn => {
  let regex = new RegExp('onclick="' + fn + '\\(\\)"', 'g');
  content = content.replace(regex, 'onclick="' + fn + '(); if(typeof toast===\'function\') toast(\'Refreshed\', \'success\');"');
});

fs.writeFileSync(file, content, 'utf-8');
console.log('Added toasts to refresh buttons in index.html');
