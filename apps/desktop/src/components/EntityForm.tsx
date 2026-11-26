import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addTextListValue,
  createEntity,
  listEntities,
  textListValues,
  parseDanishAmount,
  updateEntity,
  ValidationError,
  type EntityType,
  type Row,
} from "@ppm/core";
import { errorText, useSession } from "../app/session";
import { fieldsFor, type FieldDef } from "../lib/entityFields";
import { Modal } from "./ui";

type Values = Record<string, string>;

const pad = (n: number) => String(n).padStart(2, "0");

export function toFormValue(f: FieldDef, v: unknown): string {
  if (v === null || v === undefined) return "";
  if (f.type === "money") {
    const n = Number(v);
    const abs = Math.abs(n);
    return `${n < 0 ? "-" : ""}${Math.floor(abs / 100)},${pad(abs % 100)}`;
  }
  if (f.type === "datetime") {
    const d = new Date(String(v));
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return String(v);
}

/** Converts form strings to typed values. Returns field errors for unparsable input. */
export function fromFormValues(fields: FieldDef[], values: Values): { data: Record<string, unknown>; errors: Record<string, string> } {
  const data: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const f of fields) {
    if (!(f.key in values)) continue;
    const raw = values[f.key]!.trim();
    if (raw === "") {
      data[f.key] = null;
      continue;
    }
    switch (f.type) {
      case "money": {
        const v = parseDanishAmount(raw);
        if (v === null) errors[f.key] = "Skriv beløbet som fx 1.234,50";
        else data[f.key] = v;
        break;
      }
      case "number": {
        const v = Number(raw.replace(",", "."));
        if (!Number.isFinite(v)) errors[f.key] = "Skal være et tal";
        else data[f.key] = v;
        break;
      }
      case "datetime":
        data[f.key] = new Date(raw).toISOString();
        break;
      case "select":
        data[f.key] = f.options?.every(([k]) => /^\d+$/.test(k)) ? Number(raw) : raw;
        break;
      default:
        data[f.key] = raw;
    }
  }
  return { data, errors };
}

/** Danish neuter nouns take "Nyt" ("Nyt rum", "Nyt husdyr"). */
const NEUTER = new Set(["rum", "husdyr", "lån", "udlån", "budget"]);
/** "Ny kontakt", "Nyt rum". */
export const newLabel = (type: EntityType): string => {
  const w = TYPE_SINGULAR[type] ?? type;
  return `${NEUTER.has(w) ? "Nyt" : "Ny"} ${w}`;
};

/** Danish singular names used in "+ Ny …" options. */
export const TYPE_SINGULAR: Partial<Record<EntityType, string>> = {
  location: "rum",
  property: "bolig",
  contact: "kontakt",
  person: "person",
  account: "konto",
  category: "kategori",
  vehicle: "bil",
  pet: "husdyr",
  loan: "lån",
  policy: "police",
  item: "genstand",
  building_part: "bygningsdel",
  budget: "budget",
  claim: "skadesag",
  work_order: "arbejdsordre",
};

const NEW = "__new__";

/**
 * Dropdown of records of a type, with "+ Ny …" that creates a record in a small dialog
 * and selects it (the shared EntityForm and Zod schema validate it).
 */
