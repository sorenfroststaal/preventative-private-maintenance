import { useMemo, useState } from "react";
import { RowThumb, useThumbnails } from "../components/RowThumb";
import { Hammer, Package, PawPrint } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { addMonths, itemsWithReceipt, listEntities, locationsWithProperty, personLinks, petsWithNames, policiesForItem, policiesForPet, setPersonLinks, type Row } from "@ppm/core";
import { PersonPicker } from "../components/PersonPicker";
import { errorText, useSession } from "../app/session";
import { EntityForm } from "../components/EntityForm";
import { DocumentsTab, HistoryTab, TasksTab } from "../components/DetailTabs";
import { Empty, includesText, Modal, rowProps, SearchBox, Tabs } from "../components/ui";
import { formatDate, formatMoney } from "../lib/format";
import { COMPONENT_FIELDS, fieldsFor } from "../lib/entityFields";
import { annualAmount } from "@ppm/core";
import { useToast } from "../layout/Shell";
import { ArchiveButton } from "../components/ArchiveButton";
import { Avatar, EmptyState, PageHeader } from "../components/visual";
import { attachPending, PendingAttachments, PhotoStrip, type PendingFile } from "../components/Attachments";
import { ReceiptSuggestionBanner } from "../components/ReceiptSuggest";
import { ItemLending, LendingTab } from "../components/Lending";
import { GiftsTab } from "../components/Gifts";
import { ComponentPath, ComponentsTab, ItemTree } from "../components/Components";

export function Home() {
  const [params, setParams] = useSearchParams();
  const active = params.get("tab") ?? (params.get("part") ? "parts" : params.get("pet") ? "pets" : params.get("udlaan") ? "lending" : params.get("gave") ? "gifts" : "items");
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
          { id: "lending", label: "Udlån", content: () => <LendingTab /> },
          { id: "gifts", label: "Gaver", content: () => <GiftsTab /> },
        ]}
      />
    </section>
  );
}

function useLocations() {
  const { archive } = useSession();
  return useQuery({
    queryKey: ["location", "withProperty"],
    queryFn: () => locationsWithProperty(archive.db),
  });
}

