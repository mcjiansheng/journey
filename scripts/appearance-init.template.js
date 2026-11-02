// Applied before styles and React load so a returning visit keeps its appearance.
(() => {
  /* THEME_MODE_FUNCTION */
  let p = {};
  try { p = JSON.parse(localStorage.getItem('journey.appearance') || '{}') || {}; } catch {}
  const root = document.documentElement;
  root.dataset.palette = p.palette || 'forest';
  root.dataset.theme = p.theme || 'system';
  root.dataset.motion = String(p.reducedMotion ?? 'system');
  root.dataset.transparency = String(p.reducedTransparency ?? 'system');
  root.dataset.mapSidebarCollapse = String(p.autoCollapseMapSidebar ?? true);
  const colors = /* PALETTE_PAGE_COLORS */;
  const dark = isDark(p.theme, matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', (colors[p.palette] || colors.forest)[dark ? 'dark' : 'light']);
})();
