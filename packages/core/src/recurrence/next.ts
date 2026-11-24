import { date, recurrence, type Recurrence } from '../domain/dates';

function monthDate(year: number, monthIndex: number, day: number) {
  const result = new Date(0);
  result.setUTCFullYear(year, monthIndex + 1, 0);
  result.setUTCDate(Math.min(day, result.getUTCDate()));
  return result.toISOString().slice(0, 10);
}

export function nextDate(rule: Recurrence, due: string, completed: string, skipped = false) {
  recurrence.parse(rule);
  date.parse(due);
  date.parse(completed);
  const base = rule.kind === 'fixed' || skipped ? due : completed;
  const [year, month, day] = base.split('-').map(Number);
  if (rule.unit === 'day' || rule.unit === 'week') {
    const value = new Date(base + 'T00:00:00Z');
    value.setUTCDate(value.getUTCDate() + rule.every * (rule.unit === 'week' ? 7 : 1));
    return date.parse(value.toISOString().slice(0, 10));
  }
  const offset = rule.every * (rule.unit === 'year' ? 12 : 1);
  const anchorMonth = rule.kind === 'fixed' && rule.unit === 'year' ? rule.month! : month;
  const anchorDay = rule.kind === 'fixed' ? rule.day! : day;
  if (rule.kind === 'fixed') {
    const currentPeriod = monthDate(year, anchorMonth - 1, anchorDay);
    if (currentPeriod > due) return date.parse(currentPeriod);
  }
  return date.parse(monthDate(year, anchorMonth - 1 + offset, anchorDay));
}
