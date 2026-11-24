import { link, lstat, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { extractText, getDocumentProxy } from 'unpdf';
import PostalMime from 'postal-mime';
import { dirname, join } from 'node:path';
import { importDocument, sha256 } from './repo/documents';
import { insideArchive } from './scoped-path';
import type { Archive } from './archive';
import type { WriteContext } from './repo/write';

export async function importArchiveDocument(archive: Archive, filename: string, bytes: Uint8Array<ArrayBuffer>, ctx: WriteContext, source: 'drop' | 'inbox' | 'bank_import' = 'drop', db = archive.db as import('./db/adapter').DbAdapter) {
  if (archive.readonly) throw new Error('Arkivet er skrivebeskyttet.');
  let metadata: { title?: string; extracted_text?: string; doc_date?: string } | undefined;
  try {
    if (/\.eml$/i.test(filename)) {
      const message = await PostalMime.parse(bytes);
      metadata = { title: message.subject, extracted_text: [message.subject, message.from?.address, message.date, message.text].filter(Boolean).join('\n'),
        doc_date: message.date && Number.isFinite(Date.parse(message.date)) ? new Date(message.date).toISOString().slice(0, 10) : undefined };
    } else if (/\.pdf$/i.test(filename)) {
      const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
      metadata = { doc_date: pdf.getCreationDate()?.toISOString().slice(0, 10) };
      if (pdf.getPageCount() <= 500) {
        const proxy = await getDocumentProxy(new Uint8Array(bytes), { useWorkerFetch: false, useWasm: false,
          useSystemFonts: false, verbosity: 0, maxImageSize: 16_777_216, enableXfa: false });
        try {
          const { text } = await extractText(proxy, { mergePages: true });
          metadata.extracted_text = text.slice(0, 250_000);
        } finally {
          await proxy.loadingTask.destroy();
        }
      }
    }
  } catch {
    // The original document is still useful when its optional metadata cannot be parsed.
  }
  return importDocument(db, { filename, source }, bytes, ctx, async (relative, content, hash) => {
    const path = join(archive.root, relative);
    await insideArchive(archive.root, join(archive.root, 'bilag'));
    await mkdir(dirname(path), { recursive: true });
    await insideArchive(archive.root, dirname(path));
    const temp = path + '.' + crypto.randomUUID();
    await writeFile(temp, content, { flag: 'wx' });
    try {
      await link(temp, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (!(await lstat(path)).isFile() || await sha256(await readFile(path)) !== hash) {
        throw new Error(`Bilaget er beskadiget: ${relative}`);
      }
    } finally {
      await unlink(temp);
    }
  }, metadata);
}
