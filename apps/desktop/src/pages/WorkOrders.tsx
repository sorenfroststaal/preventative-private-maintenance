import { WorkOrderParts } from "../components/Components";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { addWorkOrderNote, changeWorkOrderStatus, createEntity, listEntities, updateEntity, workOrderEvents, workOrdersWithNames, type Row, type WorkOrderStatus } from "@ppm/core";
import { errorText, useSession } from "../app/session";
import { EntityForm, RefSelect } from "../components/EntityForm";
import { DocumentsTab } from "../components/DetailTabs";
import { Empty, includesText, Modal, rowProps, SearchBox, Tabs } from "../components/ui";
import { CLAIM_STATUS, fieldsFor, optionLabel, WO_KIND, WO_STATUS } from "../lib/entityFields";
import { formatDate, formatDateTime, formatMoney } from "../lib/format";
import { useToast } from "../layout/Shell";
import { EmptyState, PageTitle } from "../components/visual";

const TARGET_LABEL: Record<string, string> = { property: "Bolig", building_part: "Bygningsdel", item: "Genstand", vehicle: "Bil" };
const TARGET_LABEL_COL: Record<string, string> = { property: "name", building_part: "name", item: "name", vehicle: "name" };

/** Work order list with status/type/target/year filters (spec 04). */
export function WorkOrders() {
  const { archive } = useSession();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [year, setYear] = useState("");
  const [targetType, setTargetType] = useState("");
  const [creating, setCreating] = useState(false);
  const list = useQuery({
    queryKey: ["work_order", "list"],
    queryFn: () => workOrdersWithNames(archive.db),
  });
  const years = [...new Set((list.data ?? []).map((w) => String(w.reported_date).slice(0, 4)))];
  const rows = (list.data ?? []).filter(
    (w) =>
      (!status || w.status === status) &&
      (!kind || w.kind === kind) &&
      (!targetType || w.target_type === targetType) &&
      (!year || String(w.reported_date).startsWith(year)) &&
      includesText(w, ["title", "description", "target_name", "contact_name"], q),
  );
  const selectedId = params.get("id");
  const selected = list.data?.find((w) => w.id === selectedId);

  return (
    <section>
      <div className="page-header">
        <PageTitle module="maintenance" />
        <button className="primary" onClick={() => setCreating(true)} disabled={archive.readOnly}>
          Ny arbejdsordre
        </button>
      </div>
      <div className="row filters">
        <SearchBox value={q} onChange={setQ} />
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Alle statusser</option>
          {WO_STATUS.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <select aria-label="Type" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Alle typer</option>
          {WO_KIND.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <select aria-label="Mål" value={targetType} onChange={(e) => setTargetType(e.target.value)}>
          <option value="">Alle mål</option>
          {Object.entries(TARGET_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <select aria-label="År" value={year} onChange={(e) => setYear(e.target.value)}>
          <option value="">Alle år</option>
          {years.map((y) => (
            <option key={y}>{y}</option>
          ))}
        </select>
      </div>
      <div className="split">
        <table className="list">
          <thead>
            <tr>
              <th>Titel</th>
              <th>Mål</th>
              <th>Status</th>
              <th>Registreret</th>
              <th>Pris</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((w) => (
              <tr key={String(w.id)} {...rowProps(w.id === selectedId, () => setParams({ id: String(w.id) }))}>
                <td>{String(w.title)}</td>
                <td>{w.target_name ? `${TARGET_LABEL[String(w.target_type)]}: ${w.target_name}` : "–"}</td>
                <td>{optionLabel(WO_STATUS, w.status)}</td>
                <td>{formatDate(w.reported_date as string)}</td>
                <td>{formatMoney(w.cost_minor as number)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <EmptyState module="maintenance" text="Registrér reparationer, service og skader med tilbud, fakturaer og fotos." action="Opret din første arbejdsordre" onAction={() => setCreating(true)} disabled={archive.readOnly} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {selected && <WorkOrderDetail key={String(selected.id)} wo={selected} />}
      </div>
      {creating && <NewWorkOrder onClose={() => setCreating(false)} onCreated={(id) => setParams({ id })} />}
    </section>
  );
}

export function NewWorkOrder({
  onClose,
  onCreated,
  target,
  defaults,
  title = "Ny arbejdsordre",
}: {
  onClose(): void;
  onCreated(id: string): void;
  target?: { type: string; id: string };
  defaults?: Record<string, unknown>;
  title?: string;
}) {
  const session = useSession();
  const [targetType, setTargetType] = useState(target?.type ?? "");
  const [targetId, setTargetId] = useState(target?.id ?? "");
  return (
    <Modal title={title} onClose={onClose} wide>
      {!target && (
        <div className="row">
          <label>
            Gælder
            <select value={targetType} onChange={(e) => (setTargetType(e.target.value), setTargetId(""))}>
              <option value="">Intet bestemt</option>
              {Object.entries(TARGET_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          {targetType && (
            <label>
              {TARGET_LABEL[targetType]}
              <RefSelect type={targetType as never} labelCol={TARGET_LABEL_COL[targetType]!} value={targetId} onChange={setTargetId} />
            </label>
          )}
        </div>
      )}
      <EntityForm
        type="work_order"
        defaults={{ reported_date: session.env.clock.today(), status: "registered", ...defaults }}
        fields={fieldsFor("work_order")}
        fixed={{ target_type: targetType || null, target_id: targetId || null, created_by: session.user.id }}
        submitLabel="Opret"
        onSaved={(r) => {
          onClose();
          onCreated(String(r.id));
        }}
        onCancel={onClose}
        invalidate={[["history"], ["odometer_reading"]]}
      />
    </Modal>
  );
}

function WorkOrderDetail({ wo }: { wo: Row }) {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const id = String(wo.id);
  const [note, setNote] = useState("");
  const events = useQuery({ queryKey: ["work_order", "events", id], queryFn: () => workOrderEvents(session.archive.db, id) });
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["work_order"] });
    await qc.invalidateQueries({ queryKey: ["history"] });
  };
  const setStatus = useMutation({
    mutationFn: (s: WorkOrderStatus) => changeWorkOrderStatus(session.ctx(), id, s, note || null),
    onSuccess: async () => {
      setNote("");
      await refresh();
    },
    onError: (e) => toast(errorText(e), "error"),
  });
  const addNote = useMutation({
    mutationFn: () => addWorkOrderNote(session.ctx(), id, note),
    onSuccess: async () => {
      setNote("");
      await refresh();
    },
  });
  const next = WO_STATUS.filter(([k]) => k !== wo.status);

  return (
    <aside className="detail wide-detail" aria-label="Arbejdsordre">
      <h2>{String(wo.title)}</h2>
      <p>
        <strong>{optionLabel(WO_STATUS, wo.status)}</strong> · {optionLabel(WO_KIND, wo.kind)}
        {wo.target_name ? ` · ${TARGET_LABEL[String(wo.target_type)]}: ${wo.target_name}` : ""}
      </p>
      <Tabs
        tabs={[
          {
            id: "timeline",
            label: "Tidslinje",
            content: () => (
              <div>
                <fieldset disabled={session.archive.readOnly}>
                  <legend>Skift status eller tilføj note</legend>
                  <label>
                    Note
                    <input value={note} onChange={(e) => setNote(e.target.value)} />
                  </label>
                  <div className="row">
                    {next.map(([k, l]) => (
                      <button key={k} onClick={() => setStatus.mutate(k as WorkOrderStatus)}>
                        {l}
                      </button>
                    ))}
                    <button onClick={() => addNote.mutate()} disabled={!note.trim()}>
                      Kun note
                    </button>
                  </div>
                </fieldset>
                <ol className="timeline">
                  {(events.data ?? []).map((e) => (
                    <li key={String(e.id)}>
                      <span className="small muted">{formatDateTime(e.at as string)}</span>{" "}
                      {e.status ? <strong>{optionLabel(WO_STATUS, e.status)}</strong> : null} {e.note ? String(e.note) : ""}
                      {e.user_name ? <span className="small muted"> – {String(e.user_name)}</span> : null}
                    </li>
                  ))}
                </ol>
              </div>
            ),
          },
          { id: "info", label: "Oplysninger", content: () => <EntityForm type="work_order" row={wo} invalidate={[["history"], ["odometer_reading"]]} /> },
          { id: "parts", label: "Reservedele", content: () => <WorkOrderParts wo={wo} /> },
          {
            id: "docs",
            label: "Bilag",
            content: () => <DocumentsTab targetType="work_order" targetId={id} roles={["quote", "invoice", "photo_before", "photo_after", "receipt", "warranty", "contract", "report", "other"]} />,
          },
          ...(wo.kind === "damage" ? [{ id: "claim", label: "Skadesag", content: () => <ClaimPanel wo={wo} /> }] : []),
        ]}
      />
    </aside>
  );
}

/** Damage work orders can be linked to a claim on a policy (spec 04). */
function ClaimPanel({ wo }: { wo: Row }) {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [policyId, setPolicyId] = useState("");
  const claim = useQuery({
    queryKey: ["claim", wo.claim_id],
    queryFn: async () => (wo.claim_id ? (await listEntities(session.archive.db, "claim", { where: { id: String(wo.claim_id) } }))[0] ?? null : null),
  });
  const create = useMutation({
    mutationFn: async () => {
      const c = await createEntity(session.ctx(), "claim", {
        policy_id: policyId,
        incident_date: String(wo.reported_date),
        description: String(wo.description ?? wo.title),
      });
      await updateEntity(session.ctx(), "work_order", String(wo.id), { claim_id: String(c.id) });
    },
    onSuccess: () => qc.invalidateQueries(),
    onError: (e) => toast(errorText(e), "error"),
  });
  if (claim.data) {
    return (
      <div>
        <p>
          Skadesag {claim.data.claim_number ? `nr. ${claim.data.claim_number}` : ""} · {optionLabel(CLAIM_STATUS, claim.data.status)}
        </p>
        <EntityForm type="claim" row={claim.data} />
      </div>
    );
  }
  return (
    <div>
      <Empty>Ingen skadesag endnu.</Empty>
      <div className="row">
        <label>
          Police
          <RefSelect type="policy" labelCol="title" value={policyId} onChange={setPolicyId} />
        </label>
        <button onClick={() => create.mutate()} disabled={!policyId || session.archive.readOnly}>
          Opret skadesag
        </button>
      </div>
    </div>
  );
}
