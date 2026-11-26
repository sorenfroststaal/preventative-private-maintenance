import type { Archive } from "../archive/archive";
import type { DbAdapter } from "../db/adapter";
import type { Row } from "../domain/registry";
import type { EntityInput, EntityType } from "../domain/schemas";
import type { Env } from "../env";
import { createEntity, getEntity, updateEntity, ValidationError, type Ctx } from "./entities";
import { parseEml } from "./eml";

const MAX_TEXT_CHARS = 200_000;

/** Step 3 of spec 05: text layer of PDFs, subject/sender/date/plain text of .eml. */
export async function extractText(
  env: Env,
  path: string,
  ext: string,
): Promise<{ text: string | null; title: string | null; date: string | null }> {
  try {
    if (ext === "pdf" && env.pdfText) {
      const text = (await env.pdfText(await env.fs.readFile(path))).replace(/\s+/g, " ").trim();
      return { text: text ? text.slice(0, MAX_TEXT_CHARS) : null, title: null, date: null };
    }
    if (ext === "eml") {
      const m = parseEml(await env.fs.readFile(path));
      const text = [m.from && `Fra: ${m.from}`, m.subject && `Emne: ${m.subject}`, m.text].filter(Boolean).join("\n");
      return { text: text.slice(0, MAX_TEXT_CHARS) || null, title: m.subject, date: m.date };
    }
  } catch {
    // Damaged files are still imported; they just have no text.
  }
  return { text: null, title: null, date: null };
}

export const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;

/** Supported file types (spec 05). */
export const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  eml: "message/rfc822",
  msg: "application/vnd.ms-outlook",
};

export const BANK_MIME_BY_EXT: Record<string, string> = { csv: "text/csv", txt: "text/plain" };

export function extOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i > 0 ? filename.slice(i + 1).toLowerCase() : "";
}

export function isSupported(filename: string): boolean {
  return extOf(filename) in MIME_BY_EXT;
}

/** Archive-relative storage path: bilag/<sha[0:2]>/<sha256>.<ext> */
export function documentRelPath(sha256: string, ext: string): string {
  return `bilag/${sha256.slice(0, 2)}/${sha256}.${ext}`;
}

export interface ImportResult {
  document: Row;
  duplicate: boolean;
}

export class ImportError extends Error {
  constructor(
    message: string,
    readonly code: "unsupported" | "too_large" | "missing",
  ) {
    super(message);
    this.name = "ImportError";
  }
}

/**
 * Imports a file into the archive (spec 05 steps 1-2, 4): hash, reuse an existing
 * document with the same content, otherwise copy to bilag/ and insert the row.
 * Text extraction (step 3) is added in phase 2.
 */
export async function importDocument(
  env: Env,
  archive: Archive,
  ctx: Ctx,
  srcPath: string,
  opts: { source: "drop" | "inbox" | "ai" | "bank_import"; filename?: string; title?: string | null; docDate?: string | null },
): Promise<ImportResult> {
  const filename = opts.filename ?? env.fs.basename(srcPath);
  const ext = extOf(filename);
  // Bank exports are stored as raw files next to their import batch (spec 05).
  const mime = MIME_BY_EXT[ext] ?? (opts.source === "bank_import" ? BANK_MIME_BY_EXT[ext] : undefined);
  if (!mime) throw new ImportError(`Filtypen .${ext || "?"} understøttes ikke.`, "unsupported");
  const st = await env.fs.stat(srcPath);
  if (!st || st.isDir) throw new ImportError("Filen findes ikke.", "missing");
  if (st.size > MAX_DOCUMENT_BYTES) throw new ImportError("Filen er større end 100 MB.", "too_large");

  const sha256 = await env.fs.sha256File(srcPath);
  const existing = await findBySha(ctx.db, sha256);
  if (existing) return { document: existing, duplicate: true };

  const rel = documentRelPath(sha256, ext);
  const dest = archive.path(rel);
  if (!(await env.fs.exists(dest))) {
    await env.fs.mkdirp(env.fs.dirname(dest));
    // Copy to a temp name first so a crash never leaves a partial file under the final name.
    const tmp = `${dest}.part`;
    await env.fs.copyFile(srcPath, tmp);
    const copiedHash = await env.fs.sha256File(tmp);
    if (copiedHash !== sha256) {
      await env.fs.remove(tmp);
      throw new Error("Filen ændrede sig under import. Prøv igen.");
    }
    await env.fs.rename(tmp, dest);
  }
  const extracted = await extractText(env, dest, ext);
  const document = await createEntity(ctx, "document", {
    sha256,
    filename,
    ext,
    mime,
    size_bytes: st.size,
    title: opts.title ?? extracted.title ?? stripExt(filename),
    doc_date: opts.docDate ?? extracted.date ?? null,
    source: opts.source,
    extracted_text: extracted.text,
    created_by: ctx.userId,
  });
  return { document, duplicate: false };
}

