// Fails when component CSS/JSX reads a custom property that nothing defines.
// `var(--x)` without a fallback silently drops the whole declaration when --x is
// missing (the board shipped with no panel background and no selected states this
// way), and the token generator check cannot see it.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Local variables injected through inline `style` at runtime by name patterns the
// scan cannot see (computed keys). Keep this list short and documented.
export const RUNTIME_LOCALS = new Set([
  '--c',
  '--mc',
  '--a',
  '--b',
  '--h',
  '--orb',
  '--wk',
  '--ik',
  '--ink-a',
  '--ink-b',
]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (/\.(css|jsx?|mjs)$/.test(entry.name)) out.push(path);
  }
  return out;
}

/** Returns the custom properties read without fallback that nothing defines. */
export function findUndefinedVars(files) {
  const defined = new Set(RUNTIME_LOCALS);
  const uses = [];
  for (const { path, text } of files) {
    const css = path.endsWith('.css');
    if (css) for (const m of text.matchAll(/(--[a-zA-Z0-9_-]+)\s*:/g)) defined.add(m[1]);
    // Inline style keys and setProperty calls: '--name'
    for (const m of text.matchAll(/['"`](--[a-zA-Z0-9_-]+)['"`]/g)) defined.add(m[1]);
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      for (const m of line.matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)\s*([,)])/g)) {
        if (m[2] === ',') continue; // has a fallback
        uses.push({ name: m[1], path, line: i + 1 });
      }
    });
  }
  return uses.filter((u) => !defined.has(u.name));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = fileURLToPath(new URL('../app/src/', import.meta.url));
  const files = walk(root).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
  const missing = findUndefinedVars(files);
  if (missing.length) {
    for (const m of missing)
      console.error(`${relative(root, m.path)}:${m.line}  ${m.name} 未定义且没有回退值`);
    console.error(`发现 ${missing.length} 处未定义的 CSS 变量引用。`);
    process.exit(1);
  }
  console.log('CSS variable references are all defined.');
}
