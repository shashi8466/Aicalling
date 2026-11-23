const fs = require('fs');
const path = require('path');

const artifactDir = 'C:/Users/user/.gemini/antigravity/brain/64b3de3f-2822-41bd-8343-3408e577a0ae';
const repoDir = 'c:/Users/user/Downloads/Ai calling (2)/Ai calling/Ai calling';
const htmlPath = path.join(repoDir, 'dashboard/index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

// Strip external fonts
html = html.replace(/<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">/g, '');
html = html.replace(/<link href="https:\/\/fonts\.googleapis\.com[^"]+" rel="stylesheet">/g, '');
html = html.replace(/window\.location\.href\s*=\s*['"]\/login['"]/g, 'console.log("suppressed login redirect")');

const mockInitAuth = `
    async function initAuth() {
      window._authToken = 'mock-token';
      window._currentUser = { id: 'usr_admin', fullName: 'Director Admin', email: 'admin@prep365.ai', role: 'admin' };
      setTimeout(() => {
        const elAv = document.getElementById('headerAvatar');
        if (elAv) elAv.textContent = 'DA';
        const elSh = document.getElementById('headerUserShort');
        if (elSh) elSh.textContent = 'Director';
        const elNm = document.getElementById('headerUserName');
        if (elNm) elNm.textContent = 'Director Admin';
        const rb = document.getElementById('headerRoleBadge');
        if (rb) { rb.textContent = 'admin'; rb.className = 'user-role-badge admin'; }
      }, 50);
      return;
    }
    async function _disabled_initAuth() {
`;
html = html.replace('async function initAuth() {', mockInitAuth);

const mockFetchScript = `
<script>
window._authToken = 'mock-token';
window._currentUser = { id: 'usr_admin', fullName: 'Director Admin', email: 'admin@prep365.ai', role: 'admin' };
window.EventSource = function() { return { addEventListener: () => {}, removeEventListener: () => {}, close: () => {} }; };

const _origFetch = window.fetch;
window.fetch = async function(url, opts) {
  if (url === '/auth/config') return new Response(JSON.stringify({ supabaseUrl: '', supabaseAnonKey: '' }));
  if (url === '/auth/me') return new Response(JSON.stringify(window._currentUser));
  if (url.startsWith('/api/stats')) {
    return new Response(JSON.stringify({
      total: 54, contacted: 42, qualified: 28, enrolled: 12,
      hot: 8, warm: 15, cold: 19,
      totalCalls: 128, answeredCalls: 96, totalDurationSec: 18420,
      conversionRate: 22.2, todayCalls: 14
    }));
  }
  if (url.startsWith('/api/prep365/checkins')) {
    return new Response(JSON.stringify({
      testMode: true,
      testStudentIds: ['1535a7f6-94a7-4fdd-9558-516f48154819'],
      count: 2,
      callableCount: 1,
      byReason: {
        INACTIVE: 0,
        NO_RECENT_TESTS: 2,
        MISSED_ASSIGNED_TOPICS: 1,
        CUSTOM_PREP_BEHIND: 1,
        DECLINING_PERFORMANCE: 1
      },
      stats: {
        needsAttention: 2,
        callable: 1,
        calledToday: 1,
        answered: 1,
        noAnswer: 0,
        failed: 0,
        optedOut: 0
      },
      sheetUrl: 'https://docs.google.com/spreadsheets/d/1BXutZ1i9zn4Te2cc66Dlm-CXcURsCHRXdL67N4JFiyE/edit',
      lastSync: {
        timestamp: new Date().toISOString(),
        dryRun: true,
        studentsReceived: 2,
        callsQueued: 1,
        callsPlaced: 0,
        errors: 0
      },
      students: [
        {
          student: {
            id: '1535a7f6-94a7-4fdd-9558-516f48154819',
            name: 'Shashi',
            email: 'ssky57771@gmail.com',
            phone: '+918466924574',
            grade: '11th Grade',
            optedOut: false
          },
          parents: [
            {
              name: 'shashi kumar',
              email: 'edulashashi84@gmail.com',
              phone: '+918466924574'
            }
          ],
          activity: {
            daysInactive: 0,
            daysSinceLastTest: 12,
            lastLoginAt: '2026-11-23T06:47:26.177Z'
          },
          tests: {
            lastTestAt: '2026-11-11T16:08:16.916Z',
            trend: { declining: true, recentAvg: 6.7, previousAvg: 49.7 },
            recent: [
              { course: 'SAT FULL LENGTH TEST 3', scorePercent: 4, scaledScore: 446, date: '12 days ago' },
              { course: 'SAT FULL LENGTH TEST 1', scorePercent: 16, scaledScore: 561, date: '14 days ago' }
            ]
          },
          customPrep: [
            {
              planName: 'SAT FULL LENGTH TEST 3',
              percentComplete: 11,
              expectedPercentByNow: 100,
              completedTasks: 9,
              tasksBehind: 73,
              missedTopics: [
                { period: 'Day 10', topic: 'Solving systems of linear equations' },
                { period: 'Day 11', topic: 'Quadratic graphs & functions' }
              ]
            }
          ],
          reasons: [
            { code: 'NO_RECENT_TESTS', label: 'No Recent Tests', detail: 'No test attempted in 12 days' },
            { code: 'MISSED_ASSIGNED_TOPICS', label: 'Missed Topics', detail: '58 Custom Prep topic sessions not finished' },
            { code: 'CUSTOM_PREP_BEHIND', label: 'Custom Prep Behind', detail: 'SAT FULL LENGTH TEST 3 is 11% done (expected 100%)' },
            { code: 'DECLINING_PERFORMANCE', label: 'Declining Score', detail: 'Recent average dropped to 6.7%' }
          ],
          talkingPoints: 'Congratulate Shashi on diagnostic test baseline, address 12-day test gap, encourage completing 1 topic in Custom Prep plan today.',
          priority: 145,
          callStatus: {
            callable: true,
            blockedReason: null,
            inCooldown: false,
            phonesToCall: [
              { recipientType: 'student', name: 'Shashi', phone: '+918466924574' },
              { recipientType: 'parent', name: 'shashi kumar', phone: '+918466924574' }
            ],
            totalCalls: 1,
            lastCall: {
              status: 'completed',
              at: '2026-11-23T13:30:00.000Z',
              durationSeconds: 61,
              summary: 'Check-in completed: Shashi acknowledged school exams and agreed to log in today to resume SAT test prep.',
              transcript: 'Annie: Hi Shashi, this is Prep365 checking in. Do you have a quick moment?\\nShashi: Yes, I do.\\nAnnie: We noticed your Custom Prep plan for SAT Full Length Test 3 is 11% complete and you haven\\'t taken a test in 12 days. Would you be able to log in today to complete one topic?\\nShashi: Yes, I was busy with school exams, I will log in tonight.\\nAnnie: Perfect! Best of luck, Shashi. Have a great day.'
            }
          }
        },
        {
          student: {
            id: 'stu_demo_non_test_2',
            name: 'Aarav Patel',
            email: 'aarav.patel@example.com',
            phone: '+14155552671',
            grade: '10th Grade',
            optedOut: false
          },
          parents: [
            {
              name: 'Vikram Patel',
              email: 'vikram.patel@example.com',
              phone: '+14155552672'
            }
          ],
          activity: {
            daysInactive: 15,
            daysSinceLastTest: 9,
            lastLoginAt: '2026-11-08T10:15:00.000Z'
          },
          tests: {
            lastTestAt: '2026-11-14T09:00:00.000Z',
            trend: { declining: false, recentAvg: 78, previousAvg: 75 },
            recent: [
              { course: 'PSAT Practice Test #1', scorePercent: 78, scaledScore: 1120, date: '9 days ago' }
            ]
          },
          customPrep: [],
          reasons: [
            { code: 'INACTIVE', label: 'Inactive (14d+)', detail: 'No login in 15 days' },
            { code: 'NO_RECENT_TESTS', label: 'No Recent Tests', detail: 'No test in 9 days' }
          ],
          talkingPoints: 'Remind Aarav to keep up daily practice before upcoming PSAT.',
          priority: 80,
          callStatus: {
            callable: false,
            blockedReason: 'test_mode',
            inCooldown: false,
            phonesToCall: [{ recipientType: 'student', name: 'Aarav Patel', phone: '+14155552671' }],
            totalCalls: 0,
            lastCall: null
          }
        }
      ]
    }));
  }
  return _origFetch(url, opts);
};

window.addEventListener('DOMContentLoaded', () => {
  const hash = window.location.hash.replace('#', '') || 'prep365';
  showView('prep365');
  setTimeout(async () => {
    await loadPrep365Checkins();
    if (hash === 'prep365_bulk_modal') {
      _prep365SelectedStudentIds.add('1535a7f6-94a7-4fdd-9558-516f48154819');
      updatePrep365BulkCallBtn();
      openPrep365BulkCallModal();
    }
  }, 100);
});
</script>
`;
html = html.replace('<head>', '<head>' + mockFetchScript);

fs.writeFileSync('C:/Users/user/AppData/Local/Temp/dashboard_prep365_upgraded.html', html, 'utf8');
console.log('Written dashboard_prep365_upgraded.html successfully.');