const stripExt = (f: string) => (f.lastIndexOf(".") > 0 ? f.slice(0, f.lastIndexOf(".")) : f);

export async function findBySha(db: DbAdapter, sha256: string): Promise<Row | null> {
  const r = await db.select<Row>("SELECT * FROM document WHERE sha256 = ?", [sha256]);
  return r[0] ?? null;
}

type LinkInput = EntityInput<"document_link">;

/** Links a document to any entity after checking that the target exists. Idempotent. */
export async function linkDocument(ctx: Ctx, input: LinkInput): Promise<void> {
  const target = await getEntity(ctx.db, input.target_type as EntityType, input.target_id);
  if (!target) {
    throw new ValidationError([{ path: "target_id", message: "Posten findes ikke" }], "document_link");
  }
  const exists = await ctx.db.select(
    "SELECT 1 FROM document_link WHERE document_id = ? AND target_type = ? AND target_id = ? AND role = ?",
    [input.document_id, input.target_type, input.target_id, input.role],
  );
  if (exists.length) return;
  await createEntity(ctx, "document_link", input);
}

/**
 * A recipe photo is referenced by recipe.photo_document_id, because document_link cannot
 * point at recipes (schema CHECK). It counts as a link so it never sits in the import queue.
 */
const LINK_COUNT = `((SELECT count(*) FROM document_link l WHERE l.document_id = d.id)
  + (SELECT count(*) FROM recipe r WHERE r.photo_document_id = d.id))`;

export async function listDocuments(db: DbAdapter, opts: { unlinkedOnly?: boolean } = {}): Promise<Row[]> {
  const where = opts.unlinkedOnly ? `WHERE ${LINK_COUNT} = 0` : "";
  return db.select<Row>(`SELECT d.*, ${LINK_COUNT} AS link_count FROM document d ${where} ORDER BY d.created_at DESC`);
}

export async function documentsFor(db: DbAdapter, targetType: string, targetId: string): Promise<Row[]> {
  return db.select<Row>(
    `SELECT d.*, l.role FROM document_link l JOIN document d ON d.id = l.document_id
      WHERE l.target_type = ? AND l.target_id = ? ORDER BY d.created_at`,
    [targetType, targetId],
  );
}

/** Image types that get OCR (phase 4.3). HEIC cannot be decoded by Tesseract and is left out. */
export const OCR_EXTS = ["jpg", "jpeg", "png"];

/** Number of images still waiting for OCR (`extracted_text IS NULL`). */
export async function pendingOcrCount(db: DbAdapter): Promise<number> {
  const r = await db.select<{ n: number }>(`SELECT count(*) AS n FROM document WHERE extracted_text IS NULL AND ext IN (${OCR_EXTS.map(() => "?").join(",")})`, OCR_EXTS);
  return r[0]?.n ?? 0;
}

/**
 * Background OCR (phase 4.3): images without text get text from `env.ocr`, saved in
 * `extracted_text` and the search index. An image where OCR finds nothing, or fails, gets an empty
 * text so it is not tried again. Runs after import and never blocks it. Returns the number processed.
 */
export async function ocrPendingDocuments(env: Env, archive: Archive, ctx: Ctx, opts: { limit?: number } = {}): Promise<number> {
  if (!env.ocr || archive.readOnly) return 0;
  const docs = await ctx.db.select<{ id: string; sha256: string; ext: string; mime: string }>(
    `SELECT id, sha256, ext, mime FROM document WHERE extracted_text IS NULL AND ext IN (${OCR_EXTS.map(() => "?").join(",")}) ORDER BY created_at LIMIT ?`,
    [...OCR_EXTS, opts.limit ?? 5],
  );
  for (const d of docs) {
    let text = "";
    try {
      const bytes = await env.fs.readFile(archive.path(documentRelPath(d.sha256, d.ext)));
      text = (await env.ocr(bytes, d.mime)).replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim().slice(0, MAX_TEXT_CHARS);
    } catch {
      text = "";
    }
    await updateEntity(ctx, "document", d.id, { extracted_text: text });
  }
  return docs.length;
}

export interface ThumbDoc {
  id: string;
  sha256: string;
  ext: string;
  mime: string;
}

const THUMB_EXTS = ["jpg", "jpeg", "png"];

/**
 * The image shown on a record's row: the first photo (role 'photo', then any other role) linked to it.
 * A policy without its own image shows the photo of something it covers.
 */
