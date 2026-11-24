import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { openArchive } from '../packages/core/src/archive';
import { createBackup, restoreBackup } from '../packages/core/src/backup/backup';
import { now } from '../packages/core/src/db/migrate';
import { documentPath } from '../packages/core/src/repo/documents';

const root = await mkdtemp(join(tmpdir(), 'ppm-backup-measure-'));
const bytesPerDocument = 90 * 1024 * 1024;
const documentCount = 6;
try {
  const archive = await openArchive(join(root, 'source'), { create: true });
  try {
    for (let i = 0; i < documentCount; i++) {
      const chunk = Buffer.alloc(1024 * 1024, i);
      const hash = createHash('sha256');
      for (let offset = 0; offset < bytesPerDocument; offset += chunk.length) hash.update(chunk);
      const sha256 = hash.digest('hex');
      const path = join(archive.root, documentPath(sha256, 'png'));
      await mkdir(dirname(path), { recursive: true });
      await pipeline(Readable.from((function* () {
        for (let offset = 0; offset < bytesPerDocument; offset += chunk.length) yield chunk;
      })()), createWriteStream(path, { flags: 'wx' }));
      await archive.db.execute(`INSERT INTO document (id, sha256, filename, ext, mime, size_bytes, source, created_at)
        VALUES (?, ?, ?, 'png', 'image/png', ?, 'drop', ?)`, [crypto.randomUUID(), sha256, i + '.png', bytesPerDocument, now()]);
    }
    const zip = await createBackup(archive, root);
    await restoreBackup(zip, join(root, 'restored'));
    console.log(JSON.stringify({ archiveBytes: documentCount * bytesPerDocument, maxRssKiB: process.resourceUsage().maxRSS, platform: process.platform }));
  } finally {
    await archive.close();
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
