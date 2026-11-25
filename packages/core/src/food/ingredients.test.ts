import { expect, it } from 'vitest';
import { parseIngredientLine } from './ingredients';

it.each([
  ['500 g hakket oksekød', 500, 'g', 'hakket oksekød', null],
  ['2 dl fløde', 2, 'dl', 'fløde', null],
  ['1,5 kg kartofler, skrællede', 1.5, 'kg', 'kartofler', 'skrællede'],
  ['½ tsk salt', 0.5, 'tsk', 'salt', null],
  ['2 løg', 2, 'stk', 'løg', null],
  ['2-3 fed hvidløg', 3, 'fed', 'hvidløg', null],
  ['Salt og peber', null, null, 'salt og peber', null],
  ['  1/2 LITER Vand  ', 0.5, 'l', 'vand', null],
])('parses %s and retains the original line', (line, amount, unit, name, note) => {
  expect(parseIngredientLine(String(line))).toEqual({ amount, unit, name, note, raw_text: line });
});