export async function thumbnailsFor(db: DbAdapter, targetType: string): Promise<Map<string, ThumbDoc>> {
  const marks = THUMB_EXTS.map(() => "?").join(",");
  const rows = await db.select<ThumbDoc & { target_id: string }>(
    `SELECT l.target_id, d.id, d.sha256, d.ext, d.mime FROM document_link l JOIN document d ON d.id = l.document_id
      WHERE l.target_type = ? AND d.ext IN (${marks})
      ORDER BY l.target_id, CASE l.role WHEN 'photo' THEN 0 WHEN 'photo_after' THEN 1 ELSE 2 END, d.created_at`,
    [targetType, ...THUMB_EXTS],
  );
  const out = new Map<string, ThumbDoc>();
  for (const r of rows) if (!out.has(r.target_id)) out.set(r.target_id, { id: r.id, sha256: r.sha256, ext: r.ext, mime: r.mime });
  if (targetType === "policy") {
    const covered = await db.select<ThumbDoc & { policy_id: string }>(
      `SELECT c.policy_id, d.id, d.sha256, d.ext, d.mime FROM policy_coverage c
         JOIN document_link l ON l.target_type = c.target_type AND l.target_id = c.target_id
         JOIN document d ON d.id = l.document_id
        WHERE d.ext IN (${marks}) ORDER BY c.policy_id, CASE l.role WHEN 'photo' THEN 0 ELSE 1 END, d.created_at`,
      THUMB_EXTS,
    );
    for (const r of covered) if (!out.has(r.policy_id)) out.set(r.policy_id, { id: r.id, sha256: r.sha256, ext: r.ext, mime: r.mime });
  }
  return out;
}

export interface LinkSummary {
  type: string;
  id: string;
  /** Display name of the record; health records only say "Helbred" (no details in lists). */
  name: string;
  role: string;
}

const LINK_NAME_SQL = `SELECT l.document_id, l.target_type AS type, l.target_id AS id, l.role,
  COALESCE(pr.name, lo.name, it.name, ip.name, bp.name, ve.name, pe.name, wo.title, cl.description, po.title,
           ps.name, co.name, ac.name, ln.name, re.name, bt.text, tk.title) AS name
  FROM document_link l
  LEFT JOIN property pr ON l.target_type = 'property' AND pr.id = l.target_id
  LEFT JOIN location lo ON l.target_type = 'location' AND lo.id = l.target_id
  LEFT JOIN item it ON l.target_type = 'item' AND it.id = l.target_id
  LEFT JOIN item_part ip ON l.target_type = 'item_part' AND ip.id = l.target_id
  LEFT JOIN building_part bp ON l.target_type = 'building_part' AND bp.id = l.target_id
  LEFT JOIN vehicle ve ON l.target_type = 'vehicle' AND ve.id = l.target_id
  LEFT JOIN pet pe ON l.target_type = 'pet' AND pe.id = l.target_id
  LEFT JOIN work_order wo ON l.target_type = 'work_order' AND wo.id = l.target_id
  LEFT JOIN claim cl ON l.target_type = 'claim' AND cl.id = l.target_id
  LEFT JOIN policy po ON l.target_type = 'policy' AND po.id = l.target_id
  LEFT JOIN person ps ON l.target_type = 'person' AND ps.id = l.target_id
  LEFT JOIN contact co ON l.target_type = 'contact' AND co.id = l.target_id
  LEFT JOIN account ac ON l.target_type = 'account' AND ac.id = l.target_id
  LEFT JOIN loan ln ON l.target_type = 'loan' AND ln.id = l.target_id
  LEFT JOIN recurring_expense re ON l.target_type = 'recurring_expense' AND re.id = l.target_id
  LEFT JOIN bank_transaction bt ON l.target_type = 'bank_transaction' AND bt.id = l.target_id
  LEFT JOIN task_occurrence tko ON l.target_type = 'task_occurrence' AND tko.id = l.target_id
  LEFT JOIN task tk ON tk.id = tko.task_id`;

/** What every document is linked to, by document id (for the Koblinger column). Recipe photos count too. */
export async function documentLinkSummaries(db: DbAdapter): Promise<Map<string, LinkSummary[]>> {
  const rows = await db.select<LinkSummary & { document_id: string }>(LINK_NAME_SQL);
  const recipes = await db.select<{ document_id: string; id: string; name: string }>(
    "SELECT photo_document_id AS document_id, id, name FROM recipe WHERE photo_document_id IS NOT NULL",
  );
  const out = new Map<string, LinkSummary[]>();
  const add = (docId: string, s: LinkSummary) => out.set(docId, [...(out.get(docId) ?? []), s]);
  for (const r of rows) {
    const health = r.type.startsWith("health_");
    add(r.document_id, { type: r.type, id: r.id, role: r.role, name: health ? "Helbred" : (r.name ?? "(slettet)") });
  }
  for (const r of recipes) add(r.document_id, { type: "recipe", id: r.id, role: "photo", name: r.name });
  return out;
}
