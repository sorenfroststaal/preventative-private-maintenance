/**
 * Mobile web app server (iPhone, local network only). HTTPS with a certificate from the computer's own
 * CA; a small HTTP port only serves the CA and a guide. Every API call needs a device token from pairing.
 * All reads and writes go through core, like the desktop app; nothing is sent to the internet.
 */
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { existsSync, promises as fsp, readFileSync, statSync } from "node:fs";
import { networkInterfaces, hostname as osHostname, tmpdir } from "node:os";
import { extname, join, normalize, resolve, sep } from "node:path";
import {
  activeLendingForItem,
  addDays,
  completeOccurrence,
  createEntity,
  createGift,
  createOutsidePerson,
  getEntity,
  giftSummary,
  lendItem,
  listEntities,
  listGifts,
  listPersons,
  locationOptions,
  textListValues,
  updateEntity,
  dashboard,
  documentRelPath,
  documentsFor,
  entriesBetween,
  formatShoppingItem,
  groupBySection,
  importDocument,
  isLanAddress,
  linkDocument,
  listForWeek,
  listLendings,
  makeCtx,
  PairingError,
  redeemPairingCode,
  returnLending,
  search,
  setItemChecked,
  shoppingItems,
  thumbnailsFor,
  timelineEvents,
  TIMELINE_KINDS,
  ValidationError,
  verifyDeviceToken,
  weekStart,
  type Archive,
  type Env,
  type MobileDevice,
  type TimelineKind,
} from "@ppm/core";
import { ensureTls } from "./tls";

export interface MobileServerOptions {
  env: Env;
  archive: Archive;
  /** Directory with the built mobile web app (index.html …). */
  staticDir: string;
  /** Where the CA and server certificate are kept (outside the archive). */
  tlsDir: string;
  port: number;
  /** For tests: bind to this host instead of all interfaces. */
  host?: string;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};
const MAX_UPLOAD = 25 * 1024 * 1024;

/** Item columns the phone may set. Everything else (archiving, links) stays on the computer. */
const ITEM_FIELDS = ["name", "category", "location_id", "brand", "model", "serial_number", "purchase_date", "purchase_price_minor", "vendor_name", "warranty_until", "complaint_until", "notes"] as const;
const GIFT_FIELDS = ["direction", "person_id", "title", "occasion", "gift_date", "amount_minor", "notes"] as const;
const pick = (b: Record<string, unknown>, keys: readonly string[]) => Object.fromEntries(keys.filter((k) => k in b).map((k) => [k, b[k] === "" ? null : b[k]]));

/** Private IPv4 addresses of this computer (what the phone connects to). */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const i of list ?? []) if (i.family === "IPv4" && !i.internal && isLanAddress(i.address)) out.push(i.address);
  }
  return [...new Set(out)];
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const data = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": typeof body === "string" ? "text/html; charset=utf-8" : Buffer.isBuffer(body) ? "application/octet-stream" : "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...headers,
  });
  res.end(data);
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new HttpError(413, "Filen er for stor (højst 25 MB).");
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}
const json = async <T>(req: IncomingMessage): Promise<T> => {
  try {
    return JSON.parse((await readBody(req, 64 * 1024)).toString("utf8") || "{}") as T;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, "Ugyldig forespørgsel.");
  }
};

/** Kinds shown on the phone: health is left out (private data stays on the computer). */
const MOBILE_KINDS = TIMELINE_KINDS.map((k) => k.id).filter((k) => k !== "health") as TimelineKind[];

