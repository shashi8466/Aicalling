
/* ---------- ICON LIBRARY (inline SVG, stroke-based) ---------- */
const ICONS = {
  phone: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
  megaphone: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l18-5v12L3 13v-2z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>',
  users: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  bolt: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  calendar: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  dollar: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
  chart: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M18.7 8l-5.1 5.1-2.8-2.8L7 14"/></svg>',
  grad: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1.66 2.69 3 6 3s6-1.34 6-3v-5"/></svg>',
  target: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
  link: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
  shield: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  layers: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
  clock: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  star: '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.63 22 9.24 17 14.14 18.18 21 12 17.77 5.82 21 7 14.14 2 9.24 8.91 8.63 12 2"/></svg>',
  arrowRight: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
  arrowDown: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>',
  twitter:'<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M22 5.9c-.7.35-1.5.6-2.3.7a4 4 0 0 0 1.8-2.2c-.8.45-1.6.8-2.5 1a4 4 0 0 0-6.9 3.6A11.3 11.3 0 0 1 3.9 4.9a4 4 0 0 0 1.2 5.3c-.6 0-1.2-.2-1.7-.5v.05a4 4 0 0 0 3.2 3.9c-.6.15-1.2.17-1.8.06a4 4 0 0 0 3.7 2.8A8 8 0 0 1 2 18.5a11.3 11.3 0 0 0 6.1 1.8c7.3 0 11.3-6.1 11.3-11.3v-.5c.8-.55 1.4-1.25 1.9-2z"/></svg>',
  linkedin:'<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M4.98 3.5C4.98 4.9 3.9 6 2.5 6S0 4.9 0 3.5 1.1 1 2.5 1s2.48 1.1 2.48 2.5zM.5 8.5h4V23h-4V8.5zM8.5 8.5h3.8v2h.05c.53-1 1.83-2.05 3.77-2.05 4.03 0 4.78 2.65 4.78 6.1V23h-4v-6.9c0-1.65-.03-3.77-2.3-3.77-2.3 0-2.65 1.8-2.65 3.65V23h-4V8.5z"/></svg>',
  yt:'<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M23 12s0-3.6-.46-5.3a3 3 0 0 0-2.1-2.1C18.7 4 12 4 12 4s-6.7 0-8.44.6a3 3 0 0 0-2.1 2.1C1 8.4 1 12 1 12s0 3.6.46 5.3a3 3 0 0 0 2.1 2.1C5.3 20 12 20 12 20s6.7 0 8.44-.6a3 3 0 0 0 2.1-2.1C23 15.6 23 12 23 12z"/><polygon points="10 15.5 15.5 12 10 8.5" fill="var(--bg-0)"/></svg>',
};

/* ---------- FEATURE SLIDER DATA ---------- */
const features = [
  {icon:'phone', color:'59,130,246', title:'AI Calling', desc:'Human-like AI voice conversations that qualify leads in real time.'},
  {icon:'megaphone', color:'139,108,246', title:'Campaigns', desc:'Launch bulk outreach campaigns to thousands of leads at once.'},
  {icon:'users', color:'34,197,129', title:'Lead Management', desc:'A full CRM built for the admissions funnel, start to enrolled.'},
  {icon:'bolt', color:'245,165,36', title:'Bulk Calling', desc:'Dial 1,000+ leads in parallel without adding headcount.'},
  {icon:'calendar', color:'239,90,122', title:'Meetings', desc:'Auto-book counselor meetings straight to Google Meet.'},
  {icon:'dollar', color:'34,197,129', title:'Billing', desc:'Usage-based Twilio billing, reconciled automatically.'},
  {icon:'chart', color:'59,130,246', title:'Analytics', desc:'Funnel, score, and conversion reporting on every lead.'},
  {icon:'grad', color:'139,108,246', title:'Counselor Hub', desc:'Route qualified leads to the right counselor, instantly.'},
  {icon:'target', color:'245,165,36', title:'Enrollment', desc:'Track every lead through the enrollment pipeline.'},
  {icon:'link', color:'59,130,246', title:'Integrations', desc:'Connects to OpenAI, Twilio, and Supabase out of the box.'},
];

