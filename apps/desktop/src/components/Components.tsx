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
  itemTree,
  STOCK_STATUSES,
  consumeComponent,
  workOrdersWithNames,
  type ComponentRow,
  type Row,
  type TreeGroupBy,
  type TreeNode,
} from "@ppm/core";
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
          <h3>{g.plural}</h3>
          <ul className="plain">
            {g.rows.map((c) => (
              <li key={c.id} className="line component-line">
                <span className="with-thumb">
                  <RowThumb doc={thumbs?.get(c.id)} icon={Package} />
                  <button className="link text" onClick={() => setParams({ id: c.id })}>
                    {c.name}
                  </button>
                  {c.children > 0 && <span className="small muted"> · {c.children} dele</span>}
                </span>
                <span className="small muted">{String(c.part_number ?? "")}</span>
                <StockInfo c={c} />
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
export function ItemTree({ q, selectedId, onSelect }: { q: string; selectedId: string | null; onSelect(id: string): void }) {
  const { archive } = useSession();
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
  const render = (nodes: TreeNode[], depth: number) => (
    <ul className={depth === 0 ? "tree" : "tree-sub"} role={depth === 0 ? "tree" : "group"}>
      {nodes.map((n) => {
        const expandable = n.children.length > 0;
        const expanded = expandable && isOpen(n, depth);
        return (
          <li key={n.key} role="treeitem" aria-expanded={expandable ? expanded : undefined} aria-selected={n.item ? n.item.id === selectedId : undefined}>
            <div className={`tree-row ${n.kind}${n.item && n.item.id === selectedId ? " selected" : ""}`} style={{ paddingLeft: `${depth * 1.25}rem` }}>
              {expandable ? (
                <button className="tree-toggle" onClick={() => toggle(n, depth)} aria-label={`${expanded ? "Fold sammen" : "Fold ud"}: ${n.label}`} title={expanded ? "Fold sammen" : "Fold ud"}>
                  {expanded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
                </button>
              ) : (
                <span className="tree-toggle" aria-hidden="true" />
              )}
              {n.item ? (
                <button className="tree-item" onClick={() => onSelect(String(n.item!.id))}>
                  <RowThumb doc={thumbs?.get(String(n.item.id))} icon={Package} />
                  <span className="text">{n.label}</span>
                  {n.item.component_role ? <span className="chip small">{roleLabel(n.item.component_role)}</span> : null}
                  {n.note && <span className="small muted">({n.note})</span>}
                  <StockInfo c={n.item} />
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
      {tree.data?.length === 0 && <Empty>{q ? "Ingen genstande passer til søgningen." : "Ingen genstande endnu."}</Empty>}
      {tree.data && render(tree.data, 0)}
    </div>
  );
}