export async function startMobileServer(o: MobileServerOptions) {
  const { env, archive } = o;
  const addresses = o.host ? [o.host] : lanAddresses();
  const host = osHostname();
  const tls = ensureTls(o.tlsDir, addresses.length ? addresses : ["127.0.0.1"], host);
  const staticRoot = resolve(o.staticDir);
  const today = () => env.clock.today();
  const ctxFor = (d: MobileDevice | null) => makeCtx(env, archive.db, d?.userId ?? null, "ui");

  async function device(req: IncomingMessage): Promise<MobileDevice> {
    const auth = req.headers.authorization ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const d = await verifyDeviceToken(ctxFor(null), token);
    if (!d) throw new HttpError(401, "Telefonen er ikke parret. Lav en parringskode i PPM på computeren.");
    return d;
  }

  /** A document may be shown on the phone unless it is linked to health records. */
  async function assertViewable(docId: string) {
    const rows = await archive.db.select<{ t: string }>("SELECT target_type AS t FROM document_link WHERE document_id = ?", [docId]);
    if (rows.some((r) => r.t.startsWith("health_"))) throw new HttpError(403, "Dokumentet hører til helbredsdata og vises kun på computeren.");
  }

  async function api(req: IncomingMessage, res: ServerResponse, url: URL) {
    const path = url.pathname;
    const m = req.method ?? "GET";
    if (m === "POST" && path === "/api/pair") {
      const b = await json<{ code?: string; name?: string }>(req);
      try {
        const r = await redeemPairingCode(ctxFor(null), String(b.code ?? ""), String(b.name ?? "iPhone"));
        return send(res, 200, { token: r.token, device: { id: r.device.id, name: r.device.name } });
      } catch (e) {
        if (e instanceof PairingError) throw new HttpError(400, e.message);
        throw e;
      }
    }
    const d = await device(req);
    const ctx = ctxFor(d);
    if (m === "GET" && path === "/api/me") {
      const [u] = d.userId ? await archive.db.select<{ name: string }>("SELECT name FROM app_user WHERE id = ?", [d.userId]) : [];
      return send(res, 200, { device: { id: d.id, name: d.name }, user: u?.name ?? null, today: today() });
    }
    if (m === "GET" && path === "/api/overview") {
      const dash = await dashboard(archive.db, { today: today(), userId: d.userId });
      const strip = (t: { title: string; due_date: string | null; occurrence_id: string; module: string }) => ({ title: t.title, due: t.due_date, occurrence: t.occurrence_id, module: t.module });
      return send(res, 200, {
        today: today(),
        overdue: dash.overdue.filter((t) => t.module !== "health").map(strip),
        upcoming: dash.upcoming.filter((t) => t.module !== "health").map(strip),
        expiring: dash.expiring.filter((t) => t.module !== "health").map(strip),
        meals: dash.meals,
        lending: (await listLendings(archive.db, today(), { active: true })).map((l) => ({ id: l.id, thing: l.thing, borrower: l.borrower, due: l.due_date, overdue: l.overdue })),
      });
    }
    const complete = path.match(/^\/api\/occurrences\/([\w-]+)\/complete$/);
    if (m === "POST" && complete) {
      const r = await completeOccurrence(ctx, complete[1]!, { completedDate: today() });
      return send(res, 200, { next: r.next?.due_date ?? null });
    }
    if (m === "GET" && path === "/api/calendar") {
      const from = url.searchParams.get("from") ?? today();
      const to = url.searchParams.get("to") ?? addDays(from, 30);
      return send(res, 200, await timelineEvents(archive.db, { from, to, kinds: MOBILE_KINDS, today: today(), userId: d.userId }));
    }
    if (m === "GET" && path === "/api/shopping") {
      const monday = weekStart(url.searchParams.get("date") ?? today());
      const list = await listForWeek(archive.db, monday);
      if (!list) return send(res, 200, { monday, list: null, sections: [] });
      const items = await shoppingItems(archive.db, String(list.id));
      return send(res, 200, {
        monday,
        list: { id: list.id },
        sections: groupBySection(items).map((g) => ({ category: g.category, items: g.items.map((i) => ({ id: i.id, text: formatShoppingItem({ name: String(i.name), amount: (i.amount as number | null) ?? null, unit: (i.unit as string | null) ?? null }), checked: Boolean(i.checked) })) })),
      });
    }
    const shop = path.match(/^\/api\/shopping\/([\w-]+)$/);
    if (m === "POST" && shop) {
      const b = await json<{ checked?: boolean }>(req);
      await setItemChecked(ctx, shop[1]!, Boolean(b.checked));
      return send(res, 200, { ok: true });
    }
    if (m === "GET" && path === "/api/meals") {
      const monday = weekStart(url.searchParams.get("date") ?? today());
      const rows = await entriesBetween(archive.db, monday, addDays(monday, 6));
      return send(res, 200, { monday, entries: rows.map((e) => ({ id: e.id, date: e.plan_date, meal: e.meal, title: e.recipe_name ?? e.title, recipe: e.recipe_id ?? null })) });
    }
    if (m === "GET" && path === "/api/search") {
      const q = url.searchParams.get("q") ?? "";
      const hits = await search(archive.db, q, { modules: ["home", "maintenance", "vehicle", "finance", "insurance", "documents", "food", "core"], limit: 30 });
      return send(res, 200, hits);
    }
    if (m === "GET" && path === "/api/items") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const rows = await archive.db.select<{ id: string; name: string; category: string | null; brand: string | null; model: string | null; serial_number: string | null; location: string | null }>(
        `SELECT i.id, i.name, i.category, i.brand, i.model, i.serial_number, l.name AS location FROM item i LEFT JOIN location l ON l.id = i.location_id
          WHERE i.archived_at IS NULL ORDER BY i.name`,
      );
      const thumbs = await thumbnailsFor(archive.db, "item");
      return send(
        res,
        200,
        rows
          .filter((r) => !q || [r.name, r.brand, r.model, r.serial_number, r.category, r.location].some((v) => v?.toLowerCase().includes(q)))
          .map((r) => ({ ...r, thumb: thumbs.get(r.id)?.id ?? null })),
      );
    }
    const item = path.match(/^\/api\/items\/([\w-]+)$/);
    if (m === "GET" && item) {
      const [row] = await archive.db.select<Record<string, unknown>>(
        `SELECT i.*, l.name AS location FROM item i LEFT JOIN location l ON l.id = i.location_id WHERE i.id = ? AND i.archived_at IS NULL`,
        [item[1]!],
      );
      if (!row) throw new HttpError(404, "Genstanden findes ikke.");
      const docs = await documentsFor(archive.db, "item", item[1]!);
      const lending = await activeLendingForItem(archive.db, item[1]!);
      return send(res, 200, {
        item: row,
        documents: docs.map((x) => ({ id: x.id, title: x.title ?? x.filename, role: x.role, ext: x.ext, mime: x.mime })),
        lending: lending ? { id: lending.id, borrower: lending.borrower, since: lending.lent_date, due: lending.due_date } : null,
      });
    }
    if (m === "PATCH" && item) {
      if (!(await getEntity(archive.db, "item", item[1]!))) throw new HttpError(404, "Genstanden findes ikke.");
      const row = await updateEntity(ctx, "item", item[1]!, pick(await json<Record<string, unknown>>(req), ITEM_FIELDS) as never);
      return send(res, 200, { id: row.id });
    }
    if (m === "POST" && path === "/api/items") {
      const row = await createEntity(ctx, "item", pick(await json<Record<string, unknown>>(req), ITEM_FIELDS) as never);
      return send(res, 200, { id: row.id });
    }
    if (m === "GET" && path === "/api/options") {
      return send(res, 200, {
        locations: await locationOptions(archive.db),
        categories: (await textListValues(archive.db, "item_category")).map((v) => v.value),
        occasions: (await textListValues(archive.db, "gift_occasion")).map((v) => v.value),
        persons: (await listPersons(archive.db)).map((p) => ({ id: p.id, name: p.name, relation: p.relation, household: p.household })),
        items: (await listEntities(archive.db, "item", { orderBy: "name" })).map((i) => ({ id: String(i.id), name: String(i.name) })),
      });
    }
    if (m === "GET" && path === "/api/people") {
      const summary = new Map((await giftSummary(archive.db)).map((s) => [s.person_id, s]));
      const lent = (await listLendings(archive.db, today(), { active: true })).filter((l) => l.borrower_person_id);
      return send(
        res,
        200,
        (await listPersons(archive.db)).map((p) => ({
          id: p.id,
          name: p.name,
          relation: p.relation,
          household: p.household,
          gifts: (summary.get(p.id)?.given ?? 0) + (summary.get(p.id)?.received ?? 0),
          lent: lent.filter((l) => l.borrower_person_id === p.id).length,
        })),
      );
    }
    if (m === "POST" && path === "/api/people") {
      const b = await json<{ name?: string; relation?: string }>(req);
      if (!b.name?.trim()) throw new HttpError(400, "Skriv personens navn.");
      const row = await createOutsidePerson(ctx, b.name, b.relation);
      return send(res, 200, { id: row.id, name: row.name });
    }
    const person = path.match(/^\/api\/people\/([\w-]+)$/);
    if (m === "GET" && person) {
      const [p] = (await listPersons(archive.db)).filter((x) => x.id === person[1]);
      if (!p) throw new HttpError(404, "Personen findes ikke.");
      const lendings = (await listLendings(archive.db, today())).filter((l) => l.borrower_person_id === p.id);
      return send(res, 200, {
        person: { id: p.id, name: p.name, relation: p.relation, household: p.household },
        gifts: (await listGifts(archive.db, { personId: p.id })).map((g) => ({ id: g.id, direction: g.direction, title: g.title, occasion: g.occasion, date: g.gift_date, amount_minor: g.amount_minor, notes: g.notes })),
        lendings: lendings.map((l) => ({ id: l.id, thing: l.thing, since: l.lent_date, due: l.due_date, returned: l.returned_date, overdue: l.overdue })),
      });
    }
    if (m === "POST" && path === "/api/gifts") {
      const row = await createGift(ctx, pick(await json<Record<string, unknown>>(req), GIFT_FIELDS) as never);
      return send(res, 200, { id: row.id });
    }
    const gift = path.match(/^\/api\/gifts\/([\w-]+)$/);
    if (m === "PATCH" && gift) {
      if (!(await getEntity(archive.db, "gift", gift[1]!))) throw new HttpError(404, "Gaven findes ikke.");
      await updateEntity(ctx, "gift", gift[1]!, pick(await json<Record<string, unknown>>(req), GIFT_FIELDS) as never);
      return send(res, 200, { ok: true });
    }
    if (m === "POST" && path === "/api/lending") {
      const b = await json<Record<string, unknown>>(req);
      const row = await lendItem(ctx, { lent_date: today(), ...pick(b, ["item_id", "title", "borrower_person_id", "borrower_name", "lent_date", "due_date", "notes"]) } as never);
      return send(res, 200, { id: row.id });
    }
    const file = path.match(/^\/api\/documents\/([\w-]+)\/file$/);
    if (m === "GET" && file) {
      await assertViewable(file[1]!);
      const [doc] = await archive.db.select<{ sha256: string; ext: string; mime: string; filename: string }>("SELECT sha256, ext, mime, filename FROM document WHERE id = ?", [file[1]!]);
      if (!doc) throw new HttpError(404, "Dokumentet findes ikke.");
      const bytes = await fsp.readFile(archive.path(documentRelPath(doc.sha256, doc.ext)));
      return send(res, 200, bytes, { "content-type": doc.mime, "cache-control": "private, max-age=86400", "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(doc.filename)}` });
    }
    if (m === "POST" && path === "/api/upload") {
      const name = (url.searchParams.get("name") ?? "foto.jpg").replace(/[\\/:*?"<>|]/g, "_").slice(0, 120);
      if (!/\.(jpe?g|png|heic|pdf)$/i.test(name)) throw new HttpError(400, "Kun billeder og PDF kan sendes fra telefonen.");
      const body = await readBody(req, MAX_UPLOAD);
      if (!body.length) throw new HttpError(400, "Filen er tom.");
      const tmp = join(tmpdir(), `ppm-mobil-${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
      await fsp.writeFile(tmp, body);
      try {
        const r = await importDocument(env, archive, ctx, tmp, { source: "drop", filename: name });
        const itemId = url.searchParams.get("item");
        const role = url.searchParams.get("role") === "receipt" ? "receipt" : "photo";
        if (itemId) await linkDocument(ctx, { document_id: String(r.document.id), target_type: "item", target_id: itemId, role });
        return send(res, 200, { id: r.document.id, duplicate: r.duplicate, linked: Boolean(itemId) });
      } finally {
        await fsp.rm(tmp, { force: true });
      }
    }
    const ret = path.match(/^\/api\/lending\/([\w-]+)\/return$/);
    if (m === "POST" && ret) {
      await returnLending(ctx, ret[1]!);
      return send(res, 200, { ok: true });
    }
    throw new HttpError(404, "Ukendt adresse.");
  }

  async function serveStatic(res: ServerResponse, url: URL) {
    let rel = decodeURIComponent(url.pathname);
    if (rel === "/" || !extname(rel)) rel = "/index.html";
    const full = normalize(join(staticRoot, rel));
    if (!full.startsWith(staticRoot + sep) || !existsSync(full) || !statSync(full).isFile()) return send(res, 404, "Ikke fundet");
    const immutable = rel.startsWith("/assets/");
    send(res, 200, readFileSync(full), {
      "content-type": MIME[extname(full)] ?? "application/octet-stream",
      "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
      "content-security-policy": "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'",
    });
  }

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (!isLanAddress(req.socket.remoteAddress)) return send(res, 403, { error: "Kun adgang fra det lokale netværk." });
      const url = new URL(req.url ?? "/", "https://ppm.local");
      if (url.pathname.startsWith("/api/")) return await api(req, res, url);
      if (url.pathname === "/ppm-ca.cer") return send(res, 200, tls.caDer, { "content-type": "application/x-x509-ca-cert", "content-disposition": 'attachment; filename="PPM-certifikat.cer"' });
      return await serveStatic(res, url);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : e instanceof ValidationError ? 400 : 500;
      const message = e instanceof Error ? e.message : String(e);
      return send(res, status, { error: status === 500 ? "Der skete en fejl på computeren." : message });
    }
  };

  const httpsServer = createHttpsServer({ key: tls.key, cert: tls.cert }, (req, res) => void handler(req, res));
  // Plain HTTP only hands out the CA (to install before HTTPS can be trusted) and a short guide.
  const httpServer = createHttpServer((req, res) => {
    if (!isLanAddress(req.socket.remoteAddress)) return send(res, 403, { error: "Kun adgang fra det lokale netværk." });
    const url = new URL(req.url ?? "/", "http://ppm.local");
    if (url.pathname === "/ppm-ca.cer") return send(res, 200, tls.caDer, { "content-type": "application/x-x509-ca-cert", "content-disposition": 'attachment; filename="PPM-certifikat.cer"' });
    const httpsUrl = `https://${(req.headers.host ?? "").replace(/:\d+$/, "")}:${o.port}/`;
    send(res, 200, guidePage(httpsUrl, tls.caFingerprint));
  });
  const bind = o.host ?? "0.0.0.0";
  await new Promise<void>((ok, fail) => httpsServer.once("error", fail).listen(o.port, bind, () => ok()));
  await new Promise<void>((ok, fail) => httpServer.once("error", fail).listen(o.port + 1, bind, () => ok()));
  return {
    addresses,
    httpsPort: o.port,
    httpPort: o.port + 1,
    caFingerprint: tls.caFingerprint,
    /** The CA was replaced at this start; phones must install the new certificate. */
    caRenewed: tls.caRenewed,
    caCert: tls.caCert,
    close: async () => {
      await new Promise((r) => httpsServer.close(() => r(null)));
      await new Promise((r) => httpServer.close(() => r(null)));
    },
  };
}

function guidePage(httpsUrl: string, fingerprint: string): string {
  return `<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PPM på iPhone</title><style>body{font:17px -apple-system,system-ui,sans-serif;margin:0;padding:24px;background:#f6f4ef;color:#1d2321;line-height:1.45}
h1{font-size:24px}a.btn{display:block;text-align:center;background:#1f5e54;color:#fff;padding:14px;border-radius:12px;text-decoration:none;font-weight:600;margin:14px 0}
ol li{margin:8px 0}code{font-size:12px;word-break:break-all;color:#5f6b67}</style></head><body>
<h1>PPM på iPhone</h1>
<p>Telefonen skal stole på computerens certifikat én gang. Så er forbindelsen krypteret, og intet går via internettet.</p>
<a class="btn" href="/ppm-ca.cer">1. Hent certifikatet</a>
<ol><li>Brug <b>Safari</b>. Tryk <b>Tillad</b>, og derefter <b>Luk</b>.</li>
<li>Åbn <b>Indstillinger</b>, tryk <b>Profil hentet</b> øverst, og tryk <b>Installer</b>. Står den der ikke, så find profilen under <b>Generelt → VPN og enhedsadministration</b>.</li>
<li>Gå til <b>Indstillinger → Generelt → Om → Indst. til certifikatgodkendelse</b>, og slå <b>PPM lokal CA</b> til under <i>Aktivér fuld tillid til rodcertifikater</i>.</li></ol>
<a class="btn" href="${httpsUrl}">2. Åbn PPM</a>
<ol start="4"><li>Tryk på <b>Del</b> → <b>Føj til hjemmeskærm</b>.</li>
<li>Åbn PPM fra det nye ikon, og parr telefonen dér med koden fra computeren. Ikonet husker parringen; Safari og ikonet husker hver for sig.</li></ol>
<p><small>Siger Safari &quot;Forbindelsen er ikke privat&quot;, mangler trin 3.</small></p>
<p><small>Certifikatets fingeraftryk (skal stå i PPM på computeren):</small><br><code>${fingerprint}</code></p>
</body></html>`;
}
