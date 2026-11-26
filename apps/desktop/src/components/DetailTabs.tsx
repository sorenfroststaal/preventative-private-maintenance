import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { createTask, deleteLink, documentsFor, getHistory, importDocument, linkDocument, listDocuments, MIME_BY_EXT, tasksForTarget, type Row } from "@ppm/core";
import { errorText, useSession } from "../app/session";
import { pickFiles } from "../platform/tauri";
import { DOC_ROLES, optionLabel } from "../lib/entityFields";
import { describeRecurrence, formatDate, formatMoney } from "../lib/format";
import { parseRecurrence } from "@ppm/core";
import { Modal, Empty } from "./ui";
import { DocumentPreview } from "./DocumentPreview";
import { useToast } from "../layout/Shell";
import { TEMPLATES, type Template } from "../lib/templates";

type DocTarget = Parameters<typeof linkDocument>[1]["target_type"];

/** Documents linked to an entity, with link/import/unlink and preview (spec 04 "Bilag"). */
export function DocumentsTab({ targetType, targetId, roles }: { targetType: DocTarget; targetId: string; roles?: string[] }) {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [preview, setPreview] = useState<Row | null>(null);
  const [linking, setLinking] = useState(false);
  const [role, setRole] = useState(roles?.[0] ?? "receipt");
  const docs = useQuery({ queryKey: ["documents", "for", targetType, targetId], queryFn: () => documentsFor(session.archive.db, targetType, targetId) });
  const roleOptions = DOC_ROLES.filter(([k]) => !roles || roles.includes(k));
  const refresh = () => qc.invalidateQueries({ queryKey: ["documents"] }).then(() => qc.invalidateQueries({ queryKey: ["dashboard"] }));

  async function importAndLink() {
    const files = await pickFiles("Vælg bilag", { filterName: "Bilag", extensions: Object.keys(MIME_BY_EXT), multiple: true });
    for (const f of files) {
      try {
        const r = await importDocument(session.env, session.archive, session.ctx(), f, { source: "drop" });
        await linkDocument(session.ctx(), { document_id: String(r.document.id), target_type: targetType, target_id: targetId, role: role as never });
      } catch (e) {
        toast(errorText(e), "error");
      }
    }
    await refresh();
  }

  const unlink = useMutation({
    mutationFn: (d: Row) => deleteLink(session.ctx(), "document_link", { document_id: d.id, target_type: targetType, target_id: targetId, role: d.role }),
    onSuccess: refresh,
  });

  return (
    <div>
      <div className="row">
        <label className="inline-label">
          Kategori
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {roleOptions.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <button onClick={importAndLink} disabled={session.archive.readOnly}>
          Importér og tilknyt…
        </button>
        <button onClick={() => setLinking(true)} disabled={session.archive.readOnly}>
          Tilknyt eksisterende…
        </button>
      </div>
      {docs.data?.length === 0 && <Empty>Ingen bilag.</Empty>}
      <ul className="plain">
        {(docs.data ?? []).map((d) => (
          <li key={`${d.id}:${d.role}`} className="line">
            <button className="link" onClick={() => setPreview(d)}>
              {String(d.title ?? d.filename)}
            </button>
            <span className="muted">{optionLabel(DOC_ROLES, d.role)}</span>
            <button className="link" onClick={() => window.confirm(`Fjern bilaget "${d.title ?? d.filename}" fra posten? Selve dokumentet bevares under Dokumenter.`) && unlink.mutate(d)} aria-label={`Fjern ${d.title ?? d.filename}`}>
              Fjern
            </button>
          </li>
        ))}
      </ul>
      {preview && (
        <Modal title={String(preview.title ?? preview.filename)} onClose={() => setPreview(null)} wide>
          <DocumentPreview doc={preview} />
        </Modal>
      )}
      {linking && (
        <LinkExisting
          onClose={() => setLinking(false)}
          onPick={async (docId) => {
            try {
              await linkDocument(session.ctx(), { document_id: docId, target_type: targetType, target_id: targetId, role: role as never });
              await refresh();
              setLinking(false);
            } catch (e) {
              toast(errorText(e), "error");
            }
          }}
        />
      )}
    </div>
  );
}

function LinkExisting({ onClose, onPick }: { onClose(): void; onPick(id: string): void }) {
  const { archive } = useSession();
  const [all, setAll] = useState(false);
  const docs = useQuery({ queryKey: ["documents", "pick", all], queryFn: () => listDocuments(archive.db, { unlinkedOnly: !all }) });
  return (
    <Modal title="Tilknyt dokument" onClose={onClose}>
      <label className="inline">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Vis også dokumenter, der allerede er tilknyttet
      </label>
      {docs.data?.length === 0 && <Empty>Ingen dokumenter i importkøen.</Empty>}
      <ul className="plain">
        {(docs.data ?? []).map((d) => (
          <li key={String(d.id)} className="line">
            <span>{String(d.title ?? d.filename)}</span>
            <span className="muted small">{String(d.filename)}</span>
            <button onClick={() => onPick(String(d.id))}>Vælg</button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/** Work orders and completed tasks on the target (spec 04 "Historikfanen"). */
export function HistoryTab({ targetType, targetId }: { targetType: string; targetId: string }) {
  const { archive } = useSession();
  const q = useQuery({ queryKey: ["history", targetType, targetId], queryFn: () => getHistory(archive.db, targetType, targetId) });
  if (q.data?.length === 0) return <Empty>Ingen historik endnu.</Empty>;
  return (
    <ul className="plain timeline">
      {(q.data ?? []).map((h) => (
        <li key={`${h.kind}:${h.id}`} className="line">
          <span>
            {formatDate(h.date)} · {h.title}
          </span>
          <span className="muted">{h.kind === "work_order" ? "Arbejdsordre" : h.status === "done" ? "Opgave udført" : "Sprunget over"}</span>
          <span>{h.cost_minor ? formatMoney(h.cost_minor) : h.kind === "work_order" ? <Link to={`/arbejdsordrer?id=${h.id}`}>Åbn</Link> : ""}</span>
        </li>
      ))}
    </ul>
  );
}

/** Tasks on the target + quick add from templates that apply to this kind of target. */
export function TasksTab({ targetType, targetId, module }: { targetType: Template["applies_to"]; targetId: string; module: string }) {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const tasks = useQuery({
    queryKey: ["tasks", "for", targetType, targetId],
    queryFn: () => tasksForTarget(session.archive.db, targetType, targetId),
  });
  const templates = TEMPLATES.filter((t) => t.applies_to === targetType);
  const existing = new Set((tasks.data ?? []).map((t) => t.template_id));

  async function addTemplate(t: Template) {
    try {
      await createTask(session.ctx(), {
        title: t.title,
        description: t.description,
        module: t.module as never,
        target_type: targetType,
        target_id: targetId,
        template_id: t.id,
        template_version: t.version,
        source: "template",
        recurrence: t.recurrence,
      });
      await qc.invalidateQueries({ queryKey: ["tasks"] });
      await qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast(`Opgave oprettet: ${t.title}`);
    } catch (e) {
      toast(errorText(e), "error");
    }
  }

  return (
    <div>
      {tasks.data?.length === 0 && <Empty>Ingen opgaver.</Empty>}
      <ul className="plain">
        {(tasks.data ?? []).map((t) => (
          <li key={String(t.id)} className="line">
            <Link to={`/opgaver?task=${t.id}`}>{String(t.title)}</Link>
            <span className="muted small">{describeRecurrence(parseRecurrence(t.recurrence_json))}</span>
            <span>{t.occurrence_id ? (t.due_date ? formatDate(String(t.due_date)) : "Dato mangler") : "Afsluttet"}</span>
          </li>
        ))}
      </ul>
      {templates.length > 0 && (
        <>
          <h4>Forslag</h4>
          <p className="small muted">Praktiske standardintervaller – ikke lovkrav. Justér dem til dine forhold.</p>
          <ul className="plain">
            {templates.map((t) => (
              <li key={t.id} className="line">
                <span>{t.title}</span>
                <span className="muted small">{describeRecurrence(t.recurrence)}</span>
                <button onClick={() => addTemplate(t)} disabled={existing.has(t.id) || session.archive.readOnly}>
                  {existing.has(t.id) ? "Tilføjet" : "Tilføj"}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="small muted">
        Nye opgaver uden skabelon oprettes under <Link to="/opgaver">Opgaver</Link> (modul: {module}).
      </p>
    </div>
  );
}
