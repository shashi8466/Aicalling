(function() {
  const CACHE_KEY = 'app_branding';
  const DEFAULT_LOGO = '/assets/hg_logo1.png';
  const DEFAULT_TITLE = 'Prep365 AI Calling';

  function applyBranding(b) {
    if (!b) return;
    const logoUrl = b.logoUrl || DEFAULT_LOGO;
    const title = b.appTitle || DEFAULT_TITLE;

    // Update all logo images
    const logoImgs = document.querySelectorAll('.app-logo-img, img.logo, [data-brand-logo], #appSidebarLogo');
    logoImgs.forEach(img => {
      if (img.src !== logoUrl && !img.src.endsWith(logoUrl)) {
        img.src = logoUrl;
      }
    });

    // Update brand titles
    const titleEls = document.querySelectorAll('.app-brand-title, .brand-text .title');
    titleEls.forEach(el => {
      el.textContent = title;
    });

    // Update favicon
    try {
      const favicons = document.querySelectorAll("link[rel*='icon']");
      favicons.forEach(fav => {
        if (fav && logoUrl) fav.href = logoUrl;
      });
    } catch (_) {}

    // Update page titles if requested
    if (document.body.hasAttribute('data-brand-dynamic-title')) {
      const baseTitle = document.body.getAttribute('data-brand-dynamic-title');
      document.title = `${baseTitle} — ${title}`;
    }
  }

  // 1. Instant apply from local cache (zero flicker)
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      applyBranding(JSON.parse(cached));
    }
  } catch (_) {}

  // 2. Fetch latest from backend
  async function syncBranding() {
    try {
      const res = await fetch('/api/branding');
      if (res.ok) {
        const data = await res.json();
        localStorage.setItem(CACHE_KEY, JSON.stringify(data));
        applyBranding(data);
        return data;
      }
    } catch (_) {}
    return null;
  }

  // Run on DOMContentLoaded or immediately
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncBranding);
  } else {
    syncBranding();
  }

  window.getAppBranding = function() {
    try {
      return JSON.parse(localStorage.getItem(CACHE_KEY)) || { logoUrl: DEFAULT_LOGO, appTitle: DEFAULT_TITLE };
    } catch (_) {
      return { logoUrl: DEFAULT_LOGO, appTitle: DEFAULT_TITLE };
    }
  };

  window.refreshAppBranding = syncBranding;
})();
