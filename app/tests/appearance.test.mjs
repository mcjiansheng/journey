import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { palettePreviews } from '../src/palette-meta.js';
import { mergeAccountAppearance, readAppearance, applyAppearance, isDark } from '../src/appearance.js';
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
      boardPanelDock: 'left',
    },
  );
  // The sticker panel dock follows the account across devices.
  assert.equal(
    mergeAccountAppearance({ boardPanelDock: 'left' }, { boardPanelDock: 'bottom' }).boardPanelDock,
    'bottom',
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
  globalThis.getComputedStyle = () => { throw new Error('Appearance must not read computed styles'); };
  globalThis.matchMedia = () => ({ matches: false });
  try {
    applyAppearance({ palette: 'atlas', theme: 'dark', reducedTransparency: true });
    assert.equal(document.documentElement.dataset.palette, 'atlas');
    assert.equal(document.documentElement.dataset.transparency, 'true');
    assert.equal(attributes.content, palettePreviews.atlas.dark.page);
  } finally {
    delete globalThis.document;
    delete globalThis.getComputedStyle;
    delete globalThis.matchMedia;
  }
});

test('an account without preferences starts with defaults rather than the previous account appearance', () => { assert.equal(mergeAccountAppearance({palette:'atlas',theme:'dark'}, {}).palette,'forest'); assert.equal(mergeAccountAppearance({palette:'atlas'}, undefined).palette,'atlas'); });

test('theme resolution and browser chrome agree before and after mount for both palettes', () => {
  const source = readFileSync(new URL('../public/appearance-init.js', import.meta.url), 'utf8');
  for (const systemDark of [false, true]) {
    for (const theme of [undefined, 'system', 'light', 'dark']) {
      assert.equal(isDark(theme, systemDark), theme === 'dark' || (theme !== 'light' && systemDark));
      for (const palette of ['forest', 'atlas']) {
        const p = { palette, theme };
        const colors = [];
        const document = {
          documentElement: { dataset: {} },
          querySelector: () => ({ setAttribute: (_, value) => colors.push(value) }),
        };
        const matchMedia = () => ({ matches: systemDark });
        runInNewContext(source, { document, matchMedia, localStorage: { getItem: () => JSON.stringify(p) } });
        globalThis.document = document;
        globalThis.matchMedia = matchMedia;
        try {
          applyAppearance(p);
          const expected = palettePreviews[palette][isDark(theme, systemDark) ? 'dark' : 'light'].page;
          assert.deepEqual(colors, [expected, expected]);
        } finally {
          delete globalThis.document;
          delete globalThis.matchMedia;
        }
      }
    }
  }
});
