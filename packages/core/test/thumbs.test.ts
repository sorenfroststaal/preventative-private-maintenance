import { describe, expect, it } from "vitest";
import { createEntity, documentLinkSummaries, importDocument, linkDocument, thumbnailsFor } from "../src";
import { ctxFor, newArchive, writeTempFile } from "./helpers";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("row thumbnails", () => {
  it("picks a photo first, then other images; PDFs are ignored; a policy falls back to what it covers", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const img = async (name: string, extra: string) => (await importDocument(env, archive, ctx, await writeTempFile(name, Buffer.concat([Buffer.from(PNG, "base64"), Buffer.from(extra)])), { source: "drop" })).document;
    const sofa = await createEntity(ctx, "item", { name: "Sofa" });
    const lamp = await createEntity(ctx, "item", { name: "Lampe" });
    const receipt = await img("kvittering.png", "r");
    const photo = await img("sofa.png", "p");
    const pdf = (await importDocument(env, archive, ctx, await writeTempFile("manual.pdf", "%PDF-1.4"), { source: "drop" })).document;
    await linkDocument(ctx, { document_id: String(receipt.id), target_type: "item", target_id: String(sofa.id), role: "receipt" });
    await linkDocument(ctx, { document_id: String(photo.id), target_type: "item", target_id: String(sofa.id), role: "photo" });
    await linkDocument(ctx, { document_id: String(pdf.id), target_type: "item", target_id: String(lamp.id), role: "manual" });
    const items = await thumbnailsFor(archive.db, "item");
    expect(items.get(String(sofa.id))?.id).toBe(String(photo.id));
    expect(items.has(String(lamp.id))).toBe(false);

    const pet = await createEntity(ctx, "pet", { name: "Fido" });
    const dog = await img("fido.png", "d");
    await linkDocument(ctx, { document_id: String(dog.id), target_type: "pet", target_id: String(pet.id), role: "photo" });
    const pol = await createEntity(ctx, "policy", { kind: "pet", title: "Hundeforsikring" });
    await createEntity(ctx, "policy_coverage", { policy_id: String(pol.id), target_type: "pet", target_id: String(pet.id) });
    expect((await thumbnailsFor(archive.db, "policy")).get(String(pol.id))?.id).toBe(String(dog.id));
  });

  it("link summaries name what each document is linked to; health links say only 'Helbred'", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const doc = (await importDocument(env, archive, ctx, await writeTempFile("brev.pdf", "%PDF-1.4 brev"), { source: "drop" })).document;
    const item = await createEntity(ctx, "item", { name: "Sofa" });
    const contact = await createEntity(ctx, "contact", { name: "Møbelbutikken", kind: "shop" });
    const person = await createEntity(ctx, "person", { name: "Anna" });
    const visit = await createEntity(ctx, "health_visit", { person_id: String(person.id), visit_date: "2026-11-01", kind: "gp", reason: "Hemmelig årsag" });
    await linkDocument(ctx, { document_id: String(doc.id), target_type: "item", target_id: String(item.id), role: "receipt" });
    await linkDocument(ctx, { document_id: String(doc.id), target_type: "contact", target_id: String(contact.id), role: "contract" });
    await linkDocument(ctx, { document_id: String(doc.id), target_type: "health_visit", target_id: String(visit.id), role: "letter" });
    const s = (await documentLinkSummaries(archive.db)).get(String(doc.id))!;
    expect(s.map((l) => [l.type, l.name, l.role]).sort()).toEqual([
      ["contact", "Møbelbutikken", "contract"],
      ["health_visit", "Helbred", "letter"],
      ["item", "Sofa", "receipt"],
    ]);
  });
});

