import { describe, expect, it } from "vitest";
import {
  archiveEntity,
  completeOccurrence,
  createEntity,
  createTask,
  createUser,
  deleteLink,
  getOpenOccurrence,
  getSetting,
  importDocument,
  linkDocument,
  listUsers,
  login,
  restoreEntity,
  search,
  updateEntity,
  ValidationError,
} from "../src";
import { ctxFor, newArchive, writeTempFile } from "./helpers";

const auditFor = (db: import("../src").DbAdapter, type: string, id: string) =>
  db.select<{ action: string; via: string; user_id: string | null; diff_json: string }>(
    "SELECT action, via, user_id, diff_json FROM audit_log WHERE entity_type = ? AND entity_id = ? ORDER BY rowid",
    [type, id],
  );

describe("phase 1.8 – every write audits and updates the search index", () => {
  it("create, update, archive and restore", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive, null);
    const item = await createEntity(ctx, "item", { name: "Opvaskemaskine", brand: "Eksempel", model: "X100" });
    const id = String(item.id);
    expect(item.currency).toBe("DKK");
    expect(item.created_at).toBe(item.updated_at);

    expect((await search(archive.db, "opvask")).map((h) => h.id)).toEqual([id]);
    expect((await search(archive.db, "X100")).map((h) => h.id)).toEqual([id]);

    await updateEntity(ctx, "item", id, { model: "Z200", notes: "Støjer" });
    expect(await search(archive.db, "X100")).toEqual([]);
    expect((await search(archive.db, "støjer")).map((h) => h.id)).toEqual([id]);

    await archiveEntity(ctx, "item", id);
    expect(await search(archive.db, "opvask")).toEqual([]);
    await restoreEntity(ctx, "item", id);
    expect(await search(archive.db, "opvask")).toHaveLength(1);

    const audit = await auditFor(archive.db, "item", id);
    expect(audit.map((a) => a.action)).toEqual(["create", "update", "archive", "restore"]);
    expect(JSON.parse(audit[1]!.diff_json)).toEqual({ model: ["X100", "Z200"], notes: [null, "Støjer"] });
    expect(audit.every((a) => a.via === "ui")).toBe(true);
  });

  it("an update without changes writes no audit row", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const p = await createEntity(ctx, "property", { name: "Huset", kind: "house" });
    await updateEntity(ctx, "property", String(p.id), { name: "Huset" });
    expect(await auditFor(archive.db, "property", String(p.id))).toHaveLength(1);
  });

  it("rejects invalid input with Danish messages and writes nothing", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const err = await createEntity(ctx, "item", { name: "", purchase_date: "2026-02-30" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).issues.map((i) => i.path)).toEqual(["name", "purchase_date"]);
    expect(await archive.db.select("SELECT * FROM item")).toHaveLength(0);
    // Unknown fields are refused too.
    await expect(createEntity(ctx, "item", { name: "x", bogus: 1 } as never)).rejects.toBeInstanceOf(ValidationError);
  });

  it("rolls back the whole write when something fails inside the transaction", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    // Foreign key violation: location for non-existent property.
    await expect(
      createEntity(ctx, "location", { property_id: "00000000-0000-4000-8000-000000000099", name: "Køkken" }),
    ).rejects.toThrow();
    expect(await archive.db.select("SELECT * FROM audit_log WHERE entity_type = 'location'")).toHaveLength(0);
  });

  it("search can be filtered by module", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    await createEntity(ctx, "item", { name: "Varmepumpe filter" });
    await createEntity(ctx, "vehicle", { name: "Familiebil", notes: "filter skiftet" });
    expect(await search(archive.db, "filter")).toHaveLength(2);
    expect((await search(archive.db, "filter", { modules: ["vehicle"] })).map((h) => h.type)).toEqual(["vehicle"]);
    expect(await search(archive.db, "filter", { modules: [] })).toEqual([]);
    expect(await search(archive.db, '"; DROP TABLE item; --')).toEqual([]);
  });

  it("link rows can be deleted and the deletion is audited", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const pol = await createEntity(ctx, "policy", { kind: "home_contents", title: "Indbo" });
    const it1 = await createEntity(ctx, "item", { name: "TV" });
    const key = { policy_id: String(pol.id), target_type: "item", target_id: String(it1.id) };
    await createEntity(ctx, "policy_coverage", key as never);
    expect(await deleteLink(ctx, "policy_coverage", key)).toBe(true);
    const a = await auditFor(archive.db, "policy_coverage", `${pol.id}:item:${it1.id}`);
    expect(a.map((x) => x.action)).toEqual(["create", "delete"]);
  });

  it("new archives get default settings and categories (system writes are audited)", async () => {
    const { archive } = await newArchive();
    expect(await getSetting(archive.db, "ai.modules")).toMatchObject({ health: false, home: true });
    expect(await archive.db.select("SELECT * FROM category")).toHaveLength(13);
    const audit = await archive.db.select<{ via: string }>("SELECT via FROM audit_log WHERE entity_type = 'category'");
    expect(audit).toHaveLength(13);
    expect(audit.every((a) => a.via === "system")).toBe(true);
  });
});