const track = document.getElementById('sliderTrack');
features.forEach(f=>{
  track.innerHTML += `
    <div class="feat-card">
      <div class="feat-icon" style="background:rgba(${f.color},.15); color:rgb(&nbsp;${f.color})">${ICONS[f.icon]}</div>
      <h4>${f.title}</h4>
      <p>${f.desc}</p>
      <span class="pill-live">LIVE</span>
    </div>`;
});
// duplicate set for seamless loop
const trackHTML = track.innerHTML;
track.innerHTML = trackHTML + trackHTML;

/* dots */
const dotsWrap = document.getElementById('sliderDots');
features.forEach((_,i)=>{ dotsWrap.innerHTML += `<span class="${i===0?'active':''}"></span>`; });

/* slider engine: autoscroll + drag + arrows */
(function(){
  const viewport = document.getElementById('sliderViewport');
  const cardWidth = 240 + 18;
  let pos = 0;
  let autoplay = true;
  const totalSetWidth = cardWidth * features.length;

  function render(){ track.style.transform = `translateX(${-pos}px)`; updateDots(); }
  function updateDots(){
    const idx = Math.round(pos / cardWidth) % features.length;
    [...dotsWrap.children].forEach((d,i)=>d.classList.toggle('active', i===idx));
  }
  function tick(){
    if(autoplay && !viewport.classList.contains('dragging')){
      pos += 0.55;
      if(pos >= totalSetWidth) pos -= totalSetWidth;
      render();
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  viewport.addEventListener('mouseenter', ()=> autoplay = false);
  viewport.addEventListener('mouseleave', ()=> autoplay = true);

  document.getElementById('nextBtn').onclick = ()=>{ pos += cardWidth; if(pos>=totalSetWidth) pos-=totalSetWidth; render(); };
  document.getElementById('prevBtn').onclick = ()=>{ pos -= cardWidth; if(pos<0) pos+=totalSetWidth; render(); };

  /* drag / swipe */
  let isDown=false, startX=0, startPos=0;
  viewport.addEventListener('pointerdown', e=>{ isDown=true; viewport.classList.add('dragging'); startX=e.clientX; startPos=pos; });
  window.addEventListener('pointermove', e=>{
    if(!isDown) return;
    const dx = e.clientX - startX;
    pos = startPos - dx;
    if(pos<0) pos += totalSetWidth;
    if(pos>=totalSetWidth) pos -= totalSetWidth;
    render();
  });
  window.addEventListener('pointerup', () => {
    isDown = false;
    viewport.classList.remove('dragging');
  });
})();

/* ---------- WORKFLOW DATA ---------- */
const workflowSteps = [
  { icon: 'users', color: '59,130,246', index: '01', title: 'Lead Capture', desc: 'Sync leads automatically from Google Sheets, Meta Forms, or your CRM.' },
  { icon: 'phone', color: '139,108,246', index: '02', title: 'Instant Dial', desc: 'The AI caller initiates a call within 30 seconds of lead capture.' },
  { icon: 'bolt', color: '34,197,129', index: '03', title: 'Qualification', desc: 'Human-like conversation determines intent, interest, and budget.' },
  { icon: 'calendar', color: '239,90,122', index: '04', title: 'Auto-Booking', desc: 'Qualified leads are scheduled directly to counselor calendars.' },
  { icon: 'target', color: '245,165,36', index: '05', title: 'CRM Sync & Follow-up', desc: 'Automatic sheets update, webhook triggers, and counselor emails.' }
];

const wfWrap = document.getElementById('wfWrap');
workflowSteps.forEach(wf => {
  wfWrap.innerHTML += `
    <div class="wf-card reveal">
      <div class="wf-top">
        <div class="wf-node" style="background:rgba(${wf.color},.15); color:rgb(${wf.color})">${ICONS[wf.icon]}</div>
        <span class="wf-index">${wf.index}</span>
      </div>
      <h4>${wf.title}</h4>
      <p>${wf.desc}</p>
      <div class="wf-arrow">${ICONS.arrowRight}</div>
      <div class="wf-arrow down">${ICONS.arrowDown}</div>
    </div>
  `;
});

/* ---------- DASHBOARD PREVIEW POPULATION ---------- */
const dashStats = [
  { icon: 'phone', color: '59,130,246', num: '14,832', lbl: 'Total Calls Dialed', delta: '↑ 12.4% vs last week' },
  { icon: 'users', color: '139,108,246', num: '82.3%', lbl: 'Call Answer Rate', delta: '↑ 3.8% vs last week' },
  { icon: 'bolt', color: '34,197,129', num: '2,941', lbl: 'Qualified Leads', delta: '↑ 18.2% vs last week' },
  { icon: 'calendar', color: '239,90,122', num: '1,492', lbl: 'Meetings Booked', delta: '↑ 8.6% vs last week' },
  { icon: 'target', color: '245,165,36', num: '18.4%', lbl: 'Enrollment Rate', delta: '↑ 2.1% vs last week' },
  { icon: 'dollar', color: '34,197,129', num: '$245.80', lbl: 'Twilio Reconciled', delta: 'Reconciled 100%' }
];

const dashStatsRow = document.getElementById('dashStatsRow');
dashStats.forEach(s => {
  dashStatsRow.innerHTML += `
    <div class="dstat">
      <div class="dicon" style="background:rgba(${s.color},.15); color:rgb(${s.color})">${ICONS[s.icon]}</div>
      <div class="dnum">${s.num}</div>
      <div class="dlbl">${s.lbl}</div>
      <div class="ddelta">${s.delta}</div>
    </div>
  `;
});

const funnelSteps = [
  { label: 'Total Leads Captured', num: '5,248', pct: '100%' },
  { label: 'Outbound Calls Initiated', num: '5,248', pct: '100%' },
  { label: 'Connected Calls', num: '4,319', pct: '82.3%' },
  { label: 'Qualified Leads', num: '2,941', pct: '56.0%' },
  { label: 'Google Meet Booked', num: '1,492', pct: '28.4%' },
  { label: 'Students Enrolled', num: '965', pct: '18.4%' }
];

const funnelCard = document.getElementById('funnelCard');
funnelSteps.forEach(f => {
  funnelCard.innerHTML += `
    <div class="frow">
      <div class="frow-top"><span>${f.label}</span><span>${f.num} (${f.pct})</span></div>
      <div class="fbar"><i style="width:${f.pct}; background:var(--grad-signal);"></i></div>
    </div>
  `;
});

/* ---------- WHY CHOOSE DATA ---------- */
const whyItems = [
  { icon: 'shield', color: '59,130,246', title: 'Admissions-First Architecture', desc: 'Unlike sales tools retrofitted for schools, Aiprep365 is designed directly around academic intake, parent conversations, and counselor routing.' },
  { icon: 'clock', color: '139,108,246', title: 'Ultra-Low Latency Calling', desc: 'Powered by state-of-the-art neural speech pipelines with sub-second response latency. Students won\'t even realize they\'re speaking to an AI agent.' },
  { icon: 'layers', color: '34,197,129', title: 'Transparent Billing Integration', desc: 'Connect your own Twilio keys directly. Pay carrier wholesale rates without a single penny of markup or hidden transaction fees.' }
];

const whyGrid = document.getElementById('whyGrid');
whyItems.forEach(w => {
  whyGrid.innerHTML += `
    <div class="why-card reveal">
      <div class="why-icon" style="background:rgba(${w.color},.15); color:rgb(${w.color})">${ICONS[w.icon]}</div>
      <h4>${w.title}</h4>
      <p>${w.desc}</p>
    </div>
  `;
});

/* ---------- STATS GRID ---------- */
const statsList = [
  { val: 30, suffix: 's', decimals: 0, lbl: 'Average Speed-to-Contact' },
  { val: 2.4, suffix: 'x', decimals: 1, lbl: 'Increase in Qualified Pipeline' },
  { val: 82.3, suffix: '%', decimals: 1, lbl: 'Average Answer Connection Rate' }
];

const statsGrid = document.getElementById('statsGrid');
statsList.forEach((s, idx) => {
  statsGrid.innerHTML += `
    <div class="reveal">
      <div class="stat-num" id="statNum${idx}">0${s.suffix}</div>
      <div class="stat-lbl">${s.lbl}</div>
    </div>
  `;
});

// Number counting animation
const statsObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting && !statsGrid.classList.contains('counted')) {
      statsGrid.classList.add('counted');
      statsList.forEach((s, idx) => {
        const el = document.getElementById(`statNum${idx}`);
        const duration = 2000;
        const startTime = performance.now();
        
        function update(currentTime) {
          const elapsed = currentTime - startTime;
          const progress = Math.min(elapsed / duration, 1);
          const easeProgress = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
          
          const currentVal = (s.val * easeProgress).toFixed(s.decimals);
          el.innerText = currentVal + s.suffix;
          
          if (progress < 1) {
            requestAnimationFrame(update);
          } else {
            el.innerText = s.val.toFixed(s.decimals) + s.suffix;
          }
        }
        requestAnimationFrame(update);
      });
    }
  });
}, { threshold: 0.5 });

