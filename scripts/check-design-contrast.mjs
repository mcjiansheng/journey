import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const { palettes } = JSON.parse(readFileSync(new URL('../design/tokens.json', import.meta.url), 'utf8'));
function luminance(hex) {
  const rgb = hex.slice(1).match(/../g).slice(0,3).map(v => parseInt(v,16)/255).map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4);
  return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
}
export function contrast(a,b) { const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); }
let count=0;
for (const [name,palette] of Object.entries(palettes)) for (const mode of ['light','dark']) {
  const c=palette[mode];
  for(const foreground of ['text','muted','primary','placeholder']) for(const background of ['page','surface','elevated','accent-soft']) {
    const ratio=contrast(c[foreground],c[background]);
    const minimum=foreground==='placeholder'?3:4.5;
    assert.ok(ratio >= minimum,`${name}/${mode} ${foreground} on ${background}: ${ratio.toFixed(2)} < ${minimum}`);
    count++;
  }
  assert.ok(contrast(c.onPrimary,c.primary)>=4.5,`${name}/${mode} button label`);
  assert.ok(contrast(c.selected,c.surface)>=1.2,`${name}/${mode} selected fill`);
  count+=2;
}

const skyGradients = [
  ['night', '#232a5c', '#0a0e24'],
  ['dawn', '#a16748', '#6d5aa8'],
  ['morning', '#3a7ba4', '#2c6fbe'],
  ['noon', '#2f7abc', '#1f5fb4'],
  ['afternoon', '#3a77b3', '#9c6938'],
  ['dusk', '#b45d40', '#5d438c'],
  ['twilight', '#453f86', '#151a42']
];
for (const [key, a, b] of skyGradients) {
  assert.ok(contrast('#ffffff', a) >= 4.5, `sky ${key} start on white >= 4.5`);
  assert.ok(contrast('#ffffff', b) >= 4.5, `sky ${key} end on white >= 4.5`);
  count += 2;
}
for (const [name, palette] of Object.entries(palettes)) {
  const a = palette.light.widgetBrandA, b = palette.light.widgetBrandB;
  assert.ok(contrast('#ffffff', a) >= 4.5, `${name} widget brand-a on white >= 4.5`);
  assert.ok(contrast('#ffffff', b) >= 4.5, `${name} widget brand-b on white >= 4.5`);
  count += 2;
}
console.log(`${count} palette contrast checks passed.`);
