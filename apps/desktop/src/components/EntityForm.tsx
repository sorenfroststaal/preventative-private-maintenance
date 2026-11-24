import { useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createEntity,
  listEntities,
  parseDanishAmount,
  updateEntity,
  ValidationError,
  type EntityType,
  type Row,
} from "@ppm/core";
import { errorText, useSession } from "../app/session";
import { fieldsFor, type FieldDef } from "../lib/entityFields";

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

export function RefSelect(props: {
  id?: string;
  type: EntityType;
  labelCol: string;
  value: string;
  onChange(v: string): void;
  where?: Record<string, string>;
  required?: boolean;
  emptyLabel?: string;
}) {
  const { archive } = useSession();
  const q = useQuery({
    queryKey: [props.type, "options", props.where ?? null],
    queryFn: () => listEntities(archive.db, props.type, { where: props.where, orderBy: props.labelCol }),
  });
  return (
    <select id={props.id} value={props.value} required={props.required} onChange={(e) => props.onChange(e.target.value)}>
      <option value="">{props.emptyLabel ?? "– vælg –"}</option>
      {(q.data ?? []).map((r) => (
        <option key={String(r.id)} value={String(r.id)}>
          {String(r[props.labelCol] ?? r.id)}
        </option>
      ))}
    </select>
  );
}

function Input({ f, value, onChange }: { f: FieldDef; value: string; onChange(v: string): void }) {
  const id = `f-${f.key}`;
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
    case "ref":
      return <RefSelect id={id} type={f.ref!.type} labelCol={f.ref!.label} where={f.ref!.where} value={value} required={f.required} onChange={onChange} />;
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
            <label htmlFor={`f-${f.key}`}>
              {f.label}
              {f.required && <span aria-hidden="true"> *</span>}
            </label>
            <Input f={f} value={values[f.key] ?? ""} onChange={(v) => set(f.key, v)} />
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
