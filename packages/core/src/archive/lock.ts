import type { Env } from "../env";
import { ArchiveError } from "./errors";

export interface LockInfo {
  pid: number;
  hostname: string;
  at: string;
}

const lockPath = (env: Env, root: string) => env.fs.join(root, ".lock");

export async function readLock(env: Env, root: string): Promise<LockInfo | null> {
  const p = lockPath(env, root);
  if (!(await env.fs.exists(p))) return null;
  try {
    return JSON.parse(await env.fs.readText(p)) as LockInfo;
  } catch {
    // Unreadable lock: treat as stale lock owned by nobody.
    return { pid: -1, hostname: "", at: "" };
  }
}

/** True if the lock belongs to a process that is no longer running on this machine. */
export async function isLockStale(env: Env, lock: LockInfo): Promise<boolean> {
  if (lock.pid <= 0) return true;
  const host = await env.platform.hostname();
  if (lock.hostname && lock.hostname !== host) return false; // cannot check other machines
  return !(await env.platform.isProcessAlive(lock.pid));
}

/**
 * Takes the instance lock. Throws ArchiveError("locked") if a running process holds it,
 * or ArchiveError("stale_lock") if a dead process left it behind; the caller must ask
 * the user before calling removeStaleLock().
 */
export async function acquireLock(env: Env, root: string): Promise<void> {
  const info: LockInfo = {
    pid: await env.platform.pid(),
    hostname: await env.platform.hostname(),
    at: env.clock.nowIso(),
  };
  if (await env.fs.createExclusive(lockPath(env, root), JSON.stringify(info))) return;
  const existing = await readLock(env, root);
  if (existing && existing.pid === info.pid && existing.hostname === info.hostname) {
    throw new ArchiveError("Arkivet er allerede åbent i dette program.", "locked");
  }
  if (existing && (await isLockStale(env, existing))) {
    throw new ArchiveError(
      "Arkivet blev ikke lukket korrekt sidste gang. Fjern låsen, hvis intet andet program bruger arkivet.",
      "stale_lock",
    );
  }
  throw new ArchiveError("Arkivet er åbent i et andet program og kan ikke åbnes for skrivning.", "locked");
}

/** Removes a lock only if it is stale. Returns true if removed. */
export async function removeStaleLock(env: Env, root: string): Promise<boolean> {
  const existing = await readLock(env, root);
  if (!existing) return true;
  if (!(await isLockStale(env, existing))) return false;
  await env.fs.remove(lockPath(env, root));
  return true;
}

/** Releases the lock if this process owns it. */
export async function releaseLock(env: Env, root: string): Promise<void> {
  const existing = await readLock(env, root);
  if (!existing) return;
  if (existing.pid === (await env.platform.pid()) && existing.hostname === (await env.platform.hostname())) {
    await env.fs.remove(lockPath(env, root));
  }
}
