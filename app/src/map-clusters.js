import { markKey } from './marks.js';
// Points are already projected into screen pixels. Previous groups provide hysteresis.
export function clusterPlaces(points, previous = []) {
  const ordered = [...points].sort(
    (a, b) =>
      (b.priority || 0) - (a.priority || 0) ||
      (a.createdAt || 0) - (b.createdAt || 0) ||
      a.id.localeCompare(b.id),
  );
  let groups = ordered.map((p) => ({ points: [p], x: p.x, y: p.y }));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  for (const same of [true, false]) {
    for (let i = 0; i < groups.length; i++)
      for (let j = i + 1; j < groups.length; j++) {
        const a = groups[i],
          b = groups[j];
        if (a.points.some((p) => p.priority) || b.points.some((p) => p.priority)) continue;
        const keys = new Set([...a.points, ...b.points].map((p) => markKey(p.mark)));
        if (same && keys.size !== 1) continue;
        const retained = previous.some((g) =>
          [...a.points, ...b.points].every((p) => g.includes(p.id)),
        );
        if (distance(a, b) >= (same ? (retained ? 40 : 34) : retained ? 30 : 24)) continue;
        const combined = [...a.points, ...b.points];
        groups[i] = {
          points: combined,
          x: combined.reduce((s, p) => s + p.x, 0) / combined.length,
          y: combined.reduce((s, p) => s + p.y, 0) / combined.length,
        };
        groups.splice(j--, 1);
      }
  }
  const boxes = groups.map((g) => ({ x: g.x - 14, y: g.y - 14, w: 28, h: 28 }));
  const overlap = (a, b) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  return groups.map((g) => {
    const keys = new Set(g.points.map((p) => markKey(p.mark)));
    let labelSide = null;
    if (keys.size === 1) {
      const name = g.points.length === 1 ? g.points[0].name : g.points[0].presetName;
      if (name)
        for (const side of ['right', 'left']) {
          const w = Math.min(8, [...name].length) * 13 + 16;
          const box = { x: side === 'right' ? g.x + 20 : g.x - 20 - w, y: g.y - 12, w, h: 24 };
          if (!boxes.some((b) => overlap(box, b))) {
            boxes.push(box);
            labelSide = side;
            break;
          }
        }
    }
    return { ...g, labelSide };
  });
}
