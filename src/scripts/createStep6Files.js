const fs = require('fs');
const path = require('path');

const repoDir = 'c:/Users/user/Downloads/Ai calling (2)/Ai calling/Ai calling';
const htmlPath = path.join(repoDir, 'dashboard/index.html');
let baseHtml = fs.readFileSync(htmlPath, 'utf8');

// Strip external fonts
baseHtml = baseHtml.replace(/<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">/g, '');
baseHtml = baseHtml.replace(/<link href="https:\/\/fonts\.googleapis\.com[^"]+" rel="stylesheet">/g, '');
baseHtml = baseHtml.replace(/window\.location\.href\s*=\s*['"]\/login['"]/g, 'console.log("suppressed login redirect")');

// Replace stat card values directly in template
baseHtml = baseHtml.replace('id="prep365TestModeBanner" style="display:none;', 'id="prep365TestModeBanner" style="display:flex;');
baseHtml = baseHtml.replace('<div class="kpi-val" id="p365_needsAttention">0</div>', '<div class="kpi-val" id="p365_needsAttention">2</div>');
baseHtml = baseHtml.replace('<div class="kpi-val" id="p365_callable">0</div>', '<div class="kpi-val" id="p365_callable">1</div>');
baseHtml = baseHtml.replace('<div class="kpi-val" id="p365_calledToday">0</div>', '<div class="kpi-val" id="p365_calledToday">1</div>');
baseHtml = baseHtml.replace('<div class="kpi-val" id="p365_answered">0</div>', '<div class="kpi-val" id="p365_answered">1</div>');
baseHtml = baseHtml.replace('<div class="kpi-val" id="p365_reason_inactive" style="font-size:20px">0</div>', '<div class="kpi-val" id="p365_reason_inactive" style="font-size:20px">1</div>');
baseHtml = baseHtml.replace('<div class="kpi-val" id="p365_reason_no_recent_tests" style="font-size:20px">0</div>', '<div class="kpi-val" id="p365_reason_no_recent_tests" style="font-size:20px">2</div>');
baseHtml = baseHtml.replace('<div class="kpi-val" id="p365_reason_missed_topics" style="font-size:20px">0</div>', '<div class="kpi-val" id="p365_reason_missed_topics" style="font-size:20px">1</div>');
baseHtml = baseHtml.replace('<div class="kpi-val" id="p365_reason_custom_prep_behind" style="font-size:20px">0</div>', '<div class="kpi-val" id="p365_reason_custom_prep_behind" style="font-size:20px">1</div>');
baseHtml = baseHtml.replace('<div class="kpi-val" id="p365_reason_declining_score" style="font-size:20px">0</div>', '<div class="kpi-val" id="p365_reason_declining_score" style="font-size:20px">1</div>');
baseHtml = baseHtml.replace('id="prep365LastSyncInfo">Last sync: Checking…<', 'id="prep365LastSyncInfo">Last sync: Just now (2 students received, 1 callable)<');

// Pre-rendered rows: 1 test student (callable), 1 non-test student (disabled due to test mode)
const preRenderedRows = `
  <tr>
    <td style="text-align:center"><input type="checkbox" class="prep365-row-checkbox" checked></td>
    <td>
      <div style="font-weight:600;color:#0F172A">Shashi</div>
      <div style="font-size:11px;color:#64748B">ssky57771@gmail.com</div>
    </td>
    <td><span class="chip chip-slate">11th Grade</span></td>
    <td>
      <div style="display:flex;gap:4px;flex-wrap:wrap;max-width:260px">
        <span class="chip chip-rose" title="No test attempted in 12 days">No Recent Tests</span>
        <span class="chip chip-amber" title="58 Custom Prep topic sessions not finished">Missed Topics</span>
        <span class="chip chip-purple" title="Plan is 11% done (expected 100%)">Custom Prep Behind</span>
        <span class="chip chip-rose" title="Recent average dropped to 6.7%">Declining Score</span>
      </div>
    </td>
    <td style="text-align:center;font-weight:600;color:#0F172A">0d</td>
    <td style="text-align:center;font-weight:600;color:#F59E0B">12d</td>
    <td><code style="font-size:11px;color:#334155">+918466924574</code></td>
    <td>
      <div style="font-size:12px;font-weight:500;color:#0F172A">shashi kumar</div>
      <code style="font-size:11px;color:#64748B">+918466924574</code>
    </td>
    <td>
      <div style="font-size:12px"><span class="badge chip-green">Completed</span> <span style="font-weight:600;margin-left:4px">61s</span></div>
      <div style="font-size:11px;color:#64748B">Today at 7:00 PM</div>
    </td>
    <td>
      <div style="display:flex;gap:6px;align-items:center">
        <button type="button" class="btn btn-primary btn-xs" style="padding:4px 10px;font-size:12px;background:#2563EB">📞 Call</button>
        <button type="button" class="btn btn-secondary btn-xs" style="padding:4px 10px;font-size:12px">View</button>
      </div>
    </td>
  </tr>
  <tr>
    <td style="text-align:center"><input type="checkbox" class="prep365-row-checkbox" disabled></td>
    <td>
      <div style="font-weight:600;color:#0F172A">Aarav Patel</div>
      <div style="font-size:11px;color:#64748B">aarav.patel@example.com</div>
    </td>
    <td><span class="chip chip-slate">10th Grade</span></td>
    <td>
      <div style="display:flex;gap:4px;flex-wrap:wrap;max-width:260px">
        <span class="chip chip-slate" title="No login in 15 days">Inactive (14d+)</span>
        <span class="chip chip-rose" title="No test in 9 days">No Recent Tests</span>
      </div>
    </td>
    <td style="text-align:center;font-weight:600;color:#EF4444">15d</td>
    <td style="text-align:center;font-weight:600;color:#F59E0B">9d</td>
    <td><code style="font-size:11px;color:#334155">+14155552671</code></td>
    <td>
      <div style="font-size:12px;font-weight:500;color:#0F172A">Vikram Patel</div>
      <code style="font-size:11px;color:#64748B">+14155552672</code>
    </td>
    <td>
      <div style="font-size:12px"><span class="badge chip-slate">Not called</span></div>
      <div style="font-size:11px;color:#64748B">—</div>
    </td>
    <td>
      <div style="display:flex;gap:6px;align-items:center">
        <span class="badge chip-slate" style="font-size:11px" title="Cannot be called: Test mode">Test mode</span>
        <button type="button" class="btn btn-secondary btn-xs" style="padding:4px 10px;font-size:12px">View</button>
      </div>
    </td>
  </tr>
`;

baseHtml = baseHtml.replace('<tr><td colspan="10" style="text-align:center;color:var(--muted);padding:32px">Loading Prep365 students…</td></tr>', preRenderedRows);

// Show Call selected (1) button
baseHtml = baseHtml.replace('id="btnPrep365BulkCall" class="btn btn-primary btn-sm" style="display:none;', 'id="btnPrep365BulkCall" class="btn btn-primary btn-sm" style="display:inline-flex;');
baseHtml = baseHtml.replace('📞 Call selected (0)', '📞 Call selected (1)');

const mockScript = `
<script>
window._authToken = 'mock-token';
window._currentUser = { id: 'usr_admin', fullName: 'Director Admin', email: 'admin@prep365.ai', role: 'admin' };
window.initAuth = async function() {
  const elAv = document.getElementById('headerAvatar');
  if (elAv) elAv.textContent = 'DA';
  const elSh = document.getElementById('headerUserShort');
  if (elSh) elSh.textContent = 'Director';
  const elNm = document.getElementById('headerUserName');
  if (elNm) elNm.textContent = 'Director Admin';
  const rb = document.getElementById('headerRoleBadge');
  if (rb) { rb.textContent = 'admin'; rb.className = 'user-role-badge admin'; }
};
window.addEventListener('DOMContentLoaded', () => {
  showView('prep365');
});
</script>
`;

// 1. All students view
const htmlAll = baseHtml.replace('<head>', '<head>' + mockScript);
fs.writeFileSync('C:/Users/user/AppData/Local/Temp/p365_all_students.html', htmlAll, 'utf8');

// 2. Bulk modal view
let htmlModal = baseHtml;
htmlModal = htmlModal.replace(
  'id="prep365BulkModal" class="modal-backdrop" style="display:none;',
  'id="prep365BulkModal" class="modal-backdrop" style="display:flex;'
);

const modalBodyContent = `
  <p>You have selected <strong>1 student</strong> (Shashi) out of 2 students.</p>
  <p style="font-size:13px;color:#64748B">Note: Aarav Patel is skipped because <strong>Test Mode</strong> is enabled and only designated test students can be called.</p>
  <p>Total outbound calls to be placed (student + parent): <strong>2 calls</strong>.</p>
  <div style="background:#F1F5F9;padding:14px;border-radius:8px;margin-top:12px;font-size:13px">
    <div><strong>Mode:</strong> <span style="color:#D97706;font-weight:700">DRY RUN (no phones will ring)</span></div>
    <div style="margin-top:4px"><strong>Concurrency:</strong> Max 2 calls simultaneously</div>
    <div style="margin-top:4px"><strong>Logging:</strong> All conversation summaries and transcripts will be automatically logged to Google Sheets.</div>
  </div>
`;

htmlModal = htmlModal.replace('<!-- Content populated dynamically -->', modalBodyContent);
htmlModal = htmlModal.replace('<head>', '<head>' + mockScript);
fs.writeFileSync('C:/Users/user/AppData/Local/Temp/p365_bulk_modal.html', htmlModal, 'utf8');

console.log('Successfully written both pre-rendered preview files.');