export function RefSelect(props: {
  id?: string;
  type: EntityType;
  labelCol: string;
  value: string;
  onChange(v: string): void;
  where?: Record<string, string>;
  required?: boolean;
  emptyLabel?: string;
  /** Default true; set false where creating here makes no sense. */
  allowCreate?: boolean;
  /** Prefilled values in the "+ Ny …" dialog, e.g. kind "shop" for a vendor. */
  createDefaults?: Record<string, unknown>;
}) {
  const { archive } = useSession();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const q = useQuery({
    queryKey: [props.type, "options", props.where ?? null],
    queryFn: () => listEntities(archive.db, props.type, { where: props.where, orderBy: props.labelCol }),
  });
  const canCreate = (props.allowCreate ?? true) && !archive.readOnly && fieldsFor(props.type).length > 0;
  // A required choice with only one option (e.g. the only property) is chosen for the user.
  const only = props.required && !props.value && q.data?.length === 1 ? String(q.data[0]!.id) : null;
  useEffect(() => {
    if (only) props.onChange(only);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [only]);
  return (
    <>
      <select
        id={props.id}
        value={props.value}
        required={props.required}
        onChange={(e) => (e.target.value === NEW ? setCreating(true) : props.onChange(e.target.value))}
      >
        <option value="">{props.emptyLabel ?? "– vælg –"}</option>
        {(q.data ?? []).map((r) => (
          <option key={String(r.id)} value={String(r.id)}>
            {String(r[props.labelCol] ?? r.id)}
          </option>
        ))}
        {canCreate && <option value={NEW}>+ {newLabel(props.type)}…</option>}
      </select>
      {creating && (
        <Modal title={newLabel(props.type)} onClose={() => setCreating(false)}>
          <EntityForm
            type={props.type}
            fixed={props.where}
            defaults={props.createDefaults ?? (props.type === "contact" ? { kind: "other" } : undefined)}
            onSaved={async (r) => {
              await qc.invalidateQueries({ queryKey: [props.type] });
              props.onChange(String(r.id));
              setCreating(false);
            }}
            onCancel={() => setCreating(false)}
          />
        </Modal>
      )}
    </>
  );
}

/** Dropdown for a free-text column backed by an editable value list, with "+ Tilføj ny…". */
export function ListSelect({ id, list, value, onChange, required }: { id?: string; list: string; value: string; onChange(v: string): void; required?: boolean }) {
  const session = useSession();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const q = useQuery({ queryKey: ["lists", list], queryFn: () => textListValues(session.archive.db, list) });
  const values = q.data ?? [];
  const has = values.some((v) => v.value === value);
  async function add() {
    const v = await addTextListValue(session.ctx(), list, text);
    await qc.invalidateQueries({ queryKey: ["lists", list] });
    onChange(v);
    setAdding(false);
    setText("");
  }
  if (adding) {
    return (
      <span className="row tight">
        <input
          id={id}
          autoFocus
          value={text}
          placeholder="Ny værdi"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (text.trim()) void add();
            }
            if (e.key === "Escape") setAdding(false);
          }}
        />
        <button type="button" onClick={() => void add()} disabled={!text.trim()}>
          Tilføj
        </button>
        <button type="button" onClick={() => setAdding(false)}>
          Annullér
        </button>
      </span>
    );
  }
  return (
    <select id={id} value={value} required={required} onChange={(e) => (e.target.value === NEW ? setAdding(true) : onChange(e.target.value))}>
      <option value="">– vælg –</option>
      {!has && value && <option value={value}>{value}</option>}
      {values.map((v) => (
        <option key={v.value} value={v.value}>
          {v.value}
        </option>
      ))}
      {!session.archive.readOnly && <option value={NEW}>+ Tilføj ny…</option>}
    </select>
  );
}

