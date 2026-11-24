/** Minimal RFC 5322/MIME parser: headers, encoded words and the text/plain part (spec 05). */

export interface ParsedEmail {
  subject: string | null;
  from: string | null;
  date: string | null; // YYYY-MM-DD (local)
  text: string;
}

function decodeBytes(bytes: Uint8Array, charset: string): string {
  const cs = (charset || "utf-8").toLowerCase().replace(/^"|"$/g, "");
  try {
    return new TextDecoder(cs === "latin1" ? "iso-8859-1" : cs).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function base64ToBytes(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/=]/g, "");
  try {
    return Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
  } catch {
    return new Uint8Array();
  }
}

function qpToBytes(s: string, header = false): Uint8Array {
  const src = header ? s.replace(/_/g, " ") : s.replace(/=\r?\n/g, "");
  const out: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (c === "=" && /^[0-9A-Fa-f]{2}$/.test(src.slice(i + 1, i + 3))) {
      out.push(parseInt(src.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      const code = c.charCodeAt(0);
      if (code < 128) out.push(code);
      else out.push(...new TextEncoder().encode(c));
    }
  }
  return new Uint8Array(out);
}

/** Decodes RFC 2047 encoded words: =?utf-8?B?...?= / =?iso-8859-1?Q?...?= */
export function decodeEncodedWords(s: string): string {
  return s
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_m, cs: string, enc: string, data: string) =>
      decodeBytes(enc.toUpperCase() === "B" ? base64ToBytes(data) : qpToBytes(data, true), cs),
    );
}

function splitHeaderBody(raw: string): [string, string] {
  const m = raw.match(/\r?\n\r?\n/);
  if (!m || m.index === undefined) return [raw, ""];
  return [raw.slice(0, m.index), raw.slice(m.index + m[0].length)];
}

function parseHeaders(block: string): Map<string, string> {
  const unfolded = block.replace(/\r?\n[ \t]+/g, " ");
  const h = new Map<string, string>();
  for (const line of unfolded.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) {
      const k = line.slice(0, i).trim().toLowerCase();
      if (!h.has(k)) h.set(k, line.slice(i + 1).trim());
    }
  }
  return h;
}

function param(value: string | undefined, name: string): string | null {
  if (!value) return null;
  const m = value.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|[^;\\s]+)`, "i"));
  return m ? (m[2] ?? m[1]!) : null;
}

function decodePart(headers: Map<string, string>, body: string): string {
  const enc = (headers.get("content-transfer-encoding") ?? "").toLowerCase();
  const charset = param(headers.get("content-type"), "charset") ?? "utf-8";
  if (enc === "base64") return decodeBytes(base64ToBytes(body), charset);
  if (enc === "quoted-printable") return decodeBytes(qpToBytes(body), charset);
  // 7bit/8bit: the raw text was read as latin1 bytes by the caller.
  return decodeBytes(Uint8Array.from(body, (c) => c.charCodeAt(0) & 0xff), charset);
}

/** Finds the first text/plain part, descending into multipart containers. */
function findText(headers: Map<string, string>, body: string, depth = 0): string | null {
  const ct = (headers.get("content-type") ?? "text/plain").toLowerCase();
  if (ct.startsWith("multipart/") && depth < 5) {
    const boundary = param(headers.get("content-type"), "boundary");
    if (!boundary) return null;
    const parts = body.split(`--${boundary}`).slice(1);
    for (const part of parts) {
      if (part.startsWith("--")) break;
      const [h, b] = splitHeaderBody(part.replace(/^\r?\n/, ""));
      const found = findText(parseHeaders(h), b, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }
  if (ct.startsWith("text/plain")) return decodePart(headers, body);
  return null;
}

function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Parses raw .eml bytes. HTML parts are never rendered or returned (spec 05). */
export function parseEml(bytes: Uint8Array): ParsedEmail {
  // Read as latin1 so 8-bit bodies survive; text is re-decoded with the declared charset.
  const raw = new TextDecoder("iso-8859-1").decode(bytes);
  const [h, body] = splitHeaderBody(raw);
  const headers = parseHeaders(h);
  const hdr = (k: string) => {
    const v = headers.get(k);
    return v ? decodeEncodedWords(decodeBytes(Uint8Array.from(v, (c) => c.charCodeAt(0) & 0xff), "utf-8")) : null;
  };
  const dateRaw = headers.get("date");
  const d = dateRaw ? new Date(dateRaw) : null;
  return {
    subject: hdr("subject"),
    from: hdr("from"),
    date: d && !isNaN(d.getTime()) ? localDate(d) : null,
    text: (findText(headers, body) ?? "").replace(/\r\n/g, "\n").trim(),
  };
}
