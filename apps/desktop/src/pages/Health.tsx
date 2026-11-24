import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { healthPersons, healthRecords, type HealthTable, type Row } from "@ppm/core";
import { errorText, useSession } from "../app/session";
import { EntityForm } from "../components/EntityForm";
import { DocumentsTab } from "../components/DetailTabs";
import { Empty, Modal, Tabs } from "../components/ui";
import { fieldsFor, optionLabel } from "../lib/entityFields";
import { formatDate, formatDateTime } from "../lib/format";

const TABS: { id: HealthTable; label: string; columns: string[] }[] = [
  { id: "health_visit", label: "Besøg", columns: ["visit_date", "kind", "reason", "notes"] },
  { id: "health_screening", label: "Screeninger", columns: ["name", "screening_date", "result", "next_due_date"] },
  { id: "health_vaccination", label: "Vaccinationer", columns: ["vaccine", "dose", "given_date", "next_due_date"] },
  { id: "health_medication", label: "Medicin", columns: ["name", "strength", "dosage", "start_date", "end_date", "prescription_renewal_date"] },
  { id: "health_allergy", label: "Allergier", columns: ["substance", "reaction", "severity"] },
  { id: "health_measurement", label: "Målinger", columns: ["type", "value", "unit", "measured_at"] },
];

export function Health() {
  const session = useSession();
  const persons = useQuery({ queryKey: ["person", "health", session.user.id], queryFn: () => healthPersons(session.archive.db, session.user.id) });
  const [params] = useSearchParams();
  const [personId, setPersonId] = useState(params.get("person") ?? "");
  const current = persons.data?.find((p) => p.id === personId) ?? persons.data?.[0];
  return (
    <section>
      <h1>Helbred</h1>
      <p className="notice">Dine egne noter og påmindelser. Erstatter ikke journal eller rådgivning fra sundhedspersonale.</p>
      <div className="row">
        <label className="inline-label">
          Person
          <select value={String(current?.id ?? "")} onChange={(e) => setPersonId(e.target.value)}>
            {(persons.data ?? []).map((p) => (
              <option key={String(p.id)} value={String(p.id)}>
                {String(p.name)}
                {p.health_private_user_id ? " (privat)" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      {current?.health_private_user_id ? (
        <p className="small muted">
          Helbredsdata for {String(current.name)} vises kun for dig. Det er ikke en sikkerhedsgrænse, fordi arkivet ikke er krypteret.
        </p>
      ) : null}
      {current && (
        <Tabs
          key={String(current.id)}
          tabs={TABS.map((t) => ({ id: t.id, label: t.label, content: () => <HealthTab table={t.id} columns={t.columns} personId={String(current.id)} /> }))}
        />
      )}
      {persons.data?.length === 0 && <Empty>Ingen personer. Opret personer under Indstillinger.</Empty>}
    </section>
  );
}

function cell(table: HealthTable, key: string, v: unknown): string {
  const f = fieldsFor(table).find((x) => x.key === key);
  if (!f) return String(v ?? "–");
  if (f.type === "date") return formatDate(v as string);
  if (f.type === "datetime") return formatDateTime(v as string);
  if (f.type === "select") return optionLabel(f.options!, v);
  if (typeof v === "number") return v.toLocaleString("da-DK");
  return String(v ?? "–");
}

function HealthTab({ table, columns, personId }: { table: HealthTable; columns: string[]; personId: string }) {
  const session = useSession();
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const q = useQuery({ queryKey: [table, personId, session.user.id], queryFn: () => healthRecords(session.archive.db, table, personId, session.user.id) });
  const labels = Object.fromEntries(fieldsFor(table).map((f) => [f.key, f.label]));
  if (q.error) return <p className="error">{errorText(q.error)}</p>;
  return (
    <div>
      <button className="primary" onClick={() => setEditing("new")} disabled={session.archive.readOnly}>
        Tilføj
      </button>
      {table === "health_measurement" && q.data && q.data.length > 0 && <MeasurementCharts rows={q.data} />}
      <table className="list">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>{labels[c] ?? c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(q.data ?? []).map((r) => (
            <tr key={String(r.id)} tabIndex={0} onClick={() => setEditing(r)} onKeyDown={(e) => e.key === "Enter" && setEditing(r)}>
              {columns.map((c) => (
                <td key={c}>{cell(table, c, r[c])}</td>
              ))}
            </tr>
          ))}
          {q.data?.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="muted">
                Intet registreret.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {editing && (
        <Modal title={editing === "new" ? "Tilføj" : "Redigér"} onClose={() => setEditing(null)} wide>
          <EntityForm
            type={table}
            row={editing === "new" ? null : editing}
            fixed={{ person_id: personId }}
            defaults={table === "health_measurement" ? { measured_at: session.env.clock.nowIso() } : undefined}
            onSaved={() => setEditing(null)}
            onCancel={() => setEditing(null)}
          />
          {editing !== "new" && (table === "health_visit" || table === "health_screening" || table === "health_vaccination" || table === "health_medication") && (
            <>
              <h3>Dokumenter</h3>
              <DocumentsTab targetType={table} targetId={String(editing.id)} roles={["letter", "report", "other"]} />
            </>
          )}
        </Modal>
      )}
    </div>
  );
}

/** Simple SVG line chart per measurement type (spec 04). */
function MeasurementCharts({ rows }: { rows: Row[] }) {
  const byType = new Map<string, Row[]>();
  for (const r of rows) byType.set(String(r.type), [...(byType.get(String(r.type)) ?? []), r]);
  return (
    <div className="charts">
      {[...byType.entries()].map(([type, list]) => {
        const pts = [...list].sort((a, b) => String(a.measured_at).localeCompare(String(b.measured_at)));
        const vals = pts.map((p) => Number(p.value));
        const min = Math.min(...vals);
        const max = Math.max(...vals);
        const w = 320;
        const h = 90;
        const span = max - min || 1;
        const path = pts
          .map((p, i) => {
            const x = pts.length === 1 ? w / 2 : 10 + (i * (w - 20)) / (pts.length - 1);
            const y = h - 10 - ((Number(p.value) - min) / span) * (h - 20);
            return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(" ");
        return (
          <figure key={type} className="chart">
            <figcaption>
              {type} ({String(pts[0]?.unit ?? "")}) · {min.toLocaleString("da-DK")}–{max.toLocaleString("da-DK")}
            </figcaption>
            <svg width={w} height={h} role="img" aria-label={`Udvikling i ${type}`}>
              <path d={path} fill="none" stroke="currentColor" strokeWidth="2" />
              {path.split(/[ML]/).filter(Boolean).map((xy, i) => {
                const [x, y] = xy.split(",").map(Number);
                return <circle key={i} cx={x} cy={y} r="3" fill="currentColor" />;
              })}
            </svg>
          </figure>
        );
      })}
    </div>
  );
}
