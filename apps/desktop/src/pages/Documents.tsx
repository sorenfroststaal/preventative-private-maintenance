import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { linkDocument, listDocuments, MIME_BY_EXT, type Row } from "@ppm/core";
import { errorText, useSession } from "../app/session";
import { pickFiles } from "../platform/tauri";
import { formatBytes, formatDateTime } from "../lib/format";
import { DocumentPreview } from "../components/DocumentPreview";
import { RefSelect } from "../components/EntityForm";
import { includesText, rowProps, SearchBox } from "../components/ui";
import { DOC_ROLES, optionLabel } from "../lib/entityFields";
import { useInbox, useToast } from "../layout/Shell";
import { FileTypeIcon, PageTitle, StatusBadge } from "../components/visual";

const SOURCE_LABEL: Record<string, string> = { drop: "Træk og slip", inbox: "Indbakke", ai: "AI", bank_import: "Bankimport" };

const LINK_TARGETS: [string, string, string][] = [
  ["item", "Genstand", "name"],
  ["work_order", "Arbejdsordre", "title"],
  ["vehicle", "Bil", "name"],
  ["policy", "Police", "title"],
  ["property", "Bolig", "name"],
  ["building_part", "Bygningsdel", "name"],
  ["claim", "Skadesag", "description"],
  ["person", "Person", "name"],
  ["recurring_expense", "Fast udgift", "name"],
];

export function Documents({ onImport }: { onImport(paths: string[]): Promise<void> }) {
  const { archive } = useSession();
  const inbox = useInbox();
  const [params, setParams] = useSearchParams();
  const [unlinkedOnly, setUnlinkedOnly] = useState(params.get("queue") === "1");
  const [source, setSource] = useState("");
  const [role, setRole] = useState("");
  const [q, setQ] = useState("");
  const docs = useQuery({ queryKey: ["documents", "list", unlinkedOnly], queryFn: () => listDocuments(archive.db, { unlinkedOnly }) });
  const roles = useQuery({
    queryKey: ["documents", "roles"],
    queryFn: () => archive.db.select<{ document_id: string; role: string }>("SELECT document_id, role FROM document_link"),
  });
  const rolesByDoc = new Map<string, Set<string>>();
  for (const r of roles.data ?? []) rolesByDoc.set(r.document_id, new Set([...(rolesByDoc.get(r.document_id) ?? []), r.role]));
  const rows = (docs.data ?? []).filter(
    (d) =>
      (!source || d.source === source) &&
      (!role || rolesByDoc.get(String(d.id))?.has(role)) &&
      includesText(d, ["title", "filename", "extracted_text"], q),
  );
  const selectedId = params.get("id");
  const selected = docs.data?.find((d) => d.id === selectedId);

  async function choose() {
    const files = await pickFiles("Vælg filer der skal importeres", { filterName: "Bilag", extensions: Object.keys(MIME_BY_EXT), multiple: true });
    if (files.length) await onImport(files);
  }

  return (
    <section>
      <div className="page-header">
        <PageTitle module="documents" />
        <button className="primary" onClick={choose} disabled={archive.readOnly}>
          Importér filer…
        </button>
      </div>
      <div className="dropzone" aria-hidden="true">
        Træk PDF-filer, billeder eller mails ind hvor som helst i vinduet – eller læg dem i arkivets mappe <code>indbakke</code>.
      </div>
      {inbox.unsupported.length > 0 && (
        <div className="warning" role="alert">
          Filer i indbakken, der ikke understøttes og bliver liggende: {inbox.unsupported.join(", ")}
        </div>
      )}
      <div className="row filters">
        <SearchBox value={q} onChange={setQ} placeholder="Søg i titel og tekst" />
        <select aria-label="Kilde" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">Alle kilder</option>
          {Object.entries(SOURCE_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <select aria-label="Kategori" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">Alle kategorier</option>
          {DOC_ROLES.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <label className="inline">
          <input type="checkbox" checked={unlinkedOnly} onChange={(e) => setUnlinkedOnly(e.target.checked)} /> Importkø (uden kobling)
        </label>
      </div>
      <div className="split">
        <table className="list">
          <thead>
            <tr>
              <th>Titel</th>
              <th>Størrelse</th>
              <th>Kilde</th>
              <th>Importeret</th>
              <th>Koblinger</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={String(d.id)} {...rowProps(d.id === selectedId, () => setParams({ id: String(d.id), ...(unlinkedOnly ? { queue: "1" } : {}) }))}>
                <td>
                  <FileTypeIcon ext={String(d.ext)} /> {String(d.title ?? d.filename)}
                  <div className="small muted">{String(d.filename)}</div>
                </td>
                <td>{formatBytes(Number(d.size_bytes))}</td>
                <td>{SOURCE_LABEL[String(d.source)] ?? String(d.source)}</td>
                <td>{formatDateTime(String(d.created_at))}</td>
                <td>{Number(d.link_count) || <StatusBadge kind="missing">Ingen</StatusBadge>}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Ingen dokumenter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {selected && (
          <aside className="detail wide-detail" key={String(selected.id)} aria-label="Dokument">
            <h2>{String(selected.title ?? selected.filename)}</h2>
            <LinkPanel doc={selected} roles={[...(rolesByDoc.get(String(selected.id)) ?? [])]} />
            <DocumentPreview doc={selected} />
          </aside>
        )}
      </div>
    </section>
  );
}

function LinkPanel({ doc, roles }: { doc: Row; roles: string[] }) {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [type, setType] = useState("item");
  const [target, setTarget] = useState("");
  const [role, setRole] = useState("receipt");
  const labelCol = LINK_TARGETS.find(([k]) => k === type)![2];
  const links = useQuery({
    queryKey: ["documents", "links", doc.id],
    queryFn: () =>
      session.archive.db.select<Row>("SELECT target_type, target_id, role FROM document_link WHERE document_id = ?", [String(doc.id)]),
  });
  return (
    <fieldset disabled={session.archive.readOnly}>
      <legend>Kobling {roles.length ? `(${roles.map((r) => optionLabel(DOC_ROLES, r)).join(", ")})` : ""}</legend>
      <p className="small muted">{links.data?.length ? `Koblet til ${links.data.length} post(er).` : "Ikke koblet til noget endnu."}</p>
      <div className="row">
        <label>
          Type
          <select value={type} onChange={(e) => (setType(e.target.value), setTarget(""))}>
            {LINK_TARGETS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          Post
          <RefSelect type={type as never} labelCol={labelCol} value={target} onChange={setTarget} />
        </label>
        <label>
          Kategori
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {DOC_ROLES.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={!target}
          onClick={async () => {
            try {
              await linkDocument(session.ctx(), { document_id: String(doc.id), target_type: type as never, target_id: target, role: role as never });
              await qc.invalidateQueries({ queryKey: ["documents"] });
              await qc.invalidateQueries({ queryKey: ["dashboard"] });
              toast("Dokumentet er koblet");
            } catch (e) {
              toast(errorText(e), "error");
            }
          }}
        >
          Kobl
        </button>
      </div>
    </fieldset>
  );
}
