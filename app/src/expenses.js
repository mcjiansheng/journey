import { visibleDays } from './domain.js';

export function linkedExpenseActivity(snapshot, expense) {
  const activity = snapshot.objects.find(
    (o) => o.id === expense.payload.activityId && o.kind === 'activity' && o.state === 'active',
  );
  return activity &&
    snapshot.objects.some(
      (o) => o.id === activity.payload.dayId && o.kind === 'day' && o.state === 'active',
    )
    ? activity
    : null;
}

export function expenseDate(snapshot, expense) {
  if (expense.payload.date) return expense.payload.date;
  const activity = linkedExpenseActivity(snapshot, expense);
  return activity
    ? snapshot.objects.find((o) => o.id === activity.payload.dayId).payload.date || null
    : null;
}

export function expenseTitle(snapshot, expense) {
  return (
    expense.payload.title ||
    linkedExpenseActivity(snapshot, expense)?.payload.title ||
    (expense.payload.payment.status === 'paid' ? '已支付' : '预计')
  );
}

export function expenseDateLabel(snapshot, date) {
  if (!date) return '未记录日期';
  const formatted = new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
  const day = visibleDays(snapshot).find((o) => o.payload.date === date);
  if (day) {
    const ordinal = snapshot.trip.startDate
      ? Math.round((Date.parse(date) - Date.parse(snapshot.trip.startDate)) / 86400000) + 1
      : day.payload.ordinal;
    return `第 ${ordinal} 天 · ${formatted}`;
  }
  const start = snapshot.trip.startDate;
  return `${start ? (date < start ? '行前支付' : '行后支付') + ' · ' : ''}${formatted}`;
}
