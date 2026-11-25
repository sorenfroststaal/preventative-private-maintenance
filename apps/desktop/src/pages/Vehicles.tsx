import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { latestOdometer, listEntities, vehicleCostsByYear, type Row } from "@ppm/core";
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
    queryFn: () =>
      archive.db.select<Row>(
        `SELECT v.*, (SELECT km FROM odometer_reading r WHERE r.vehicle_id = v.id ORDER BY reading_date DESC, km DESC LIMIT 1) AS km
           FROM vehicle v WHERE v.archived_at IS NULL ORDER BY v.name`,
      ),
  });
  const selectedId = params.get("id");
  const selected = list.data?.find((v) => v.id === selectedId);
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
                <td>{String(v.name)}</td>
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
  const { archive } = useSession();
  const q = useQuery({ queryKey: ["work_order", "costs", vehicleId], queryFn: () => vehicleCostsByYear(archive.db, vehicleId) });
  if (q.data?.length === 0) return <Empty>Ingen udgifter registreret.</Empty>;
  return (
    <div>
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
      <p className="small muted">
        Posteringer kobles til bilen under <Link to="/okonomi">Økonomi</Link>.
      </p>
    </div>
  );
}
