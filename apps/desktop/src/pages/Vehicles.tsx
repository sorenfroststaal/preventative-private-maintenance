import { useState } from "react";
import { RowThumb, useThumbnails } from "../components/RowThumb";
import { Car } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { latestOdometer, listEntities, loanSummary, recurringLoanOverlaps, recurringSummary, vehicleCostsByYear, vehiclesWithKm, type Row } from "@ppm/core";
import { useSession } from "../app/session";
import { EntityForm } from "../components/EntityForm";
import { DocumentsTab, HistoryTab, TasksTab } from "../components/DetailTabs";
import { Empty, Modal, rowProps, Tabs } from "../components/ui";
import { formatDate, formatMoney } from "../lib/format";
import { NewWorkOrder } from "./WorkOrders";
import { ArchiveButton } from "../components/ArchiveButton";
import { attachPending, PendingAttachments, PhotoStrip, type PendingFile } from "../components/Attachments";
import { useToast } from "../layout/Shell";
import { EmptyState, PageTitle } from "../components/visual";

export function Vehicles() {
  const session = useSession();
  const { archive } = session;
  const qc = useQueryClient();
  const toast = useToast();
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const list = useQuery({
    queryKey: ["vehicle", "list"],
    queryFn: () => vehiclesWithKm(archive.db),
  });
  const selectedId = params.get("id");
  const selected = list.data?.find((v) => v.id === selectedId);
  const thumbs = useThumbnails("vehicle");
  return (
    <section>
      <div className="page-header">
        <PageTitle module="vehicle" />
        <button className="primary" onClick={() => setCreating(true)} disabled={archive.readOnly}>
          Ny bil
        </button>
      </div>
      <div className="split">
        <table className="list">
          <thead>
            <tr>
              <th>Navn</th>
              <th>Nummerplade</th>
              <th>Km</th>
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((v) => (
              <tr key={String(v.id)} {...rowProps(v.id === selectedId, () => setParams({ id: String(v.id) }))}>
                <td>
                  <span className="with-thumb">
                    <RowThumb doc={thumbs?.get(String(v.id))} icon={Car} />
                    <span className="text">{String(v.name)}</span>
                  </span>
                </td>
                <td>{String(v.registration ?? "–")}</td>
                <td>{v.km ? Number(v.km).toLocaleString("da-DK") : "–"}</td>
              </tr>
            ))}
            {list.data?.length === 0 && (
              <tr>
                <td colSpan={3}>
                  <EmptyState module="vehicle" text="Registrér bilen for at få servicebog, km-stand og påmindelser om syn og dækskifte." action="Opret din første bil" onAction={() => setCreating(true)} disabled={archive.readOnly} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {selected && <VehicleDetail key={String(selected.id)} vehicle={selected} />}
      </div>
      {creating && (
        <Modal title="Ny bil" onClose={() => setCreating(false)} wide>
          <EntityForm
            type="vehicle"
            renderAfter={(key) => (key === "notes" ? <PendingAttachments value={pending} onChange={setPending} receipt={false} /> : null)}
            onSaved={async (r) => {
              const res = await attachPending(session, "vehicle", String(r.id), pending);
              for (const e of res.errors) toast(e, "error");
              await qc.invalidateQueries({ queryKey: ["documents"] });
              setPending([]);
              setCreating(false);
              setParams({ id: String(r.id), tab: "tasks" });
            }}
            onCancel={() => setCreating(false)}
          />
          <p className="small muted">Efter oprettelsen får du forslag til dækskifte, service og syn under fanen Opgaver.</p>
        </Modal>
      )}
    </section>
  );
}

function VehicleDetail({ vehicle }: { vehicle: Row }) {
  const [params] = useSearchParams();
  const id = String(vehicle.id);
  return (
    <aside className="detail wide-detail" aria-label="Bil">
      <div className="header-row">
        <h2>{String(vehicle.name)}</h2>
        <ArchiveButton type="vehicle" id={id} label="Bilen" />
      </div>
      <PhotoStrip targetType="vehicle" targetId={id} />
      <Tabs
        initial={params.get("tab") ?? undefined}
        tabs={[
          { id: "service", label: "Servicebog", content: () => <ServiceBook vehicleId={id} /> },
          { id: "km", label: "Km-stand", content: () => <Odometer vehicleId={id} /> },
          { id: "cost", label: "Driftsomkostninger", content: () => <Costs vehicleId={id} /> },
          { id: "tasks", label: "Opgaver", content: () => <TasksTab targetType="vehicle" targetId={id} module="Bil" /> },
          { id: "docs", label: "Bilag", content: () => <DocumentsTab targetType="vehicle" targetId={id} /> },
          { id: "info", label: "Oplysninger", content: () => <EntityForm type="vehicle" row={vehicle} /> },
        ]}
      />
    </aside>
  );
}

function ServiceBook({ vehicleId }: { vehicleId: string }) {
  const { archive } = useSession();
  const [creating, setCreating] = useState(false);
  const [, setParams] = useSearchParams();
  return (
    <div>
      <button onClick={() => setCreating(true)} disabled={archive.readOnly}>
        Registrér service/reparation
      </button>
      <HistoryTab targetType="vehicle" targetId={vehicleId} />
      {creating && (
        <NewWorkOrder
          target={{ type: "vehicle", id: vehicleId }}
          onClose={() => setCreating(false)}
          onCreated={() => setParams({ id: vehicleId, tab: "service" })}
        />
      )}
    </div>
  );
}

function Odometer({ vehicleId }: { vehicleId: string }) {
  const { archive } = useSession();
  const [key, setKey] = useState(0);
  const list = useQuery({
    queryKey: ["odometer_reading", vehicleId],
    queryFn: () => listEntities(archive.db, "odometer_reading", { where: { vehicle_id: vehicleId }, orderBy: "reading_date", desc: true }),
  });
  const latest = useQuery({ queryKey: ["odometer_reading", "latest", vehicleId], queryFn: () => latestOdometer(archive.db, vehicleId) });
  return (
    <div>
      {latest.data && (
        <p>
          Seneste: <strong>{Number(latest.data.km).toLocaleString("da-DK")} km</strong> ({formatDate(latest.data.reading_date as string)})
        </p>
      )}
      <ul className="plain">
        {(list.data ?? []).map((r) => (
          <li key={String(r.id)} className="line">
            <span>{formatDate(r.reading_date as string)}</span>
            <span>{Number(r.km).toLocaleString("da-DK")} km</span>
            <span className="muted">{r.source === "work_order" ? "Fra arbejdsordre" : "Manuel"}</span>
          </li>
        ))}
      </ul>
      {list.data?.length === 0 && <Empty>Ingen km-stand registreret.</Empty>}
      <EntityForm key={key} type="odometer_reading" fixed={{ vehicle_id: vehicleId, source: "manual" }} title="Ny km-stand" submitLabel="Gem" onSaved={() => setKey((k) => k + 1)} />
    </div>
  );
}

function Costs({ vehicleId }: { vehicleId: string }) {
  const { archive, env } = useSession();
  const q = useQuery({ queryKey: ["work_order", "costs", vehicleId], queryFn: () => vehicleCostsByYear(archive.db, vehicleId) });
  const rec = useQuery({ queryKey: ["recurring_expense", "vehicle", vehicleId], queryFn: () => recurringSummary(archive.db, { vehicleId, today: env.clock.today() }) });
  const loans = useQuery({ queryKey: ["loan", "vehicle", vehicleId], queryFn: () => loanSummary(archive.db, { vehicleId }) });
  const overlaps = useQuery({ queryKey: ["recurring_expense", "loan-overlap", vehicleId], queryFn: () => recurringLoanOverlaps(archive.db, { vehicleId, today: env.clock.today() }) });
  // Only a recurring expense with the loan's monthly amount is the same payment and counted once (review B2).
  const doubled = new Map((overlaps.data ?? []).filter((o) => o.match === "amount").map((o) => [o.recurring_id, o.loan_name]));
  const similar = new Map((overlaps.data ?? []).filter((o) => o.match === "name").map((o) => [o.recurring_id, o.loan_name]));
  const fixed = (rec.data?.items ?? []).filter((r) => !r.ended);
  // A recurring expense that is the loan's payment is only counted once (review B2).
  const fixedTotal = fixed.filter((r) => !doubled.has(String(r.id))).reduce((a, r) => a + r.monthly_minor, 0);
  return (
    <div>
      {(fixed.length > 0 || (loans.data?.items.length ?? 0) > 0) && (
        <div className="panel">
          <h3>Faste udgifter og lån for bilen</h3>
          <ul className="plain">
            {fixed.map((r) => (
              <li key={String(r.id)} className="line">
                <span>
                  {String(r.name)}
                  {doubled.has(String(r.id)) && <span className="small muted"> (samme beløb som lånet {doubled.get(String(r.id))}; tælles kun én gang)</span>}
                  {similar.has(String(r.id)) && <span className="small warning-text"> (ligner lånet {similar.get(String(r.id))}; tjek, at den ikke er registreret to gange)</span>}
                </span>
                <span className="num">
                  {r.amount_variable ? "ca. " : ""}
                  {formatMoney(r.monthly_minor)} pr. måned
                </span>
              </li>
            ))}
            {(loans.data?.items ?? []).map((l) => (
              <li key={String(l.id)} className="line">
                <span>{String(l.name)} (lån)</span>
                <span className="num">{formatMoney(l.monthly_payment_minor)} pr. måned · restgæld {formatMoney(l.balance_minor as number)}</span>
              </li>
            ))}
          </ul>
          <p className="small">
            I alt pr. måned: <strong>{formatMoney(fixedTotal + (loans.data?.monthly_payment_total_minor ?? 0))}</strong>
          </p>
        </div>
      )}
      {q.data?.length === 0 && <Empty>Ingen arbejdsordrer eller koblede posteringer endnu.</Empty>}
      {(q.data?.length ?? 0) > 0 && (
      <table className="list">
        <thead>
          <tr>
            <th>År</th>
            <th>Arbejdsordrer</th>
            <th>Koblede posteringer</th>
            <th>I alt</th>
          </tr>
        </thead>
        <tbody>
          {(q.data ?? []).map((y) => (
            <tr key={y.year}>
              <td>{y.year}</td>
              <td>{formatMoney(y.work_orders_minor)}</td>
              <td>{formatMoney(y.transactions_minor)}</td>
              <td>
                <strong>{formatMoney(y.total_minor)}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      )}
      <p className="small muted">
        Faste udgifter og lån kobles til bilen i deres formular under <Link to="/okonomi">Økonomi</Link>, og det samme gælder posteringer.
      </p>
    </div>
  );
}
