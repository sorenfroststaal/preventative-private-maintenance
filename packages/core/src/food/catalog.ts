import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { DbAdapter } from '../db/adapter';
import { now } from '../db/migrate';
import { recordChange, type WriteContext } from '../repo/write';

const catalog = z.object({ format: z.literal('ppm-recipe-templates'), version: z.literal(1),
  retter: z.array(z.object({ id: z.string().min(1), navn: z.string().min(1) })) });

export async function addStarterCatalog(db: DbAdapter, ctx: WriteContext) {
  const path = process.env.PPM_RUNTIME_DIR ? join(process.env.PPM_RUNTIME_DIR, 'retter.json')
    : new URL('../../../../templates/da/retter.json', import.meta.url);
  const { retter } = catalog.parse(JSON.parse(await readFile(path, 'utf8')));
  return db.transaction(async tx => {
    let added = 0;
    for (const dish of retter) {
      const ref = 'open-planner:' + dish.id;
      if ((await tx.select('SELECT 1 FROM recipe WHERE source_ref = ?', [ref])).length) continue;
      const id = crypto.randomUUID();
      const at = now();
      await tx.execute("INSERT INTO recipe (id, name, source, source_ref, created_at, updated_at) VALUES (?, ?, 'template', ?, ?, ?)",
        [id, dish.navn, ref, at, at]);
      const [saved] = await tx.select<Record<string, unknown>>('SELECT * FROM recipe WHERE id = ?', [id]);
      await recordChange(tx, ctx, 'recipe', id, null, saved, { module: 'food', title: dish.navn });
      added++;
    }
    return added;
  });
}

export function recipes(db: DbAdapter) {
  return db.select<{id: string; name: string}>('SELECT id, name FROM recipe WHERE archived_at IS NULL ORDER BY name');
}
