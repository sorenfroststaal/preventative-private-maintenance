import { link, lstat, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { importDocument, sha256 } from './repo/documents';
import type { Archive } from './archive';
import type { WriteContext } from './repo/write';

export function importArchiveDocument(archive: Archive, filename: string, bytes: Uint8Array<ArrayBuffer>, ctx: WriteContext) {
  if (archive.readonly) throw new Error('Arkivet er skrivebeskyttet.');
  return importDocument(archive.db, { filename, source: 'drop' }, bytes, ctx, async (relative, content, hash) => {
    const path = join(archive.root, relative);
    await mkdir(dirname(path), { recursive: true });
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
  });
}
