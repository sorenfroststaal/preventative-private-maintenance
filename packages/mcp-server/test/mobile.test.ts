import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, promises as fsp, writeFileSync, mkdirSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { X509Certificate } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEntity, createPairingCode, importDocument, linkDocument, localDate, makeCtx, openArchiveForAi, type Archive } from "@ppm/core";
import { nodeEnv } from "@ppm/core/node";
import { createDemoArchive } from "../../core/scripts/seed";
import { startMobileServer } from "../src/mobile/server";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const f of cleanup.splice(0)) await f();
});

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- API responses of various shapes
type AnyJson = any;
let nextPort = 47300 + Math.floor(Math.random() * 400) * 2;

async function setup() {
  const now = new Date("2026-11-24T10:00:00.000Z");
  const env = nodeEnv({ clock: { nowIso: () => now.toISOString(), today: () => localDate(now), now: () => new Date(now) } });
  const dir = mkdtempSync(join(tmpdir(), "ppm-mobile-"));
  const info = await createDemoArchive(env, join(dir, "arkiv"));
  const archive: Archive = await openArchiveForAi(env, info.root);
  const staticDir = join(dir, "static");
  mkdirSync(staticDir);
  writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>PPM mobil</title>");
  const port = (nextPort += 2);
  const s = await startMobileServer({ env, archive, staticDir, tlsDir: join(dir, "tls"), port, host: "127.0.0.1" });
  cleanup.push(async () => {
    await s.close();
    await archive.close();
    await fsp.rm(dir, { recursive: true, force: true });
  });
  const call = (method: string, path: string, opts: { token?: string; body?: unknown; raw?: Buffer } = {}) =>
    new Promise<{ status: number; body: AnyJson; headers: Record<string, unknown> }>((ok, fail) => {
      const data = opts.raw ?? (opts.body === undefined ? undefined : Buffer.from(JSON.stringify(opts.body)));
      const req = httpsRequest(
        { host: "127.0.0.1", port, path, method, ca: s.caCert, headers: { ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...(data ? { "content-length": data.length } : {}) } },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const b = Buffer.concat(chunks);
            const type = String(res.headers["content-type"] ?? "");
            ok({ status: res.statusCode ?? 0, headers: res.headers, body: type.includes("json") ? JSON.parse(b.toString()) : b });
          });
        },
      );
      req.on("error", fail);
      if (data) req.write(data);
      req.end();
    });
  const ctx = makeCtx(env, archive.db, info.annaUserId, "ui");
  return { s, port, call, ctx, env, archive, tlsDir: join(dir, "tls") };
}

