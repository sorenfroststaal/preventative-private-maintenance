import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { DbAdapter } from '../db/adapter';
import { now } from '../db/migrate';
import { recordChange, type WriteContext } from '../repo/write';
import { synchronizeIndex } from '../repo/records';

const column = z.number().int().min(0).max(100);
const generic = z.object({ delimiter: z.enum([';', ',', '\t']), header: z.boolean(),
  dateFormat: z.enum(['danish', 'iso']), date: column, text: column, amount: column, balance: column.optional() });
export const profileSchema = z.union([z.literal('sparkron'), generic]);
export type Profile = z.infer<typeof profileSchema>;

export function danishMinor(value: string) {
  const cleaned = value.trim();
  if (!/^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(cleaned)) throw new Error('Ugyldigt dansk beløb.');
  const [whole, decimal = ''] = cleaned.replace(/[+.-]/g, '').split(',');
  const minor = Number(whole + decimal.padEnd(2, '0')) * (cleaned.startsWith('-') ? -1 : 1);
  if (!Number.isSafeInteger(minor)) throw new Error('Beløbet er for stort.');
  return minor === 0 ? 0 : minor;
}

function decode(bytes: Uint8Array) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('windows-1252').decode(bytes); }
}

function rowsOf(input: string, delimiter: string) {
  return parse(input, { delimiter, trim: true, skip_empty_lines: true, relax_column_count: true, info: true }) as unknown as
    { record: string[]; info: { lines: number } }[];
}

export function parseBank(bytes: Uint8Array, rawProfile: unknown, account: string) {
  const input = decode(bytes);
  const profile = profileSchema.parse(rawProfile);
  const standard = profile === 'sparkron';
  function matches(delimiter: string) {
    try {
      const [candidate] = parse(input, { delimiter, trim: true, to: 1, skip_empty_lines: true }) as string[][];
      return candidate?.map(cell => cell.toLocaleLowerCase('da')).join('|') === 'dato|posteringstekst|beløb';
    } catch {
      return false;
    }
  }
  const delimiter = standard ? [';', ','].find(matches) : profile.delimiter;
  if (!delimiter) throw new Error('Forventede kolonnerne Dato, Posteringstekst og Beløb.');
  const rows = rowsOf(input, delimiter);
  if (standard || profile.header) rows.shift();
  const occurrences = new Map<string, number>();
  return rows.filter(row => row.record.some(Boolean)).map(({ record, info }) => {
    try {
      if (standard && record.length !== 3) throw new Error('Forventede tre kolonner.');
      const rawDate = record[standard ? 0 : profile.date] ?? '';
      const m = /^(\d{2})([-.])(\d{2})\2(\d{4})$/.exec(rawDate);
      const booking_date = z.iso.date({ error: 'Ugyldig dato.' }).parse(!standard && profile.dateFormat === 'iso' ? rawDate : m ? [m[4], m[3], m[1]].join('-') : '');
      const text = z.string().trim().min(1, 'Posteringsteksten mangler.').parse(record[standard ? 1 : profile.text]);
      const amount_minor = danishMinor(record[standard ? 2 : profile.amount] ?? '');
      const balance = standard || profile.balance === undefined ? '' : record[profile.balance];
      const balance_minor = balance ? danishMinor(balance) : null;
      const key = [account, booking_date, text, amount_minor, balance_minor ?? ''].join('|');
      const n = occurrences.get(key) ?? 0;
      occurrences.set(key, n + 1);
      const dedupe_hash = createHash('sha256').update(key + '|' + n).digest('hex');
      return { booking_date, text, amount_minor, balance_minor, dedupe_hash };
    } catch (error) {
      throw new Error(`Række ${info.lines}: ${error instanceof Error ? error.message : 'Ugyldige data.'}`);
    }
  });
}

type BankRow = ReturnType<typeof parseBank>[number];

async function latestBankRows(db: DbAdapter, account: string, rows: BankRow[]) {
  const existing = new Set((await db.select<{ dedupe_hash: string }>('SELECT dedupe_hash FROM bank_transaction WHERE account_id = ?', [account])).map(r => r.dedupe_hash));
  return rows.filter(r => !existing.has(r.dedupe_hash));
}

export async function previewBank(db: DbAdapter, account: string, rows: BankRow[]) {
  const newRows = await latestBankRows(db, account, rows);
  return { rows: rows.slice(0, 20), added: newRows.length, duplicates: rows.length - newRows.length };
}

export async function importBank(db: DbAdapter, account: string, rows: BankRow[], profile: Profile, ctx: WriteContext, saveDocument: (tx: DbAdapter) => Promise<string>) {
  return db.transaction(async tx => {
    const [owner] = await tx.select<{ currency: string }>('SELECT currency FROM account WHERE id = ? AND archived_at IS NULL', [account]);
    if (!owner) throw new Error('Kontoen findes ikke.');
    const newRows = await latestBankRows(tx, account, rows);
    const document = await saveDocument(tx);
    const batch = {
      id: crypto.randomUUID(), account_id: account, profile: profile === 'sparkron' ? 'sparkron' : 'generic:manuel',
      file_document_id: document, imported_at: now(), rows_total: rows.length, rows_imported: newRows.length, rows_duplicate: rows.length - newRows.length,
    };
    await tx.execute('INSERT INTO import_batch VALUES (?, ?, ?, ?, ?, ?, ?, ?)', Object.values(batch));
    await recordChange(tx, ctx, 'import_batch', batch.id, null, batch);
    const rules = await tx.select<{ match_type: string; pattern: string; category_id: string }>(
      'SELECT r.match_type, r.pattern, r.category_id FROM category_rule r JOIN category c ON c.id = r.category_id WHERE c.archived_at IS NULL ORDER BY r.priority, r.rowid',
    );
    for (const row of newRows) {
      const rule = rules.find(({ match_type, pattern }) => {
        const input = row.text.toLocaleLowerCase('da');
        const term = pattern.toLocaleLowerCase('da');
        if (match_type === 'contains') return input.includes(term);
        if (match_type === 'starts_with') return input.startsWith(term);
        return false;
      });
      const data = { id: crypto.randomUUID(), account_id: account, ...row, currency: owner.currency,
        category_id: rule?.category_id ?? null, category_source: rule ? 'rule' : null, import_batch_id: batch.id };
      const columns = Object.keys(data);
      await tx.execute(`INSERT INTO bank_transaction (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`, Object.values(data));
      await synchronizeIndex(tx, 'bank_transaction', data, ctx, null);
    }
    return { added: batch.rows_imported, duplicates: batch.rows_duplicate };
  });
}
