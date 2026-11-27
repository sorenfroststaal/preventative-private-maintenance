import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { ChevronDown, ChevronRight, Package, Plus } from "lucide-react";
import {
  ancestorsOf,
  COMPONENT_ROLES,
  componentsInStockFor,
  componentsOf,
  componentsUsedIn,
  deadlineState,
  itemTree,
  editItems,
  listEntities,
  listPersons,
  locationsWithProperty,
  moveItem,
  moveItems,
  STOCK_STATUSES,
  textListValues,
  undoMoves,
  consumeComponent,
  workOrdersWithNames,
  type ComponentRow,
  type Row,
  type TreeGroupBy,
  type TreeNode,
  type MoveTarget,
  type MoveUndo,
} from "@ppm/core";
import { DisposeDialog } from "./Disposal";
import { NewWorkOrder } from "../pages/WorkOrders";
import { errorText, useSession } from "../app/session";
import { useToast } from "../layout/Shell";
import { EntityForm } from "./EntityForm";
import { Empty, Modal } from "./ui";
import { StatusBadge, TextIconButton } from "./visual";
import { RowThumb, useThumbnails } from "./RowThumb";
import { COMPONENT_FIELDS } from "../lib/entityFields";
import { formatDate } from "../lib/format";

const roleLabel = (r: unknown) => COMPONENT_ROLES.find(([k]) => k === r)?.[1] ?? "";
const stockLabel = (s: unknown) => STOCK_STATUSES.find(([k]) => k === s)?.[1] ?? "";
const usable = (c: Row) => (c.component_role === "spare_part" || c.component_role === "consumable") && (c.stock_status ?? "in_stock") === "in_stock" && Number(c.quantity ?? 1) > 0;

/** "Reklamationsret udløbet" / "Garanti udløbet" when the date has passed. */
export function DeadlineBadges({ item }: { item: Row }) {
  const { env } = useSession();
  const s = deadlineState(item, env.clock.today());
  if (!s.complaintExpired && !s.warrantyExpired) return null;
  return (
    <span className="small">
      {s.complaintExpired && (
        <StatusBadge kind="missing" title={`Reklamationsretten udløb ${formatDate(String(item.complaint_until))}`}>
          Reklamationsret udløbet
        </StatusBadge>
      )}{" "}
      {s.warrantyExpired && (
        <StatusBadge kind="missing" title={`Garantien udløb ${formatDate(String(item.warranty_until))}`}>
          Garanti udløbet
        </StatusBadge>
      )}
    </span>
  );
}

const timeLeft = (n: number) =>
  n < 0 ? "udløbet" : n === 0 ? "udløber i dag" : n < 60 ? `${n} dage tilbage` : n < 730 ? `ca. ${Math.round(n / 30)} måneder tilbage` : `ca. ${Math.floor(n / 365)} år tilbage`;

/**
 * On an item: how long the complaint period and the warranty last, and "Meld fejl …" while either is
 * running, so a fault is reported (as a work order) before the deadline.
 */