describe("phase 1.5 – users and persons", () => {
  it("creates a user with a person, optional PIN and login", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const { user, person } = await createUser(ctx, { name: "Anna", pin: "1234", isAdmin: true });
    await createUser(ctx, { name: "Bo" });
    expect(person?.app_user_id).toBe(user.id);
    const users = await listUsers(archive.db);
    expect(users).toEqual([
      { id: user.id, name: "Anna", is_admin: 1, has_pin: true },
      expect.objectContaining({ name: "Bo", has_pin: false }),
    ]);
    expect(JSON.stringify(users)).not.toContain("pbkdf2");
    expect(await login(archive.db, String(user.id), "1234")).toBe(true);
    expect(await login(archive.db, String(user.id), "9999")).toBe(false);
    expect(await login(archive.db, String(user.id), null)).toBe(false);
    expect(await login(archive.db, users[1]!.id, null)).toBe(true);
  });

  it("rejects bad PINs and duplicate user names", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    await expect(createUser(ctx, { name: "A", pin: "12" })).rejects.toBeInstanceOf(ValidationError);
    await createUser(ctx, { name: "A" });
    await expect(createUser(ctx, { name: "A" })).rejects.toThrow();
    expect(await archive.db.select("SELECT * FROM person")).toHaveLength(1);
  });
});

describe("phase 1.6 – document import", () => {
  it("stores the file by its hash and recognises duplicates", async () => {
    const { env, archive, root } = await newArchive();
    const ctx = ctxFor(env, archive);
    const src = await writeTempFile("Kvittering Opvasker.pdf", "%PDF-1.4 syntetisk kvittering");
    const first = await importDocument(env, archive, ctx, src, { source: "drop" });
    expect(first.duplicate).toBe(false);
    const sha = String(first.document.sha256);
    expect(sha).toMatch(/^[0-9a-f]{64}$/);
    expect(first.document).toMatchObject({ filename: "Kvittering Opvasker.pdf", ext: "pdf", mime: "application/pdf", title: "Kvittering Opvasker" });
    const stored = `${root}/bilag/${sha.slice(0, 2)}/${sha}.pdf`;
    expect(await env.fs.sha256File(stored)).toBe(sha);

    const copy = await writeTempFile("andet-navn.pdf", "%PDF-1.4 syntetisk kvittering");
    const second = await importDocument(env, archive, ctx, copy, { source: "inbox" });
    expect(second.duplicate).toBe(true);
    expect(second.document.id).toBe(first.document.id);
    expect(await archive.db.select("SELECT * FROM document")).toHaveLength(1);
    expect(await search(archive.db, "kvittering")).toHaveLength(1);
  });

  it("refuses unsupported file types", async () => {
    const { env, archive } = await newArchive();
    const src = await writeTempFile("virus.exe", "MZ");
    await expect(importDocument(env, archive, ctxFor(env, archive), src, { source: "drop" })).rejects.toMatchObject({ code: "unsupported" });
  });

  it("links a document to an existing entity only", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const src = await writeTempFile("foto.jpg", new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]));
    const { document } = await importDocument(env, archive, ctx, src, { source: "drop" });
    const item = await createEntity(ctx, "item", { name: "Cykel" });
    const link = { document_id: String(document.id), target_type: "item" as const, target_id: String(item.id), role: "photo" as const };
    await linkDocument(ctx, link);
    await linkDocument(ctx, link); // idempotent
    expect(await archive.db.select("SELECT * FROM document_link")).toHaveLength(1);
    await expect(
      linkDocument(ctx, { ...link, target_id: "00000000-0000-4000-8000-000000000042" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("phase 1.7 – tasks with occurrences", () => {
  it("completing creates the next occurrence; only one open occurrence exists", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const { user } = await createUser(ctx, { name: "Anna" });
    const uctx = ctxFor(env, archive, String(user.id));
    const { task, occurrence } = await createTask(uctx, {
      title: "Rens tagrender",
      module: "maintenance",
      recurrence: { kind: "fixed", unit: "year", every: 1, month: 10, day: 1 },
      firstDueDate: "2026-10-01",
    });
    const { completed, next } = await completeOccurrence(uctx, String(occurrence.id), { completedDate: "2026-11-20" });
    expect(completed).toMatchObject({ status: "done", completed_by: user.id, completed_date: "2026-11-20" });
    expect(next?.due_date).toBe("2027-10-01");
    expect((await getOpenOccurrence(archive.db, String(task.id)))?.id).toBe(next?.id);
    await expect(completeOccurrence(uctx, String(occurrence.id), { completedDate: "2026-11-21" })).rejects.toBeInstanceOf(ValidationError);
    // The database itself refuses a second open occurrence.
    await expect(createEntity(uctx, "task_occurrence", { task_id: String(task.id), status: "open" })).rejects.toThrow();
  });

  it("interval task without date has a missing due date; one-off task gets no successor", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const a = await createTask(ctx, { title: "Service varmepumpe", module: "maintenance", recurrence: { kind: "interval", unit: "year", every: 1 } });
    expect(a.occurrence.due_date).toBeNull();
    const next = await completeOccurrence(ctx, String(a.occurrence.id), { completedDate: "2026-11-24" });
    expect(next.next?.due_date).toBe("2027-11-24");

    const b = await createTask(ctx, { title: "Skift dørhåndtag", module: "custom", firstDueDate: "2026-12-01" });
    const r = await completeOccurrence(ctx, String(b.occurrence.id), { completedDate: "2026-12-02" });
    expect(r.next).toBeNull();
  });

  it("rejects invalid recurrence without writing", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    await expect(
      createTask(ctx, { title: "x", module: "custom", recurrence: { kind: "fixed", unit: "year", every: 1 } as never }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await archive.db.select("SELECT * FROM task")).toHaveLength(0);
  });
});
