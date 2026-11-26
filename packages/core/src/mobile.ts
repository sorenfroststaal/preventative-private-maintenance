/**
 * Mobile access on the local network (iPhone web app): one-time pairing codes and device tokens.
 * Only SHA-256 hashes are stored in the archive (setting `mobile.devices` / `mobile.pairing`).
 * A device acts as the app user who created its pairing code.
 */
import type { DbAdapter } from "./db/adapter";
import type { Ctx } from "./repo/entities";
import { getSetting, setSetting } from "./repo/settings";

export const PAIRING_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I

interface PairingState {
  hash: string;
  userId: string | null;
  expiresAt: string;
  attempts: number;
}

export interface MobileDevice {
  id: string;
  name: string;
  userId: string | null;
  tokenHash: string;
  createdAt: string;
  lastSeenAt: string | null;
}

async function sha256(text: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomString(length: number, alphabet: string): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

const normalizeCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** A new 6-character pairing code, valid for 10 minutes; replaces any earlier code. */
export async function createPairingCode(ctx: Ctx): Promise<{ code: string; expiresAt: string }> {
  const code = randomString(6, CODE_ALPHABET);
  const expiresAt = new Date(Date.parse(ctx.clock.nowIso()) + PAIRING_TTL_MINUTES * 60_000).toISOString();
  await setSetting(ctx, "mobile.pairing", { hash: await sha256(code), userId: ctx.userId, expiresAt, attempts: 0 } satisfies PairingState);
  return { code, expiresAt };
}

export class PairingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PairingError";
  }
}

/**
 * Exchanges a pairing code for a device token (shown once to the device). The code can be used once,
 * expires after 10 minutes and is voided after 5 wrong attempts.
 */
export async function redeemPairingCode(ctx: Ctx, code: string, deviceName: string): Promise<{ token: string; device: MobileDevice }> {
  const state = await getSetting<PairingState | null>(ctx.db, "mobile.pairing");
  if (!state) throw new PairingError("Der er ingen aktiv parringskode. Lav en ny i PPM på computeren.");
  if (state.expiresAt < ctx.clock.nowIso()) {
    await setSetting(ctx, "mobile.pairing", null);
    throw new PairingError("Parringskoden er udløbet. Lav en ny i PPM på computeren.");
  }
  if ((await sha256(normalizeCode(code))) !== state.hash) {
    const attempts = state.attempts + 1;
    await setSetting(ctx, "mobile.pairing", attempts >= MAX_ATTEMPTS ? null : { ...state, attempts });
    throw new PairingError(attempts >= MAX_ATTEMPTS ? "For mange forkerte forsøg. Lav en ny kode i PPM på computeren." : "Forkert kode.");
  }
  await setSetting(ctx, "mobile.pairing", null);
  const token = randomString(43, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_");
  const device: MobileDevice = {
    id: ctx.newId(),
    name: deviceName.trim().slice(0, 60) || "iPhone",
    userId: state.userId,
    tokenHash: await sha256(token),
    createdAt: ctx.clock.nowIso(),
    lastSeenAt: null,
  };
  await setSetting(ctx, "mobile.devices", [...(await listMobileDevices(ctx.db)), device]);
  return { token, device };
}

export async function listMobileDevices(db: DbAdapter): Promise<MobileDevice[]> {
  return (await getSetting<MobileDevice[]>(db, "mobile.devices")) ?? [];
}

/** The device for a token, or null. Updates "last seen" at most once a minute. */
export async function verifyDeviceToken(ctx: Ctx, token: string): Promise<MobileDevice | null> {
  if (!token || token.length < 20) return null;
  const hash = await sha256(token);
  const devices = await listMobileDevices(ctx.db);
  const d = devices.find((x) => x.tokenHash === hash);
  if (!d) return null;
  const now = ctx.clock.nowIso();
  if (!d.lastSeenAt || Date.parse(now) - Date.parse(d.lastSeenAt) > 60_000) {
    await setSetting(ctx, "mobile.devices", devices.map((x) => (x.id === d.id ? { ...x, lastSeenAt: now } : x)));
  }
  return d;
}

/** Removes a device; its token stops working at once. */
export async function revokeMobileDevice(ctx: Ctx, deviceId: string): Promise<void> {
  await setSetting(ctx, "mobile.devices", (await listMobileDevices(ctx.db)).filter((d) => d.id !== deviceId));
}

/** True for loopback and private LAN addresses (IPv4 and IPv6, incl. IPv4-mapped IPv6). */
export function isLanAddress(address: string | undefined | null): boolean {
  if (!address) return false;
  const a = address.replace(/^::ffff:/i, "").toLowerCase();
  const v4 = a.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [b0, b1] = [Number(v4[1]), Number(v4[2])];
    return b0 === 10 || b0 === 127 || (b0 === 172 && b1 >= 16 && b1 <= 31) || (b0 === 192 && b1 === 168) || (b0 === 169 && b1 === 254);
  }
  return a === "::1" || a.startsWith("fe80:") || a.startsWith("fc") || a.startsWith("fd");
}

/** The /24 network of each private IPv4 address, e.g. "192.168.1" (used to recognise the home network). */
export function networkKeys(addresses: string[]): string[] {
  return [...new Set(addresses.filter((a) => isLanAddress(a) && /^\d+\.\d+\.\d+\.\d+$/.test(a) && !a.startsWith("127.")).map((a) => a.split(".").slice(0, 3).join(".")))];
}

/**
 * Whether mobile access may start by itself (review E2): only on a network where the user turned it on.
 * With no remembered network (turned on before this rule, or without a network) it does not start.
 */
export function mayAutostartMobile(rememberedNetworks: string[] | null | undefined, currentAddresses: string[]): boolean {
  const now = networkKeys(currentAddresses);
  return Boolean(rememberedNetworks?.length) && now.some((n) => rememberedNetworks!.includes(n));
}