export function DeadlinePanel({ item }: { item: Row }) {
  const { env } = useSession();
  const toast = useToast();
  const [reporting, setReporting] = useState(false);
  const today = env.clock.today();
  const s = deadlineState(item, today);
  if (s.complaintDaysLeft === null && s.warrantyDaysLeft === null) return null;
  const active = (s.complaintDaysLeft ?? -1) >= 0 || (s.warrantyDaysLeft ?? -1) >= 0;
  const soon = (n: number | null) => n !== null && n >= 0 && n <= 60;
  const name = String(item.name);
  const vendor = String(item.vendor_name ?? "") || null;
  const description = [
    `Fejl opdaget ${formatDate(today)}.`,
    (s.complaintDaysLeft ?? -1) >= 0 ? `Reklamationsret til ${formatDate(String(item.complaint_until))}: kontakt forhandleren${vendor ? ` (${vendor})` : ""} inden fristen.` : null,
    (s.warrantyDaysLeft ?? -1) >= 0 ? `Garanti til ${formatDate(String(item.warranty_until))}.` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={`deadline-panel small${soon(s.complaintDaysLeft) || soon(s.warrantyDaysLeft) ? " soon" : ""}`}>
      {s.complaintDaysLeft !== null && (
        <span>
          Reklamationsret til <strong>{formatDate(String(item.complaint_until))}</strong> ({timeLeft(s.complaintDaysLeft)})
        </span>
      )}
      {s.warrantyDaysLeft !== null && (
        <span>
          Garanti til <strong>{formatDate(String(item.warranty_until))}</strong> ({timeLeft(s.warrantyDaysLeft)})
        </span>
      )}
      {active && (
        <button className="link" onClick={() => setReporting(true)}>
          Meld fejl …
        </button>
      )}
      {reporting && (
        <NewWorkOrder
          title={`Meld fejl på ${name}`}
          target={{ type: "item", id: String(item.id) }}
          defaults={{ title: `Fejl på ${name}`, kind: "repair", description }}
          onClose={() => setReporting(false)}
          onCreated={() => toast("Fejlen er registreret som arbejdsordre. Reklamér hos forhandleren inden fristen.")}
        />
      )}
    </div>
  );
}

function StockInfo({ c }: { c: Row }) {
  if (c.component_role !== "spare_part" && c.component_role !== "consumable") return null;
  const status = String(c.stock_status ?? "in_stock");
  return (
    <span className="small">
      {Number(c.quantity ?? 1) !== 1 && <span className="muted">{String(c.quantity)} stk. </span>}
      <StatusBadge kind={status === "used" ? "done" : status === "to_buy" ? "overdue" : "today"}>{stockLabel(status)}</StatusBadge>
      {status === "used" && c.used_date ? <span className="muted"> {formatDate(String(c.used_date))}</span> : null}
    </span>
  );
}

/** "Del af 3D-printer › Hotend" above an item's detail, with links. */
export function ComponentPath({ itemId }: { itemId: string }) {
  const { archive } = useSession();
  const [, setParams] = useSearchParams();
  const q = useQuery({ queryKey: ["item", "ancestors", itemId], queryFn: () => ancestorsOf(archive.db, itemId) });
  if (!q.data?.length) return null;
  return (
    <p className="small component-path">
      Del af{" "}
      {q.data.map((a, i) => (
        <span key={a.id}>
          {i > 0 && " › "}
          <button className="link" onClick={() => setParams({ id: a.id, tab: "components" })}>
            {a.name}
          </button>
        </span>
      ))}
    </p>
  );
}

