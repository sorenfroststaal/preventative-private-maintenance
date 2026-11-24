import { createEntity, listEntities, mustGet, updateEntity, ValidationError, type Ctx } from "./entities";
import type { DbAdapter } from "../db/adapter";
import type { Row } from "../domain/registry";

// OWASP 2023 recommendation for PBKDF2-HMAC-SHA256.
const PBKDF2_ITERATIONS = 600_000;
/** Upper bound accepted when verifying, so a tampered hash cannot hang the login screen. */
const PBKDF2_MAX_ITERATIONS = 2_000_000;

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function pbkdf2(pin: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

/** Format: pbkdf2$<iter>$<salt_b64>$<hash_b64> (spec schema). Not a security boundary. */
export async function hashPin(pin: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  if (!/^\d{4,8}$/.test(pin)) {
    throw new ValidationError([{ path: "pin", message: "PIN skal være 4-8 cifre" }], "app_user");
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(pin, salt, iterations);
  return `pbkdf2$${iterations}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [alg, iter, salt, hash] = stored.split("$");
  if (alg !== "pbkdf2" || !iter || !salt || !hash) return false;
  if (!/^\d+$/.test(iter) || Number(iter) < 1 || Number(iter) > PBKDF2_MAX_ITERATIONS) return false;
  const computed = await pbkdf2(pin, unb64(salt), Number(iter));
  const expected = unb64(hash);
  if (computed.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed[i]! ^ expected[i]!;
  return diff === 0;
}

export interface NewUser {
  name: string;
  pin?: string | null;
  isAdmin?: boolean;
  /** Also create a person for the user (spec 04). Default true. */
  createPerson?: boolean;
  relation?: string | null;
}

export class PermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionError";
  }
}

/**
 * Throws unless the archive has no users yet (first-run setup) or ctx.userId is an
 * active admin (spec 04: only admin creates users and persons).
 */
export async function assertAdminOrFirstUser(db: DbAdapter, userId: string | null): Promise<void> {
  const [any] = await db.select<{ id: string }>("SELECT id FROM app_user LIMIT 1");
  if (!any) return;
  const [admin] = userId
    ? await db.select<{ id: string }>(
        "SELECT id FROM app_user WHERE id = ? AND is_admin = 1 AND archived_at IS NULL",
        [userId],
      )
    : [];
  if (!admin) throw new PermissionError("Kun en administrator kan oprette brugere og personer.");
}

export async function createUser(ctx: Ctx, u: NewUser): Promise<{ user: Row; person: Row | null }> {
  const pin_hash = u.pin ? await hashPin(u.pin) : null;
  return ctx.db.transaction(async (tx) => {
    const c = { ...ctx, db: tx };
    await assertAdminOrFirstUser(tx, ctx.userId);
    const isFirst = (await tx.select("SELECT id FROM app_user LIMIT 1")).length === 0;
    const user = await createEntity(c, "app_user", {
      name: u.name,
      pin_hash,
      // The first user is always admin (spec 04), otherwise nobody could manage users.
      is_admin: isFirst || u.isAdmin ? 1 : 0,
    });
    let person: Row | null = null;
    if (u.createPerson !== false) {
      person = await createEntity(c, "person", {
        name: u.name,
        relation: u.relation ?? "mig",
        app_user_id: String(user.id),
      });
    }
    return { user, person };
  });
}

export interface NewPerson {
  name: string;
  relation?: string | null;
  birth_year?: number | null;
  notes?: string | null;
}

/** Creates a household member without a login. Admin only (spec 04). */
export async function createPerson(ctx: Ctx, p: NewPerson): Promise<Row> {
  return ctx.db.transaction(async (tx) => {
    await assertAdminOrFirstUser(tx, ctx.userId);
    return createEntity({ ...ctx, db: tx }, "person", {
      name: p.name,
      relation: p.relation ?? null,
      birth_year: p.birth_year ?? null,
      notes: p.notes ?? null,
    });
  });
}

export async function setPin(ctx: Ctx, userId: string, pin: string | null): Promise<void> {
  await updateEntity(ctx, "app_user", userId, { pin_hash: pin ? await hashPin(pin) : null });
}

export interface PublicUser {
  id: string;
  name: string;
  is_admin: number;
  has_pin: boolean;
}

/** User info for the login screen (never exposes the hash). */
export async function listUsers(db: DbAdapter): Promise<PublicUser[]> {
  const rows = await listEntities(db, "app_user", { orderBy: "name" });
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    is_admin: Number(r.is_admin),
    has_pin: Boolean(r.pin_hash),
  }));
}

export async function login(db: DbAdapter, userId: string, pin: string | null): Promise<boolean> {
  const u = await mustGet(db, "app_user", userId);
  if (u.archived_at) return false;
  if (!u.pin_hash) return true;
  if (!pin) return false;
  return verifyPin(pin, String(u.pin_hash));
}