if(statsGrid) statsObserver.observe(statsGrid);


/* ---------- PRICING PLANS ---------- */
const plans = [
  { name: 'Starter', desc: 'Perfect for small programs getting started with AI qualification.', price: '$49', sub: 'Plus Twilio carrier costs', features: ['Up to 500 qualification calls / mo', 'Google Sheets Integration', '1 Custom AI Voice Profile', 'Standard Webhooks', 'Email Support'], btnText: 'Start Free Trial', featured: false },
  { name: 'Growth', desc: 'For active admissions teams scaling up qualification & bookings.', price: '$149', sub: 'Plus Twilio carrier costs', features: ['Up to 2,500 qualification calls / mo', 'Deep CRM Integrations', 'Unlimited Custom Voices', 'Advanced Analytics Dashboard', 'Priority Live Chat Support'], btnText: 'Start 14-Day Free Trial', featured: true },
  { name: 'Enterprise', desc: 'Custom enterprise SLA and dedicated neural calling capacity.', price: 'Custom', sub: 'Volume discounts on Twilio costs', features: ['Unlimited qualification calls', 'Dedicated Server Capacity', 'Custom LLM fine-tuning', 'Dedicated Account Manager', 'Custom Integration Engineering'], btnText: 'Contact Sales', featured: false }
];