/** Item detail → Komponenter: parts, accessories, consumables and spare parts, by role. */
export function ComponentsTab({ item }: { item: Row }) {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [, setParams] = useSearchParams();
  const id = String(item.id);
  const [adding, setAdding] = useState(false);
  const [using, setUsing] = useState<ComponentRow | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const list = useQuery({ queryKey: ["item", "components", id], queryFn: () => componentsOf(session.archive.db, id) });
  const thumbs = useThumbnails("item");
  const ro = session.archive.readOnly;
  const groups = COMPONENT_ROLES.map(([role, , plural]) => ({ role, plural, rows: (list.data ?? []).filter((c) => c.component_role === role) })).filter((g) => g.rows.length);
  const other = (list.data ?? []).filter((c) => !c.component_role);
  return (
    <div>
      <TextIconButton icon={Plus} onClick={() => setAdding(true)} disabled={ro}>
        Tilføj komponent
      </TextIconButton>
      {list.data?.length === 0 && <Empty>Ingen komponenter. Tilføj fx tilbehør, forbrugsstoffer eller reservedele til genstanden.</Empty>}
      {[...groups, ...(other.length ? [{ role: "other", plural: "Andet", rows: other }] : [])].map((g) => (
        <section key={g.role} className="component-group">
          <h3>
            <button
              className="group-toggle"
              aria-expanded={!collapsed.has(g.role)}
              onClick={() => setCollapsed((s) => (s.has(g.role) ? new Set([...s].filter((x) => x !== g.role)) : new Set([...s, g.role])))}
            >
              {collapsed.has(g.role) ? <ChevronRight size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />} {g.plural}{" "}
              <span className="small muted">{g.rows.length}</span>
            </button>
          </h3>
          {!collapsed.has(g.role) && (
          <ul className="plain">
            {g.rows.map((c) => (
              <li key={c.id} className="line component-line">
                <span className="with-thumb">
                  <RowThumb doc={thumbs?.get(c.id)} icon={Package} />
                  <button className="link text" onClick={() => setParams({ id: c.id })}>
                    {c.name}
                  </button>
                  {c.children > 0 && <span className="small muted"> · {c.children === 1 ? "1 del" : `${c.children} dele`}</span>}
                </span>
                <span className="small muted">{String(c.part_number ?? "")}</span>
                <span>
                  <StockInfo c={c} /> <DeadlineBadges item={c} />
                </span>
                <span>
                  {usable(c) && (
                    <button className="link" onClick={() => setUsing(c)} disabled={ro}>
                      Brug …
                    </button>
                  )}
                  {c.stock_status === "used" && c.used_work_order_title && <span className="small muted">{String(c.used_work_order_title)}</span>}
                </span>
              </li>
            ))}
          </ul>
          )}
        </section>
      ))}
      {adding && (
        <Modal title={`Ny komponent til ${String(item.name)}`} onClose={() => setAdding(false)} wide>
          <EntityForm
            type="item"
            fields={COMPONENT_FIELDS}
            fixed={{ parent_item_id: id }}
            defaults={{ component_role: "spare_part", stock_status: "in_stock", quantity: 1, location_id: item.location_id ?? null }}
            submitLabel="Tilføj"
            invalidate={[["item"]]}
            onSaved={() => setAdding(false)}
            onCancel={() => setAdding(false)}
          />
          <p className="small muted">Komponenten får samme placering som genstanden, men du kan vælge en anden, fx reolen med reservedele.</p>
        </Modal>
      )}
      {using && (
        <UseComponentDialog
          component={using}
          targetItemId={id}
          onClose={() => setUsing(null)}
          onDone={async () => {
            toast(`${using.name} er registreret som brugt`);
            setUsing(null);
            await qc.invalidateQueries({ queryKey: ["item"] });
            await qc.invalidateQueries({ queryKey: ["work_order"] });
          }}
          onError={(e) => toast(errorText(e), "error")}
        />
      )}
    </div>
  );
}

/** "Brug reservedel": quantity, the repair (work order) and the date. */
function UseComponentDialog({ component, targetItemId, onClose, onDone, onError }: { component: Row; targetItemId?: string; onClose(): void; onDone(): void; onError(e: unknown): void }) {
  const session = useSession();
  const have = Number(component.quantity ?? 1);
  const [qty, setQty] = useState(String(have));
  const [wo, setWo] = useState("");
  const [date, setDate] = useState(session.env.clock.today());
  const orders = useQuery({ queryKey: ["work_order", "list"], queryFn: () => workOrdersWithNames(session.archive.db) });
  const relevant = (orders.data ?? []).filter((w) => !["closed", "cancelled"].includes(String(w.status)) || w.id === wo);
  const run = useMutation({
    mutationFn: () => consumeComponent(session.ctx(), String(component.id), { quantity: Number(qty), workOrderId: wo || null, date }),
    onSuccess: onDone,
    onError,
  });
  return (
    <Modal title={`Brug ${String(component.name)}`} onClose={onClose}>
      <form
        className="entity-form"
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          run.mutate();
        }}
      >
        <label>
          Antal (af {have})
          <input type="number" min={1} max={have} value={qty} onChange={(e) => setQty(e.target.value)} required />
        </label>
        <label>
          Brugt i reparation (arbejdsordre)
          <select value={wo} onChange={(e) => setWo(e.target.value)}>
            <option value="">– ingen –</option>
            {relevant
              .sort((a, b) => Number(b.target_id === targetItemId) - Number(a.target_id === targetItemId))
              .map((w) => (
                <option key={String(w.id)} value={String(w.id)}>
                  {String(w.title)}
                  {w.target_name ? ` (${String(w.target_name)})` : ""}
                </option>
              ))}
          </select>
        </label>
        <label>
          Dato
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <div className="row">
          <button type="submit" className="primary" disabled={run.isPending}>
            Registrér som brugt
          </button>
          <button type="button" onClick={onClose}>
            Annullér
          </button>
        </div>
        {have > 1 && <p className="small muted">Bruger du kun nogle af dem, bliver resten stående som "På lager".</p>}
      </form>
    </Modal>
  );
}

