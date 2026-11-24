import { z } from 'zod';
import { writeOutput } from './output';
import { join } from 'node:path';
import type { Archive } from '../archive';
import { now } from '../db/migrate';
import { insideArchive } from '../scoped-path';
import { recordType } from '../domain/records';
import { listRecords } from '../repo/records';
import { listDocuments } from '../repo/documents';

export type CalendarTask = { id: string; title: string; due_date: string; module: string };

function escapeIcs(value: string) {
  return value.replaceAll('\\', '\\\\').replace(/\r\n|\r|\n/g, '\\n').replaceAll(';', '\\;').replaceAll(',', '\\,');
}

function foldIcs(line: string) {
  const lines = [''];
  for (const char of line) {
    const last = lines.length - 1;
    if (Buffer.byteLength(lines[last] + char) > 75) lines.push(' ' + char);
    else lines[last] += char;
  }
  return lines.join('\r\n');
}

export function calendar(tasks: CalendarTask[], fullHealthTitle = false) {
  const stamp = now().replace(/[-:]/g, '');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PPM//Opgaver//DA', ...tasks.flatMap(task => [
    'BEGIN:VEVENT', 'UID:' + task.id + '@ppm', 'DTSTAMP:' + stamp, 'DTSTART;VALUE=DATE:' + task.due_date.replaceAll('-', ''),
    'SUMMARY:' + escapeIcs(task.module === 'health' && !fullHealthTitle ? 'Helbred: påmindelse' : task.title),
    'END:VEVENT',
  ]), 'END:VCALENDAR', ''].map(foldIcs).join('\r\n');
}

function csvValue(cell: unknown) {
  const value = String(cell ?? '');
  const safe = typeof cell === 'string' && /^[\s]*[=+@-]/.test(cell) ? "'" + value : value;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export async function exportFile(archive: Archive, input: unknown, userId: string) {
  const request = z.object({ format: z.enum(['json', 'csv', 'ics']), table: z.string().optional(), ids: z.array(z.uuid()).max(5000).optional() }).parse(input);
  let filename: string;
  let content: string;
  if (request.format === 'ics') {
    const rows = await archive.db.select<CalendarTask>(`SELECT o.id, o.due_date, t.title, t.module
      FROM task_occurrence o JOIN task t ON t.id = o.task_id WHERE o.status = 'open' AND o.due_date IS NOT NULL AND t.status = 'active'
      AND (t.module != 'health' OR EXISTS (SELECT 1 FROM person p WHERE p.id = t.target_id AND p.archived_at IS NULL
        AND (p.health_private_user_id IS NULL OR p.health_private_user_id = ?))) ORDER BY o.due_date`, [userId]);
    content = calendar(request.ids ? rows.filter(row => request.ids!.includes(row.id)) : rows);
    filename = 'ppm-opgaver.ics';
  } else {
    const table = request.table === 'document' ? 'document' : recordType.parse(request.table);
    const rows = table === 'document' ? await listDocuments(archive.db) : await listRecords(archive.db, table, { via: 'ui', userId });
    if (request.format === 'json') content = JSON.stringify(rows, null, 2) + '\n';
    else {
      const columns = Object.keys(rows[0] ?? {});
      content = [columns, ...rows.map(row => columns.map(key => (row as Record<string, unknown>)[key]))].map(line => line.map(csvValue).join(';')).join('\r\n');
    }
    filename = table + '.' + request.format;
  }
  const directory = await insideArchive(archive.root, join(archive.root, 'eksport'));
  return writeOutput(directory, filename, content);
}
