/**
 * Global branding: applies the admin-configured logo + app title on every page.
 *
 * Logo targets:
 *   .app-logo-img, img.logo, #appSidebarLogo, [data-brand-logo]  -> always use the current logo
 *   [data-brand-logo="custom"]  -> only replaced when an admin has uploaded a custom logo
 *                                  (keeps a page's own default art, e.g. the meeting room)
 * Title targets: .app-brand-title, .brand-text .title
 */
(function () {
  const CACHE_KEY = 'app_branding';
  const DEFAULT_LOGO = '/assets/hg_logo1.png';
  const DEFAULT_TITLE = 'Prep365 AI Calling';

  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || null; } catch (_) { return null; }
  }
  function writeCache(b) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(b)); } catch (_) {}
  }

  function setSrc(img, url) {
    if (!img || !url) return;
    const current = img.getAttribute('src') || '';
    if (current !== url && !img.src.endsWith(url)) img.src = url;
  }

  function applyBranding(b) {
    if (!b) return;
    const logoUrl = b.logoUrl || DEFAULT_LOGO;
    const title = b.appTitle || DEFAULT_TITLE;

    document.querySelectorAll('.app-logo-img, img.logo, #appSidebarLogo, [data-brand-logo]').forEach(img => {
      if (img.getAttribute('data-brand-logo') === 'custom' && !b.isCustom) return;
      setSrc(img, logoUrl);
    });

    document.querySelectorAll('.app-brand-title, .brand-text .title').forEach(el => { el.textContent = title; });

    // Favicon follows a custom logo only (the default favicon is purpose-made).
    if (b.isCustom) {
      document.querySelectorAll("link[rel*='icon']").forEach(fav => { fav.href = logoUrl; });
    }

    if (document.body && document.body.hasAttribute('data-brand-dynamic-title')) {
      document.title = `${document.body.getAttribute('data-brand-dynamic-title')} — ${title}`;
    }
  }

  async function syncBranding() {
    try {
      const res = await fetch('/api/branding', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        writeCache(data);
        applyBranding(data);
        return data;
      }
    } catch (_) {}
    return null;
  }

  function init() {
    applyBranding(readCache()); // instant, from the last known branding
    syncBranding();             // then confirm with the server
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Another tab (e.g. admin Settings) changed the logo -> update this tab too.
  window.addEventListener('storage', e => { if (e.key === CACHE_KEY) applyBranding(readCache()); });

  window.getAppBranding = function () {
    return readCache() || { logoUrl: DEFAULT_LOGO, appTitle: DEFAULT_TITLE };
  };
  window.applyAppBranding = applyBranding;
  window.refreshAppBranding = syncBranding;
})();
