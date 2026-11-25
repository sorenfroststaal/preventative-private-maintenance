import { z } from 'zod';
import type { DbAdapter } from '../db/adapter';
import { now } from '../db/migrate';
import { recordChange, type WriteContext } from './write';

const extensions = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  csv: 'text/csv', heic: 'image/heic', eml: 'message/rfc822', msg: 'application/vnd.ms-outlook',
};
export const documentLimit = 100_000_000;
const documentInput = z.object({
  filename: z.string().min(1).max(255).regex(/^[^/\\\x00-\x1f]+$/),
  source: z.enum(['drop', 'inbox', 'ai', 'bank_import']),
});
export type DocumentRow = { id: string; sha256: string; ext: string; filename: string; title: string; source?: string; linked?: number; roles?: string };
export const documentPath = (sha: string, ext: string) => `bilag/${sha.slice(0, 2)}/${sha}.${ext}`;

export async function sha256(bytes: Uint8Array<ArrayBuffer>) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function importDocument(
  db: DbAdapter, input: unknown, bytes: Uint8Array<ArrayBuffer>, ctx: WriteContext,
  store: (relative: string, bytes: Uint8Array<ArrayBuffer>, hash: string) => Promise<void>,
  metadata?: { title?: string; extracted_text?: string; doc_date?: string },
) {
  const { filename, source } = documentInput.parse(input);
  if (bytes.length > documentLimit) throw new Error('Filen fylder mere end 100 MB.');
  const dot = filename.lastIndexOf('.');
  const ext = filename.slice(dot + 1).toLowerCase();
  if (dot < 1 || !Object.hasOwn(extensions, ext) || ((ext === 'csv') !== (source === 'bank_import'))) throw new Error('Filtypen understøttes ikke.');
  const hash = await sha256(bytes);
  return db.transaction(async (tx) => {
    const [existing] = await tx.select<DocumentRow>('SELECT id, sha256, ext, filename, title FROM document WHERE sha256 = ?', [hash]);
    if (existing) {
      await store(documentPath(hash, existing.ext), bytes, hash);
      return { ...existing, duplicate: true };
    }
    const id = crypto.randomUUID();
    const title = metadata?.title || filename.slice(0, dot);
    const mime = extensions[ext as keyof typeof extensions];
    await store(documentPath(hash, ext), bytes, hash);
    await tx.execute('INSERT INTO document (id, sha256, filename, ext, mime, size_bytes, title, source, created_at, created_by, extracted_text, doc_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, hash, filename, ext, mime, bytes.length, title, source, now(), ctx.userId ?? null, metadata?.extracted_text ?? null, metadata?.doc_date ?? null]);
    await recordChange(tx, ctx, 'document', id, null, { sha256: hash, filename, ext, mime, size_bytes: bytes.length, title, source, extracted_text: metadata?.extracted_text ?? null, doc_date: metadata?.doc_date ?? null },
      { module: 'documents', title, body: metadata?.extracted_text });
    return { id, sha256: hash, ext, filename, title, duplicate: false };
  });
}

export function listDocuments(db: DbAdapter) {
  return db.select<DocumentRow>(`SELECT id, sha256, ext, filename, title, source,
    (EXISTS(SELECT 1 FROM document_link l WHERE l.document_id = d.id) OR EXISTS(SELECT 1 FROM recipe WHERE photo_document_id=d.id)) AS linked,
    (SELECT GROUP_CONCAT(DISTINCT l.role) FROM document_link l WHERE l.document_id = d.id) AS roles FROM document d
    WHERE NOT EXISTS (SELECT 1 FROM document_link l WHERE l.document_id = d.id AND l.target_type IN
      ('person', 'task_occurrence', 'health_visit', 'health_screening', 'health_vaccination', 'health_medication'))
    ORDER BY created_at DESC, id`);
}