const pricingGrid = document.getElementById('pricingGrid');
plans.forEach(p => {
  pricingGrid.innerHTML += `
    <div class="price-card reveal ${p.featured ? 'hi' : ''}">
      ${p.featured ? '<span class="price-badge">POPULAR</span>' : ''}
      <h4>${p.name}</h4>
      <p class="desc">${p.desc}</p>
      <div class="price-amt">${p.price}<span>${p.price.startsWith('$') ? '/mo' : ''}</span></div>
      <div class="price-per">${p.sub}</div>
      <ul class="price-feats">
        ${p.features.map(f => `<li>${ICONS.check}${f}</li>`).join('')}
      </ul>
      <a href="/login" class="btn ${p.featured ? 'btn-primary' : 'btn-ghost'}">${p.btnText}</a>
    </div>
  `;
});

/* ---------- FAQs ---------- */
const faqs = [
  { q: 'How does the AI Admissions Agent sound?', a: 'We leverage state-of-the-art neural voice text-to-speech models that incorporate natural breathing, custom pause timings, and professional tone inflection. In testing, over 85% of prospective students engaged with the agent exactly as they would with a human counselor.' },
  { q: 'How does the Twilio billing integration work?', a: 'You input your own Twilio API credentials directly into our settings. Aiprep365 routes your qualification calls directly through your Twilio account, ensuring you pay carrier-wholesale rates with 0% markup. Our billing engine reconciles and reports your exact call usage in real time.' },
  { q: 'Can we customize the qualification script and criteria?', a: 'Absolutely! Our dashboard includes an interactive prompt builder where you can configure qualification requirements (e.g. academic interests, GPA checks, parent involvement, call time window preferences) and counselor routing logic.' },
  { q: 'What CRMs and Sheets do you support?', a: 'We natively sync with Google Sheets, and support webhooks that connect to Salesforce, HubSpot, Zapier, and other standard student information systems.' }
];

