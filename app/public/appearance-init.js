// Applied before styles and React load so a returning visit keeps its appearance.
(() => {
  let p = {};
  try {
    p = JSON.parse(localStorage.getItem('journey.appearance') || '{}') || {};
  } catch {}
  const root = document.documentElement;
  root.dataset.palette = p.palette || 'forest';
  root.dataset.theme = p.theme || 'system';
  root.dataset.motion = String(p.reducedMotion ?? 'system');
  root.dataset.transparency = String(p.reducedTransparency ?? 'system');
  root.dataset.mapSidebarCollapse = String(p.autoCollapseMapSidebar ?? true);
  const colors = {
    forest: { light: '#f1f2ec', dark: '#0c1311' },
    atlas: { light: '#edf3f6', dark: '#102632' },
  };
  const dark =
    p.theme === 'dark' ||
    ((!p.theme || p.theme === 'system') && matchMedia('(prefers-color-scheme: dark)').matches);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', (colors[p.palette] || colors.forest)[dark ? 'dark' : 'light']);
})();
