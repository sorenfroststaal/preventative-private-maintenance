import type { Archive } from "../archive/archive";
import type { DbAdapter } from "../db/adapter";
import type { Row } from "../domain/registry";
import type { EntityInput, EntityType } from "../domain/schemas";
import type { Env } from "../env";
import { createEntity, getEntity, ValidationError, type Ctx } from "./entities";
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