const faqList = document.getElementById('faqList');
faqs.forEach(f => {
  faqList.innerHTML += `
    <div class="faq-item reveal">
      <button class="faq-q">
        <span>${f.q}</span>
        <span class="qmark">+</span>
      </button>
      <div class="faq-a">
        <p>${f.a}</p>
      </div>
    </div>
  `;
});

/* Toggle FAQ answers */
document.querySelectorAll('.faq-q').forEach(q => {
  q.onclick = () => {
    const parent = q.parentElement;
    const answer = q.nextElementSibling;
    const isOpen = parent.classList.contains('open');
    
    // Close other FAQs
    document.querySelectorAll('.faq-item').forEach(item => {
      item.classList.remove('open');
      item.querySelector('.faq-a').style.maxHeight = null;
    });

    if (!isOpen) {
      parent.classList.add('open');
      answer.style.maxHeight = answer.scrollHeight + 'px';
    }
  };
});

/* ---------- SOCIAL ROW ---------- */
const socRow = document.getElementById('socRow');
socRow.innerHTML = `
  <a href="#">${ICONS.twitter}</a>
  <a href="#">${ICONS.linkedin}</a>
  <a href="#">${ICONS.yt}</a>
`;

/* ---------- WAVEFORM GENERATORS ---------- */
const heroWave = document.getElementById('heroWave');
const callWave = document.getElementById('callWave');

for (let i = 0; i < 20; i++) {
  heroWave.innerHTML += `<span style="height: ${Math.random() * 80 + 10}%; animation-delay: ${Math.random() * 0.8}s"></span>`;
}
for (let i = 0; i < 40; i++) {
  callWave.innerHTML += `<span style="height: ${Math.random() * 80 + 10}%; animation-delay: ${Math.random() * 0.8}s"></span>`;
}

/* ---------- LIVE CALL DIALOGUE SIMULATION ---------- */
const dialogue = [
  { speaker: 'ai', text: 'Hi Shashi! I saw you registered for our SAT prep demo program. Are you looking to boost your score for university?' },
  { speaker: 'student', text: 'Yeah, I am trying to get at least a 1450 to apply to UC schools.' },
  { speaker: 'ai', text: 'That\'s an excellent goal. We\'ve helped hundreds of students reach that range. Are you currently in your junior or senior year?' },
  { speaker: 'student', text: 'I\'m a junior, so I\'m taking the test this November.' },
  { speaker: 'ai', text: 'Perfect timing. Our admissions counselor Antra is scheduling 15-minute diagnostic reviews tomorrow. Would 3 PM work for you?' },
  { speaker: 'student', text: 'Yes, 3 PM works. That would be awesome!' },
  { speaker: 'ai', text: 'Great! I\'ve scheduled a video meeting with Antra for tomorrow at 3 PM and sent a calendar invite. Have a wonderful day!' }
];

const callTranscript = document.getElementById('callTranscript');
let dialogIdx = 0;

function showNextLine() {
  if (dialogIdx >= dialogue.length) {
    callTranscript.innerHTML = '';
    dialogIdx = 0;
  }
  const line = dialogue[dialogIdx];
  const div = document.createElement('div');
  div.className = `tr-line ${line.speaker} reveal`;
  div.innerHTML = `
    <span class="tr-tag">${line.speaker === 'ai' ? 'AI Agent' : 'Shashi (Student)'}</span>
    ${line.text}
  `;
  callTranscript.appendChild(div);
  
  // scroll transcript to bottom
  callTranscript.scrollTop = callTranscript.scrollHeight;

  // trigger animation
  setTimeout(() => div.classList.add('in'), 100);

  dialogIdx++;
  setTimeout(showNextLine, line.text.length * 70 + 1500);
}
setTimeout(showNextLine, 1000);

