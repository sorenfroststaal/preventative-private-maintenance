import { expect, it } from 'vitest';
import { firstDate, nextDate } from './next';
import type { Recurrence } from '../domain/dates';

const cases: { rule: Recurrence; due: string; completed: string; expected: string[]; skipped?: boolean }[] = [
  { rule: { kind: 'fixed', unit: 'year', month: 10, day: 1, every: 1 }, due: '2026-10-01', completed: '2026-11-20', expected: ['2027-10-01'] },
  { rule: { kind: 'fixed', unit: 'year', month: 10, day: 1, every: 1 }, due: '2026-09-15', completed: '2026-09-15', expected: ['2026-10-01'] },
  { rule: { kind: 'fixed', unit: 'year', month: 10, day: 1, every: 2 }, due: '2026-11-15', completed: '2026-11-15', expected: ['2027-10-01', '2029-10-01'] },
  { rule: { kind: 'fixed', unit: 'month', day: 31, every: 1 }, due: '2026-01-31', completed: '2026-01-31', expected: ['2026-02-28', '2026-03-31'] },
  { rule: { kind: 'fixed', unit: 'year', month: 2, day: 29, every: 1 }, due: '2028-02-29', completed: '2028-02-29', expected: ['2029-02-28'] },
  { rule: { kind: 'interval', unit: 'month', every: 6 }, due: '2026-03-01', completed: '2026-03-15', expected: ['2026-09-15'] },
  { rule: { kind: 'interval', unit: 'month', every: 3 }, due: '2026-01-10', completed: '2026-02-20', expected: ['2026-04-10'], skipped: true },
  { rule: { kind: 'interval', unit: 'month', every: 1 }, due: '2026-01-31', completed: '2026-01-31', expected: ['2026-02-28'] },
];
it.each(cases)('matches the normative example from $due to $expected', ({ rule, due, completed, expected, skipped }) => {
  let next = due;
  for (const candidate of expected) {
    next = nextDate(rule, next, completed, skipped);
    expect(next).toBe(candidate);
  }
});

it('uses completion for a skipped interval without a previous date', () => {
  const rule = { kind: 'interval', unit: 'month', every: 1 } as const;
  expect(firstDate(rule, '2026-01-01')).toBeNull();
  expect(nextDate(rule, null, '2026-01-31', true)).toBe('2026-02-28');
});

it('finds the first fixed date on or after creation regardless of every', () => {
  const rule = { kind: 'fixed', unit: 'year', every: 2, month: 10, day: 1 } as const;
  expect(firstDate(rule, '2026-10-01')).toBe('2026-10-01');
  expect(firstDate(rule, '2026-10-02')).toBe('2027-10-01');
});
