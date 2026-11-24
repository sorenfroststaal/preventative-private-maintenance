import { z } from 'zod';
import type { DbAdapter } from '../db/adapter';
import { now } from '../db/migrate';
import { recordChange } from './write';

const nameSchema = z.string().trim().min(1, 'Skriv et navn.').max(120);
const userSchema = z.object({
  name: nameSchema,
  personName: nameSchema,
  pin: z.union([z.literal(''), z.string().regex(/^\d{4,12}$/, 'Brug 4–12 cifre.')]).default(''),
});
const iterations = 600_000;
const encode = (value: Uint8Array) => btoa(String.fromCharCode(...value));
const decode = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

async function pinDigest(pin: string, salt: Uint8Array<ArrayBuffer>, count: number) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: count }, key, 256));
}

export function listUsers(db: DbAdapter) {
  return db.select<{ id: string; name: string; is_admin: number; has_pin: number }>(
    'SELECT id, name, is_admin, pin_hash IS NOT NULL AS has_pin FROM app_user WHERE archived_at IS NULL ORDER BY name',
  );
}

export async function authenticate(db: DbAdapter, id: string, pin: string) {
  const [user] = await db.select<{ pin_hash: string | null }>('SELECT pin_hash FROM app_user WHERE id = ? AND archived_at IS NULL', [id]);
  if (!user) return false;
  if (!user.pin_hash) return true;
  const [kind, count, salt, expected] = user.pin_hash.split('$');
  if (kind !== 'pbkdf2' || !/^\d{4,12}$/.test(pin) || !/^\d+$/.test(count) || Number(count) > 1_000_000) return false;
  const digest = await pinDigest(pin, decode(salt), Number(count));
  const actual = encode(digest);
  let difference = actual.length ^ expected.length;
  for (let index = 0; index < actual.length; index++) difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}

export async function createUser(db: DbAdapter, input: unknown, userId?: string) {
  const { name, personName, pin } = userSchema.parse(input);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const pinHash = pin ? ['pbkdf2', iterations, encode(salt), encode(await pinDigest(pin, salt, iterations))].join('$') : null;
  return db.transaction(async (tx) => {
    const users = await tx.select<{ is_admin: number }>('SELECT is_admin FROM app_user WHERE id = ? AND archived_at IS NULL', [userId ?? null]);
    const [existing] = await tx.select('SELECT id FROM app_user LIMIT 1');
    if (existing && !users[0]?.is_admin) throw new Error('Kun administratoren kan oprette brugere.');
    const id = crypto.randomUUID();
    const personId = crypto.randomUUID();
    const createdAt = now();
    const ctx = { via: 'ui', userId } as const;
    await tx.execute('INSERT INTO app_user (id, name, pin_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?)',
      [id, name, pinHash, existing ? 0 : 1, createdAt]);
    await tx.execute('INSERT INTO person (id, name, app_user_id, created_at) VALUES (?, ?, ?, ?)', [personId, personName, id, createdAt]);
    await recordChange(tx, ctx, 'app_user', id, null, { name, is_admin: existing ? 0 : 1, pin_hash: pinHash, created_at: createdAt });
    await recordChange(tx, ctx, 'person', personId, null, { name: personName, app_user_id: id, created_at: createdAt });
    return id;
  });
}

export async function createPerson(db: DbAdapter, input: unknown, userId: string) {
  const person = z.object({ name: nameSchema, relation: z.string().trim().max(120).default('') }).parse(input);
  await db.transaction(async (tx) => {
    const [admin] = await tx.select('SELECT id FROM app_user WHERE id = ? AND is_admin = 1 AND archived_at IS NULL', [userId]);
    if (!admin) throw new Error('Kun administratoren kan oprette personer.');
    const id = crypto.randomUUID();
    await tx.execute('INSERT INTO person (id, name, relation, created_at) VALUES (?, ?, ?, ?)',
      [id, person.name, person.relation || null, now()]);
    await recordChange(tx, { via: 'ui', userId }, 'person', id, null, person);
  });
}

export async function setHealthPrivacy(db: DbAdapter, adminId: string, personId: string, owner: string | null) {
  await db.transaction(async tx => {
    const [admin] = await tx.select('SELECT id FROM app_user WHERE id = ? AND is_admin = 1 AND archived_at IS NULL', [adminId]);
    if (!admin) throw new Error('Kun administratoren kan ændre synligheden.');
    const [before] = await tx.select<Record<string, unknown>>('SELECT * FROM person WHERE id = ? AND archived_at IS NULL', [personId]);
    if (!before) throw new Error('Personen findes ikke.');
    if (owner && !(await tx.select('SELECT id FROM app_user WHERE id = ? AND archived_at IS NULL', [owner])).length) throw new Error('Brugeren findes ikke.');
    await tx.execute('UPDATE person SET health_private_user_id = ? WHERE id = ?', [owner, personId]);
    await recordChange(tx, { via: 'ui', userId: adminId }, 'person', personId, before, { ...before, health_private_user_id: owner });
  });
}
