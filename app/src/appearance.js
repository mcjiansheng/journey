export const appearanceKey = 'journey.appearance';
// A pending save belongs to the app, so reopening settings cannot submit over it.
let savingAppearance = false;
const saveListeners = new Set();
export const appearanceSave = {
  subscribe(listener) {
    saveListeners.add(listener);
    return () => saveListeners.delete(listener);
  },
  getSnapshot: () => savingAppearance,
  begin() {
    if (savingAppearance) return false;
    savingAppearance = true;
    saveListeners.forEach((listener) => listener());
    return true;
  },
  end() {
    savingAppearance = false;
    saveListeners.forEach((listener) => listener());
  },
};
export const accountAppearanceKeys = [
  'palette',
  'theme',
  'reducedMotion',
  'reducedTransparency',
  'collaborationNotifications',
];
export function readAppearance(storage = localStorage) {
  try {
    return JSON.parse(storage.getItem(appearanceKey) || '{}') || {};
  } catch {
    return {};
  }
}
const accountDefaults = {
  palette: 'forest',
  theme: 'system',
  reducedMotion: 'system',
  reducedTransparency: 'system',
  collaborationNotifications: false,
};
export function mergeAccountAppearance(local, account) {
  const next = { ...local };
  for (const key of accountAppearanceKeys)
    if (account) next[key] = account[key] ?? accountDefaults[key];
  return next;
}
export function applyAppearance(p) {
  const root = document.documentElement;
  root.dataset.palette = p?.palette || 'forest';
  root.dataset.theme = p?.theme || 'system';
  root.dataset.motion = String(p?.reducedMotion ?? 'system');
  root.dataset.transparency = String(p?.reducedTransparency ?? 'system');
  root.dataset.mapSidebarCollapse = String(p?.autoCollapseMapSidebar ?? true);
  const dark =
    p?.theme === 'dark' ||
    ((!p?.theme || p.theme === 'system') && matchMedia('(prefers-color-scheme: dark)').matches);
  const color = getComputedStyle(root).getPropertyValue('--bg').trim();
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', color || (dark ? '#17231e' : '#edf1ec'));
}
