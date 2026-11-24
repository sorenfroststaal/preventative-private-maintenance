/** Watched inbox folder (spec 05): import files once their size has been stable for 2 seconds. */
import type { Archive } from "../archive/archive";
import type { Env } from "../env";
import type { Ctx } from "./entities";
import { importDocument, isSupported, type ImportResult } from "./documents";

export const INBOX_STABLE_MS = 2000;

/** Per-file observation kept between scans (path → last seen size and since when). */
export type InboxState = Map<string, { size: number; since: number }>;

export interface InboxScanResult {
  imported: (ImportResult & { name: string })[];
  pending: string[];
  unsupported: string[];
  failed: { name: string; error: string }[];
}

const pad = (n: number) => String(n).padStart(2, "0");

async function uniqueTarget(env: Env, dir: string, name: string): Promise<string> {
  let target = env.fs.join(dir, name);
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let i = 2; await env.fs.exists(target); i++) target = env.fs.join(dir, `${base} (${i})${ext}`);
  return target;
}

/**
 * Scans `<archive>/indbakke` (not sub-folders). Call it at start-up and then regularly
 * (the app polls every 2 seconds). Imported files are moved to indbakke/importeret/YYYY-MM/.
 */
export async function scanInbox(env: Env, archive: Archive, ctx: Ctx, state: InboxState): Promise<InboxScanResult> {
  const dir = archive.path("indbakke");
  const result: InboxScanResult = { imported: [], pending: [], unsupported: [], failed: [] };
  const now = env.clock.now().getTime();
  const seen = new Set<string>();
  for (const e of await env.fs.listDir(dir)) {
    if (e.isDir || e.name.startsWith(".") || e.name.endsWith(".part") || e.name.includes(".tmp-")) continue;
    if (!isSupported(e.name)) {
      result.unsupported.push(e.name);
      continue;
    }
    const path = env.fs.join(dir, e.name);
    const st = await env.fs.stat(path);
    if (!st) continue;
    seen.add(e.name);
    const prev = state.get(e.name);
    if (!prev || prev.size !== st.size) {
      state.set(e.name, { size: st.size, since: now });
      result.pending.push(e.name);
      continue;
    }
    if (now - prev.since < INBOX_STABLE_MS) {
      result.pending.push(e.name);
      continue;
    }
    try {
      const r = await importDocument(env, archive, ctx, path, { source: "inbox" });
      const d = env.clock.now();
      const doneDir = archive.path("indbakke", "importeret", `${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
      await env.fs.mkdirp(doneDir);
      await env.fs.rename(path, await uniqueTarget(env, doneDir, e.name));
      result.imported.push({ ...r, name: e.name });
      state.delete(e.name);
    } catch (err) {
      result.failed.push({ name: e.name, error: err instanceof Error ? err.message : String(err) });
      state.delete(e.name);
    }
  }
  for (const k of [...state.keys()]) if (!seen.has(k)) state.delete(k);
  return result;
}
