import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { addMonths, archiveEntity, listEntities, policiesForItem, type Row } from "@ppm/core";
import { errorText, useSession } from "../app/session";
import { EntityForm } from "../components/EntityForm";
import { DocumentsTab, HistoryTab, TasksTab } from "../components/DetailTabs";
import { Empty, includesText, Modal, rowProps, SearchBox, Tabs } from "../components/ui";
import { formatDate, formatMoney } from "../lib/format";
import { annualAmount } from "@ppm/core";
import { useToast } from "../layout/Shell";
import { ArchiveButton } from "../components/ArchiveButton";
import { EmptyState, PageHeader } from "../components/visual";
import { attachPending, PendingAttachments, PhotoStrip, type PendingFile } from "../components/Attachments";

export function Home() {
  const [params, setParams] = useSearchParams();
  const active = params.get("tab") ?? (params.get("part") ? "parts" : params.get("pet") ? "pets" : "items");
  return (
    <section>
      <PageHeader module="home" />
      <Tabs
        active={active}
        onChange={(tab) => setParams({ tab })}
        tabs={[
          { id: "items", label: "Genstande", content: () => <Items /> },
          { id: "property", label: "Boliger og rum", content: () => <Properties /> },
          { id: "parts", label: "Bygningsdele", content: () => <BuildingParts /> },
          { id: "pets", label: "Husdyr", content: () => <Pets /> },
        ]}
      />
    </section>
  );
}

function useLocations() {
  const { archive } = useSession();
  return useQuery({
    queryKey: ["location", "withProperty"],
    queryFn: () =>
      archive.db.select<{ id: string; name: string; property_id: string; property_name: string }>(
        `SELECT l.id, l.name, l.property_id, p.name AS property_name FROM location l JOIN property p ON p.id = l.property_id
          WHERE l.archived_at IS NULL ORDER BY p.name, l.name`,
      ),
  });
}

function Items() {
  const { archive } = useSession();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [loc, setLoc] = useState("");
  const [creating, setCreating] = useState(false);
  const items = useQuery({ queryKey: ["item", "list"], queryFn: () => listEntities(archive.db, "item", { orderBy: "name" }) });
  const locations = useLocations();
  const locName = useMemo(() => new Map((locations.data ?? []).map((l) => [l.id, `${l.name}`])), [locations.data]);
  const photos = useQuery({
    queryKey: ["documents", "itemPhotos"],
    queryFn: () =>
      archive.db.select<{ target_id: string; n: number }>(
        "SELECT target_id, count(*) AS n FROM document_link WHERE target_type = 'item' AND role IN ('receipt', 'invoice') GROUP BY target_id",
      ),
  });
  const hasReceipt = new Set((photos.data ?? []).map((p) => p.target_id));
  const rows = (items.data ?? []).filter((i) => (!loc || i.location_id === loc) && includesText(i, ["name", "brand", "model", "serial_number", "category"], q));
  const selectedId = params.get("id");
  const selected = items.data?.find((i) => i.id === selectedId) ?? null;

  return (
    <>
      <div className="row filters">
        <SearchBox value={q} onChange={setQ} placeholder="Søg i genstande" />
        <select aria-label="Placering" value={loc} onChange={(e) => setLoc(e.target.value)}>
          <option value="">Alle placeringer</option>
          {(locations.data ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.property_name} › {l.name}
            </option>
          ))}
        </select>
        <button className="primary" onClick={() => setCreating(true)} disabled={archive.readOnly}>
          Ny genstand
        </button>
      </div>
      <div className="split">
        <table className="list">
          <thead>
            <tr>
              <th>Navn</th>
              <th>Placering</th>
              <th>Købt</th>
              <th>Pris</th>
              <th>Kvittering</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={String(i.id)} {...rowProps(i.id === selectedId, () => setParams({ id: String(i.id) }))}>
                <td>{String(i.name)}</td>
                <td>{locName.get(String(i.location_id)) ?? "–"}</td>
                <td>{formatDate(i.purchase_date as string)}</td>
                <td>{formatMoney(i.purchase_price_minor as number)}</td>
                <td>{hasReceipt.has(String(i.id)) ? "Ja" : <span className="muted">Nej</span>}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <EmptyState module="home" text="Hold styr på genstande med kvitteringer, garantier og reklamationsret." action="Opret din første genstand" onAction={() => setCreating(true)} disabled={archive.readOnly} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {selected && <ItemDetail key={String(selected.id)} item={selected} onArchived={() => setParams({})} />}
      </div>
      {creating && <NewItem onClose={() => setCreating(false)} onCreated={(id) => setParams({ id })} />}
    </>
  );
}

