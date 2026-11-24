import { date, recurrence, type Recurrence } from '../domain/dates';

function monthDate(year: number, monthIndex: number, day: number) {
  const result = new Date(0);
  result.setUTCFullYear(year, monthIndex + 1, 0);
  result.setUTCDate(Math.min(day, result.getUTCDate()));
  return result.toISOString().slice(0, 10);
}

export function nextDate(rule: Recurrence, due: string | null, completed: string, skipped = false) {
  recurrence.parse(rule);
  if (due !== null) date.parse(due);
  date.parse(completed);
  const base = (rule.kind === 'fixed' || skipped ? due : null) ?? completed;
  const [year, month, day] = base.split('-').map(Number);
  if (rule.unit === 'day' || rule.unit === 'week') {
    const value = new Date(base + 'T00:00:00Z');
    value.setUTCDate(value.getUTCDate() + rule.every * (rule.unit === 'week' ? 7 : 1));
    return date.parse(value.toISOString().slice(0, 10));
  }
  const period = rule.unit === 'year' ? 12 : 1;
  let offset = rule.every * period;
  const anchorMonth = rule.kind === 'fixed' && rule.unit === 'year' ? rule.month! : month;
  const anchorDay = rule.kind === 'fixed' ? rule.day! : day;
  if (rule.kind === 'fixed') {
    const currentPeriod = monthDate(year, anchorMonth - 1, anchorDay);
    if (currentPeriod > base) return date.parse(currentPeriod);
    if (currentPeriod !== base) offset = period;
  }
  return date.parse(monthDate(year, anchorMonth - 1 + offset, anchorDay));
}

export function firstDate(rule: Recurrence | null, created: string) {
  if (rule?.kind !== 'fixed') return null;
  if (rule.unit === 'day' || rule.unit === 'week') return date.parse(created);
  const [year, month] = date.parse(created).split('-').map(Number);
  const anchor = monthDate(year, (rule.unit === 'year' ? rule.month! : month) - 1, rule.day!);
  return anchor >= created ? anchor : nextDate(rule, created, created);
}
