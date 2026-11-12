// 导出为图片: draw the board's objects into one PNG.
//
// The objects are cloned with their computed styles inlined (pseudo-elements
// become CSS rules), pictures become data URLs (a GIF contributes the frame on
// screen right now), and the copy is rendered through an SVG <foreignObject>
// onto a canvas. Nothing is fetched from a third party; a picture the browser
// will not let us read (another site without CORS) is left out.

const XHTML = 'http://www.w3.org/1999/xhtml';
const SKIP = [
  '.box',
  '.handle',
  '.dim',
  '.reshape-outline',
  '.upload-placeholder',
  '.is-preview',
  '.gallery-nav',
  '.gallery-tools',
  '.gallery-hint',
  '.peer-label',
  '[data-export="skip"]',
].join(',');

let defaultsFrame = null;
const defaultsCache = new Map();
function defaultStyle(tag, ns) {
  const key = `${ns}|${tag}`;
  if (defaultsCache.has(key)) return defaultsCache.get(key);
  if (!defaultsFrame) {
    defaultsFrame = document.createElement('iframe');
    defaultsFrame.setAttribute('aria-hidden', 'true');
    defaultsFrame.tabIndex = -1;
    defaultsFrame.style.cssText =
      'position:fixed;left:-9999px;top:-9999px;width:10px;height:10px;border:0;visibility:hidden';
    document.body.appendChild(defaultsFrame);
  }
  const doc = defaultsFrame.contentDocument;
  const el = ns === XHTML ? doc.createElement(tag) : doc.createElementNS(ns, tag);
  doc.body.appendChild(el);
  const cs = defaultsFrame.contentWindow.getComputedStyle(el);
  const out = {};
  for (let i = 0; i < cs.length; i++) out[cs[i]] = cs.getPropertyValue(cs[i]);
  el.remove();
  defaultsCache.set(key, out);
  return out;
}

function styleText(cs, defaults, always = []) {
  let text = '';
  for (let i = 0; i < cs.length; i++) {
    const p = cs[i];
    if (p.startsWith('--')) continue;
    const v = cs.getPropertyValue(p);
    if (defaults[p] === v && !always.includes(p)) continue;
    text += `${p}:${v};`;
  }
  return text;
}

const TRANSPARENT =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

async function imageData(img) {
  if (!img.src) return TRANSPARENT;
  if (img.src.startsWith('data:')) return img.src;
  // The frame on screen (also for GIFs) through a canvas …
  try {
    if (img.complete && img.naturalWidth) {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      return c.toDataURL('image/png');
    }
  } catch {
    // tainted: try reading it directly
  }
  // … or the file itself when the canvas refuses (cross-origin with CORS).
  try {
    const res = await fetch(img.currentSrc || img.src, {
      mode: 'cors',
      credentials: 'same-origin',
    });
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  } catch {
    return TRANSPARENT;
  }
}

async function cloneNode(node, ctx) {
  if (node.nodeType === Node.TEXT_NODE) return node.cloneNode(false);
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  if (node.matches(SKIP)) return null;
  const cs = getComputedStyle(node);
  if (cs.display === 'none') return null;

  const ns = node.namespaceURI || XHTML;
  const tag = node.localName;
  let clone;
  if (tag === 'canvas') {
    clone = document.createElementNS(XHTML, 'img');
    try {
      clone.setAttribute('src', node.toDataURL('image/png'));
    } catch {
      clone.setAttribute('src', TRANSPARENT);
    }
  } else {
    clone = node.cloneNode(false);
    clone.removeAttribute('contenteditable');
    clone.removeAttribute('id');
    if (tag === 'img') {
      clone.removeAttribute('srcset');
      clone.removeAttribute('loading');
      clone.setAttribute('src', await imageData(node));
    }
    if (tag === 'input' || tag === 'textarea') clone.setAttribute('value', node.value);
  }
  clone.setAttribute(
    'style',
    styleText(cs, defaultStyle(tag === 'canvas' ? 'img' : tag, ns), ['display', 'position']),
  );

  for (const pseudo of ['::before', '::after']) {
    const ps = getComputedStyle(node, pseudo);
    const content = ps.getPropertyValue('content');
    if (!content || content === 'none' || content === 'normal') continue;
    const cls = `xp${ctx.n++}`;
    clone.setAttribute('class', `${clone.getAttribute('class') || ''} ${cls}`.trim());
    ctx.rules.push(`.${cls}${pseudo}{${styleText(ps, defaultStyle('span', XHTML), ['content'])}}`);
  }

  for (const child of node.childNodes) {
    const c = await cloneNode(child, ctx);
    if (c) clone.appendChild(c);
  }
  return clone;
}

function waitImages(root, timeout = 5000) {
  const pending = [...root.querySelectorAll('img')].filter((img) => !img.complete);
  if (!pending.length) return Promise.resolve();
  return Promise.race([
    Promise.all(
      pending.map(
        (img) =>
          new Promise((r) => {
            img.addEventListener('load', r, { once: true });
            img.addEventListener('error', r, { once: true });
          }),
      ),
    ),
    new Promise((r) => setTimeout(r, timeout)),
  ]);
}

/**
 * Render the children of `layer` (absolutely placed in world coordinates)
 * inside `bounds` plus `pad` on every side. Resolves to a PNG blob.
 */
export async function renderBoardImage(layer, bounds, { pad = 64, background = '#f6f4ee' } = {}) {
  await waitImages(layer);
  if (document.fonts?.ready) await document.fonts.ready;
  const W = Math.ceil(bounds.w + pad * 2);
  const H = Math.ceil(bounds.h + pad * 2);
  const ctx = { n: 0, rules: [] };

  const wrapper = document.createElementNS(XHTML, 'div');
  wrapper.setAttribute(
    'style',
    `position:relative;width:${W}px;height:${H}px;overflow:hidden;background:${background};` +
      `font-family:${getComputedStyle(layer).fontFamily};`,
  );
  const world = document.createElementNS(XHTML, 'div');
  world.setAttribute(
    'style',
    `position:absolute;left:0;top:0;transform:translate(${pad - bounds.x}px,${pad - bounds.y}px);`,
  );
  for (const child of layer.children) {
    const c = await cloneNode(child, ctx);
    if (c) world.appendChild(c);
  }
  const style = document.createElementNS(XHTML, 'style');
  style.textContent = ctx.rules.join('\n');
  wrapper.appendChild(style);
  wrapper.appendChild(world);

  const xml = new XMLSerializer().serializeToString(wrapper);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
    `<foreignObject x="0" y="0" width="100%" height="100%">${xml}</foreignObject></svg>`;
  const img = new Image();
  img.decoding = 'sync';
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error('图片渲染失败'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });

  // Sharp on retina, but within what browsers allow for one canvas.
  const scale = Math.max(0.25, Math.min(2, Math.sqrt(48e6 / (W * H)), 16000 / Math.max(W, H)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const g = canvas.getContext('2d');
  g.scale(scale, scale);
  g.fillStyle = background;
  g.fillRect(0, 0, W, H);
  g.drawImage(img, 0, 0, W, H);
  const blob = await new Promise((resolve, reject) => {
    try {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('导出失败'))), 'image/png');
    } catch {
      reject(new Error('当前浏览器不支持把白板导出成图片，请换用 Chrome 或 Edge'));
    }
  });
  return { blob, width: canvas.width, height: canvas.height };
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function exportFileName(tripName, boardTitle, date = new Date()) {
  const clean = (s) =>
    String(s || '')
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .trim();
  const d = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  return `${[clean(tripName), clean(boardTitle) || '白板'].filter(Boolean).join('-')}-${d}.png`;
}