/** Work order → Reservedele: what was used, and "Brug reservedel" from the stock on the target. */
export function WorkOrderParts({ wo }: { wo: Row }) {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const used = useQuery({ queryKey: ["work_order", "parts", wo.id], queryFn: () => componentsUsedIn(session.archive.db, String(wo.id)) });
  const stock = useQuery({ queryKey: ["item", "stock", wo.target_type, wo.target_id], queryFn: () => componentsInStockFor(session.archive.db, (wo.target_type as string) ?? null, (wo.target_id as string) ?? null) });
  const [pick, setPick] = useState("");
  const [using, setUsing] = useState<Row | null>(null);
  const ro = session.archive.readOnly;
  return (
    <div>
      {used.data?.length === 0 && <Empty>Ingen reservedele eller forbrugsstoffer registreret som brugt.</Empty>}
      <ul className="plain">
        {(used.data ?? []).map((c) => (
          <li key={String(c.id)} className="line">
            <span>
              {String(c.name)}
              {c.parent_name ? <span className="small muted"> · {String(c.parent_name)}</span> : null}
            </span>
            <span className="small muted">{Number(c.quantity ?? 1)} stk.</span>
            <span className="small muted">{formatDate(c.used_date as string)}</span>
          </li>
        ))}
      </ul>
      {(stock.data ?? []).length > 0 && (
        <div className="row">
          <label>
            Brug fra lager
            <select value={pick} onChange={(e) => setPick(e.target.value)} disabled={ro}>
              <option value="">– vælg reservedel –</option>
              {(stock.data ?? []).map((c) => (
                <option key={String(c.id)} value={String(c.id)}>
                  {String(c.name)}
                  {c.parent_name ? ` (${String(c.parent_name)})` : ""} · {Number(c.quantity ?? 1)} stk.
                </option>
              ))}
            </select>
          </label>
          <button disabled={!pick || ro} onClick={() => setUsing((stock.data ?? []).find((c) => c.id === pick) ?? null)}>
            Brug …
          </button>
        </div>
      )}
      {using && (
        <UseComponentDialogFixed
          component={using}
          workOrderId={String(wo.id)}
          onClose={() => setUsing(null)}
          onDone={async () => {
            toast(`${String(using.name)} er registreret som brugt`);
            setUsing(null);
            setPick("");
            await qc.invalidateQueries({ queryKey: ["work_order"] });
            await qc.invalidateQueries({ queryKey: ["item"] });
          }}
          onError={(e) => toast(errorText(e), "error")}
        />
      )}
    </div>
  );
}

/** The same dialog with the work order already chosen. */
function UseComponentDialogFixed({ component, workOrderId, onClose, onDone, onError }: { component: Row; workOrderId: string; onClose(): void; onDone(): void; onError(e: unknown): void }) {
  const session = useSession();
  const have = Number(component.quantity ?? 1);
  const [qty, setQty] = useState(String(have));
  const run = useMutation({
    mutationFn: () => consumeComponent(session.ctx(), String(component.id), { quantity: Number(qty), workOrderId }),
    onSuccess: onDone,
    onError,
  });
  return (
    <Modal title={`Brug ${String(component.name)}`} onClose={onClose}>
      <form
        className="entity-form"
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          run.mutate();
        }}
      >
        <label>
          Antal (af {have})
          <input type="number" min={1} max={have} value={qty} onChange={(e) => setQty(e.target.value)} required />
        </label>
        <div className="row">
          <button type="submit" className="primary" disabled={run.isPending}>
            Registrér som brugt
          </button>
          <button type="button" onClick={onClose}>
            Annullér
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- tree

