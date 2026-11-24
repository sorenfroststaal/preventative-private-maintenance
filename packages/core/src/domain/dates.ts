import { z } from 'zod';

export const date = z.iso.date();
export const recurrence = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('interval'), unit: z.enum(['day', 'week', 'month', 'year']), every: z.number().int().min(1).max(9999) }).strict(),
  z.object({
    kind: z.literal('fixed'), unit: z.enum(['day', 'week', 'month', 'year']), every: z.number().int().min(1).max(9999),
    month: z.number().int().min(1).max(12).optional(), day: z.number().int().min(1).max(31).optional(),
  }).strict().refine(({ unit, month, day }) =>
    (unit === 'year' ? month !== undefined : month === undefined) &&
    (unit === 'year' || unit === 'month' ? day !== undefined : day === undefined)),
]);
export type Recurrence = z.infer<typeof recurrence>;

export function today() {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return parts.format(new Date());
}
