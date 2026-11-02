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
console.log(`${count} palette contrast checks passed.`);
