// Rich text for sticky notes. Notes are edited with contentEditable and stored
// as a small HTML subset; anything else a peer (or a paste) sends is dropped.
// The sanitizer is string-based so it runs the same in the browser and in tests.

const BLOCK = new Set(['div', 'p', 'ul', 'ol', 'li']);
const INLINE = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'span', 'font', 'br']);
const RENAME = { strong: 'b', em: 'i', strike: 's', p: 'div', font: 'span' };
const VOID = new Set(['br']);

// Text colors offered by the format bar; also the only colors kept on save.
export const NOTE_TEXT_COLORS = [
  { id: 'ink', name: '默认', value: 'var(--text)' },
  { id: 'red', name: '红', value: 'var(--ink-red)' },
  { id: 'orange', name: '橙', value: 'var(--ink-orange)' },
  { id: 'blue', name: '蓝', value: 'var(--ink-blue)' },
  { id: 'purple', name: '紫', value: 'var(--ink-purple)' },
  { id: 'accent', name: '主题色', value: 'var(--ink-accent)' },
];
const COLOR_IDS = new Set(NOTE_TEXT_COLORS.map((c) => c.id));

const escapeText = (t) =>
  t
    .replace(/&(?!(?:[a-z]+|#\d+|#x[0-9a-f]+);)/gi, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

function attrsOf(raw) {
  const out = {};
  for (const m of raw.matchAll(/([a-zA-Z-:]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g))
    out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return out;
}

function keptAttrs(tag, attrs) {
  const parts = [];
  // Colors are stored as data-color ids, never as free CSS.
  const color = attrs['data-color'];
  if (color && COLOR_IDS.has(color) && (tag === 'span' || tag === 'font'))
    parts.push(`data-color="${color}"`);
  const align =
    attrs['data-align'] || /text-align:\s*(left|center|right)/i.exec(attrs.style || '')?.[1];
  if (
    align &&
    /^(left|center|right)$/i.test(align) &&
    (tag === 'div' || tag === 'p' || tag === 'li')
  )
    parts.push(`data-align="${align.toLowerCase()}"`);
  if (tag === 'ul' && attrs['data-list'] === 'check') parts.push('data-list="check"');
  if (tag === 'li' && attrs['data-checked'] === 'true') parts.push('data-checked="true"');
  return parts.length ? ' ' + parts.join(' ') : '';
}

/** Keep only the formatting the note toolbar can produce. */
export function sanitizeRichText(html = '') {
  if (!html) return '';
  let out = '';
  const open = [];
  const re = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>|([^<]+)|(<)/g;
  let m;
  let skipDepth = 0; // inside <script>/<style>: drop everything
  while ((m = re.exec(html))) {
    if (m[3] !== undefined || m[4] !== undefined) {
      if (!skipDepth) out += escapeText(m[3] ?? '<');
      continue;
    }
    if (!m[1]) continue; // comment
    const isClose = m[0].startsWith('</');
    const raw = m[1].toLowerCase();
    if (raw === 'script' || raw === 'style' || raw === 'template' || raw === 'iframe') {
      if (!isClose && !m[0].endsWith('/>')) skipDepth++;
      else if (isClose && skipDepth) skipDepth--;
      continue;
    }
    if (skipDepth) continue;
    if (!BLOCK.has(raw) && !INLINE.has(raw)) continue;
    const tag = RENAME[raw] || raw;
    if (VOID.has(tag)) {
      if (!isClose) out += '<br>';
      continue;
    }
    if (isClose) {
      const idx = open.lastIndexOf(tag);
      if (idx === -1) continue;
      while (open.length > idx) out += `</${open.pop()}>`;
    } else {
      out += `<${tag}${keptAttrs(raw === 'font' ? 'span' : tag, attrsOf(m[2]))}>`;
      open.push(tag);
    }
  }
  while (open.length) out += `</${open.pop()}>`;
  return out;
}

/** Plain text of a note (kept in content.text for search, peers on old clients). */
export function richTextToPlain(html = '') {
  return sanitizeRichText(html)
    .replace(/<br>/g, '\n')
    .replace(/<\/(div|li)>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** HTML for a note that only has plain text (notes written before rich text). */
export function plainToRichText(text = '') {
  return escapeText(text).replace(/\n/g, '<br>');
}