function Items() {
  const { archive } = useSession();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [loc, setLoc] = useState("");
  const [owner, setOwner] = useState("");
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<"list" | "tree">(() => {
    try {
      return localStorage.getItem("ppm.items.view") === "tree" ? "tree" : "list";
    } catch {
      return "list";
    }
  });
  const [showComponents, setShowComponents] = useState(false);
  const chooseView = (v: "list" | "tree") => {
    setView(v);
    try {
      localStorage.setItem("ppm.items.view", v);
    } catch {
      // Not remembered in private mode.
    }
  };
  const items = useQuery({ queryKey: ["item", "list"], queryFn: () => listEntities(archive.db, "item", { orderBy: "name" }) });
  const persons = useQuery({ queryKey: ["person", "list"], queryFn: () => listEntities(archive.db, "person", { orderBy: "name" }) });
  const owners = useQuery({ queryKey: ["person_link", "item"], queryFn: () => personLinks(archive.db, "item") });
  const locations = useLocations();
  const locName = useMemo(() => new Map((locations.data ?? []).map((l) => [l.id, `${l.name}`])), [locations.data]);
  const receipts = useQuery({ queryKey: ["documents", "itemReceipts"], queryFn: () => itemsWithReceipt(archive.db) });
  const hasReceipt = receipts.data ?? new Set<string>();
  const thumbs = useThumbnails("item");
  const componentCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items.data ?? []) if (i.parent_item_id) m.set(String(i.parent_item_id), (m.get(String(i.parent_item_id)) ?? 0) + 1);
    return m;
  }, [items.data]);
  const rows = (items.data ?? []).filter(
    (i) => (showComponents || q || !i.parent_item_id) && (!loc || i.location_id === loc) && (!owner || (owners.data?.get(String(i.id)) ?? []).some((p) => p.id === owner)) && includesText(i, ["name", "brand", "model", "serial_number", "category"], q),
  );
  const selectedId = params.get("id");
  const selected = items.data?.find((i) => i.id === selectedId) ?? null;

  return (
    <>
      <div className="row filters">
        <SearchBox value={q} onChange={setQ} placeholder="Søg i genstande" />
        <div className="segmented-control" role="group" aria-label="Visning">
          <button aria-pressed={view === "list"} onClick={() => chooseView("list")}>
            Liste
          </button>
          <button aria-pressed={view === "tree"} onClick={() => chooseView("tree")}>
            Træ
          </button>
        </div>
        {view === "list" && (
        <select aria-label="Placering" value={loc} onChange={(e) => setLoc(e.target.value)}>
          <option value="">Alle placeringer</option>
          {(locations.data ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.property_name} › {l.name}
            </option>
          ))}
        </select>
        )}
        {view === "list" && (persons.data ?? []).length > 0 && (
          <select aria-label="Ejer" value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">Alle personer</option>
            {(persons.data ?? []).map((p) => (
              <option key={String(p.id)} value={String(p.id)}>
                {String(p.name)}
              </option>
            ))}
          </select>
        )}
        {view === "list" && componentCount.size > 0 && (
          <label className="inline small">
            <input type="checkbox" checked={showComponents} onChange={(e) => setShowComponents(e.target.checked)} /> Vis også komponenter
          </label>
        )}
        <button className="primary" onClick={() => setCreating(true)} disabled={archive.readOnly}>
          Ny genstand
        </button>
      </div>
      <div className="split">
        {view === "tree" ? (
          <ItemTree q={q} selectedId={selectedId} onSelect={(id) => setParams({ id })} />
        ) : (
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
                <td>
                  <span className="with-thumb">
                    <RowThumb doc={thumbs?.get(String(i.id))} icon={Package} />
                    <span className="text">{String(i.name)}</span>
                    {componentCount.get(String(i.id)) ? <span className="small muted">{componentCount.get(String(i.id))} dele</span> : null}
                    {(owners.data?.get(String(i.id)) ?? []).length > 0 && (
                      <span className="avatars">
                        {(owners.data?.get(String(i.id)) ?? []).map((p) => (
                          <Avatar key={p.id} name={p.name} />
                        ))}
                      </span>
                    )}
                  </span>
                </td>
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
        )}
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
  const [owners, setOwners] = useState<string[]>([]);
  return (
    <Modal title="Ny genstand" onClose={onClose} wide>
      <EntityForm
        type="item"
        renderAfter={(key, values, set) =>
          key === "notes" ? (
            <>
              <PersonPicker label="Ejere" value={owners} onChange={setOwners} />
              <PendingAttachments value={pending} onChange={setPending} />
            </>
          ) : (
            complaintSuggestion(key, values, set)
          )
        }
        onSaved={async (r) => {
          if (owners.length) await setPersonLinks(session.ctx(), "item", String(r.id), owners);
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
  const [params] = useSearchParams();
  const id = String(item.id);
  return (
    <aside className="detail wide-detail" aria-label="Genstand">
      <div className="header-row">
        <h2>{String(item.name)}</h2>
        <ArchiveButton type="item" id={id} label="Genstanden" onDone={onArchived} />
      </div>
      <ComponentPath itemId={id} />
      <PhotoStrip targetType="item" targetId={id} />
      <ItemOwners itemId={id} />
      <ItemLending itemId={id} />
      <ReceiptSuggestionBanner itemId={id} />
      <Tabs
        initial={params.get("tab") === "components" ? "components" : undefined}
        tabs={[
          { id: "info", label: "Oplysninger", content: () => <EntityForm key={String(item.updated_at ?? "")} type="item" row={item} fields={item.parent_item_id ? [...fieldsFor("item").filter((f) => !["parent_item_id", "component_role"].includes(f.key)), ...COMPONENT_FIELDS.filter((f) => ["component_role", "part_number", "quantity", "stock_status"].includes(f.key)), ...fieldsFor("item").filter((f) => f.key === "parent_item_id")] : undefined} renderAfter={complaintSuggestion} /> },
          { id: "docs", label: "Bilag", content: () => <DocumentsTab targetType="item" targetId={id} /> },
          { id: "components", label: "Komponenter", content: () => <ComponentsTab item={item} /> },
          { id: "ins", label: "Forsikring", content: () => <ItemPolicies itemId={id} /> },
          { id: "hist", label: "Historik", content: () => <HistoryTab targetType="item" targetId={id} /> },
          { id: "tasks", label: "Opgaver", content: () => <TasksTab targetType="item" targetId={id} module="Bolig og inventar" /> },
        ]}
      />
    </aside>
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
  const thumbs = useThumbnails("building_part");
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
                <td>
                  <span className="with-thumb">
                    <RowThumb doc={thumbs?.get(String(p.id))} icon={Hammer} />
                    <span className="text">{String(p.name)}</span>
                  </span>
                </td>
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
    queryFn: () => petsWithNames(archive.db),
  });
  const selectedId = params.get("pet");
  const selected = pets.data?.find((p) => p.id === selectedId);
  const thumbs = useThumbnails("pet");
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
                <td>
                  <span className="with-thumb">
                    <RowThumb doc={thumbs?.get(String(p.id))} icon={PawPrint} />
                    <span className="text">{String(p.name)}</span>
                  </span>
                </td>
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
    queryFn: () => policiesForPet(archive.db, petId),
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

/** Persons the item belongs to; toggling saves at once (migration 0010). */
function ItemOwners({ itemId }: { itemId: string }) {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const links = useQuery({ queryKey: ["person_link", "item"], queryFn: () => personLinks(session.archive.db, "item") });
  const value = (links.data?.get(itemId) ?? []).map((p) => p.id);
  const save = useMutation({
    mutationFn: (ids: string[]) => setPersonLinks(session.ctx(), "item", itemId, ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["person_link"] }),
    onError: (e) => toast(errorText(e), "error"),
  });
  return <PersonPicker label="Ejere" value={value} onChange={(ids) => save.mutate(ids)} />;
}