/* ---------- CALL TIMER ---------- */
const callTimer = document.getElementById('callTimer');
let timerSec = 0;
setInterval(() => {
  timerSec++;
  const mins = String(Math.floor(timerSec / 60)).padStart(2, '0');
  const secs = String(timerSec % 60).padStart(2, '0');
  callTimer.innerHTML = `LIVE · ${mins}:${secs}`;
}, 1000);

/* ---------- SCROLL REVEALS ---------- */
const observer = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.classList.add('in');
    }
  });
}, { threshold: 0.1 });

document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

/* ---------- BURGER MENU TOGGLE ---------- */
const burger = document.querySelector('.burger');
const navlinks = document.querySelector('.navlinks');
if (burger && navlinks) {
  burger.onclick = () => {
    navlinks.classList.toggle('mobile-open');
  };
  navlinks.querySelectorAll('a').forEach(link => {
    link.onclick = () => {
      navlinks.classList.remove('mobile-open');
    };
  });
}
/* ---------- TESTIMONIALS LOGIC ---------- */
const testimonialsData = [
  {
    quote: "\"AI Admissions Agent reduced our admissions team's manual call workload by 80% in the first month.\"",
    authorName: "M. Alvarez",
    authorTitle: "Admissions Director, Crestline Academy",
    avatar: "MA",
    stars: 5
  },
  {
    quote: "\"We've seen our connection rates double since switching to AI calling. It's incredibly realistic.\"",
    authorName: "S. Reynolds",
    authorTitle: "VP of Enrollment, Union Tech",
    avatar: "SR",
    stars: 5
  },
  {
    quote: "\"The seamless CRM integration means our counselors only spend time talking to qualified, high-intent leads.\"",
    authorName: "J. Chen",
    authorTitle: "Director of Admissions, Meridian University",
    avatar: "JC",
    stars: 5
  }
];

let testiIdx = 0;
let testiTimer;
const testiInner = document.getElementById('testiInner');
const testiText = document.getElementById('testiText');
const testiAuthorName = document.getElementById('testiAuthorName');
const testiAuthorTitle = document.getElementById('testiAuthorTitle');
const testiAvatar = document.getElementById('testiAvatar');
const testiStars = document.getElementById('testiStars');
const testiCard = document.getElementById('testiCard');

function renderTestimonial(idx) {
  testiInner.classList.add('fade-out');
  setTimeout(() => {
    const t = testimonialsData[idx];
    testiText.innerText = t.quote;
    testiAuthorName.innerText = t.authorName;
    testiAuthorTitle.innerText = t.authorTitle;
    testiAvatar.innerText = t.avatar;
    testiStars.innerHTML = Array(t.stars).fill(ICONS.star).join('');
    testiInner.classList.remove('fade-out');
  }, 300);
}

function nextTestimonial() {
  testiIdx = (testiIdx + 1) % testimonialsData.length;
  renderTestimonial(testiIdx);
}
function prevTestimonial() {
  testiIdx = (testiIdx - 1 + testimonialsData.length) % testimonialsData.length;
  renderTestimonial(testiIdx);
}

function startTestiTimer() {
  stopTestiTimer();
  testiTimer = setInterval(nextTestimonial, 3000);
}
function stopTestiTimer() {
  if (testiTimer) clearInterval(testiTimer);
}
if (testiCard) {
  document.getElementById('testiNext').addEventListener('click', () => { nextTestimonial(); startTestiTimer(); });
  document.getElementById('testiPrev').addEventListener('click', () => { prevTestimonial(); startTestiTimer(); });
  testiCard.addEventListener('mouseenter', stopTestiTimer);
  testiCard.addEventListener('mouseleave', startTestiTimer);

  renderTestimonial(testiIdx);
  startTestiTimer();
}
