
  // ═══════════════════════════════════════════════════════════════════════
  //   BULK EMAIL — State & Constants
  // ═══════════════════════════════════════════════════════════════════════
  const BULK_EMAIL_TEMPLATES = [
    { key:'welcome',          label:'Welcome Email',        icon:'👋', desc:'First contact welcome message' },
    { key:'confirmation',     label:'Meeting Confirmation', icon:'✅', desc:'Confirm a scheduled meeting' },
    { key:'reminder',         label:'Meeting Reminder',     icon:'⏰', desc:'Remind about upcoming meeting' },
    { key:'noAnswer',         label:'No Answer Follow-up',  icon:'📵', desc:'Sent when lead doesn\'t answer' },
    { key:'success-stories',  label:'Success Stories',      icon:'🏆', desc:'Share student success stories' },
    { key:'enrollment',       label:'Enrollment Follow-up', icon:'📝', desc:'Follow-up after qualification' },
    { key:'thankyou',         label:'Thank You Email',      icon:'🙏', desc:'Post-meeting thank you' },
    { key:'programBenefits',  label:'Program Benefits',     icon:'📚', desc:'Highlight program advantages' },
    { key:'limitedSeat',      label:'Limited Seat Alert',   icon:'⚠️', desc:'Urgency — seats filling up' },
    { key:'counselorReachOut',label:'Counselor Reach-Out',  icon:'👩‍💼', desc:'Personal check-in from counselor' },
    { key:'reEngagement',     label:'Re-Engagement',        icon:'🔄', desc:'Re-engage cold/inactive leads' },
    { key:'parentDiscussion', label:'Parent Discussion',    icon:'👪', desc:'Invite parents to discuss' },
  ];

  const TEMPLATE_PREVIEWS = {
    welcome:          { subject:'Welcome to [Company] – We\'ll be in touch, {Student Name}! 🎓', body:'Hello {Student Name},\n\nThank you for your interest in our programs. We\'re excited to connect with you about your academic journey.\n\nOur admissions counselor will reach out to you shortly to discuss how we can help you achieve your goals.\n\nBest regards,\nThe Admissions Team' },
    confirmation:     { subject:'✅ Consultation Confirmed – {Date} at {Time}', body:'Hello {Student Name},\n\nGreat news! Your free admissions consultation has been confirmed.\n\n📅 Date & Time: {Meeting Date} at {Meeting Time}\n🔗 Meeting Link: {Meet Link}\n\nPlease join from a quiet room with a working microphone and camera. We look forward to speaking with you!\n\nBest,\n{Counselor Name}' },
    reminder:         { subject:'⏰ Reminder: Your Consultation is Tomorrow – {Date}', body:'Hello {Student Name},\n\nJust a friendly reminder that your free admissions consultation is scheduled for tomorrow.\n\n📅 {Meeting Date} at {Meeting Time}\n🔗 {Meet Link}\n\nPlease make sure you have a quiet space and your microphone/camera ready. See you soon!\n\n{Counselor Name}' },
    noAnswer:         { subject:'We tried to reach you – {Student Name}', body:'Hello {Student Name},\n\nOur AI admissions assistant tried to reach you today but was unable to connect.\n\nWe\'d love to discuss how we can help with {Program}. Would you have a few minutes for a call?\n\nBest,\n{Counselor Name}' },
    'success-stories':{ subject:'🏆 See How Students Like {Student Name} Are Succeeding', body:'Hello {Student Name},\n\nWe\'ve helped hundreds of students like you achieve amazing results in their academic journey.\n\nOur students have seen:\n• Significant score improvements on SAT/ACT\n• Acceptance to top universities\n• Personalized study plans that actually work\n\nLet\'s talk about {Student Name}\'s goals!\n\n{Counselor Name}' },
    enrollment:       { subject:'Ready to take the next step? 🚀', body:'Hello {Parent Name},\n\nIt was wonderful speaking with you about {Student Name}\'s academic goals. I hope our consultation gave you a clear picture of how we can make a difference.\n\n🎯 Recommended Program: {Program}\n\nTo secure your spot and lock in current pricing, you can enroll today.\n\n{Counselor Name}' },
    thankyou:         { subject:'⏳ Last chance to secure {Student Name}\'s spot', body:'Hello {Parent Name},\n\nThank you so much for meeting with us! We truly enjoyed learning about {Student Name}\'s goals.\n\nWe have a few spots remaining in the upcoming cohort. I would hate for {Student Name} to miss out.\n\nReply to this email or give us a call to secure their spot!\n\n{Counselor Name}' },
    programBenefits:  { subject:'Why students choose us – {Student Name}\'s program breakdown', body:'Hello {Student Name},\n\nWe wanted to share what makes our {Program} program the best choice for students like you:\n\n✅ Personalized learning plan\n✅ Expert instructors with proven results\n✅ Flexible scheduling\n✅ Score improvement guarantee\n\nLet\'s discuss how this fits your goals.\n\n{Counselor Name}' },
    limitedSeat:      { subject:'⚠️ Limited seats remaining – secure {Student Name}\'s spot now', body:'Hello {Parent Name},\n\nI wanted to personally reach out because seats in our upcoming {Program} cohort are filling up fast.\n\nWe currently have only a few spots left for the session starting soon.\n\nI\'d hate for {Student Name} to miss this opportunity. Can we hop on a quick call today?\n\n{Counselor Name}' },
    counselorReachOut:{ subject:'{Student Name}, I wanted to personally check in 👋', body:'Hello {Student Name},\n\nI\'m {Counselor Name}, your admissions counselor here. I noticed you expressed interest in {Program} and wanted to personally reach out.\n\nI know deciding on a test prep program is a big decision, and I\'m here to answer any questions you might have.\n\nWould you be open to a quick 15-minute call this week?\n\n{Counselor Name}' },
    reEngagement:     { subject:'Still thinking about it? We\'re here for {Student Name} whenever you\'re ready', body:'Hello {Student Name},\n\nWe know life gets busy, and decisions like these take time.\n\nWe wanted to reach out one more time to let you know that we\'re still here when you\'re ready.\n\n{Program} enrollment is still open, and we\'d love to help {Student Name} achieve their goals.\n\n{Counselor Name}' },
    parentDiscussion: { subject:'{Parent Name} — Let\'s discuss {Student Name}\'s academic future', body:'Hello {Parent Name},\n\nI wanted to reach out directly to you to discuss {Student Name}\'s academic journey and how our {Program} program can support their goals.\n\nParent involvement makes a huge difference in student success, and I\'d love to answer any questions you might have.\n\nWould you be available for a brief call this week?\n\n{Counselor Name}' },
  };

  let _bemActiveSet = 'main'; // 'main' | 'clp' | 'pclp'
  let _bemSelectedKey = null;
  let _bemSendOpt = 'now';
  let _bemJobId = null;
  let _bemPollTimer = null;

  function _getBemLeadIds() {
    if (_bemActiveSet === 'clp') return [...(typeof _selectedCampaignLeads !== 'undefined' ? _selectedCampaignLeads : [])];
    if (_bemActiveSet === 'pclp') return [...(typeof _selectedParentCampaignLeads !== 'undefined' ? _selectedParentCampaignLeads : [])];
    return [..._selectedLeads];
  }

  // ─── Open/Close ──────────────────────────────────────────────────────
  function openBulkEmailModal(set = 'main') {
    _bemActiveSet = set;
    _bemSelectedKey = null;
    _bemSendOpt = 'now';
    _bemJobId = null;
    clearInterval(_bemPollTimer);

    const ids = _getBemLeadIds();
    if (!ids.length) { toast('Select at least one lead first', 'error'); return; }

    // Reset steps
    bemGoStep(1);
    document.getElementById('bemLeadCount').textContent = ids.length;
    document.getElementById('bemSummaryCount').textContent = ids.length;

    // Render template cards
    const grid = document.getElementById('bemTplGrid');
    grid.innerHTML = BULK_EMAIL_TEMPLATES.map(t => `
      <div class="tpl-card" id="tplCard_${t.key}" onclick="selectBemTemplate('${t.key}')">
        <div class="tpl-icon">${t.icon}</div>
        <div class="tpl-info">
          <div class="tpl-name">${esc(t.label)}</div>
          <div class="tpl-desc">${esc(t.desc)}</div>
        </div>
      </div>
    `).join('');

    document.getElementById('bulkEmailModal').classList.add('active');
  }

  function closeBulkEmailModal() {
    document.getElementById('bulkEmailModal').classList.remove('active');
    clearInterval(_bemPollTimer);
    _bemPollTimer = null;
    _bemJobId = null;
  }

  // ─── Step navigation ─────────────────────────────────────────────────
  function bemGoStep(n) {
    [1,2,3,4].forEach(i => {
      document.getElementById('bemPanel' + i).classList.toggle('active', i === n);
      const ind = document.getElementById('bemStep' + i + 'Ind');
      ind.classList.remove('active','done');
      if (i === n) ind.classList.add('active');
      else if (i < n) ind.classList.add('done');
    });
  }

  function bemGoStep2() {
    if (!_bemSelectedKey) { toast('Choose a template first', 'error'); return; }
    // Load preview
    const preview = TEMPLATE_PREVIEWS[_bemSelectedKey] || { subject:'Custom template', body:'Email content varies per lead.' };
    document.getElementById('bemPreviewSubject').innerHTML = '<strong>Subject:</strong> ' + esc(preview.subject);
    document.getElementById('bemPreviewBody').innerHTML = esc(preview.body).replace(/\n/g,'<br>').replace(/\{([^}]+)\}/g, '<span style="background:rgba(99,102,241,.2);color:#a5b4fc;padding:1px 5px;border-radius:4px;">{$1}</span>');
    const tpl = BULK_EMAIL_TEMPLATES.find(t => t.key === _bemSelectedKey);
    document.getElementById('bemSubtitle').textContent = 'Preview: ' + (tpl ? tpl.label : _bemSelectedKey);
    bemGoStep(2);
  }

  // ─── Template selection ───────────────────────────────────────────────
  function selectBemTemplate(key) {
    _bemSelectedKey = key;
    document.querySelectorAll('.tpl-card').forEach(el => el.classList.remove('selected'));
    const card = document.getElementById('tplCard_' + key);
    if (card) card.classList.add('selected');
    const btn = document.getElementById('bemToStep2Btn');
    if (btn) btn.disabled = false;
  }

  // ─── Send option ──────────────────────────────────────────────────────
  function selectSendOpt(opt) {
    _bemSendOpt = opt;
    document.getElementById('sendOptNow').classList.toggle('selected', opt === 'now');
    document.getElementById('sendOptSchedule').classList.toggle('selected', opt === 'schedule');
    document.getElementById('scheduleFields').style.display = opt === 'schedule' ? 'block' : 'none';
    const sendBtn = document.getElementById('bemSendBtn');
    if (sendBtn) {
      sendBtn.textContent = opt === 'schedule' ? '📅 Schedule Emails' : '📧 Send Emails Now';
    }
    const tpl = BULK_EMAIL_TEMPLATES.find(t => t.key === _bemSelectedKey);
    document.getElementById('bemSummaryTemplate').textContent = tpl ? tpl.label : _bemSelectedKey;
    document.getElementById('bemSummaryWhen').textContent = opt === 'schedule' ? 'Scheduled' : 'Immediately';
  }

  // Also update summary on step 3 display
  const _origBemGoStep = bemGoStep;

  // ─── Execute send ─────────────────────────────────────────────────────
  async function executeBulkEmail() {
    const ids = _getBemLeadIds();
    if (!ids.length) { toast('No leads selected', 'error'); return; }
    if (!_bemSelectedKey) { toast('No template selected', 'error'); return; }

    const tpl = BULK_EMAIL_TEMPLATES.find(t => t.key === _bemSelectedKey);
    const label = tpl ? tpl.label : _bemSelectedKey;

    // Update summary before advancing
    document.getElementById('bemSummaryTemplate').textContent = label;
    document.getElementById('bemSummaryCount').textContent = ids.length;

    // Move to progress step immediately
    bemGoStep(4);
    document.getElementById('bemProgressTitle').textContent = `Sending ${label} to ${ids.length} lead(s)...`;
    document.getElementById('bemStatPending').textContent = ids.length;
    document.getElementById('bemStatSent').textContent = '0';
    document.getElementById('bemStatFailed').textContent = '0';
    document.getElementById('bemProgressBar').style.width = '0%';
    document.getElementById('bemDoneMsg').style.display = 'none';
    document.getElementById('bemErrorsList').style.display = 'none';

    try {
      const result = await api('/leads/bulk-email', {
        method: 'POST',
        body: JSON.stringify({ leadIds: ids, templateType: _bemSelectedKey }),
      });

      if (!result.ok) { toast('❌ ' + (result.error || 'Failed to start bulk email'), 'error'); return; }

      _bemJobId = result.jobId;
      toast(`✅ Bulk email job started for ${ids.length} lead(s)`, 'success');

      // Poll for progress
      _bemPollTimer = setInterval(async () => {
        try {
          const job = await api('/leads/bulk-email/progress/' + _bemJobId);
          const total = job.total || 1;
          const processed = job.sent + job.failed;
          const pct = Math.round((processed / total) * 100);

          document.getElementById('bemProgressBar').style.width = pct + '%';
          document.getElementById('bemStatSent').textContent = job.sent;
          document.getElementById('bemStatPending').textContent = job.pending;
          document.getElementById('bemStatFailed').textContent = job.failed;

          if (job.errors && job.errors.length) {
            const errEl = document.getElementById('bemErrorsList');
            errEl.style.display = 'block';
            errEl.innerHTML = job.errors.map(e =>
              `<div>❌ ${esc(e.leadName || e.id)}: ${esc(e.error)}</div>`
            ).join('');
          }

          if (job.done) {
            clearInterval(_bemPollTimer);
            _bemPollTimer = null;
            document.getElementById('bemProgressTitle').textContent = `✅ Done! ${job.sent} sent, ${job.failed} failed.`;
            document.getElementById('bemProgressBar').style.width = '100%';
            if (job.failed === 0) {
              document.getElementById('bemDoneMsg').style.display = 'block';
            }
            // Refresh leads to show updated email history
            if (typeof loadLeads === 'function') loadLeads();
          }
        } catch (e) {
          // Job might be gone — stop polling
          clearInterval(_bemPollTimer);
          _bemPollTimer = null;
        }
      }, 2000);

    } catch(e) {
      toast('❌ ' + e.message, 'error');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //   EMAIL ANALYTICS
  // ═══════════════════════════════════════════════════════════════════════
  async function loadEmailAnalytics() {
    try {
      const d = await api('/email-analytics');
      const el = v => document.getElementById(v);
      if (el('ea_total')) el('ea_total').textContent = d.totalEmails || 0;
      if (el('ea_sent'))  el('ea_sent').textContent  = d.totalSent  || 0;
      if (el('ea_failed'))el('ea_failed').textContent= d.totalFailed|| 0;
      const rate = d.totalEmails ? Math.round((d.totalSent / d.totalEmails) * 100) : 0;
      if (el('ea_rate')) el('ea_rate').textContent = rate + '%';

      const byTpl = document.getElementById('emailAnByTemplate');
      if (byTpl) {
        if (!d.byTemplate || !d.byTemplate.length) {
          byTpl.innerHTML = '<div style="color:var(--muted);font-size:13px">No emails sent yet.</div>';
        } else {
          const max = d.byTemplate[0].count;
          byTpl.innerHTML = d.byTemplate.map(t => {
            const pct = Math.round((t.count / max) * 100);
            return `
              <div style="margin-bottom:10px;">
                <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">
                  <span style="font-weight:600;">${esc(t.label)}</span>
                  <span style="color:var(--muted);">${t.count}</span>
                </div>
                <div style="background:var(--panel2);border-radius:999px;height:8px;overflow:hidden;">
                  <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#6366f1,#8b5cf6);border-radius:999px;transition:width .4s;"></div>
                </div>
              </div>`;
          }).join('');
        }
      }
    } catch(e) {
      console.warn('Email analytics failed:', e.message);
    }
  }

  // Auto-load email analytics when analytics view is opened
  const _origShowView = typeof showView === 'function' ? showView : null;
  document.addEventListener('DOMContentLoaded', () => {
    // Hook into view switching to load analytics
    document.querySelectorAll('[data-view="analytics"]').forEach(el => {
      el.addEventListener('click', () => {
        setTimeout(loadEmailAnalytics, 300);
      });
    });
  });

  