const GROUPS: [TreeGroupBy, string][] = [
  ["location", "Placering"],
  ["owner", "Ejer"],
  ["category", "Kategori"],
];

/** Bolig og inventar → Genstande as a tree that can be expanded with + (by location, owner or category). */
export function ItemTree({
  q,
  selectedId,
  onSelect,
  selection = new Set<string>(),
  onToggle,
}: {
  q: string;
  selectedId: string | null;
  onSelect(id: string): void;
  /** Items chosen with the checkboxes (dragging one of them moves all of them). */
  selection?: Set<string>;
  /** `shown`: the visible items in tree order, for Shift-click ranges. */
  onToggle?(id: string, e: { shiftKey: boolean }, shown: string[]): void;
}) {
  const session = useSession();
  const { archive } = session;
  const qc = useQueryClient();
  const toast = useToast();
  const ro = archive.readOnly;
  // Drag and drop: drop an item on a room/category/owner to move it there, on another item to make it a component.
  const [dragging, setDragging] = useState<{ id: string; name: string; fromKey: string; ids: string[] } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [lastMove, setLastMove] = useState<{ undo: MoveUndo[]; label: string } | null>(null);
  const [groupBy, setGroupBy] = useState<TreeGroupBy>(() => {
    try {
      return (localStorage.getItem("ppm.tree.groupBy") as TreeGroupBy) || "location";
    } catch {
      return "location";
    }
  });
  const tree = useQuery({ queryKey: ["item", "tree", groupBy, q], queryFn: () => itemTree(archive.db, { groupBy, match: q }) });
  const [open, setOpen] = useState<Set<string> | "all" | null>(null);
  const thumbs = useThumbnails("item");
  // By default the groups are open and items are closed; a search opens everything.
  const isOpen = (n: TreeNode, depth: number) => (q ? true : open === "all" ? true : open ? open.has(n.key) : n.kind !== "item" && depth < 3);
  const toggle = (n: TreeNode, depth: number) => {
    const now = isOpen(n, depth);
    const next = new Set(open instanceof Set ? open : []);
    if (open === null || open === "all") {
      // Materialise the current state before changing one node.
      const walk = (ns: TreeNode[], d: number) => ns.forEach((x) => (isOpen(x, d) && next.add(x.key), walk(x.children, d + 1)));
      walk(tree.data ?? [], 0);
    }
    if (now) next.delete(n.key);
    else next.add(n.key);
    setOpen(next);
  };
  /** Items in the order they are shown (open branches only), each once. */
  const shownItems = () => {
    const out: string[] = [];
    const walk = (ns: TreeNode[], d: number) =>
      ns.forEach((x) => {
        if (x.item && !out.includes(String(x.item.id))) out.push(String(x.item.id));
        if (isOpen(x, d)) walk(x.children, d + 1);
      });
    walk(tree.data ?? [], 0);
    return out;
  };
  /** What dropping on a node means in the current grouping (null: not a drop target). */
  const targetFor = (n: TreeNode | "root"): { target: MoveTarget; label: string } | null => {
    if (!dragging) return null;
    if (n === "root") return { target: { kind: "root" }, label: "hovedgenstand" };
    if (n.kind === "item") {
      if (!n.item || dragging.ids.includes(String(n.item.id))) return null;
      return { target: { kind: "item", parentId: String(n.item.id) }, label: `del af ${n.label}` };
    }
    const k = n.key;
    if (k.startsWith("l:")) return { target: { kind: "location", locationId: k === "l:none" ? null : k.slice(2) }, label: k === "l:none" ? "uden placering" : n.label };
    if (k.startsWith("c:")) return { target: { kind: "category", category: k.slice(2) || null }, label: k === "c:" ? "uden kategori" : n.label };
    if (k.startsWith("p:")) {
      const from = dragging.fromKey.split("/")[0]!;
      const fromPersonId = from.startsWith("p:") && from !== "p:none" ? from.slice(2) : null;
      if (k === from) return null;
      return { target: { kind: "owner", personId: k === "p:none" ? null : k.slice(2), fromPersonId }, label: k === "p:none" ? "uden ejer" : n.label };
    }
    return null;
  };
  const drop = async (n: TreeNode | "root") => {
    const t = targetFor(n);
    const d = dragging;
    setDragging(null);
    setOver(null);
    if (!t || !d) return;
    try {
      if (d.ids.length > 1) {
        const undos = await moveItems(session.ctx(), d.ids, t.target);
        setLastMove({ undo: undos, label: `${d.ids.length} genstande er flyttet til ${t.label}.` });
      } else {
        const undo = await moveItem(session.ctx(), d.id, t.target);
        setLastMove({ undo: [undo], label: `${d.name} er flyttet til ${t.label}.` });
      }
      await qc.invalidateQueries({ queryKey: ["item"] });
      await qc.invalidateQueries({ queryKey: ["person_link"] });
    } catch (e) {
      toast(errorText(e), "error");
    }
  };
  const dropProps = (n: TreeNode | "root", key: string) =>
    ro || !dragging
      ? {}
      : {
          onDragOver: (e: React.DragEvent) => {
            if (!targetFor(n)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (over !== key) setOver(key);
          },
          onDragLeave: () => setOver((o) => (o === key ? null : o)),
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            void drop(n);
          },
        };
  const render = (nodes: TreeNode[], depth: number) => (
    <ul className={depth === 0 ? "tree" : "tree-sub"} role={depth === 0 ? "tree" : "group"}>
      {nodes.map((n) => {
        const expandable = n.children.length > 0;
        const expanded = expandable && isOpen(n, depth);
        return (
          <li key={n.key} role="treeitem" aria-expanded={expandable ? expanded : undefined} aria-selected={n.item ? n.item.id === selectedId : undefined}>
            <div
              className={`tree-row ${n.kind}${n.item && n.item.id === selectedId ? " selected" : ""}${over === n.key ? " drop-over" : ""}${dragging?.fromKey === n.key ? " dragging" : ""}`}
              style={{ paddingLeft: `${depth * 1.25}rem` }}
              draggable={Boolean(n.item) && !ro}
              onDragStart={(e) => {
                if (!n.item) return;
                e.stopPropagation();
                e.dataTransfer.setData("text/plain", String(n.item.id));
                e.dataTransfer.effectAllowed = "move";
                setLastMove(null);
                const id = String(n.item.id);
                const ids = selection.has(id) && selection.size > 1 ? [...selection] : [id];
                setDragging({ id, name: ids.length > 1 ? `${ids.length} genstande` : n.label, fromKey: n.key, ids });
              }}
              onDragEnd={() => {
                setDragging(null);
                setOver(null);
              }}
              {...dropProps(n, n.key)}
            >
              {expandable ? (
                <button className="tree-toggle" onClick={() => toggle(n, depth)} aria-label={`${expanded ? "Fold sammen" : "Fold ud"}: ${n.label}`} title={expanded ? "Fold sammen" : "Fold ud"}>
                  {expanded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
                </button>
              ) : (
                <span className="tree-toggle" aria-hidden="true" />
              )}
              {n.item && onToggle && (
                <input
                  type="checkbox"
                  className="tree-check"
                  aria-label={`Vælg ${n.label}`}
                  checked={selection.has(String(n.item.id))}
                  onChange={() => undefined}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggle(String(n.item!.id), e, shownItems());
                  }}
                />
              )}
              {n.item ? (
                <button
                  className="tree-item"
                  onMouseDown={(e) => e.shiftKey && e.preventDefault()}
                  onClick={(e) => (onToggle && (e.ctrlKey || e.metaKey || e.shiftKey) ? onToggle(String(n.item!.id), e, shownItems()) : onSelect(String(n.item!.id)))}
                >
                  <RowThumb doc={thumbs?.get(String(n.item.id))} icon={Package} />
                  <span className="text">{n.label}</span>
                  {n.item.component_role ? <span className="chip small">{roleLabel(n.item.component_role)}</span> : null}
                  {n.note && <span className="small muted">({n.note})</span>}
                  <StockInfo c={n.item} />
                  <DeadlineBadges item={n.item} />
                </button>
              ) : (
                <span className="tree-group">
                  {n.label} <span className="small muted">{n.count}</span>
                </span>
              )}
            </div>
            {expanded && render(n.children, depth + 1)}
          </li>
        );
      })}
    </ul>
  );
  return (
    <div className="tree-wrap">
      <div className="row tree-tools">
        <label className="inline">
          Gruppér efter{" "}
          <select
            value={groupBy}
            onChange={(e) => {
              const v = e.target.value as TreeGroupBy;
              setGroupBy(v);
              setOpen(null);
              try {
                localStorage.setItem("ppm.tree.groupBy", v);
              } catch {
                // Not remembered in private mode.
              }
            }}
          >
            {GROUPS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <button className="link" onClick={() => setOpen("all")}>
          Fold alt ud
        </button>
        <button className="link" onClick={() => setOpen(new Set())}>
          Fold alt sammen
        </button>
      </div>
      {!ro && <p className="small muted tree-hint">Træk en linje oven på et rum, en kategori eller en ejer for at flytte den, eller oven på en anden genstand for at gøre den til en del af den.</p>}
      {lastMove && (
        <p className="row tree-undo" role="status">
          <span>{lastMove.label}</span>
          <button
            className="link"
            onClick={async () => {
              await undoMoves(session.ctx(), lastMove.undo);
              setLastMove(null);
              await qc.invalidateQueries({ queryKey: ["item"] });
              await qc.invalidateQueries({ queryKey: ["person_link"] });
            }}
          >
            Fortryd
          </button>
        </p>
      )}
      {dragging && (
        <div className={`tree-root-drop${over === "root" ? " drop-over" : ""}`} {...dropProps("root", "root")}>
          Slip her for at gøre {dragging.name} til en hovedgenstand
        </div>
      )}
      {tree.data?.length === 0 && <Empty>{q ? "Ingen genstande passer til søgningen." : "Ingen genstande endnu."}</Empty>}
      {tree.data && render(tree.data, 0)}
    </div>
  );
}


