import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listDocuments, MIME_BY_EXT } from "@ppm/core";
import { useSession } from "../app/session";
import { pickFiles } from "../platform/tauri";
import { formatBytes, formatDateTime } from "../lib/format";

const SOURCE_LABEL: Record<string, string> = {
  drop: "Træk og slip",
  inbox: "Indbakke",
  ai: "AI",
  bank_import: "Bankimport",
};

export function Documents({ onImport }: { onImport(paths: string[]): Promise<void> }) {
  const { archive } = useSession();
  const [unlinkedOnly, setUnlinkedOnly] = useState(false);
  const docs = useQuery({
    queryKey: ["documents", unlinkedOnly],
    queryFn: () => listDocuments(archive.db, { unlinkedOnly }),
  });

  async function choose() {
    const files = await pickFiles("Vælg filer der skal importeres", {
      filterName: "Bilag",
      extensions: Object.keys(MIME_BY_EXT),
      multiple: true,
    });
    if (files.length) await onImport(files);
  }

  return (
    <section>
      <div className="header-row">
        <h1>Dokumenter</h1>
        <button className="primary" onClick={choose} disabled={archive.readOnly}>
          Importér filer…
        </button>
      </div>
      <div className="dropzone" aria-hidden="true">
        Træk PDF-filer, billeder eller mails ind hvor som helst i vinduet for at importere dem.
      </div>
      <label className="inline">
        <input type="checkbox" checked={unlinkedOnly} onChange={(e) => setUnlinkedOnly(e.target.checked)} /> Vis kun
        dokumenter uden kobling (importkø)
      </label>
      <table className="list">
        <thead>
          <tr>
            <th>Titel</th>
            <th>Fil</th>
            <th>Størrelse</th>
            <th>Kilde</th>
            <th>Importeret</th>
            <th>Koblinger</th>
          </tr>
        </thead>
        <tbody>
          {(docs.data ?? []).map((d) => (
            <tr key={String(d.id)}>
              <td>{String(d.title ?? d.filename)}</td>
              <td className="small">{String(d.filename)}</td>
              <td>{formatBytes(Number(d.size_bytes))}</td>
              <td>{SOURCE_LABEL[String(d.source)] ?? String(d.source)}</td>
              <td>{formatDateTime(String(d.created_at))}</td>
              <td>{Number(d.link_count) || <span className="muted">Ingen</span>}</td>
            </tr>
          ))}
          {docs.data?.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                Ingen dokumenter.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="small muted">Forhåndsvisning, kobling til poster og overvåget indbakke kommer i fase 2.</p>
    </section>
  );
}
