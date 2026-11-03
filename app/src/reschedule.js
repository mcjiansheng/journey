import { dateAdd } from './domain.js';
export function reschedulePlan(
  snapshot,
  startDate,
  dayCount,
  strategy = 'move',
  targets = {},
  selected = new Set(),
) {
  const days = snapshot.objects.filter((o) => o.kind === 'day' && o.state === 'active');
  const ordinal = (day) =>
    snapshot.trip.startDate && day.payload.date
      ? Math.round(
          (Date.parse(day.payload.date) - Date.parse(snapshot.trip.startDate)) / 86400000,
        ) + 1
      : day.payload.ordinal;
  const rows = snapshot.objects
    .filter((o) => o.kind === 'activity' && o.state === 'active')
    .flatMap((activity) => {
      const day = days.find((d) => d.id === activity.payload.dayId);
      if (!day) return [];
      const original = ordinal(day);
      // Existing outside arrangements stay outside unless explicitly selected.
      const inRange =
        Boolean(snapshot.trip.startDate) === Boolean(day.payload.date) &&
        original >= 1 &&
        original <= snapshot.trip.dayCount;
      const target = Math.max(
        1,
        Math.min(dayCount, strategy === 'custom' ? targets[activity.id] || original : original),
      );
      const date = dateAdd(startDate, target - 1);
      const changed = day.payload.date
        ? day.payload.date !== date
        : original !== target || !!startDate;
      const moved =
        strategy === 'custom' ? selected.has(activity.id) : strategy === 'move' && inRange;
      return [{ activity, day, ordinal: target, date, affected: inRange && changed, moved }];
    });
  return {
    rows,
    affected: rows.some((row) => row.affected),
    moves: rows
      .filter((row) => row.moved)
      .map((row) => ({
        activityId: row.activity.id,
        ordinal: row.ordinal,
        ...(row.date ? { date: row.date } : {}),
      })),
  };
}
