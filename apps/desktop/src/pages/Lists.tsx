import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  addTextListValue,
  removeTextListValue,
  renameTextListValue,
  TEXT_LISTS,
  fields,
  textListValues,
  type EntityType,
  type Row,
} from "@ppm/core";
import { errorText, useSession } from "../app/session";
import { useToast } from "../layout/Shell";
import { EntityForm, newLabel, TYPE_SINGULAR } from "../components/EntityForm";
import { ArchiveButton } from "../components/ArchiveButton";
import { DocumentsTab } from "../components/DetailTabs";

/** Types that can have documents (spec 03, migration 0006): contacts, persons, accounts, properties, rooms. */
const ATTACHABLE = new Set<string>(fields.document_link.target_type.options);
import { Modal, rowProps, SearchBox, Tabs, includesText } from "../components/ui";
import { IconButton, PageHeader, StatusBadge, TextIconButton } from "../components/visual";
import { CONTACT_KINDS, optionLabel } from "../lib/entityFields";

interface Column {
  key: string;
  label: string;
  render?(r: Row): string;
}

interface EntityList {
  id: string;
  label: string;
  type: EntityType;
  sql: string;
  columns: Column[];
  search: string[];
}

/** The records behind the dropdowns. Archived records are left out (they can be found in exports). */
const ENTITY_LISTS: EntityList[] = [
  {
    id: "location",
    label: "Rum og placeringer",
    type: "location",
    sql: `SELECT l.*, p.name AS property_name, pl.name AS parent_name FROM location l JOIN property p ON p.id = l.property_id
            LEFT JOIN location pl ON pl.id = l.parent_id WHERE l.archived_at IS NULL ORDER BY p.name, l.name`,
    columns: [
      { key: "name", label: "Navn" },
      { key: "property_name", label: "Bolig" },
      { key: "parent_name", label: "Del af" },
    ],
    search: ["name", "property_name"],
  },
  { id: "property", label: "Boliger", type: "property", sql: "SELECT * FROM property WHERE archived_at IS NULL ORDER BY name", columns: [{ key: "name", label: "Navn" }, { key: "address", label: "Adresse" }], search: ["name", "address"] },
  {
    id: "contact",
    label: "Kontakter",
    type: "contact",
    sql: "SELECT * FROM contact WHERE archived_at IS NULL ORDER BY name",
    columns: [
      { key: "name", label: "Navn" },
      { key: "kind", label: "Type", render: (r) => optionLabel(CONTACT_KINDS, r.kind) },
      { key: "phone", label: "Telefon" },
    ],
    search: ["name", "phone", "email"],
  },
  { id: "person", label: "Personer", type: "person", sql: "SELECT * FROM person WHERE archived_at IS NULL ORDER BY name", columns: [{ key: "name", label: "Navn" }, { key: "relation", label: "Relation" }], search: ["name", "relation"] },
  { id: "account", label: "Konti", type: "account", sql: "SELECT * FROM account WHERE archived_at IS NULL ORDER BY name", columns: [{ key: "name", label: "Navn" }, { key: "bank", label: "Bank" }], search: ["name", "bank"] },
  {
    id: "category",
    label: "Økonomikategorier",
    type: "category",
    sql: `SELECT c.*, p.name AS parent_name FROM category c LEFT JOIN category p ON p.id = c.parent_id WHERE c.archived_at IS NULL ORDER BY COALESCE(p.name, c.name), c.parent_id IS NOT NULL, c.name`,
    columns: [
      { key: "name", label: "Navn" },
      { key: "parent_name", label: "Under" },
      { key: "kind", label: "Type", render: (r) => ({ expense: "Udgift", income: "Indtægt", transfer: "Overførsel" })[String(r.kind)] ?? String(r.kind) },
    ],
    search: ["name", "parent_name"],
  },
];

/** "Lister": see and edit the records and value lists that fill the dropdowns. */
export function Lists() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("liste") ?? ENTITY_LISTS[0]!.id;
  return (
    <section>
      <PageHeader module="lists" />
      <p className="small muted">Her ser og retter du de poster og værdier, som rullelisterne i formularerne henter fra. Nye kan også oprettes direkte i en rulleliste med "+ Ny …".</p>
      <Tabs
        active={tab}
        onChange={(id) => setParams({ liste: id })}
        tabs={[
          ...ENTITY_LISTS.map((l) => ({ id: l.id, label: l.label, content: () => <EntityListTab key={l.id} list={l} /> })),
          ...TEXT_LISTS.map((l) => ({ id: l.key, label: l.label, content: () => <TextListTab key={l.key} listKey={l.key} /> })),
        ]}
      />
    </section>
  );
}