/** "Ny genstand" with photos and receipt chosen before saving (imported after the item exists). */
function NewItem({ onClose, onCreated }: { onClose(): void; onCreated(id: string): void }) {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [pending, setPending] = useState<PendingFile[]>([]);
  return (
    <Modal title="Ny genstand" onClose={onClose} wide>
      <EntityForm
        type="item"
        renderAfter={(key, values, set) =>
          key === "notes" ? <PendingAttachments value={pending} onChange={setPending} /> : complaintSuggestion(key, values, set)
        }
        onSaved={async (r) => {
          const res = await attachPending(session, "item", String(r.id), pending);
          for (const e of res.errors) toast(e, "error");
          await qc.invalidateQueries({ queryKey: ["documents"] });
          await qc.invalidateQueries({ queryKey: ["dashboard"] });
          onClose();
          onCreated(String(r.id));
        }}
        onCancel={onClose}
      />
    </Modal>
  );
}

/** Spec 03: suggest purchase_date + 24 months, never saved without being shown. */
function complaintSuggestion(key: string, values: Record<string, string>, set: (k: string, v: string) => void) {
  if (key !== "complaint_until" || values.complaint_until || !values.purchase_date) return null;
  const suggestion = addMonths(values.purchase_date, 24);
  return (
    <div className="suggestion small">
      <button type="button" className="link" onClick={() => set("complaint_until", suggestion)}>
        Brug forslag: {formatDate(suggestion)}
      </button>
      <div className="muted">Forslag ud fra 2 års reklamationsret ved forbrugerkøb. Kontrollér dine egne vilkår.</div>
    </div>
  );
}

function ItemDetail({ item, onArchived }: { item: Row; onArchived(): void }) {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const archive = useMutation({
    mutationFn: () => archiveEntity(session.ctx(), "item", String(item.id)),
    onSuccess: async () => {
      await qc.invalidateQueries();
      toast("Genstanden er arkiveret");
      onArchived();
    },
    onError: (e) => toast(errorText(e), "error"),
  });
  const id = String(item.id);
  return (
    <aside className="detail wide-detail" aria-label="Genstand">
      <div className="header-row">
        <h2>{String(item.name)}</h2>
        <button className="link" onClick={() => archive.mutate()} disabled={session.archive.readOnly}>
          Arkivér
        </button>
      </div>
      <PhotoStrip targetType="item" targetId={id} />
      <Tabs
        tabs={[
          { id: "info", label: "Oplysninger", content: () => <EntityForm type="item" row={item} renderAfter={complaintSuggestion} /> },
          { id: "docs", label: "Bilag", content: () => <DocumentsTab targetType="item" targetId={id} /> },
          { id: "parts", label: "Reservedele", content: () => <Parts itemId={id} /> },
          { id: "ins", label: "Forsikring", content: () => <ItemPolicies itemId={id} /> },
          { id: "hist", label: "Historik", content: () => <HistoryTab targetType="item" targetId={id} /> },
          { id: "tasks", label: "Opgaver", content: () => <TasksTab targetType="item" targetId={id} module="Bolig og inventar" /> },
        ]}
      />
    </aside>
  );
}