// ---------------------------------------------------------------- several items at once

/**
 * Toolbar for a selection of items (list or tree): move them to a room, category or another item,
 * add or remove an owner, set role or stock status, or archive them. Moves can be undone.
 */
export function BulkBar({ ids, onClear }: { ids: string[]; onClear(): void }) {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const db = session.archive.db;
  const [undo, setUndo] = useState<{ undos: MoveUndo[]; label: string } | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [category, setCategory] = useState("");
  const locations = useQuery({ queryKey: ["location", "withProperty"], queryFn: () => locationsWithProperty(db) });
  const categories = useQuery({ queryKey: ["lists", "item_category"], queryFn: () => textListValues(db, "item_category") });
  const persons = useQuery({ queryKey: ["person", "list", "household"], queryFn: () => listPersons(db, { household: true }) });
  const items = useQuery({ queryKey: ["item", "list"], queryFn: () => listEntities(db, "item", { orderBy: "name" }) });
  const n = ids.length;
  const what = n === 1 ? "1 genstand" : `${n} genstande`;
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["item"] });
    await qc.invalidateQueries({ queryKey: ["person_link"] });
  };
  const run = async (label: string, f: () => Promise<MoveUndo[] | number>) => {
    try {
      const r = await f();
      await refresh();
      if (Array.isArray(r)) setUndo({ undos: r, label });
      else toast(label);
    } catch (e) {
      toast(errorText(e), "error");
    }
  };
  const move = (target: MoveTarget, label: string) => run(`${what} er flyttet til ${label}.`, () => moveItems(session.ctx(), ids, target));
  const ro = session.archive.readOnly;
  const selected = new Set(ids);
  return (
    <div className="bulk-bar" role="toolbar" aria-label="Handlinger for valgte genstande">
      <strong>{n} valgt</strong>
      <select
        aria-label="Flyt til placering"
        value=""
        disabled={ro}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) return;
          const l = (locations.data ?? []).find((x) => x.id === v);
          void move({ kind: "location", locationId: v === "__none" ? null : v }, l ? l.name : "uden placering");
        }}
      >
        <option value="">Placering …</option>
        {(locations.data ?? []).map((l) => (
          <option key={l.id} value={l.id}>
            {l.property_name} › {l.name}
          </option>
        ))}
        <option value="__none">Uden placering</option>
      </select>
      <span className="inline-field">
        <input aria-label="Kategori" list="bulk-categories" placeholder="Kategori …" value={category} onChange={(e) => setCategory(e.target.value)} disabled={ro} />
        <datalist id="bulk-categories">
          {(categories.data ?? []).map((c) => (
            <option key={c.value} value={c.value} />
          ))}
        </datalist>
        <button disabled={ro} onClick={() => void move({ kind: "category", category: category || null }, category || "uden kategori").then(() => setCategory(""))}>
          Sæt
        </button>
      </span>
      <select
        aria-label="Gør til del af"
        value=""
        disabled={ro}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) return;
          if (v === "__root") void move({ kind: "root" }, "hovedgenstande");
          else void move({ kind: "item", parentId: v }, `dele af ${(items.data ?? []).find((i) => i.id === v)?.name ?? ""}`);
        }}
      >
        <option value="">Del af …</option>
        <option value="__root">Ingen (hovedgenstand)</option>
        {(items.data ?? [])
          .filter((i) => !selected.has(String(i.id)))
          .map((i) => (
            <option key={String(i.id)} value={String(i.id)}>
              {String(i.name)}
            </option>
          ))}
      </select>
      <select
        aria-label="Ejer"
        value=""
        disabled={ro}
        onChange={(e) => {
          const [op, pid] = e.target.value.split(":");
          if (!pid) return;
          const name = (persons.data ?? []).find((p) => p.id === pid)?.name ?? "";
          void run(op === "add" ? `${name} er tilføjet som ejer af ${what}.` : `${name} er fjernet som ejer af ${what}.`, () =>
            editItems(session.ctx(), ids, op === "add" ? { addOwner: pid } : { removeOwner: pid }),
          );
        }}
      >
        <option value="">Ejer …</option>
        <optgroup label="Tilføj ejer">
          {(persons.data ?? []).map((p) => (
            <option key={`a${p.id}`} value={`add:${p.id}`}>
              + {p.name}
            </option>
          ))}
        </optgroup>
        <optgroup label="Fjern ejer">
          {(persons.data ?? []).map((p) => (
            <option key={`r${p.id}`} value={`remove:${p.id}`}>
              − {p.name}
            </option>
          ))}
        </optgroup>
      </select>
      <select
        aria-label="Rolle"
        value=""
        disabled={ro}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) return;
          void run(`Rollen er sat for ${what}.`, () => editItems(session.ctx(), ids, { component_role: v === "__none" ? null : (v as never) }));
        }}
      >
        <option value="">Rolle …</option>
        {COMPONENT_ROLES.map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
        <option value="__none">Ingen rolle</option>
      </select>
      <select
        aria-label="Lagerstatus"
        value=""
        disabled={ro}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) return;
          void run(`Lagerstatus er sat for ${what}.`, () => editItems(session.ctx(), ids, { stock_status: v === "__none" ? null : (v as never) }));
        }}
      >
        <option value="">Lager …</option>
        {STOCK_STATUSES.map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
        <option value="__none">Ingen</option>
      </select>
      <button onClick={() => setConfirmArchive(true)} disabled={ro}>
        Arkivér …
      </button>
      {confirmArchive && <DisposeDialog ids={ids} what={what} onClose={() => setConfirmArchive(false)} onDone={onClear} />}
      <button className="link" onClick={onClear}>
        Ryd valg
      </button>
      {undo && (
        <span className="inline-field" role="status">
          <span>{undo.label}</span>
          <button
            className="link"
            onClick={async () => {
              await undoMoves(session.ctx(), undo.undos);
              setUndo(null);
              await refresh();
            }}
          >
            Fortryd
          </button>
        </span>
      )}
    </div>
  );
}
