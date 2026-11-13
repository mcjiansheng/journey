import test from 'node:test';
import assert from 'node:assert/strict';
import { findUndefinedVars } from '../../scripts/check-css-vars.mjs';

test('css var check rejects references nothing defines (N-6)', () => {
  const files = [
    { path: 'tokens.css', text: ':root {\n  --accent: #2f6b57;\n}' },
    {
      path: 'board.css',
      text: [
        '.a { color: var(--accent); }',
        '.b { background: var(--panel); }',
        '.c { border-color: var(--edge, #ccc); }',
        '.d { transform: scale(var(--wk)); }',
      ].join('\n'),
    },
    {
      path: 'X.jsx',
      text: '<path stroke="var(--primary)" style={{ \'--local\': 1 }} />\nvar(--local)',
    },
  ];
  const missing = findUndefinedVars(files).map((m) => `${m.path}:${m.line}:${m.name}`);
  assert.deepEqual(missing, ['board.css:2:--panel', 'X.jsx:1:--primary']);
});
