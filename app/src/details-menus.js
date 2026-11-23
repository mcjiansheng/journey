// Shared behaviour for the "更多操作" <details> menus on activity cards, expenses and members:
// only one stays open, a tap outside / Escape / scrolling it off screen closes it, and the panel
// opens upwards when the space below is covered by the viewport edge, bottom navigation or
// the floating add button (MOB-003).
export const MENU_SELECTOR = 'details.activity-more, details.expense-more, details.member-more';

const panelOf = (menu) => menu.querySelector(':scope > :not(summary)');

function visibleTop(selector) {
  const element = document.querySelector(selector);
  if (!element) return Infinity;
  const rect = element.getBoundingClientRect();
  return rect.height > 0 && getComputedStyle(element).display !== 'none' ? rect.top : Infinity;
}

export function placeMenu(menu) {
  const panel = panelOf(menu);
  if (!panel) return;
  delete menu.dataset.placement;
  const viewport = window.visualViewport;
  const viewportBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
  const summary = menu.querySelector(':scope > summary').getBoundingClientRect();
  const rect = panel.getBoundingClientRect();
  let limit = Math.min(viewportBottom, visibleTop('.bottom-nav')) - 8;
  const fab = document.querySelector('.itinerary-add-fab');
  if (fab) {
    const f = fab.getBoundingClientRect();
    if (f.height > 0 && f.left < rect.right && f.right > rect.left)
      limit = Math.min(limit, f.top - 8);
  }
  if (rect.bottom > limit && summary.top - rect.height - 8 > (viewport?.offsetTop || 0))
    menu.dataset.placement = 'top';
}

export function closeMenu(menu, { focus = false } = {}) {
  if (!menu.open) return;
  menu.open = false;
  if (focus) menu.querySelector(':scope > summary')?.focus();
}

export function installDetailsMenus(root = document) {
  const openMenus = () => [...root.querySelectorAll(`:is(${MENU_SELECTOR})[open]`)];
  const onToggle = (event) => {
    const menu = event.target;
    if (!(menu instanceof HTMLDetailsElement) || !menu.matches(MENU_SELECTOR)) return;
    if (!menu.open) {
      delete menu.dataset.placement;
      return;
    }
    for (const other of openMenus()) if (other !== menu) closeMenu(other);
    placeMenu(menu);
  };
  const onPointerDown = (event) => {
    for (const menu of openMenus()) if (!menu.contains(event.target)) closeMenu(menu);
  };
  const onKeyDown = (event) => {
    if (event.key !== 'Escape') return;
    const menus = openMenus();
    if (!menus.length) return;
    event.preventDefault();
    for (const menu of menus) closeMenu(menu, { focus: menu.contains(document.activeElement) });
  };
  // Scrolling the list closes a menu once its button has left the screen; small scrolls
  // (including the browser bringing a panel item into view) keep it open.
  const onScroll = (event) => {
    for (const menu of openMenus()) {
      if (event.target instanceof Node && panelOf(menu)?.contains(event.target)) continue;
      const summary = menu.querySelector(':scope > summary').getBoundingClientRect();
      if (summary.bottom < 0 || summary.top > window.innerHeight) closeMenu(menu);
    }
  };
  // toggle and scroll do not bubble; capture still reaches the document.
  root.addEventListener('toggle', onToggle, true);
  root.addEventListener('pointerdown', onPointerDown, true);
  root.addEventListener('keydown', onKeyDown);
  root.addEventListener('scroll', onScroll, true);
  return () => {
    root.removeEventListener('toggle', onToggle, true);
    root.removeEventListener('pointerdown', onPointerDown, true);
    root.removeEventListener('keydown', onKeyDown);
    root.removeEventListener('scroll', onScroll, true);
  };
}
