import { mkdtempSync } from "node:fs";
import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { nodeEnv } from "../src/node";
import { localDate, type Clock, type Env } from "../src/env";
import { createArchive, type Archive } from "../src/archive/archive";
import { makeCtx } from "../src";

const dirs: string[] = [];
const archives: Archive[] = [];

afterEach(async () => {
  for (const a of archives.splice(0)) await a.close().catch(() => undefined);
  for (const d of dirs.splice(0)) await fsp.rm(d, { recursive: true, force: true });
});

export function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "ppm-test-"));
  dirs.push(d);
  return d;
}

/** A controllable clock. */
export function fixedClock(iso = "2026-11-24T10:00:00.000Z"): Clock & { set(iso: string): void } {
  let current = new Date(iso);
  return {
    nowIso: () => current.toISOString(),
    today: () => localDate(current),
    now: () => new Date(current),
    set(v: string) {
      current = new Date(v);
    },
  };
}

export function testEnv(overrides: Partial<Env> = {}): Env {
  return nodeEnv({ clock: fixedClock(), ...overrides });
}

export async function newArchive(env: Env = testEnv()): Promise<{ env: Env; archive: Archive; root: string }> {
  const root = join(tempDir(), "arkiv");
  const archive = await createArchive(env, root, { appVersion: "0.1.0-test" });
  archives.push(archive);
  return { env, archive, root };
}

export function track(a: Archive): Archive {
  archives.push(a);
  return a;
}

export const ctxFor = (env: Env, archive: Archive, userId: string | null = null) =>
  makeCtx(env, archive.db, userId, "ui");

export async function writeTempFile(name: string, content: string | Uint8Array): Promise<string> {
  const p = join(tempDir(), name);
  await fsp.writeFile(p, content);
  return p;
}