describe("mobile web app server (iPhone, local network)", () => {
  it("serves HTTPS with a certificate from the local CA that iOS accepts (SAN, serverAuth, ≤ 825 days)", async () => {
    const { s, call, tlsDir } = await setup();
    const res = await call("GET", "/");
    expect(res.status).toBe(200);
    expect(String(res.body)).toContain("PPM mobil");
    const ca = new X509Certificate(s.caCert);
    expect(ca.ca).toBe(true);
    expect(s.caFingerprint).toBe(ca.fingerprint256);
    const server = new X509Certificate(await fsp.readFile(join(tlsDir, "server.crt")));
    expect(server.checkIssued(ca)).toBe(true);
    expect(server.verify(ca.publicKey)).toBe(true);
    expect(server.subjectAltName).toContain("IP Address:127.0.0.1");
    expect(server.keyUsage).toContain("1.3.6.1.5.5.7.3.1"); // serverAuth
    expect((Date.parse(server.validTo) - Date.parse(server.validFrom)) / 86_400_000).toBeLessThanOrEqual(825);
    expect(server.publicKey.asymmetricKeyDetails?.modulusLength).toBeGreaterThanOrEqual(2048);
    expect(server.ca).toBe(false);
  });

  it("requires pairing; a code gives a token; the token reads the overview and writes through core", async () => {
    const { call, ctx, archive, env } = await setup();
    expect((await call("GET", "/api/overview")).status).toBe(401);
    expect((await call("POST", "/api/pair", { body: { code: "AAAAAA", name: "x" } })).status).toBe(400);
    const { code } = await createPairingCode(ctx);
    const paired = await call("POST", "/api/pair", { body: { code, name: "Annas iPhone" } });
    expect(paired.status).toBe(200);
    const token = paired.body.token as string;
    const me = await call("GET", "/api/me", { token });
    expect(me.body).toMatchObject({ device: { name: "Annas iPhone" }, user: "Anna Eksempel" });

    const ov = await call("GET", "/api/overview", { token });
    expect(ov.status).toBe(200);
    expect(ov.body.overdue.length + ov.body.upcoming.length).toBeGreaterThan(0);
    expect([...ov.body.overdue, ...ov.body.upcoming].every((t: { module: string }) => t.module !== "health")).toBe(true);
    const task = (ov.body.overdue[0] ?? ov.body.upcoming[0]) as { occurrence: string };
    const done = await call("POST", `/api/occurrences/${task.occurrence}/complete`, { token });
    expect(done.status).toBe(200);
    expect((await archive.db.select<{ status: string }>("SELECT status FROM task_occurrence WHERE id = ?", [task.occurrence]))[0]!.status).toBe("done");

    const cal = await call("GET", "/api/calendar?from=2026-11-01&to=2026-12-31", { token });
    expect(cal.body.length).toBeGreaterThan(0);
    expect(cal.body.every((e: { kind: string }) => e.kind !== "health")).toBe(true);

    const shop = await call("GET", "/api/shopping?date=2026-11-24", { token });
    const first = shop.body.sections[0]?.items[0] as { id: string; checked: boolean } | undefined;
    if (first) {
      await call("POST", `/api/shopping/${first.id}`, { token, body: { checked: !first.checked } });
      expect((await archive.db.select<{ checked: number }>("SELECT checked FROM shopping_item WHERE id = ?", [first.id]))[0]!.checked).toBe(first.checked ? 0 : 1);
    }
    expect((await call("GET", "/api/meals?date=2026-11-24", { token })).body.entries.length).toBeGreaterThan(0);
    expect((await call("GET", "/api/search?q=opvask", { token })).body.length).toBeGreaterThan(0);

    // Upload a photo from the phone and link it to an item.
    const items = (await call("GET", "/api/items?q=sofa", { token })).body as { id: string }[];
    const up = await call("POST", `/api/upload?name=foto.png&item=${items[0]!.id}&role=photo`, { token, raw: PNG });
    expect(up.status).toBe(200);
    expect(up.body.linked).toBe(true);
    const detail = await call("GET", `/api/items/${items[0]!.id}`, { token });
    expect(detail.body.documents.some((d: { role: string }) => d.role === "photo")).toBe(true);
    const file = await call("GET", `/api/documents/${up.body.id}/file`, { token });
    expect(file.headers["content-type"]).toBe("image/png");

    // Documents linked to health records stay on the computer.
    const person = await createEntity(ctx, "person", { name: "Privat" });
    const visit = await createEntity(ctx, "health_visit", { person_id: String(person.id), visit_date: "2026-11-01", kind: "gp" });
    const tmp = join(mkdtempSync(join(tmpdir(), "ppm-mob-doc-")), "brev.pdf");
    writeFileSync(tmp, "%PDF-1.4 helbred");
    const { document } = await importDocument(env, archive, ctx, tmp, { source: "drop" });
    await linkDocument(ctx, { document_id: String(document.id), target_type: "health_visit", target_id: String(visit.id), role: "letter" });
    expect((await call("GET", `/api/documents/${document.id}/file`, { token })).status).toBe(403);
    expect((await call("GET", "/api/overview", { token: token.slice(0, -2) + "xx" })).status).toBe(401);
  });

  it("the phone creates and edits items, people outside the household, gifts and lendings through core", async () => {
    const { call, ctx, archive } = await setup();
    const { code } = await createPairingCode(ctx);
    const token = (await call("POST", "/api/pair", { body: { code, name: "Annas iPhone" } })).body.token as string;
    const opts = (await call("GET", "/api/options", { token })).body;
    expect(opts.locations.length).toBeGreaterThan(0);
    expect(opts.categories).toContain("Værktøj");
    expect(opts.occasions).toContain("Fødselsdag");

    // New item, then edit it; only allowed columns are written.
    const created = await call("POST", "/api/items", { token, body: { name: "Mobil-stige", category: "Værktøj", location_id: opts.locations[0].id, purchase_price_minor: 49900, archived_at: "2026-01-01" } });
    expect(created.status).toBe(200);
    const id = created.body.id as string;
    expect((await call("PATCH", `/api/items/${id}`, { token, body: { serial_number: "ST-77", brand: "" } })).status).toBe(200);
    expect(await archive.db.select("SELECT name, serial_number, brand, purchase_price_minor, archived_at FROM item WHERE id = ?", [id])).toEqual([
      { name: "Mobil-stige", serial_number: "ST-77", brand: null, purchase_price_minor: 49900, archived_at: null },
    ]);
    expect((await call("PATCH", `/api/items/${id}`, { token, body: { name: "" } })).status).toBe(400);
    expect((await call("PATCH", "/api/items/00000000-0000-4000-8000-000000000999", { token, body: { name: "x" } })).status).toBe(404);

    // A friend outside the household borrows the item and gets a gift.
    expect((await call("POST", "/api/people", { token, body: { name: " " } })).status).toBe(400);
    const friend = (await call("POST", "/api/people", { token, body: { name: "Karl Ven", relation: "ven" } })).body as { id: string };
    expect(await archive.db.select("SELECT household FROM person WHERE id = ?", [friend.id])).toEqual([{ household: 0 }]);
    expect((await call("POST", "/api/lending", { token, body: { item_id: id, borrower_person_id: friend.id, due_date: "2026-12-01" } })).status).toBe(200);
    expect((await call("POST", "/api/lending", { token, body: { item_id: id, borrower_name: "Nabo" } })).status).toBe(400);
    const gift = await call("POST", "/api/gifts", { token, body: { person_id: friend.id, title: "Brætspil", occasion: "Fødselsdag", gift_date: "2026-11-20", amount_minor: 29900 } });
    expect(gift.status).toBe(200);
    expect((await call("PATCH", `/api/gifts/${gift.body.id}`, { token, body: { title: "Brætspillet Eksempel" } })).status).toBe(200);
    expect((await call("POST", "/api/gifts", { token, body: { person_id: friend.id, gift_date: "2026-11-20" } })).status).toBe(400);

    const people = (await call("GET", "/api/people", { token })).body as { id: string; household: number; gifts: number; lent: number }[];
    expect(people.find((p) => p.id === friend.id)).toMatchObject({ household: 0, gifts: 1, lent: 1 });
    const detail = (await call("GET", `/api/people/${friend.id}`, { token })).body;
    expect(detail.gifts.map((g: { title: string }) => g.title)).toEqual(["Brætspillet Eksempel"]);
    expect(detail.lendings.map((l: { thing: string; due: string }) => [l.thing, l.due])).toEqual([["Mobil-stige", "2026-12-01"]]);
  });

  it("the plain HTTP port only hands out the CA and a guide", async () => {
    const { port, s } = await setup();
    const get = (path: string) =>
      new Promise<{ status: number; type: string; body: Buffer }>((ok, fail) => {
        httpRequest({ host: "127.0.0.1", port: port + 1, path }, (res) => {
          const c: Buffer[] = [];
          res.on("data", (d) => c.push(d));
          res.on("end", () => ok({ status: res.statusCode ?? 0, type: String(res.headers["content-type"]), body: Buffer.concat(c) }));
        })
          .on("error", fail)
          .end();
      });
    const ca = await get("/ppm-ca.cer");
    expect(ca.type).toBe("application/x-x509-ca-cert");
    expect(new X509Certificate(ca.body).fingerprint256).toBe(s.caFingerprint);
    const guide = await get("/api/overview");
    expect(guide.body.toString()).toContain("Hent certifikatet");
    expect(guide.body.toString()).toContain("Indst. til certifikatgodkendelse");
    expect(guide.body.toString()).toContain("parr telefonen dér");
  });
});
