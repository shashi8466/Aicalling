const fs = require('fs');
const path = require('path');

const repoDir = 'c:/Users/user/Downloads/Ai calling (2)/Ai calling/Ai calling';
const htmlPath = path.join(repoDir, 'dashboard/index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

console.log('Original index.html size:', html.length);

// 1. Feather SVG Icons map
const ICONS = {
  // Navigation
  dashboard: `<svg class="fi" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:12px;flex-shrink:0"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>`,
  leads: `<svg class="fi" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:12px;flex-shrink:0"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>`,
  campaigns: `<svg class="fi" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:12px;flex-shrink:0"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`,
  calls: `<svg class="fi" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:12px;flex-shrink:0"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path><path d="M15 3a6 6 0 0 1 6 6"></path></svg>`,
  meetings: `<svg class="fi" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:12px;flex-shrink:0"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>`,
  prep365: `<svg class="fi" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:12px;flex-shrink:0"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>`,
  enrollments: `<svg class="fi" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:12px;flex-shrink:0"><polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>`,
  counselor: `<svg class="fi" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:12px;flex-shrink:0"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><polyline points="16 11 18 13 22 9"></polyline></svg>`,
  billing: `<svg class="fi" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:12px;flex-shrink:0"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg>`,
  counselors: `<svg class="fi" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:12px;flex-shrink:0"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>`,
  settings: `<svg class="fi" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:12px;flex-shrink:0"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`,
  collapse: `<svg class="fi" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:12px;flex-shrink:0;transition:transform 0.2s"><polyline points="15 18 9 12 15 6"></polyline></svg>`,
  logout: `<svg class="fi" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:12px;flex-shrink:0"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>`,
  // Buttons & general
  refresh: `<svg class="fi" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>`,
  download: `<svg class="fi" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`,
  zap: `<svg class="fi" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`,
  external: `<svg class="fi" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`,
  phone: `<svg class="fi" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>`,
  menu: `<svg class="fi" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>`,
  close: `<svg class="fi" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`,
  search: `<svg class="fi" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#94A3B8"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`,
  // Stat Card Tiles (20x20)
  tileUsers: `<svg class="fi" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>`,
  tileUserPlus: `<svg class="fi" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line></svg>`,
  tilePhone: `<svg class="fi" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>`,
  tileCheckCircle: `<svg class="fi" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`,
  tileAward: `<svg class="fi" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="7"></circle><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"></polyline></svg>`,
  tileCalendar: `<svg class="fi" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>`,
  tileZap: `<svg class="fi" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`,
  tileBook: `<svg class="fi" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>`,
  tileTrendingUp: `<svg class="fi" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg>`,
  tileAlertCircle: `<svg class="fi" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`,
  tilePhoneCall: `<svg class="fi" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path><path d="M15 3a6 6 0 0 1 6 6"></path></svg>`,
  tileCheck: `<svg class="fi" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
  tilePhoneOff: `<svg class="fi" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`,
  tileClock: `<svg class="fi" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
  tileFileText: `<svg class="fi" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`,
  tileBookmark: `<svg class="fi" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>`,
  tileTrendingDown: `<svg class="fi" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"></polyline><polyline points="17 18 23 18 23 12"></polyline></svg>`,
  tileActivity: `<svg class="fi" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>`,
  tileSlash: `<svg class="fi" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>`
};

// 2. Comprehensive Prep365 CSS Theme
const PREP365_CSS = `
    /* ══════════════════════════════════════════════════════════════════════
       PREP365 CLEAN WHITE THEME — OFFICIAL SPECIFICATION
       ══════════════════════════════════════════════════════════════════════ */
    :root {
      --bg-page: #F8FAFC;
      --bg-white: #FFFFFF;
      --border-gray: #E5E7EB;
      --border-header: #E2E8F0;
      --fill-subtle: #F9FAFB;
      --fill-hover: #F3F4F6;
      --text-heading: #0F172A;
      --text-value: #111827;
      --text-body: #4B5563;
      --text-muted: #64748B;
      --icon-slate: #94A3B8;
      --brand-primary: #2563EB;
      --brand-primary-hover: #1D4ED8;
      --btn-dark: #0F172A;
      --btn-dark-hover: #1E293B;
      --success-green: #22C55E;
      --accent-sky-bg: #F0F9FF;
      --accent-sky-text: #0284C7;
      --accent-sky-border: #BAE6FD;
    }

    /* Base Font & Page Structure */
    body, html {
      font-family: 'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;
      background: #F8FAFC !important;
      color: #4B5563 !important;
      margin: 0 !important;
      padding: 0 !important;
      overflow: hidden !important;
      height: 100vh !important;
    }

    .app {
      display: flex !important;
      height: 100vh !important;
      background: #F8FAFC !important;
      overflow: hidden !important;
      transition: all 0.3s ease !important;
    }

    /* ─── Sidebar ─── */
    .sidebar {
      width: 256px !important;
      min-width: 256px !important;
      height: 100vh !important;
      background: #FFFFFF !important;
      border-right: 1px solid #E5E7EB !important;
      display: flex !important;
      flex-direction: column !important;
      padding: 0 !important;
      position: relative !important;
      transition: width 0.3s ease, min-width 0.3s ease !important;
      box-shadow: none !important;
      z-index: 50 !important;
    }
    .app.collapsed .sidebar {
      width: 80px !important;
      min-width: 80px !important;
    }

    /* Logo Area (h-20 = 80px) */
    .brand {
      height: 80px !important;
      min-height: 80px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: flex-start !important;
      padding: 0 20px !important;
      border-bottom: 1px solid #E5E7EB !important;
      gap: 12px !important;
      background: #FFFFFF !important;
    }
    .app.collapsed .brand {
      justify-content: center !important;
      padding: 0 !important;
    }
    .prep365-logo-sq {
      width: 44px !important;
      height: 44px !important;
      border-radius: 12px !important;
      background: linear-gradient(135deg, #2563EB 0%, #4338CA 100%) !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      color: #FFFFFF !important;
      font-weight: 800 !important;
      font-size: 18px !important;
      box-shadow: 0 2px 4px rgba(37, 99, 235, 0.2) !important;
      flex-shrink: 0 !important;
    }
    .brand-text {
      display: flex !important;
      flex-direction: column !important;
      overflow: hidden !important;
      white-space: nowrap !important;
    }
    .app.collapsed .brand-text {
      display: none !important;
    }
    .brand-text .title {
      font-size: 15px !important;
      font-weight: 800 !important;
      color: #0F172A !important;
      line-height: 1.2 !important;
    }
    .brand-text .sub {
      font-size: 11px !important;
      font-weight: 500 !important;
      color: #64748B !important;
      margin-top: 2px !important;
    }

    /* Navigation */
    .nav {
      flex: 1 !important;
      overflow-y: auto !important;
      padding: 16px 0 !important;
      scrollbar-width: thin !important;
    }
    .nav-group-label {
      padding: 0 24px !important;
      margin-top: 18px !important;
      margin-bottom: 8px !important;
      font-size: 10px !important;
      font-weight: 900 !important;
      color: #64748B !important;
      text-transform: uppercase !important;
      letter-spacing: 0.1em !important;
      user-select: none !important;
    }
    .nav-group-label:first-child {
      margin-top: 0 !important;
    }
    .app.collapsed .nav-group-label {
      display: none !important;
    }
    .nav-group {
      padding: 0 12px !important;
      display: flex !important;
      flex-direction: column !important;
      gap: 4px !important;
      margin-bottom: 8px !important;
    }
    .nav a {
      display: flex !important;
      align-items: center !important;
      border-radius: 8px !important;
      padding: 9px 12px !important;
      font-size: 14px !important;
      font-weight: 500 !important;
      color: #64748B !important;
      text-decoration: none !important;
      cursor: pointer !important;
      transition: all 0.15s ease !important;
      white-space: nowrap !important;
      margin: 1px 0 !important;
    }
    .nav a:hover {
      background: #F3F4F6 !important;
      color: #1F2937 !important;
    }
    .nav a.active {
      background: #2563EB !important;
      color: #FFFFFF !important;
      font-weight: 600 !important;
    }
    .nav a.active svg.fi {
      color: #FFFFFF !important;
    }
    .app.collapsed .nav a {
      justify-content: center !important;
      padding: 10px 0 !important;
    }
    .app.collapsed .nav a .nav-label,
    .app.collapsed .nav-badge {
      display: none !important;
    }
    .nav-badge {
      margin-left: auto !important;
      font-size: 10px !important;
      font-weight: 700 !important;
      padding: 2px 7px !important;
      border-radius: 9999px !important;
      background: #F3F4F6 !important;
      color: #475569 !important;
    }
    .nav a.active .nav-badge {
      background: rgba(255, 255, 255, 0.25) !important;
      color: #FFFFFF !important;
    }

    /* Sidebar Footer */
    .sidebar-footer {
      padding: 16px !important;
      border-top: 1px solid #E5E7EB !important;
      display: flex !important;
      flex-direction: column !important;
      gap: 8px !important;
      background: #FFFFFF !important;
    }
    .sidebar-footer button, .sidebar-footer a {
      display: flex !important;
      align-items: center !important;
      border-radius: 8px !important;
      padding: 9px 12px !important;
      font-size: 13px !important;
      font-weight: 500 !important;
      color: #64748B !important;
      cursor: pointer !important;
      background: transparent !important;
      border: 1px solid transparent !important;
      transition: all 0.15s !important;
      width: 100% !important;
      text-align: left !important;
    }
    .sidebar-footer button:hover, .sidebar-footer a:hover {
      background: #F3F4F6 !important;
      color: #111827 !important;
    }
    .sidebar-footer .btn-logout-dark {
      background: #0F172A !important;
      color: #FFFFFF !important;
      font-weight: 500 !important;
      border: none !important;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05) !important;
    }
    .sidebar-footer .btn-logout-dark:hover {
      background: #1E293B !important;
      color: #FFFFFF !important;
    }
    .sidebar-footer .btn-logout-dark svg.fi {
      color: #FFFFFF !important;
    }
    .app.collapsed .sidebar-footer button,
    .app.collapsed .sidebar-footer a {
      justify-content: center !important;
      padding: 9px 0 !important;
    }
    .app.collapsed .sidebar-footer .nav-label {
      display: none !important;
    }
    .app.collapsed #sidebarCollapseBtn svg {
      transform: rotate(180deg) !important;
      margin-right: 0 !important;
    }

    /* ─── Main & Header ─── */
    .main {
      flex: 1 !important;
      display: flex !important;
      flex-direction: column !important;
      height: 100vh !important;
      overflow: hidden !important;
      background: #F8FAFC !important;
    }

    .header {
      background: #FFFFFF !important;
      border-bottom: 1px solid #E2E8F0 !important;
      padding: 16px 28px !important;
      min-height: 72px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      gap: 16px !important;
      flex-shrink: 0 !important;
    }
    .header h1, #pageTitle {
      font-size: 24px !important;
      font-weight: 700 !important;
      color: #0F172A !important;
      letter-spacing: -0.02em !important;
      margin: 0 !important;
    }
    .status-pill {
      background: #ECFDF5 !important;
      color: #059669 !important;
      border: 1px solid #A7F3D0 !important;
      font-size: 12px !important;
      font-weight: 600 !important;
      padding: 3px 10px !important;
      border-radius: 9999px !important;
      display: inline-flex !important;
      align-items: center !important;
      gap: 6px !important;
      margin-left: 10px !important;
    }
    .status-dot {
      width: 6px !important;
      height: 6px !important;
      border-radius: 50% !important;
      background: #10B981 !important;
    }
    .toolbar {
      display: flex !important;
      align-items: center !important;
      gap: 8px !important;
      flex-wrap: wrap !important;
    }
    .user-pill {
      display: flex !important;
      align-items: center !important;
      gap: 8px !important;
      padding: 5px 12px !important;
      border-radius: 8px !important;
      border: 1px solid #E5E7EB !important;
      background: #FFFFFF !important;
      cursor: pointer !important;
      box-shadow: 0 1px 2px rgba(0,0,0,0.05) !important;
    }
    .user-avatar {
      width: 28px !important;
      height: 28px !important;
      border-radius: 50% !important;
      background: #2563EB !important;
      color: #FFFFFF !important;
      font-size: 11px !important;
      font-weight: 700 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
    }
    .user-role-badge {
      font-size: 10px !important;
      font-weight: 700 !important;
      text-transform: uppercase !important;
      background: #F1F5F9 !important;
      color: #475569 !important;
      padding: 2px 6px !important;
      border-radius: 4px !important;
    }

    /* ─── Content Wrapper ─── */
    .content {
      flex: 1 !important;
      overflow-y: auto !important;
      padding: 24px 32px !important;
      background: #F8FAFC !important;
    }
    .content-inner {
      max-width: 1400px !important;
      margin: 0 auto !important;
      display: flex !important;
      flex-direction: column !important;
      gap: 24px !important;
    }

    /* ─── Stat Cards & Panels ─── */
    .card, .ov-stat, .ov-card, .metric-card, .an-card, .prep365-kpi-card {
      background: #FFFFFF !important;
      border: 1px solid #E5E7EB !important;
      border-radius: 12px !important;
      padding: 20px !important;
      box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05) !important;
      color: #0F172A !important;
      display: flex !important;
      align-items: flex-start !important;
      gap: 16px !important;
      transition: all 0.15s ease !important;
    }
    .card-icon-tile, .ov-stat-icon {
      width: 48px !important;
      height: 48px !important;
      border-radius: 10px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      flex-shrink: 0 !important;
    }
    /* Stat Icon Tints (10% opacity background + exact text color) */
    .tile-purple { background: rgba(168, 85, 247, 0.1) !important; color: #A855F7 !important; }
    .tile-blue   { background: rgba(59, 130, 246, 0.1) !important; color: #3B82F6 !important; }
    .tile-green  { background: rgba(34, 197, 94, 0.1) !important; color: #22C55E !important; }
    .tile-amber  { background: rgba(245, 158, 11, 0.1) !important; color: #F59E0B !important; }
    .tile-rose   { background: rgba(239, 68, 68, 0.1) !important; color: #EF4444 !important; }
    .tile-sky    { background: rgba(14, 165, 233, 0.1) !important; color: #0EA5E9 !important; }
    .tile-slate  { background: rgba(100, 116, 139, 0.1) !important; color: #64748B !important; }

    .ov-stat-val, .kpi-val {
      font-size: 24px !important;
      font-weight: 700 !important;
      color: #111827 !important;
      line-height: 1.2 !important;
    }
    .ov-stat-label, .kpi-label {
      font-size: 12px !important;
      font-weight: 500 !important;
      color: #64748B !important;
      margin-bottom: 2px !important;
    }
    .ov-stat-trend {
      font-size: 10px !important;
      font-weight: 500 !important;
      color: #22C55E !important;
      margin-top: 4px !important;
    }
    .ov-stat-trend.down {
      color: #EF4444 !important;
    }
    .ov-stat-trend.neu {
      color: #64748B !important;
    }

    /* Grids */
    .ov-stats {
      display: grid !important;
      gap: 16px !important;
      margin-bottom: 20px !important;
    }

    /* Panel Card */
    .panel-card, .section-card {
      background: #FFFFFF !important;
      border: 1px solid #E5E7EB !important;
      border-radius: 12px !important;
      padding: 24px !important;
      box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05) !important;
      margin-bottom: 24px !important;
    }
    .panel-heading, .section-heading {
      font-size: 14px !important;
      font-weight: 700 !important;
      color: #111827 !important;
      margin-bottom: 20px !important;
    }
    .list-row-panel {
      display: flex !important;
      align-items: center !important;
      gap: 12px !important;
      padding: 12px !important;
      border-radius: 12px !important;
      background: #F9FAFB !important;
      border: 1px solid #E5E7EB !important;
      transition: all 0.15s ease !important;
    }
    .list-row-panel:hover {
      background: #F3F4F6 !important;
    }

    /* ─── Buttons ─── */
    .btn {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 6px !important;
      padding: 8px 16px !important;
      font-size: 14px !important;
      font-weight: 500 !important;
      border-radius: 8px !important;
      cursor: pointer !important;
      transition: all 0.15s ease !important;
      line-height: 1.4 !important;
      box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05) !important;
      text-decoration: none !important;
    }
    .btn-sm {
      padding: 6px 12px !important;
      font-size: 13px !important;
    }
    .btn-xs {
      padding: 4px 8px !important;
      font-size: 12px !important;
    }
    .btn-primary {
      background: #2563EB !important;
      color: #FFFFFF !important;
      border: 1px solid #2563EB !important;
    }
    .btn-primary:hover {
      background: #1D4ED8 !important;
      border-color: #1D4ED8 !important;
    }
    .btn-secondary {
      background: #FFFFFF !important;
      border: 1px solid #E5E7EB !important;
      color: #4B5563 !important;
    }
    .btn-secondary:hover {
      background: #F3F4F6 !important;
      color: #111827 !important;
      border-color: #D1D5DB !important;
    }
    .btn-dark {
      background: #0F172A !important;
      color: #FFFFFF !important;
      border: 1px solid #0F172A !important;
    }
    .btn-dark:hover {
      background: #1E293B !important;
    }
    .btn-accent {
      background: #F0F9FF !important;
      color: #0284C7 !important;
      border: 1px solid #BAE6FD !important;
      font-size: 11px !important;
      font-weight: 900 !important;
      text-transform: uppercase !important;
      letter-spacing: 0.1em !important;
    }
    .btn-accent:hover {
      background: #E0F2FE !important;
    }
    .btn-small-link {
      font-size: 10px !important;
      font-weight: 500 !important;
      color: #2563EB !important;
      padding: 6px 12px !important;
      border-radius: 8px !important;
      border: 1px solid #E5E7EB !important;
      background: #F9FAFB !important;
    }
    .btn-small-link:hover {
      background: #F3F4F6 !important;
    }
    .btn-danger {
      background: #DC2626 !important;
      color: #FFFFFF !important;
      border: 1px solid #DC2626 !important;
    }
    .btn-danger:hover {
      background: #B91C1C !important;
    }
    .btn-date-filter {
      padding: 8px 16px !important;
      background: #FFFFFF !important;
      font-size: 14px !important;
      color: #4B5563 !important;
      border-radius: 8px !important;
      border: 1px solid #E5E7EB !important;
      box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05) !important;
      display: inline-flex !important;
      align-items: center !important;
      gap: 8px !important;
      cursor: pointer !important;
    }

    /* ─── Badges & Chips ─── */
    .chip, .badge, .status-badge {
      display: inline-flex !important;
      align-items: center !important;
      gap: 4px !important;
      padding: 2px 10px !important;
      border-radius: 9999px !important;
      font-size: 12px !important;
      font-weight: 500 !important;
      line-height: 1.4 !important;
      white-space: nowrap !important;
      border: 1px solid transparent !important;
    }
    .chip-green, .badge-success { background: #DCFCE7 !important; color: #15803D !important; border-color: #BBF7D0 !important; }
    .chip-amber, .badge-warning { background: #FEF3C7 !important; color: #B45309 !important; border-color: #FDE68A !important; }
    .chip-red, .chip-rose, .badge-danger { background: #FEE2E2 !important; color: #B91C1C !important; border-color: #FECACA !important; }
    .chip-blue, .badge-info    { background: #DBEAFE !important; color: #1D4ED8 !important; border-color: #BFDBFE !important; }
    .chip-purple               { background: #F3E8FF !important; color: #7E22CE !important; border-color: #E9D5FF !important; }
    .chip-gray, .chip-slate    { background: #F3F4F6 !important; color: #4B5563 !important; border-color: #E5E7EB !important; }

    /* ─── Tables ─── */
    .table-card, .table-wrap, .an-table-wrap {
      background: #FFFFFF !important;
      border-radius: 12px !important;
      border: 1px solid #E5E7EB !important;
      box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05) !important;
      overflow-x: auto !important;
      margin-bottom: 24px !important;
    }
    table {
      width: 100% !important;
      border-collapse: collapse !important;
      background: #FFFFFF !important;
      color: #111827 !important;
      font-size: 14px !important;
    }
    thead {
      background: #F9FAFB !important;
    }
    thead th {
      padding: 12px 24px !important;
      text-align: left !important;
      font-size: 12px !important;
      font-weight: 500 !important;
      color: #6B7280 !important;
      text-transform: uppercase !important;
      letter-spacing: 0.05em !important;
      border-bottom: 1px solid #E5E7EB !important;
      white-space: nowrap !important;
    }
    tbody td {
      padding: 16px 24px !important;
      font-size: 14px !important;
      color: #111827 !important;
      border-bottom: 1px solid #E5E7EB !important;
      vertical-align: middle !important;
    }
    tbody tr:last-child td {
      border-bottom: none !important;
    }
    tbody tr:hover td {
      background: #F9FAFB !important;
    }
    .td-sec {
      font-size: 12px !important;
      color: #64748B !important;
      margin-top: 2px !important;
    }

    /* ─── Inputs, Selects, Forms ─── */
    input[type="text"], input[type="email"], input[type="password"], input[type="search"], select, textarea {
      width: 100% !important;
      padding: 8px 12px !important;
      background: #FFFFFF !important;
      border: 1px solid #E5E7EB !important;
      border-radius: 8px !important;
      font-size: 14px !important;
      color: #111827 !important;
      outline: none !important;
      transition: all 0.15s ease !important;
      box-sizing: border-box !important;
    }
    input::placeholder, textarea::placeholder {
      color: #94A3B8 !important;
    }
    input:focus, select:focus, textarea:focus {
      outline: none !important;
      border-color: #2563EB !important;
      box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.2) !important;
    }

    /* ─── Modals ─── */
    .modal-bg, .modal-backdrop {
      position: fixed !important;
      inset: 0 !important;
      background: rgba(15, 23, 42, 0.5) !important;
      z-index: 9999 !important;
      display: none !important;
      align-items: center !important;
      justify-content: center !important;
      padding: 24px !important;
      backdrop-filter: blur(2px) !important;
      overflow-y: auto !important;
    }
    .modal-bg.active {
      display: flex !important;
    }
    .modal, .modal-backdrop > div {
      background: #FFFFFF !important;
      border-radius: 12px !important;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04) !important;
      border: 1px solid #E5E7EB !important;
      padding: 24px !important;
      max-width: 540px !important;
      width: 100% !important;
      position: relative !important;
      color: #0F172A !important;
    }
    .modal-header {
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      margin-bottom: 20px !important;
      padding-bottom: 14px !important;
      border-bottom: 1px solid #E5E7EB !important;
    }
    .modal-header h2, .modal-header h3 {
      font-size: 18px !important;
      font-weight: 700 !important;
      color: #0F172A !important;
      margin: 0 !important;
    }
    .modal-close-btn {
      width: 32px !important;
      height: 32px !important;
      border-radius: 8px !important;
      border: 1px solid #E5E7EB !important;
      background: #FFFFFF !important;
      color: #94A3B8 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      cursor: pointer !important;
      transition: all 0.15s !important;
    }
    .modal-close-btn:hover {
      background: #F3F4F6 !important;
      color: #0F172A !important;
    }

    /* ─── Alert & Test Mode Banners ─── */
    .banner-warning, #prep365TestModeBanner {
      border-radius: 12px !important;
      border: 1px solid #FDE68A !important;
      background: #FFFBEB !important;
      color: #92400E !important;
      padding: 12px 16px !important;
      font-size: 14px !important;
      font-weight: 500 !important;
      display: flex !important;
      align-items: center !important;
      gap: 10px !important;
      margin-bottom: 20px !important;
    }

    /* ─── Tab Switchers (Pill style) ─── */
    .view-tabs {
      display: inline-flex !important;
      align-items: center !important;
      gap: 4px !important;
      background: #F1F5F9 !important;
      padding: 4px !important;
      border-radius: 10px !important;
      margin-bottom: 20px !important;
      border: 1px solid #E2E8F0 !important;
    }
    .view-tab {
      display: inline-flex !important;
      align-items: center !important;
      gap: 6px !important;
      padding: 8px 16px !important;
      border-radius: 8px !important;
      font-size: 13px !important;
      font-weight: 600 !important;
      color: #64748B !important;
      cursor: pointer !important;
      border: none !important;
      background: transparent !important;
      transition: all 0.15s ease !important;
    }
    .view-tab:hover {
      color: #0F172A !important;
    }
    .view-tab.active {
      background: #FFFFFF !important;
      color: #2563EB !important;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1) !important;
    }

    /* ─── Responsive Mobile Drawer ─── */
    .sidebar-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.5);
      z-index: 999;
      backdrop-filter: blur(2px);
    }
    .sidebar-overlay.open {
      display: block !important;
    }
    @media (max-width: 768px) {
      .app {
        flex-direction: column !important;
      }
      .sidebar {
        position: fixed !important;
        left: 0 !important;
        top: 0 !important;
        bottom: 0 !important;
        transform: translateX(-100%) !important;
        z-index: 1000 !important;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.15) !important;
      }
      .sidebar.open {
        transform: translateX(0) !important;
      }
      .content {
        padding: 16px !important;
      }
      .header {
        padding: 12px 16px !important;
      }
    }
`;

// Replace CSS block
const cssStartMarker = '/* ══════════════════════════════════════════════════════════════════════\n       PREP365 CLEAN WHITE THEME & MODERN DESIGN TOKENS';
const cssEndMarker = '</style>';

if (html.includes(cssStartMarker)) {
  const sIdx = html.indexOf(cssStartMarker);
  const eIdx = html.indexOf(cssEndMarker, sIdx);
  html = html.slice(0, sIdx) + PREP365_CSS + '\n  ' + html.slice(eIdx);
  console.log('Replaced existing PREP365 CSS theme block.');
} else {
  // Append before </style>
  html = html.replace('</style>', PREP365_CSS + '\n  </style>');
  console.log('Appended PREP365 CSS theme block.');
}

// 3. Update Sidebar HTML: Logo + Feather line icons + clean groups
const oldSidebarHtml = html.substring(html.indexOf('<aside class="sidebar"'), html.indexOf('</aside>') + 8);

const newSidebarHtml = `
    <aside class="sidebar" id="appSidebar">
      <!-- Logo Area (h-20, border-b border-gray-200) -->
      <div class="brand">
        <div class="prep365-logo-sq">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
          </svg>
        </div>
        <div class="brand-text">
          <div class="title">Prep365 AI Calling</div>
          <div class="sub">Admin &amp; Counselor</div>
        </div>
      </div>

      <nav class="nav">
        <!-- OVERVIEW -->
        <div class="nav-group-label">OVERVIEW</div>
        <div class="nav-group">
          <a class="active" data-view="overview" onclick="showView('overview')">
            ${ICONS.dashboard}<span class="nav-label">Dashboard</span>
          </a>
        </div>

        <!-- OUTREACH -->
        <div class="nav-group-label">OUTREACH</div>
        <div class="nav-group">
          <a data-view="leads" onclick="showView('leads')">
            ${ICONS.leads}<span class="nav-label">Leads</span><span class="nav-badge" id="navLeadCount">0</span>
          </a>
          <a data-view="campaigns" onclick="showView('campaigns')">
            ${ICONS.campaigns}<span class="nav-label">Campaigns</span>
          </a>
          <a data-view="calls" onclick="showView('calls')">
            ${ICONS.calls}<span class="nav-label">Call Activity</span><span class="nav-badge" id="navCallCount">0</span>
          </a>
          <a data-view="meetings" onclick="showView('meetings')">
            ${ICONS.meetings}<span class="nav-label">Meetings</span><span class="nav-badge" id="navMeetCount">0</span>
          </a>
        </div>

        <!-- PREP365 -->
        <div class="nav-group-label">PREP365</div>
        <div class="nav-group">
          <a data-view="prep365" onclick="showView('prep365')">
            ${ICONS.prep365}<span class="nav-label">Student Check-ins</span><span class="nav-badge" id="navPrep365Count">0</span>
          </a>
        </div>

        <!-- ENROLLMENT -->
        <div class="nav-group-label">ENROLLMENT</div>
        <div class="nav-group">
          <a data-view="enrollments" onclick="showView('enrollments')">
            ${ICONS.enrollments}<span class="nav-label">Enrollments</span><span class="nav-badge" id="navEnrollCount">0</span>
          </a>
          <a data-view="counselor" onclick="showView('counselor')">
            ${ICONS.counselor}<span class="nav-label">Counselor Hub</span>
          </a>
        </div>

        <!-- ADMIN -->
        <div class="nav-group-label">ADMIN</div>
        <div class="nav-group">
          <a data-view="billing" onclick="showView('billing')">
            ${ICONS.billing}<span class="nav-label">Billing</span>
          </a>
          <a data-view="counselors" onclick="showView('counselors')">
            ${ICONS.counselors}<span class="nav-label">Counselors</span>
          </a>
          <a data-view="settings" onclick="showView('settings')">
            ${ICONS.settings}<span class="nav-label">Settings</span>
          </a>
        </div>
      </nav>

      <!-- Sidebar Footer -->
      <div class="sidebar-footer">
        <button id="sidebarCollapseBtn" type="button" onclick="toggleSidebarCollapse()" title="Collapse sidebar">
          ${ICONS.collapse}<span class="nav-label">Collapse</span>
        </button>
        <button type="button" class="btn-logout-dark" onclick="doLogout()" title="Log out">
          ${ICONS.logout}<span class="nav-label">Logout</span>
        </button>
      </div>
    </aside>
`;

html = html.replace(oldSidebarHtml, newSidebarHtml);
console.log('Sidebar updated with Prep365 logo and Feather line icons.');

// 4. Update Header Buttons: replace emoji/symbols with Feather SVGs
html = html.replace(
  '<button class="menu-toggle" onclick="toggleMobileMenu()" title="Menu">☰</button>',
  `<button class="menu-toggle btn btn-secondary btn-sm" onclick="toggleMobileMenu()" title="Menu" style="margin-right:8px">${ICONS.menu}</button>`
);
html = html.replace('onclick="refreshAll()">⟳ Refresh</button>', `onclick="refreshAll()">${ICONS.refresh} Refresh</button>`);
html = html.replace('onclick="exportLeads()">⬇ Export CSV</button>', `onclick="exportLeads()">${ICONS.download} Export CSV</button>`);
html = html.replace('onclick="pollNow()">⚡ Poll Sheets Now</button>', `onclick="pollNow()">${ICONS.zap} Poll Sheets Now</button>`);
html = html.replace('onclick="syncPrep365Now()" title="Fetch candidate students from Prep365">🔄 Sync Prep365</button>', `onclick="syncPrep365Now()" class="btn btn-accent btn-sm" title="Fetch candidate students from Prep365">${ICONS.refresh} Sync Prep365</button>`);

// 5. Update Overview Stat Cards Icons
html = html.replace('<div class="ov-stat-icon tile-blue">👥</div>', `<div class="ov-stat-icon tile-blue">${ICONS.tileUsers}</div>`);
html = html.replace('<div class="ov-stat-icon tile-cyan" style="background:rgba(6,182,212,.1);color:#0891b2">✨</div>', `<div class="ov-stat-icon tile-sky">${ICONS.tileUserPlus}</div>`);
html = html.replace('<div class="ov-stat-icon tile-amber">📞</div>', `<div class="ov-stat-icon tile-amber">${ICONS.tilePhone}</div>`);
html = html.replace('<div class="ov-stat-icon tile-purple">✅</div>', `<div class="ov-stat-icon tile-purple">${ICONS.tileCheckCircle}</div>`);
html = html.replace('<div class="ov-stat-icon tile-rose">🎓</div>', `<div class="ov-stat-icon tile-rose">${ICONS.tileAward}</div>`);
html = html.replace('<div class="ov-stat-icon tile-blue">📱</div>', `<div class="ov-stat-icon tile-blue">${ICONS.tilePhoneCall}</div>`);
html = html.replace('<div class="ov-stat-icon tile-green">📅</div>', `<div class="ov-stat-icon tile-green">${ICONS.tileCalendar}</div>`);
html = html.replace('<div class="ov-stat-icon tile-amber">⚡</div>', `<div class="ov-stat-icon tile-amber">${ICONS.tileZap}</div>`);
html = html.replace('<div class="ov-stat-icon tile-green">🎓</div>', `<div class="ov-stat-icon tile-green">${ICONS.tileBook}</div>`);
html = html.replace('background:linear-gradient(to bottom,#FFFFFF,#F0FDF4)', 'background:#FFFFFF;border-color:#BFDBFE');

// 6. Update Tabs in Overview and Leads
html = html.replace('>📊 Overview</button>', `>${ICONS.dashboard} Overview</button>`);
html = html.replace('>📈 Reports &amp; Analytics</button>', `>${ICONS.tileActivity} Reports &amp; Analytics</button>`);
html = html.replace('>📋 Lead List</button>', `>${ICONS.leads} Lead List</button>`);

// 7. Update Prep365 Student Check-ins Page
html = html.replace(
  '<span style="font-size:16px">⚠️</span>',
  `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#D97706"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`
);
html = html.replace(
  '<h2 class="an-title">🎓 Student Check-ins</h2>',
  `<h2 class="an-title" style="display:flex;align-items:center;gap:10px">${ICONS.prep365} Student Check-ins</h2>`
);

// Buttons on Prep365 View
html = html.replace(
  `onclick="loadPrep365Checkins(); if(typeof toast==='function') toast('Refreshed', 'success');">↻ Refresh</button>`,
  `onclick="loadPrep365Checkins(); if(typeof toast==='function') toast('Refreshed', 'success');" class="btn btn-secondary btn-sm">${ICONS.refresh} Refresh</button>`
);
html = html.replace(
  `onclick="triggerPrep365ManualSync()">⚡ Sync from Prep365</button>`,
  `onclick="triggerPrep365ManualSync()" class="btn btn-primary btn-sm">${ICONS.zap} Sync from Prep365</button>`
);
html = html.replace(
  `onclick="openPrep365GoogleSheet()">📊 Open Google Sheet</button>`,
  `onclick="openPrep365GoogleSheet()" class="btn btn-secondary btn-sm">${ICONS.external} Open Google Sheet</button>`
);
html = html.replace(
  `onclick="downloadPrep365Excel()">📥 Download Excel</button>`,
  `onclick="downloadPrep365Excel()" class="btn btn-secondary btn-sm">${ICONS.download} Download Excel</button>`
);
html = html.replace(
  `onclick="openPrep365BulkCallModal()">📞 Call selected (0)</button>`,
  `onclick="openPrep365BulkCallModal()" class="btn btn-primary btn-sm" style="display:none;background:#2563EB;border-color:#2563EB">${ICONS.phone} Call selected (0)</button>`
);

// Stat cards tiles on Prep365 View
html = html.replace('<div class="card-icon-tile tile-blue">🎯</div>', `<div class="card-icon-tile tile-blue">${ICONS.tileAlertCircle}</div>`);
html = html.replace('<div class="card-icon-tile tile-purple">📞</div>', `<div class="card-icon-tile tile-purple">${ICONS.tilePhoneCall}</div>`);
html = html.replace('<div class="card-icon-tile tile-blue">📅</div>', `<div class="card-icon-tile tile-blue">${ICONS.tileCalendar}</div>`);
html = html.replace('<div class="card-icon-tile tile-green">✅</div>', `<div class="card-icon-tile tile-green">${ICONS.tileCheck}</div>`);
html = html.replace('<div class="card-icon-tile tile-amber">⏳</div>', `<div class="card-icon-tile tile-amber">${ICONS.tilePhoneOff}</div>`);
html = html.replace('<div class="card-icon-tile tile-slate">🚫</div>', `<div class="card-icon-tile tile-slate">${ICONS.tileSlash}</div>`);

// Reason cards tiles on Prep365 View
html = html.replace('<div class="card-icon-tile tile-slate" style="font-size:16px">💤</div>', `<div class="card-icon-tile tile-slate">${ICONS.tileClock}</div>`);
html = html.replace('<div class="card-icon-tile tile-rose" style="font-size:16px">📝</div>', `<div class="card-icon-tile tile-rose">${ICONS.tileFileText}</div>`);
html = html.replace('<div class="card-icon-tile tile-amber" style="font-size:16px">📑</div>', `<div class="card-icon-tile tile-amber">${ICONS.tileBookmark}</div>`);
html = html.replace('<div class="card-icon-tile tile-purple" style="font-size:16px">📉</div>', `<div class="card-icon-tile tile-purple">${ICONS.tileTrendingDown}</div>`);
html = html.replace('<div class="card-icon-tile tile-rose" style="font-size:16px">🔻</div>', `<div class="card-icon-tile tile-rose">${ICONS.tileActivity}</div>`);

// Modal close buttons
html = html.replace(
  'onclick="closePrep365BulkModal()">✕</button>',
  `onclick="closePrep365BulkModal()" class="modal-close-btn">${ICONS.close}</button>`
);
html = html.replace(
  '<h3 style="margin:0;font-size:18px;font-weight:700;color:#0F172A">📞 Confirm Outreach Calls</h3>',
  `<h3 style="margin:0;font-size:18px;font-weight:700;color:#0F172A;display:flex;align-items:center;gap:8px">${ICONS.phone} Confirm Outreach Calls</h3>`
);

fs.writeFileSync(htmlPath, html, 'utf8');
console.log('Updated index.html saved successfully. New size:', html.length);
