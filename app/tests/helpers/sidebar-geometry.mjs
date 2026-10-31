// The sidebar's layout is fixed; its visible surface is defined by a clip inset.
export function sidebarGeometry(sidebar) {
  const rect = sidebar.getBoundingClientRect();
  const clip = getComputedStyle(sidebar).clipPath;
  const lengths = clip.split('round')[0].match(/calc\([^)]*\)|[-\d.]+(?:px|%)/g) || ['0px'];
  const sides = [lengths[0], lengths[1] || lengths[0], lengths[2] || lengths[0], lengths[3] || lengths[1] || lengths[0]];
  function pixels(value, size) {
    return (value.match(/[+-]?\s*[\d.]+(?:px|%)/g) || []).reduce((total, term) => {
      const n = parseFloat(term.replace(/\s/g, ''));
      return total + (term.endsWith('%') ? n * size / 100 : n);
    }, 0);
  }
  const [top, right, bottom, left] = sides.map((s, i) => pixels(s, i % 2 ? rect.width : rect.height));
  return {x:rect.x+left,y:rect.y+top,width:rect.width-left-right,height:rect.height-top-bottom,clip};
}
