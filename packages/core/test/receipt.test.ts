import { describe, expect, it } from "vitest";
import { applyReceiptSuggestion, createEntity, dismissReceiptSuggestion, itemReceiptStatus, importDocument, linkDocument, parseReceipt, receiptSuggestionForItem, updateEntity } from "../src";
import { ctxFor, newArchive, writeTempFile } from "./helpers";

// Synthetic receipt texts (phase 4.4): Danish amounts, "I alt"/"Total", VAT and date formats.
const RECEIPTS: [string, string, { total_minor: number | null; date: string | null; vendor: string | null }][] = [
  [
    "electronics, I alt DKK, VAT line, DD.MM.YYYY",
    "ELEKTROLAGERET\nEksempelvej 12, 8000 Aarhus C\nDato: 14.03.2026\nOpvaskemaskine 4.999,00\nLevering 299,00\nI alt DKK 5.298,00\nHeraf moms 1.059,60\nTak for handlen",
    { total_minor: 529800, date: "2026-03-14", vendor: "ELEKTROLAGERET" },
  ],
  [
    "supermarket, TOTAL, change and card lines, DD-MM-YY",
    "Kvittering\nSuperBrugsen Eksempelby\nCVR 12345678\n02-11-26 17:41\nMælk 12,95\nRugbrød 24,00\nSUBTOTAL 36,95\nTOTAL 36,95\nDankort 36,95\nByttepenge 0,00\nMoms udgør 7,39",
    { total_minor: 3695, date: "2026-11-02", vendor: "SuperBrugsen Eksempelby" },
  ],
  [
    "builders' merchant, 'At betale' wins over 'I alt', amount on the next line, ISO date",
    "Byggemarked Nord A/S\n2026-05-09\nSkruer 89,95\nMaling 10 l 1.249,00\nI alt 1.338,95\nRabat -100,00\nAt betale\n1.238,95\nheraf moms 247,79",
    { total_minor: 123895, date: "2026-05-09", vendor: "Byggemarked Nord A/S" },
  ],
  [
    "web shop invoice, 'Total' with kr. and space thousands, textual month",
    "FAKTURA\nNetbutikken ApS\nFakturadato: 3. februar 2026\nRobotstøvsuger 2 499,00 kr.\nFragt 49,00 kr.\nTotal inkl. moms 2 548,00 kr.\nMoms 509,60 kr.",
    { total_minor: 254800, date: "2026-02-03", vendor: "Netbutikken ApS" },
  ],
  [
    "kiosk with ',-' amounts and DD/MM/YYYY",
    "Kiosken på Hjørnet\n24/12/2025\nAvis 35,-\nKaffe 25,-\nSum 60,-",
    { total_minor: 6000, date: "2025-12-24", vendor: "Kiosken på Hjørnet" },
  ],
  [
    "OCR noise: no total keyword, invalid date, no vendor line",
    "12345 678\n31.02.2026\n99,95\n--- ---",
    { total_minor: null, date: null, vendor: null },
  ],
  [
    "excl. VAT and subtotal ignored, last total wins on the same rank",
    "Cykelværkstedet\n10.06.2026\nService 450,00\nTotal ekskl. moms 360,00\nSubtotal 450,00\nTotal 450,00",
    { total_minor: 45000, date: "2026-06-10", vendor: "Cykelværkstedet" },
  ],
];

describe("phase 4.4 – suggestions from receipts", () => {
  it.each(RECEIPTS)("%s", (_name, text, expected) => {
    expect(parseReceipt(text)).toEqual(expected);
  });

  it("one-line PDF text layers (whitespace collapsed) give the same suggestions", () => {
    const flat = (t: string) => t.replace(/\s+/g, " ").trim();
    expect(parseReceipt(flat(RECEIPTS[0]![1]))).toEqual(RECEIPTS[0]![2]);
    expect(parseReceipt(flat(RECEIPTS[3]![1]))).toEqual(RECEIPTS[3]![2]);
    expect(parseReceipt(flat(RECEIPTS[4]![1]))).toEqual(RECEIPTS[4]![2]);
    expect(parseReceipt(flat(RECEIPTS[1]![1]))).toEqual(RECEIPTS[1]![2]);
  });

  it("suggests price, date and vendor for an item from a linked receipt; fills them when confirmed", async () => {
    const { env: base, archive } = await newArchive();
    const env = { ...base, pdfText: async () => RECEIPTS[0]![1] };
    const ctx = ctxFor(env, archive);
    const item = await createEntity(ctx, "item", { name: "Opvaskemaskine", vendor_name: "Gammel butik" });
    const pdf = await writeTempFile("kvittering.pdf", "%PDF-1.4 synthetic");
    const { document } = await importDocument(env, archive, ctx, pdf, { source: "drop" });
    await linkDocument(ctx, { document_id: String(document.id), target_type: "item", target_id: String(item.id), role: "receipt" });
    const s = (await receiptSuggestionForItem(archive.db, String(item.id), String(document.id)))!;
    expect(s.fields).toEqual([
      { key: "purchase_price_minor", suggested: 529800, current: null },
      { key: "purchase_date", suggested: "2026-03-14", current: null },
      { key: "vendor_name", suggested: "ELEKTROLAGERET", current: "Gammel butik" },
    ]);
    await applyReceiptSuggestion(ctx, String(item.id), { purchase_price_minor: 529800, purchase_date: "2026-03-14" });
    expect((await archive.db.select("SELECT purchase_price_minor, purchase_date, vendor_name FROM item WHERE id = ?", [String(item.id)]))[0]).toEqual({
      purchase_price_minor: 529800,
      purchase_date: "2026-03-14",
      vendor_name: "Gammel butik",
    });
    // Price and date are filled; the vendor differs but is not empty → no banner.
    expect((await itemReceiptStatus(archive.db, String(item.id))).suggestion).toBeNull();
    // No text (e.g. an image still waiting for OCR) → no suggestion.
    await updateEntity(ctx, "document", String(document.id), { extracted_text: null });
    expect(await receiptSuggestionForItem(archive.db, String(item.id), String(document.id))).toBeNull();
    expect(await itemReceiptStatus(archive.db, String(item.id))).toEqual({ suggestion: null, waiting_for_ocr: true });
  });

  it("the item banner shows a suggestion for empty fields until it is used or dismissed", async () => {
    const { env: base, archive } = await newArchive();
    const env = { ...base, pdfText: async () => RECEIPTS[1]![1] };
    const ctx = ctxFor(env, archive);
    const item = await createEntity(ctx, "item", { name: "Indkøb" });
    const pdf = await writeTempFile("bon.pdf", "%PDF-1.4 bon");
    const { document } = await importDocument(env, archive, ctx, pdf, { source: "drop" });
    await linkDocument(ctx, { document_id: String(document.id), target_type: "item", target_id: String(item.id), role: "invoice" });
    const st = await itemReceiptStatus(archive.db, String(item.id));
    expect(st.suggestion?.fields.map((f) => f.key)).toEqual(["purchase_price_minor", "purchase_date", "vendor_name"]);
    await dismissReceiptSuggestion(ctx, String(item.id), String(document.id));
    expect((await itemReceiptStatus(archive.db, String(item.id))).suggestion).toBeNull();
  });
});
