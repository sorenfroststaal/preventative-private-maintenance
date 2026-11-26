import { describe, expect, it } from "vitest";
import { createPairingCode, isLanAddress, listMobileDevices, makeCtx, redeemPairingCode, revokeMobileDevice, verifyDeviceToken } from "../src";
import { newArchive } from "./helpers";

describe("mobile access – pairing and device tokens", () => {
  it("a code pairs one device once; the token works until the device is revoked; only hashes are stored", async () => {
    const { env, archive } = await newArchive();
    const ctx = makeCtx(env, archive.db, null, "ui");
    const { code, expiresAt } = await createPairingCode(ctx);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(expiresAt > env.clock.nowIso()).toBe(true);
    const { token, device } = await redeemPairingCode(ctx, code.toLowerCase().replace(/(...)/, "$1-"), "Annas iPhone");
    expect(device.name).toBe("Annas iPhone");
    await expect(redeemPairingCode(ctx, code, "Anden")).rejects.toThrow(/ingen aktiv parringskode/);
    expect((await verifyDeviceToken(ctx, token))?.id).toBe(device.id);
    expect(await verifyDeviceToken(ctx, token + "x")).toBeNull();
    const raw = JSON.stringify(await archive.db.select("SELECT value_json FROM setting WHERE key LIKE 'mobile.%'"));
    expect(raw).not.toContain(token);
    expect(raw).not.toContain(code);
    await revokeMobileDevice(ctx, device.id);
    expect(await verifyDeviceToken(ctx, token)).toBeNull();
    expect(await listMobileDevices(archive.db)).toEqual([]);
  });

  it("wrong codes count; five wrong attempts void the code; expired codes are refused", async () => {
    const { env, archive } = await newArchive();
    const ctx = makeCtx(env, archive.db, null, "ui");
    const { code } = await createPairingCode(ctx);
    for (let i = 0; i < 4; i++) await expect(redeemPairingCode(ctx, "AAAAAA", "x")).rejects.toThrow(/Forkert kode/);
    await expect(redeemPairingCode(ctx, "AAAAAA", "x")).rejects.toThrow(/For mange forkerte/);
    await expect(redeemPairingCode(ctx, code, "x")).rejects.toThrow(/ingen aktiv/);
    const later = makeCtx({ ...env, clock: { ...env.clock, nowIso: () => "2099-01-01T00:00:00.000Z" } }, archive.db, null, "ui");
    const second = await createPairingCode(ctx);
    await expect(redeemPairingCode(later, second.code, "x")).rejects.toThrow(/udløbet/);
  });

  it("only local network addresses are accepted", () => {
    for (const a of ["192.168.1.20", "10.0.0.5", "172.16.3.4", "172.31.255.1", "127.0.0.1", "::1", "::ffff:192.168.0.7", "fe80::1", "fd12::3", "169.254.10.1"]) expect(isLanAddress(a), a).toBe(true);
    for (const a of ["8.8.8.8", "172.32.0.1", "100.64.0.1", "2a00:1450::1", "", undefined]) expect(isLanAddress(a), String(a)).toBe(false);
  });
});

describe("autostart only on a remembered network (review E2)", () => {
  it("keys networks by /24 and starts only where the user turned mobile access on", async () => {
    const { networkKeys, mayAutostartMobile } = await import("../src");
    expect(networkKeys(["192.168.1.23", "192.168.1.40", "10.0.0.5", "127.0.0.1", "8.8.8.8", "fe80::1"])).toEqual(["192.168.1", "10.0.0"]);
    expect(mayAutostartMobile(["192.168.1"], ["192.168.1.99"])).toBe(true);
    expect(mayAutostartMobile(["192.168.1"], ["192.168.2.99"])).toBe(false);
    expect(mayAutostartMobile(null, ["192.168.1.99"])).toBe(false);
    expect(mayAutostartMobile([], ["192.168.1.99"])).toBe(false);
    expect(mayAutostartMobile(["192.168.1"], [])).toBe(false);
  });
});
