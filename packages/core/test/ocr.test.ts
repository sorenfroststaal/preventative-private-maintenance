import { afterAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createWorker, OEM, type Worker } from "tesseract.js";
import { importDocument, ocrPendingDocuments, parseReceipt, pendingOcrCount, search } from "../src";
import { ctxFor, newArchive } from "./helpers";

const require = createRequire(import.meta.url);
const langPath = join(dirname(require.resolve("@tesseract.js-data/dan/package.json")), "4.0.0_best_int");
const receipt = join(__dirname, "../../../fixtures/ocr/kvittering-syntetisk.png");

let worker: Worker | null = null;
/** Node OCR with the same Danish data the app bundles; no network (local langPath, no cache). */
async function nodeOcr(bytes: Uint8Array): Promise<string> {
  worker ??= await createWorker("dan", OEM.LSTM_ONLY, { langPath, cacheMethod: "none", gzip: true });
  return (await worker.recognize(Buffer.from(bytes))).data.text;
}
afterAll(async () => {
  await worker?.terminate();
});

describe("phase 4.3 – local OCR", () => {
  it("an imported image gets text in the background, which is searchable; import does not wait for OCR", async () => {
    const { env: base, archive } = await newArchive();
    const env = { ...base, ocr: nodeOcr };
    const ctx = ctxFor(env, archive);
    const r = await importDocument(env, archive, ctx, receipt, { source: "drop" });
    expect(r.document.extracted_text).toBeNull();
    expect(await pendingOcrCount(archive.db)).toBe(1);
    expect(await ocrPendingDocuments(env, archive, ctx)).toBe(1);
    const [doc] = await archive.db.select<{ extracted_text: string }>("SELECT extracted_text FROM document");
    expect(doc!.extracted_text).toMatch(/ELEKTROLAGERET/i);
    expect(doc!.extracted_text).toMatch(/5\.298,00/);
    expect(doc!.extracted_text).toMatch(/14\.03\.2026/);
    expect(await pendingOcrCount(archive.db)).toBe(0);
    // Phase 4.4 on real OCR output: the receipt parser finds total, date and vendor.
    expect(parseReceipt(doc!.extracted_text)).toEqual({ total_minor: 529800, date: "2026-03-14", vendor: "ELEKTROLAGERET" });
    expect((await search(archive.db, "elektrolageret")).map((h) => h.type)).toContain("document");
    expect(await ocrPendingDocuments(env, archive, ctx)).toBe(0);
  }, 60_000);

  it("without OCR nothing happens; a failing OCR leaves an empty text so it is not retried", async () => {
    const { env: base, archive } = await newArchive();
    const ctx = ctxFor(base, archive);
    await importDocument(base, archive, ctx, receipt, { source: "drop" });
    expect(await ocrPendingDocuments(base, archive, ctx)).toBe(0);
    const failing = { ...base, ocr: async () => Promise.reject(new Error("boom")) };
    expect(await ocrPendingDocuments(failing, archive, ctx)).toBe(1);
    expect(await archive.db.select("SELECT extracted_text FROM document")).toEqual([{ extracted_text: "" }]);
    expect(await pendingOcrCount(archive.db)).toBe(0);
  });
});
