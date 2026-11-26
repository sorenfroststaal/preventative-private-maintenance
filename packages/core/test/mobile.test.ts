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
  it("starts only when the current router is one where the user turned mobile access on", async () => {
    const { mayAutostartMobile } = await import("../src");
    const home = "router:aa:bb:cc:dd:ee:ff";
    expect(mayAutostartMobile([home], home)).toBe(true);
    // A café with the same 192.168.1.x range has another router.
    expect(mayAutostartMobile([home], "router:11:22:33:44:55:66")).toBe(false);
    expect(mayAutostartMobile([home], null)).toBe(false);
    expect(mayAutostartMobile(null, home)).toBe(false);
    // Keys from the earlier /24 rule never match.
    expect(mayAutostartMobile(["192.168.1"], "192.168.1")).toBe(false);
  });
});