function EntityListTab({ list }: { list: EntityList }) {
  const { archive } = useSession();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const rows = useQuery({ queryKey: [list.type, "lists", list.id], queryFn: () => archive.db.select<Row>(list.sql) });
  const shown = (rows.data ?? []).filter((r) => includesText(r, list.search, q));
  const sel = shown.find((r) => r.id === selected) ?? null;
  const singular = TYPE_SINGULAR[list.type] ?? list.type;
  return (
    <div>
      <div className="row filters">
        <SearchBox value={q} onChange={setQ} placeholder={`Søg i ${list.label.toLowerCase()}`} />
        <TextIconButton icon={Plus} className="primary" onClick={() => setCreating(true)} disabled={archive.readOnly}>
          {newLabel(list.type)}
        </TextIconButton>
      </div>
      <div className="split">
        <table className="list">
          <thead>
            <tr>
              {list.columns.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={String(r.id)} {...rowProps(r.id === selected, () => setSelected(String(r.id)))}>
                {list.columns.map((c) => (
                  <td key={c.key}>{c.render ? c.render(r) : String(r[c.key] ?? "–")}</td>
                ))}
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={list.columns.length} className="muted">
                  Ingen {list.label.toLowerCase()}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {sel && (
          <aside className="detail" aria-label={String(sel.name)} key={String(sel.id)}>
            <div className="header-row">
              <h2>{String(sel.name)}</h2>
              <ArchiveButton type={list.type} id={String(sel.id)} label={singular.charAt(0).toUpperCase() + singular.slice(1)} onDone={() => setSelected(null)} />
            </div>
            {ATTACHABLE.has(list.type) ? (
              <Tabs
                tabs={[
                  { id: "info", label: "Oplysninger", content: () => <EntityForm type={list.type} row={sel} invalidate={[[list.type]]} /> },
                  { id: "docs", label: "Bilag", content: () => <DocumentsTab targetType={list.type as never} targetId={String(sel.id)} roles={["contract", "letter", "certificate", "warranty", "invoice", "receipt", "photo", "other"]} /> },
                ]}
              />
            ) : (
              <EntityForm type={list.type} row={sel} invalidate={[[list.type]]} />
            )}
          </aside>
        )}
      </div>
      {creating && (
        <Modal title={newLabel(list.type)} onClose={() => setCreating(false)}>
          <EntityForm
            type={list.type}
            onSaved={(r) => {
              setCreating(false);
              setSelected(String(r.id));
            }}
            onCancel={() => setCreating(false)}
          />
        </Modal>
      )}
    </div>
  );
}

function TextListTab({ listKey }: { listKey: string }) {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState("");
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null);
  const values = useQuery({ queryKey: ["lists", listKey], queryFn: () => textListValues(session.archive.db, listKey) });
  const refresh = () => qc.invalidateQueries();
  const run = useMutation({
    mutationFn: (f: () => Promise<unknown>) => f(),
    onSuccess: refresh,
    onError: (e) => toast(errorText(e), "error"),
  });
  const ro = session.archive.readOnly;
  return (
    <div>
      <form
        className="row filters"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          run.mutate(() => addTextListValue(session.ctx(), listKey, text).then(() => setText("")));
        }}
      >
        <label style={{ marginBottom: 0 }}>
          Ny værdi
          <input value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <TextIconButton icon={Plus} type="submit" className="primary" disabled={ro || !text.trim()}>
          Tilføj
        </TextIconButton>
      </form>
      <table className="list compact">
        <thead>
          <tr>
            <th>Værdi</th>
            <th className="num">Bruges af</th>
            <th aria-label="Handlinger" />
          </tr>
        </thead>
        <tbody>
          {(values.data ?? []).map((v) => (
            <tr key={v.value}>
              <td>
                {renaming?.from === v.value ? (
                  <form
                    className="row tight"
                    onSubmit={(e) => {
                      e.preventDefault();
                      run.mutate(() => renameTextListValue(session.ctx(), listKey, v.value, renaming.to).then((n) => {
                        setRenaming(null);
                        if (n) toast(`${n} ${n === 1 ? "post er" : "poster er"} opdateret`);
                      }));
                    }}
                  >
                    <input aria-label={`Nyt navn for ${v.value}`} autoFocus value={renaming.to} onChange={(e) => setRenaming({ ...renaming, to: e.target.value })} />
                    <button type="submit" disabled={!renaming.to.trim()}>
                      Gem
                    </button>
                    <button type="button" onClick={() => setRenaming(null)}>
                      Annullér
                    </button>
                  </form>
                ) : (
                  <>
                    {v.value} {!v.listed && <StatusBadge kind="missing">Kun i data</StatusBadge>}
                  </>
                )}
              </td>
              <td className="num">{v.used}</td>
              <td>
                <span className="row tight">
                  <IconButton icon={Pencil} label={`Omdøb ${v.value}`} onClick={() => setRenaming({ from: v.value, to: v.value })} disabled={ro} />
                  <IconButton
                    icon={Trash2}
                    label={v.used ? `${v.value} er i brug og kan ikke slettes` : `Slet ${v.value}`}
                    onClick={() => run.mutate(() => removeTextListValue(session.ctx(), listKey, v.value))}
                    disabled={ro || v.used > 0}
                  />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted">Omdøbes en værdi, opdateres alle poster, der bruger den. Vælg et eksisterende navn for at lægge to værdier sammen.</p>
    </div>
  );
}
