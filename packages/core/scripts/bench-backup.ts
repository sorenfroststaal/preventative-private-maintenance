/**
 * Streaming check for spec 07 nr. 15: full backup + restore of an archive with
 * N MB of documents through core (Node). Run with:
 *   /usr/bin/time -v pnpm exec tsx packages/core/scripts/bench-backup.ts 500
 * and read "Maximum resident set size".
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArchive, createBackup, importDocument, makeCtx, openArchive, restoreBackup } from "../src";
import { nodeEnv } from "../src/node";

async function main() {
  const mb = Number(process.argv[2] ?? 500);
  const base = mkdtempSync(join(tmpdir(), "ppm-bench-"));
  const env = nodeEnv();
  try {
    const root = join(base, "arkiv");
    const archive = await createArchive(env, root, { appVersion: "bench" });
    const ctx = makeCtx(env, archive.db, null, "system");
    const chunk = Buffer.alloc(1024 * 1024);
    for (let i = 0; i < chunk.length; i++) chunk[i] = (i * 7) % 251;
    const files = Math.ceil(mb / 10);
    for (let i = 0; i < files; i++) {
      const p = join(base, `foto-${i}.jpg`);
      chunk[0] = i % 256; // unique content per file
      chunk[1] = Math.floor(i / 256);
      writeFileSync(p, Buffer.concat(Array(10).fill(chunk)));
      await importDocument(env, archive, ctx, p, { source: "drop" });
      rmSync(p);
    }
    const before = process.memoryUsage().rss;
    const t0 = Date.now();
    const backup = await createBackup(env, archive, ctx, join(base, "backups"));
    const t1 = Date.now();
    await archive.close();
    await restoreBackup(env, backup.path, join(base, "gendannet"));
    const t2 = Date.now();
    const restored = await openArchive(env, join(base, "gendannet"), { appVersion: "bench" });
    const docs = await restored.db.select<{ n: number }>("SELECT count(*) AS n FROM document");
    await restored.close();
    console.log(
      JSON.stringify({
        documentsMB: files * 10,
        files: backup.files,
        backupSeconds: (t1 - t0) / 1000,
        restoreSeconds: (t2 - t1) / 1000,
        restoredDocuments: docs[0]?.n,
        rssBeforeBackupMB: Math.round(before / 1048576),
        peakRssMB: Math.round(process.resourceUsage().maxRSS / 1024),
      }),
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
