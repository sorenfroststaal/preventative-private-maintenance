import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  annualAmount,
  coverageSummary,
  createEntity,
  deleteLink,
  generateInsuranceReport,
  listEntities,
  type Row,
} from "@ppm/core";
import { errorText, useSession } from "../app/session";
import { EntityForm, RefSelect } from "../components/EntityForm";
import { DocumentsTab } from "../components/DetailTabs";
import { Empty, Modal, rowProps, Tabs } from "../components/ui";
import { CLAIM_STATUS, optionLabel, POLICY_KIND } from "../lib/entityFields";
import { formatDate, formatMoney } from "../lib/format";
import { useToast } from "../layout/Shell";
import { ArchiveButton } from "../components/ArchiveButton";
import { EmptyState, PageTitle } from "../components/visual";

export function Insurance() {
  const { archive } = useSession();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [report, setReport] = useState(false);
  const list = useQuery({ queryKey: ["policy", "list"], queryFn: () => listEntities(archive.db, "policy", { orderBy: "title" }) });
  const total = (list.data ?? []).reduce((a, p) => a + (annualAmount(p.premium_minor as number, p.premium_period as string) ?? 0), 0);
  const selectedId = params.get("id");
  const selected = list.data?.find((p) => p.id === selectedId);
  return (
    <section>
      <div className="page-header">
        <PageTitle module="insurance" />
        <div className="row">
          <button onClick={() => setReport(true)}>Forsikringsrapport…</button>
          <button className="primary" onClick={() => setCreating(true)} disabled={archive.readOnly}>
            Ny police
          </button>
        </div>
      </div>
      <div className="split">
        <table className="list">
          <thead>
            <tr>
              <th>Police</th>
              <th>Type</th>
              <th className="num">Præmie pr. år</th>
              <th>Fornyelse</th>
              <th className="num">Selvrisiko</th>
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((p) => (
              <tr key={String(p.id)} {...rowProps(p.id === selectedId, () => setParams({ id: String(p.id) }))}>
                <td>{String(p.title)}</td>
                <td>{optionLabel(POLICY_KIND, p.kind)}</td>
                <td className="num">{formatMoney(annualAmount(p.premium_minor as number, p.premium_period as string))}</td>
                <td>{formatDate(p.renewal_date as string)}</td>
                <td className="num">{formatMoney(p.deductible_minor as number)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>Samlet præmie pr. år</td>
              <td className="num">
                <strong>{formatMoney(total)}</strong>
              </td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
        {selected && <PolicyDetail key={String(selected.id)} policy={selected} />}
      </div>
      {list.data?.length === 0 && <EmptyState module="insurance" text="Saml policer med præmie, dækning og fornyelse, så du kan se, om noget er underforsikret." action="Opret din første police" onAction={() => setCreating(true)} disabled={archive.readOnly} />}
      {creating && (
        <Modal title="Ny police" onClose={() => setCreating(false)} wide>
          <EntityForm
            type="policy"
            onSaved={(r) => {
              setCreating(false);
              setParams({ id: String(r.id) });
            }}
            onCancel={() => setCreating(false)}
          />
        </Modal>
      )}
      {report && <ReportDialog onClose={() => setReport(false)} initialPolicy={selectedId ?? ""} />}
    </section>
  );
}

function PolicyDetail({ policy }: { policy: Row }) {
  const id = String(policy.id);
  return (
    <aside className="detail wide-detail" aria-label="Police">
      <div className="header-row">
        <h2>{String(policy.title)}</h2>
        <ArchiveButton type="policy" id={id} label="Policen" />
      </div>
      <Tabs
        tabs={[
          { id: "cov", label: "Dækning", content: () => <Coverage policyId={id} /> },
          { id: "claims", label: "Skadesager", content: () => <Claims policyId={id} /> },
          { id: "docs", label: "Dokumenter", content: () => <DocumentsTab targetType="policy" targetId={id} roles={["policy_terms", "letter", "invoice", "other"]} /> },
          { id: "info", label: "Oplysninger", content: () => <EntityForm type="policy" row={policy} /> },
        ]}
      />
    </aside>
  );
}

const COVER_TYPES: [string, string, string][] = [
  ["property", "Bolig", "name"],
  ["item", "Genstand", "name"],
  ["vehicle", "Bil", "name"],
  ["person", "Person", "name"],
];

function Coverage({ policyId }: { policyId: string }) {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [type, setType] = useState("property");
  const [target, setTarget] = useState("");
  const covered = useQuery({
    queryKey: ["policy_coverage", policyId],
    queryFn: () =>
      session.archive.db.select<Row>(
        `SELECT c.*, COALESCE(p.name, i.name, v.name, pe.name) AS name FROM policy_coverage c
           LEFT JOIN property p ON c.target_type = 'property' AND p.id = c.target_id
           LEFT JOIN item i ON c.target_type = 'item' AND i.id = c.target_id
           LEFT JOIN vehicle v ON c.target_type = 'vehicle' AND v.id = c.target_id
           LEFT JOIN person pe ON c.target_type = 'person' AND pe.id = c.target_id
          WHERE c.policy_id = ?`,
        [policyId],
      ),
  });
  const summary = useQuery({ queryKey: ["policy_coverage", "summary", policyId], queryFn: () => coverageSummary(session.archive.db, policyId) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["policy_coverage"] }).then(() => qc.invalidateQueries({ queryKey: ["policy"] }));
  const add = useMutation({
    mutationFn: () => createEntity(session.ctx(), "policy_coverage", { policy_id: policyId, target_type: type as never, target_id: target }),
    onSuccess: async () => {
      setTarget("");
      await refresh();
    },
    onError: (e) => toast(errorText(e), "error"),
  });
  const remove = useMutation({
    mutationFn: (c: Row) => deleteLink(session.ctx(), "policy_coverage", c),
    onSuccess: refresh,
  });
  return (
    <div>
      {summary.data && (
        <div className={summary.data.underinsured ? "warning" : "panel"}>
          <p>
            Dækkede genstande: {summary.data.items} · Samlet købspris {formatMoney(summary.data.items_value_minor)} · Dækningssum{" "}
            {formatMoney(summary.data.coverage_sum_minor)}
          </p>
          {summary.data.underinsured && <p role="alert">Den samlede købspris er større end dækningssummen. Du kan være underforsikret.</p>}
        </div>
      )}
      <ul className="plain">
        {(covered.data ?? []).map((c) => (
          <li key={`${c.target_type}:${c.target_id}`} className="line">
            <span>{String(c.name ?? "?")}</span>
            <span className="muted">{COVER_TYPES.find(([k]) => k === c.target_type)?.[1]}</span>
            <button className="link" onClick={() => remove.mutate(c)}>
              Fjern
            </button>
          </li>
        ))}
      </ul>
      <div className="row">
        <label>
          Dækker
          <select value={type} onChange={(e) => (setType(e.target.value), setTarget(""))}>
            {COVER_TYPES.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          Hvad
          <RefSelect type={type as never} labelCol="name" value={target} onChange={setTarget} />
        </label>
        <button onClick={() => add.mutate()} disabled={!target || session.archive.readOnly}>
          Tilføj dækning
        </button>
      </div>
      <p className="small muted">Genstande i en dækket bolig regnes med automatisk.</p>
    </div>
  );
}

function Claims({ policyId }: { policyId: string }) {
  const { archive } = useSession();
  const [key, setKey] = useState(0);
  const q = useQuery({ queryKey: ["claim", policyId], queryFn: () => listEntities(archive.db, "claim", { where: { policy_id: policyId }, orderBy: "incident_date", desc: true }) });
  return (
    <div>
      <ul className="plain">
        {(q.data ?? []).map((c) => (
          <li key={String(c.id)} className="line">
            <span>
              {formatDate(c.incident_date as string)} · {String(c.description)}
            </span>
            <span className="muted">{optionLabel(CLAIM_STATUS, c.status)}</span>
            <span>{formatMoney(c.payout_minor as number)}</span>
          </li>
        ))}
      </ul>
      {q.data?.length === 0 && <Empty>Ingen skadesager.</Empty>}
      <EntityForm key={key} type="claim" fixed={{ policy_id: policyId }} title="Ny skadesag" invalidate={[["claim"]]} onSaved={() => setKey((k) => k + 1)} />
    </div>
  );
}

/** Insurance report dialog (spec 05). */
export function ReportDialog({ onClose, initialPolicy = "" }: { onClose(): void; initialPolicy?: string }) {
  const session = useSession();
  const toast = useToast();
  const [propertyId, setPropertyId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [policyId, setPolicyId] = useState(initialPolicy);
  const [archived, setArchived] = useState(false);
  const [attachments, setAttachments] = useState(true);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const r = await generateInsuranceReport(
        session.env,
        session.archive,
        { propertyId: propertyId || null, locationId: locationId || null, policyId: policyId || null, includeArchived: archived, includeAttachments: attachments },
        { today: session.env.clock.today() },
      );
      const name = `forsikringsrapport-${session.env.clock.today().replace(/-/g, "")}.pdf`;
      const path = session.archive.path("eksport", name);
      await session.env.fs.writeFile(path, r.bytes);
      toast(`Rapport gemt (${r.items} genstande, ${formatMoney(r.totalMinor)}): ${path}`);
      onClose();
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Forsikringsrapport" onClose={onClose}>
      <p className="small muted">Liste over genstande med fotos, købspris, dato og kvitteringer – fx til forsikringsselskabet efter indbrud eller brand.</p>
      <label>
        Bolig
        <RefSelect type="property" labelCol="name" value={propertyId} onChange={setPropertyId} emptyLabel="Alle" />
      </label>
      <label>
        Lokation
        <RefSelect type="location" labelCol="name" value={locationId} onChange={setLocationId} emptyLabel="Alle" />
      </label>
      <label>
        Police
        <RefSelect type="policy" labelCol="title" value={policyId} onChange={setPolicyId} emptyLabel="Alle" />
      </label>
      <label className="inline">
        <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Medtag arkiverede genstande
      </label>
      <label className="inline">
        <input type="checkbox" checked={attachments} onChange={(e) => setAttachments(e.target.checked)} /> Vedlæg kvitteringer som bilag
      </label>
      <button className="primary" onClick={run} disabled={busy}>
        {busy ? "Danner rapport…" : "Dan rapport"}
      </button>
      <p className="small muted">Rapporten gemmes i arkivets eksport-mappe og dannes helt lokalt.</p>
    </Modal>
  );
}