function Parts({ itemId }: { itemId: string }) {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const parts = useQuery({ queryKey: ["item_part", itemId], queryFn: () => listEntities(session.archive.db, "item_part", { where: { item_id: itemId }, orderBy: "name" }) });
  const [key, setKey] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingFile[]>([]);
  return (
    <div>
      {parts.data?.length === 0 && <Empty>Ingen reservedele registreret.</Empty>}
      <ul className="plain">
        {(parts.data ?? []).map((p) => {
          const id = String(p.id);
          const isOpen = open === id;
          return (
            <li key={id} className="part-row">
              <button className="part-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : id)}>
                <span>{String(p.name)}</span>
                <span className="muted">{String(p.part_number ?? "")}</span>
                <span className="muted">{String(p.vendor ?? "")}</span>
              </button>
              {isOpen && (
                <div className="part-body">
                  <PhotoStrip targetType="item_part" targetId={id} />
                  <EntityForm type="item_part" row={p} fixed={{ item_id: itemId }} invalidate={[["item_part", itemId]]} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <EntityForm
        key={key}
        type="item_part"
        fixed={{ item_id: itemId }}
        title="Tilføj reservedel"
        submitLabel="Tilføj"
        renderAfter={(k) => (k === "notes" ? <PendingAttachments value={pending} onChange={setPending} receipt={false} /> : null)}
        onSaved={async (r) => {
          const res = await attachPending(session, "item_part", String(r.id), pending);
          for (const e of res.errors) toast(e, "error");
          await qc.invalidateQueries({ queryKey: ["documents"] });
          setPending([]);
          setKey((k) => k + 1);
        }}
      />
    </div>
  );
}

function ItemPolicies({ itemId }: { itemId: string }) {
  const { archive } = useSession();
  const q = useQuery({ queryKey: ["policy", "forItem", itemId], queryFn: () => policiesForItem(archive.db, itemId) });
  if (q.data?.length === 0) return <Empty>Ingen police dækker genstanden. Tilføj dækning under Forsikring.</Empty>;
  return (
    <ul className="plain">
      {(q.data ?? []).map((p) => (
        <li key={String(p.id)} className="line">
          <span>{String(p.title)}</span>
          <span className="muted">Selvrisiko {formatMoney(p.deductible_minor as number)}</span>
          <span className="muted">{formatMoney(annualAmount(p.premium_minor as number, p.premium_period as string))}/år</span>
        </li>
      ))}
    </ul>
  );
}

function Properties() {
  const { archive } = useSession();
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const [newLoc, setNewLoc] = useState<string | null>(null);
  const props = useQuery({ queryKey: ["property", "list"], queryFn: () => listEntities(archive.db, "property", { orderBy: "name" }) });
  const locations = useLocations();
  return (
    <div>
      <button className="primary" onClick={() => setEditing("new")} disabled={archive.readOnly}>
        Ny bolig
      </button>
      {(props.data ?? []).map((p) => (
        <div key={String(p.id)} className="panel">
          <div className="header-row">
            <h3>{String(p.name)}</h3>
            <span className="row tight">
              <button className="link" onClick={() => setEditing(p)}>
                Redigér
              </button>
              <ArchiveButton type="property" id={String(p.id)} label="Boligen" />
            </span>
          </div>
          <p className="muted">{String(p.address ?? "")}</p>
          <h4>Rum og områder</h4>
          <ul className="plain">
            {(locations.data ?? [])
              .filter((l) => l.property_id === p.id)
              .map((l) => (
                <li key={l.id} className="line">
                  <span>{l.name}</span>
                  <span />
                  <span />
                </li>
              ))}
          </ul>
          <button onClick={() => setNewLoc(String(p.id))} disabled={archive.readOnly}>
            Tilføj rum/område
          </button>
          <h4>Opgaver og historik</h4>
          <TasksTab targetType="property" targetId={String(p.id)} module="Vedligehold" />
          <HistoryTab targetType="property" targetId={String(p.id)} />
        </div>
      ))}
      {props.data?.length === 0 && <Empty>Opret din bolig for at kunne placere genstande i rum.</Empty>}
      {editing && (
        <Modal title={editing === "new" ? "Ny bolig" : "Redigér bolig"} onClose={() => setEditing(null)}>
          <EntityForm type="property" row={editing === "new" ? null : editing} onSaved={() => setEditing(null)} onCancel={() => setEditing(null)} />
        </Modal>
      )}
      {newLoc && (
        <Modal title="Nyt rum eller område" onClose={() => setNewLoc(null)}>
          <EntityForm type="location" fixed={{ property_id: newLoc }} invalidate={[["location"]]} onSaved={() => setNewLoc(null)} onCancel={() => setNewLoc(null)} />
        </Modal>
      )}
    </div>
  );
}

function BuildingParts() {
  const session = useSession();
  const { archive } = session;
  const qc = useQueryClient();
  const toast = useToast();
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const parts = useQuery({ queryKey: ["building_part", "list"], queryFn: () => listEntities(archive.db, "building_part", { orderBy: "name" }) });
  const selectedId = params.get("part");
  const selected = parts.data?.find((p) => p.id === selectedId);
  return (
    <div>
      <button className="primary" onClick={() => setCreating(true)} disabled={archive.readOnly}>
        Ny bygningsdel
      </button>
      <div className="split">
        <table className="list">
          <thead>
            <tr>
              <th>Navn</th>
              <th>Type</th>
              <th>Installeret</th>
            </tr>
          </thead>
          <tbody>
            {(parts.data ?? []).map((p) => (
              <tr key={String(p.id)} {...rowProps(p.id === selectedId, () => setParams({ part: String(p.id) }))}>
                <td>{String(p.name)}</td>
                <td>{String(p.kind ?? "–")}</td>
                <td>{formatDate(p.installed_date as string)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {selected && (
          <aside className="detail" key={String(selected.id)}>
            <div className="header-row">
              <h2>{String(selected.name)}</h2>
              <ArchiveButton type="building_part" id={String(selected.id)} label="Bygningsdelen" onDone={() => setParams({})} />
            </div>
            <PhotoStrip targetType="building_part" targetId={String(selected.id)} />
            <Tabs
              tabs={[
                { id: "tasks", label: "Opgaver", content: () => <TasksTab targetType="building_part" targetId={String(selected.id)} module="Vedligehold" /> },
                { id: "hist", label: "Historik", content: () => <HistoryTab targetType="building_part" targetId={String(selected.id)} /> },
                { id: "docs", label: "Bilag", content: () => <DocumentsTab targetType="building_part" targetId={String(selected.id)} /> },
                { id: "info", label: "Oplysninger", content: () => <EntityForm type="building_part" row={selected} /> },
              ]}
            />
          </aside>
        )}
      </div>
      {creating && (
        <Modal title="Ny bygningsdel" onClose={() => setCreating(false)}>
          <EntityForm
            type="building_part"
            renderAfter={(key) => (key === "notes" ? <PendingAttachments value={pending} onChange={setPending} receipt={false} /> : null)}
            onSaved={async (r) => {
              const res = await attachPending(session, "building_part", String(r.id), pending);
              for (const e of res.errors) toast(e, "error");
              await qc.invalidateQueries({ queryKey: ["documents"] });
              setPending([]);
              setCreating(false);
              setParams({ part: String(r.id) });
            }}
            onCancel={() => setCreating(false)}
          />
        </Modal>
      )}
    </div>
  );
}


const SPECIES: Record<string, string> = { dog: "Hund", cat: "Kat", horse: "Hest", rabbit: "Kanin", bird: "Fugl", other: "Andet" };

/** Husdyr (migration 0004): name, species, chip, owner, vet, photos, documents and insurance. */
function Pets() {
  const session = useSession();
  const { archive } = session;
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<PendingFile[]>([]);
  const pets = useQuery({
    queryKey: ["pet", "list"],
    queryFn: () =>
      archive.db.select<Row>(
        `SELECT p.*, o.name AS owner_name, c.name AS vet_name FROM pet p LEFT JOIN person o ON o.id = p.owner_person_id
           LEFT JOIN contact c ON c.id = p.vet_contact_id WHERE p.archived_at IS NULL ORDER BY p.name`,
      ),
  });
  const selectedId = params.get("pet");
  const selected = pets.data?.find((p) => p.id === selectedId);
  return (
    <div>
      <button className="primary" onClick={() => setCreating(true)} disabled={archive.readOnly}>
        Nyt husdyr
      </button>
      <div className="split">
        <table className="list">
          <thead>
            <tr>
              <th>Navn</th>
              <th>Art og race</th>
              <th>Chipnummer</th>
              <th>Dyrlæge</th>
            </tr>
          </thead>
          <tbody>
            {(pets.data ?? []).map((p) => (
              <tr key={String(p.id)} {...rowProps(p.id === selectedId, () => setParams({ tab: "pets", pet: String(p.id) }))}>
                <td>{String(p.name)}</td>
                <td>
                  {SPECIES[String(p.species)] ?? String(p.species)}
                  {p.breed ? `, ${String(p.breed)}` : ""}
                </td>
                <td>{String(p.chip_number ?? "–")}</td>
                <td>{String(p.vet_name ?? "–")}</td>
              </tr>
            ))}
            {pets.data?.length === 0 && (
              <tr>
                <td colSpan={4}>
                  <EmptyState module="home" text="Saml husdyrenes chipnummer, dyrlæge, forsikring og papirer ét sted." action="Opret dit første husdyr" onAction={() => setCreating(true)} disabled={archive.readOnly} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {selected && (
          <aside className="detail wide-detail" key={String(selected.id)} aria-label="Husdyr">
            <div className="header-row">
              <h2>{String(selected.name)}</h2>
              <ArchiveButton type="pet" id={String(selected.id)} label="Husdyret" onDone={() => setParams({ tab: "pets" })} />
            </div>
            <PhotoStrip targetType="pet" targetId={String(selected.id)} />
            <Tabs
              tabs={[
                { id: "info", label: "Oplysninger", content: () => <EntityForm type="pet" row={selected} /> },
                { id: "docs", label: "Bilag", content: () => <DocumentsTab targetType="pet" targetId={String(selected.id)} /> },
                { id: "ins", label: "Forsikring", content: () => <PetPolicies petId={String(selected.id)} /> },
              ]}
            />
          </aside>
        )}
      </div>
      {creating && (
        <Modal title="Nyt husdyr" onClose={() => setCreating(false)} wide>
          <EntityForm
            type="pet"
            renderAfter={(key) => (key === "notes" ? <PendingAttachments value={pending} onChange={setPending} receipt={false} /> : null)}
            onSaved={async (r) => {
              const res = await attachPending(session, "pet", String(r.id), pending);
              for (const e of res.errors) toast(e, "error");
              await qc.invalidateQueries({ queryKey: ["documents"] });
              setPending([]);
              setCreating(false);
              setParams({ tab: "pets", pet: String(r.id) });
            }}
            onCancel={() => setCreating(false)}
          />
        </Modal>
      )}
    </div>
  );
}

function PetPolicies({ petId }: { petId: string }) {
  const { archive } = useSession();
  const q = useQuery({
    queryKey: ["policy", "forPet", petId],
    queryFn: () =>
      archive.db.select<Row>(
        "SELECT p.* FROM policy p JOIN policy_coverage c ON c.policy_id = p.id WHERE c.target_type = 'pet' AND c.target_id = ? AND p.archived_at IS NULL ORDER BY p.title",
        [petId],
      ),
  });
  if (q.data?.length === 0) return <Empty>Ingen police dækker husdyret. Tilføj dækning under Forsikring.</Empty>;
  return (
    <ul className="plain">
      {(q.data ?? []).map((p) => (
        <li key={String(p.id)} className="line">
          <span>{String(p.title)}</span>
          <span className="muted">{formatMoney(p.premium_minor as number)}</span>
        </li>
      ))}
    </ul>
  );
}
