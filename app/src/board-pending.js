// Local changes that the server has not echoed back yet. A refresh triggered by
// an earlier operation returns the older server copy; applying it would flash
// the object back to its previous size or position until the next refresh.
export const PENDING_TTL = 15000;
const sameValue = (a, b) =>
  typeof a === 'number' && typeof b === 'number'
    ? Math.abs(a - b) < 0.01
    : JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
function matchesExpected(item, expect) {
  for (const [key, value] of Object.entries(expect)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [sub, v] of Object.entries(value))
        if (!sameValue(item[key]?.[sub], v)) return false;
    } else if (!sameValue(item[key], value)) return false;
  }
  return true;
}
export function mergeExpected(prev = {}, next = {}) {
  const out = { ...prev };
  for (const [key, value] of Object.entries(next))
    out[key] =
      value && typeof value === 'object' && !Array.isArray(value)
        ? { ...(prev[key] || {}), ...value }
        : value;
  return out;
}
/**
 * Keep local versions of items whose pending change the server copy does not
 * reflect yet. `pending` maps id → { expect, at } and is pruned in place once
 * the server confirms a change or it expires (a peer may have won the conflict).
 */
export function reconcilePending(serverItems, localItems, pending, now = Date.now()) {
  if (!pending.size) return serverItems;
  const local = new Map(localItems.map((it) => [it.id, it]));
  const seen = new Set();
  const out = serverItems.map((it) => {
    seen.add(it.id);
    const p = pending.get(it.id);
    if (!p) return it;
    if (matchesExpected(it, p.expect) || now - p.at > PENDING_TTL) {
      pending.delete(it.id);
      return it;
    }
    return local.get(it.id) || it;
  });
  for (const [id, p] of pending) {
    if (seen.has(id)) continue;
    if (now - p.at > PENDING_TTL) pending.delete(id);
    else if (local.has(id)) out.push(local.get(id));
  }
  return out;
}
