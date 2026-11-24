import { readdir, lstat, mkdir, readFile, link, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Archive } from '../archive';
import { insideArchive } from '../scoped-path';
import { documentLimit } from '../repo/documents';
import { importArchiveDocument } from '../node-documents';
import { today } from '../domain/dates';

export function trackInbox(delay = 2000) {
  const pending = new Map<string, { size: number; modified: number; since: number }>();
  return (files: { name: string; size: number; modified: number }[], time: number) => {
    const seen = new Set(files.map(file => file.name));
    for (const name of pending.keys()) if (!seen.has(name)) pending.delete(name);
    return files.filter(file => {
      const previous = pending.get(file.name);
      if (!previous || previous.size !== file.size || previous.modified !== file.modified) {
        pending.set(file.name, { ...file, since: time });
        return false;
      }
      return time - previous.since >= delay;
    });
  };
}

const supported = /\.(?:pdf|jpe?g|png|heic|eml|msg)$/i;
export function startInbox(archive: Archive) {
  const stable = trackInbox();
  let active: Promise<void> | undefined;
  let warnings: string[] = [];
  async function scan() {
    const [setting] = await archive.db.select<{ value_json: string }>('SELECT value_json FROM setting WHERE key = ?', ['import.inbox_enabled']);
    if (setting?.value_json === 'false') { warnings = []; return; }
    const inbox = await insideArchive(archive.root, join(archive.root, 'indbakke'));
    const files = (await Promise.all((await readdir(inbox, { withFileTypes: true })).filter(e => e.isFile()).map(async e => {
      const stat = await lstat(join(inbox, e.name));
      return { name: e.name, size: stat.size, modified: stat.mtimeMs };
    })));
    warnings = files.filter(f => f.size > documentLimit || !supported.test(f.name)).map(f => f.name + ' · Filtypen eller størrelsen understøttes ikke.');
    const ready = stable(files.filter(f => f.size <= documentLimit && supported.test(f.name)), Date.now());
    for (const f of ready) {
      try {
        const path = await insideArchive(inbox, join(inbox, f.name));
        const bytes = await readFile(path);
        if (bytes.length !== f.size || (await lstat(path)).mtimeMs !== f.modified) continue;
        await importArchiveDocument(archive, f.name, bytes, { via: 'import' }, 'inbox');
        if ((await lstat(path)).mtimeMs !== f.modified) continue;
        const parent = await insideArchive(inbox, join(inbox, 'importeret'));
        const dir = join(parent, today().slice(0, 7));
        await mkdir(dir, { recursive: true });
        const dest = await insideArchive(inbox, dir);
        try { await link(path, join(dest, f.name)); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          await link(path, join(dest, crypto.randomUUID() + '-' + f.name));
        }
        await unlink(path);
      } catch {
        warnings.push(f.name + ' · Kunne ikke importeres eller flyttes.');
      }
    }
  }
  function tick() {
    if (active) return;
    active = scan().catch(() => { warnings = ['Indbakken kunne ikke scannes.']; }).finally(() => { active = undefined; });
  }
  const timer = setInterval(tick, 1000);
  tick();
  return { warnings: () => warnings, async stop() { clearInterval(timer); await active; } };
}
