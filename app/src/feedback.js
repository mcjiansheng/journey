const STORAGE_KEY = 'journey.appearance';
const SURFACES = '.activity-card,.trip-card,.continue-card,.primary,.day-tabs button,.sidebar nav button,.bottom-nav button,[data-pointer-glow]';
const ACTIONS = 'button,a[href],summary,input[type="checkbox"],input[type="radio"],[role="button"],[role="tab"]';
let installedCleanup = null;
let audioContext = null;
let lastFeedbackAt = -Infinity;

function storedAppearance() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; }
  catch { return {}; }
}
export function getFeedbackPreferences() {
  const value = storedAppearance();
  return { sound: value.interactionSound === true, haptics: value.interactionHaptics !== false };
}
export function setFeedbackPreferences(patch) {
  const value = storedAppearance();
  if (typeof patch.sound === 'boolean') value.interactionSound = patch.sound;
  if (typeof patch.haptics === 'boolean') value.interactionHaptics = patch.haptics;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  return getFeedbackPreferences();
}
export function supportsHaptics() {
  return typeof window !== 'undefined' && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
    && (navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches);
}
export function supportsNativeSwitch() {
  return typeof document !== 'undefined' && 'switch' in document.createElement('input');
}
function reducedMotion() {
  const value = document.documentElement.dataset.motion;
  return value === 'true' || (value !== 'false' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}
function clickTone() {
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio) return;
  try {
    audioContext ||= new Audio();
    // Resume is invoked directly from a trusted user interaction.
    const ready = audioContext.state === 'suspended' ? audioContext.resume() : Promise.resolve();
    void ready.then(() => {
      if (audioContext?.state !== 'running' || !getFeedbackPreferences().sound) return;
      const time = audioContext.currentTime;
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(250, time);
      oscillator.frequency.exponentialRampToValueAtTime(180, time + 0.035);
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(0.018, time + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.04);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(time);
      oscillator.stop(time + 0.045);
    }).catch(() => {});
  } catch { /* Device audio availability does not block an interaction. */ }
}
export function installFeedback() {
  if (installedCleanup) return installedCleanup;
  let frame = 0;
  let viewportFrame = 0;
  let surface = null;
  let latestPoint = null;
  let disposed = false;
  const root = document.documentElement;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');

  function clearSurface() {
    cancelAnimationFrame(frame);
    frame = 0;
    latestPoint = null;
    if (surface) {
      surface.removeAttribute('data-pointer-active');
      surface.style.removeProperty('--pointer-x');
      surface.style.removeProperty('--pointer-y');
      surface = null;
    }
  }
  function pointerMove(event) {
    if (event.pointerType !== 'mouse' || !finePointer.matches || reducedMotion()) {
      clearSurface();
      return;
    }
    const element = event.target instanceof Element ? event.target.closest(SURFACES) : null;
    if (!element || element.closest('[inert]') || element.matches(':disabled,[aria-disabled="true"]')) {
      clearSurface();
      return;
    }
    latestPoint = { element, x: event.clientX, y: event.clientY };
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (disposed || !latestPoint?.element.isConnected || reducedMotion()) { clearSurface(); return; }
      const { element: next, x, y } = latestPoint;
      if (surface !== next) { clearSurface(); surface = next; surface.setAttribute('data-pointer-active', ''); }
      const bounds = next.getBoundingClientRect();
      next.style.setProperty('--pointer-x', `${x - bounds.left}px`);
      next.style.setProperty('--pointer-y', `${y - bounds.top}px`);
    });
  }
  function pointerOut(event) {
    if (!surface) return;
    const next = event.relatedTarget instanceof Element ? event.relatedTarget.closest(SURFACES) : null;
    if (next !== surface) clearSurface();
  }
  function clicked(event) {
    if (!event.isTrusted || event.defaultPrevented) return;
    const control = event.target instanceof Element ? event.target.closest(ACTIONS) : null;
    if (!control || control.matches(':disabled,[aria-disabled="true"]') || control.closest('[inert]')) return;
    const at = performance.now();
    if (at - lastFeedbackAt < 70) return;
    lastFeedbackAt = at;
    const preferences = getFeedbackPreferences();
    if (preferences.sound) clickTone();
    // Native Safari switches own their system haptic; there is no synthetic iOS vibration path.
    const nativeSwitch = control.matches('input[switch]') && supportsNativeSwitch();
    if (preferences.haptics && supportsHaptics() && !nativeSwitch) {
      try { navigator.vibrate(10); } catch { /* Hardware may reject vibration. */ }
    }
  }
  function updateViewport() {
    if (viewportFrame) return;
    viewportFrame = requestAnimationFrame(() => {
      viewportFrame = 0;
      if (disposed) return;
      const viewport = window.visualViewport;
      const height = viewport?.height || window.innerHeight;
      const top = viewport?.offsetTop || 0;
      const inset = Math.max(0, window.innerHeight - height - top);
      root.style.setProperty('--visual-viewport-height', `${Math.round(height)}px`);
      root.style.setProperty('--visual-height', `${Math.round(height)}px`);
      root.style.setProperty('--visual-top', `${Math.round(top)}px`);
      root.style.setProperty('--keyboard-inset', `${Math.round(inset)}px`);
      const editing = document.activeElement?.matches('input:not([type="checkbox"]):not([type="radio"]),textarea,[contenteditable="true"]');
      root.dataset.keyboard = editing && window.innerHeight - height > 140 ? 'open' : 'closed';
    });
  }
  document.addEventListener('click', clicked, true);
  document.addEventListener('pointermove', pointerMove, { passive: true });
  document.addEventListener('pointerout', pointerOut, { passive: true });
  document.addEventListener('scroll', clearSurface, { passive: true, capture: true });
  document.addEventListener('focusin', updateViewport);
  document.addEventListener('focusout', updateViewport);
  window.addEventListener('blur', clearSurface);
  window.addEventListener('resize', updateViewport, { passive: true });
  window.visualViewport?.addEventListener('resize', updateViewport, { passive: true });
  window.visualViewport?.addEventListener('scroll', updateViewport, { passive: true });
  updateViewport();
  installedCleanup = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    cancelAnimationFrame(viewportFrame);
    clearSurface();
    document.removeEventListener('click', clicked, true);
    document.removeEventListener('pointermove', pointerMove);
    document.removeEventListener('pointerout', pointerOut);
    document.removeEventListener('scroll', clearSurface, true);
    document.removeEventListener('focusin', updateViewport);
    document.removeEventListener('focusout', updateViewport);
    window.removeEventListener('blur', clearSurface);
    window.removeEventListener('resize', updateViewport);
    window.visualViewport?.removeEventListener('resize', updateViewport);
    window.visualViewport?.removeEventListener('scroll', updateViewport);
    for (const key of ['--visual-viewport-height','--visual-height','--visual-top','--keyboard-inset']) root.style.removeProperty(key);
    delete root.dataset.keyboard;
    void audioContext?.close().catch(() => {});
    audioContext = null;
    installedCleanup = null;
  };
  return installedCleanup;
}