function Input({ id, f, value, onChange, values }: { id: string; f: FieldDef; value: string; onChange(v: string): void; values: Values }) {
  switch (f.type) {
    case "textarea":
      return <textarea id={id} rows={3} value={value} onChange={(e) => onChange(e.target.value)} />;
    case "date":
      return <input id={id} type="date" value={value} required={f.required} onChange={(e) => onChange(e.target.value)} />;
    case "datetime":
      return <input id={id} type="datetime-local" value={value} required={f.required} onChange={(e) => onChange(e.target.value)} />;
    case "money":
      return <input id={id} inputMode="decimal" placeholder="0,00" value={value} required={f.required} onChange={(e) => onChange(e.target.value)} />;
    case "number":
      return <input id={id} inputMode="decimal" value={value} required={f.required} onChange={(e) => onChange(e.target.value)} />;
    case "select":
      return (
        <select id={id} value={value} required={f.required} onChange={(e) => onChange(e.target.value)}>
          <option value="">– vælg –</option>
          {f.options!.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      );
    case "list":
      return <ListSelect id={id} list={f.list!} value={value} required={f.required} onChange={onChange} />;
    case "ref":
      return (
        <RefSelect
          id={id}
          type={f.ref!.type}
          labelCol={f.ref!.label}
          where={f.ref!.whereFrom ? { ...f.ref!.where, ...Object.fromEntries(Object.entries(f.ref!.whereFrom).map(([col, field]) => [col, values[field] || "__none__"])) } : f.ref!.where}
          createDefaults={f.ref!.createDefaults}
          allowCreate={f.ref!.whereFrom ? false : undefined}
          value={value}
          required={f.required}
          onChange={onChange}
        />
      );
    default:
      return <input id={id} value={value} required={f.required} onChange={(e) => onChange(e.target.value)} />;
  }
}

interface Props {
  type: EntityType;
  row?: Row | null;
  /** Initial values for a new entity (ignored when row is set). */
  defaults?: Record<string, unknown>;
  /** Values set by the context (e.g. person_id) – not shown, always saved. */
  fixed?: Record<string, unknown>;
  fields?: FieldDef[];
  title?: string;
  submitLabel?: string;
  onSaved?(row: Row): void;
  onCancel?(): void;
  /** Rendered below a field: (key, values, setValue) => node */
  renderAfter?(key: string, values: Values, set: (k: string, v: string) => void): ReactNode;
  /** Invalidate these query keys after save (in addition to [type]). */
  invalidate?: unknown[][];
}

/** Generic create/update form driven by FieldDefs; validation is core's Zod schema (spec 04). */
export function EntityForm(props: Props) {
  const session = useSession();
  // Unique ids per form: a "+ Ny …" dialog can show a second form with the same fields.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const qc = useQueryClient();
  const fields = (props.fields ?? fieldsFor(props.type)).filter((f) => !f.hidden && !(props.fixed && f.key in props.fixed));
  const [values, setValues] = useState<Values>(() =>
    Object.fromEntries(fields.map((f) => [f.key, toFormValue(f, props.row ? props.row[f.key] : props.defaults?.[f.key])])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setValues((x) => ({ ...x, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    // A "+ Ny …" dialog renders its form inside this one; its submit must not also save this form.
    e.stopPropagation();
    const { data, errors: parseErrors } = fromFormValues(fields, values);
    setErrors(parseErrors);
    setGeneral(null);
    if (Object.keys(parseErrors).length) return;
    setBusy(true);
    try {
      const payload = { ...data, ...(props.fixed ?? {}) };
      const saved = props.row
        ? await updateEntity(session.ctx(), props.type, String(props.row.id), payload as never)
        : await createEntity(session.ctx(), props.type, payload as never);
      await qc.invalidateQueries({ queryKey: [props.type] });
      for (const k of props.invalidate ?? []) await qc.invalidateQueries({ queryKey: k });
      await qc.invalidateQueries({ queryKey: ["dashboard"] });
      await qc.invalidateQueries({ queryKey: ["tasks"] });
      props.onSaved?.(saved);
    } catch (err) {
      if (err instanceof ValidationError) {
        const map: Record<string, string> = {};
        for (const i of err.issues) {
          if (fields.some((f) => f.key === i.path)) map[i.path] = i.message;
          else setGeneral(i.message);
        }
        setErrors(map);
      } else setGeneral(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="entity-form" onSubmit={submit} aria-label={props.title ?? "Formular"}>
      {props.title && <h3>{props.title}</h3>}
      <div className="grid2">
        {fields.map((f) => (
          <div key={f.key} className={f.type === "textarea" ? "span2" : ""}>
            <label htmlFor={`f${uid}-${f.key}`}>
              {f.label}
              {f.required && <span aria-hidden="true"> *</span>}
            </label>
            <Input id={`f${uid}-${f.key}`} f={f} value={values[f.key] ?? ""} onChange={(v) => set(f.key, v)} values={values} />
            {f.help && <div className="small muted">{f.help}</div>}
            {errors[f.key] && (
              <div className="error small" role="alert">
                {errors[f.key]}
              </div>
            )}
            {props.renderAfter?.(f.key, values, set)}
          </div>
        ))}
      </div>
      {general && <p className="error" role="alert">{general}</p>}
      <div className="row">
        <button className="primary" type="submit" disabled={busy || session.archive.readOnly}>
          {props.submitLabel ?? (props.row ? "Gem" : "Opret")}
        </button>
        {props.onCancel && (
          <button type="button" onClick={props.onCancel}>
            Annullér
          </button>
        )}
      </div>
    </form>
  );
}
