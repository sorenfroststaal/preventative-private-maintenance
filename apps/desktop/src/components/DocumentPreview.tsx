import { useEffect, useRef, useState } from "react";
import { documentRelPath, type Row } from "@ppm/core";
import { useSession } from "../app/session";
import { renderPdf } from "../lib/pdf";
import { formatBytes, formatDate } from "../lib/format";

/** Preview of PDF (canvas), images (blob URL) and the extracted text of mails. HTML is never rendered. */
export function DocumentPreview({ doc }: { doc: Row }) {
  const { env, archive } = useSession();
  const [url, setUrl] = useState<string | null>(null);
  const [pages, setPages] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pdfRef = useRef<HTMLDivElement>(null);
  const ext = String(doc.ext);

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    setError(null);
    setUrl(null);
    (async () => {
      const path = archive.path(documentRelPath(String(doc.sha256), ext));
      if (ext === "jpg" || ext === "jpeg" || ext === "png") {
        const bytes = await env.fs.readFile(path);
        revoked = URL.createObjectURL(new Blob([bytes.slice()], { type: String(doc.mime) }));
        if (!cancelled) setUrl(revoked);
      } else if (ext === "pdf" && pdfRef.current) {
        const bytes = await env.fs.readFile(path);
        if (!cancelled && pdfRef.current) setPages(await renderPdf(bytes, pdfRef.current));
      }
    })().catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [archive, doc.id, doc.mime, doc.sha256, env, ext]);

  return (
    <div className="preview">
      <div className="small muted">
        {String(doc.filename)} · {formatBytes(Number(doc.size_bytes))}
        {doc.doc_date ? ` · ${formatDate(String(doc.doc_date))}` : ""}
      </div>
      {error && <p className="error">Kan ikke vises: {error}</p>}
      {url && <img src={url} alt={String(doc.title ?? doc.filename)} className="preview-img" />}
      {ext === "pdf" && <div ref={pdfRef} className="pdf-pages" aria-label="PDF-forhåndsvisning" />}
      {pages !== null && pages > 5 && <p className="small muted">Viser de første 5 af {pages} sider.</p>}
      {(ext === "eml" || ext === "msg" || ext === "heic") && (
        <>
          {ext !== "eml" && <p className="muted">Denne filtype kan ikke forhåndsvises.</p>}
          {doc.extracted_text ? <pre className="mailtext">{String(doc.extracted_text)}</pre> : null}
        </>
      )}
    </div>
  );
}
