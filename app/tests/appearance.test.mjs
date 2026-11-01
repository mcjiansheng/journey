import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { palettePreviews } from '../src/palette-meta.js';
import { mergeAccountAppearance, readAppearance, applyAppearance } from '../src/appearance.js';
test('account appearance wins over cached values and keeps this device feedback and map settings', () => {
  assert.deepEqual(
    mergeAccountAppearance(
      {
        palette: 'forest',
        theme: 'light',
        interactionSound: true,
        interactionHaptics: false,
        autoCollapseMapSidebar: false,
      },
      {
        palette: 'atlas',
        theme: 'dark',
        reducedMotion: true,
        reducedTransparency: false,
        interactionSound: false,
      },
    ),
    {
      palette: 'atlas',
      theme: 'dark',
      reducedMotion: true,
      reducedTransparency: false,
      interactionSound: true,
      interactionHaptics: false,
      autoCollapseMapSidebar: false,
      collaborationNotifications: false,
    },
  );
  assert.deepEqual(readAppearance({ getItem: () => 'broken json' }), {});
});
test('head bootstrap applies stored appearance before the app is mounted', () => {
  const dataset = {};
  const meta = {};
  runInNewContext(readFileSync(new URL('../public/appearance-init.js', import.meta.url), 'utf8'), {
    document: {
      documentElement: { dataset },
      querySelector: () => ({ setAttribute: (key, value) => (meta[key] = value) }),
    },
    matchMedia: () => ({ matches: false }),
    localStorage: {
      getItem: () =>
        JSON.stringify({
          palette: 'atlas',
          theme: 'dark',
          reducedMotion: true,
          reducedTransparency: false,
        }),
    },
  });
  assert.equal(meta.content, palettePreviews.atlas.dark.page);
  assert.deepEqual(dataset, {
    palette: 'atlas',
    theme: 'dark',
    motion: 'true',
    transparency: 'false',
    mapSidebarCollapse: 'true',
  });
});
test('appearance applies palette, accessibility and the current page color to browser chrome', () => {
  const attributes = {};
  globalThis.document = {
    documentElement: { dataset: {} },
    querySelector: () => ({ setAttribute: (key, value) => (attributes[key] = value) }),
  };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '#102632' });
  globalThis.matchMedia = () => ({ matches: false });
  try {
    applyAppearance({ palette: 'atlas', theme: 'dark', reducedTransparency: true });
    assert.equal(document.documentElement.dataset.palette, 'atlas');
    assert.equal(document.documentElement.dataset.transparency, 'true');
    assert.equal(attributes.content, '#102632');
  } finally {
    delete globalThis.document;
    delete globalThis.getComputedStyle;
    delete globalThis.matchMedia;
  }
});

test('an account without preferences starts with defaults rather than the previous account appearance', () => { assert.equal(mergeAccountAppearance({palette:'atlas',theme:'dark'}, {}).palette,'forest'); assert.equal(mergeAccountAppearance({palette:'atlas'}, undefined).palette,'atlas'); });
