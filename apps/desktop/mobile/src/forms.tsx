/** Forms on the phone: items, gifts, lending and persons outside the household. Saved on the computer through core. */
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { errorText, Field, formatKr, Header, parseKr } from "./ui";

export interface Options {
  locations: { id: string; label: string }[];
  categories: string[];
  occasions: string[];
  persons: { id: string; name: string; relation: string | null; household: 0 | 1 }[];
  items: { id: string; name: string }[];
}
export const useOptions = () => useQuery({ queryKey: ["options"], queryFn: () => api<Options>("/api/options") });

type Values = Record<string, string>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

function useForm(initial: Values) {
  const [v, setV] = useState<Values>(initial);
  const bind = (k: string) => ({ value: v[k] ?? "", onChange: (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value })) });
  return { v, setV, bind };
}

function Actions({ busy, label, error, onCancel }: { busy: boolean; label: string; error: unknown; onCancel(): void }) {
  return (
    <>
      {error ? (
        <p className="banner error" role="alert">
          {errorText(error)}
        </p>
      ) : null}
      <button type="submit" className="primary big" disabled={busy}>
        {busy ? "Gemmer …" : label}
      </button>
      <button type="button" className="plain-btn" onClick={onCancel}>
        Annullér
      </button>
    </>
  );
}

// ---------------------------------------------------------------- item

export function ItemForm({ item, onDone, onCancel }: { item: Record<string, unknown> | null; onDone(id: string): void; onCancel(): void }) {
  const qc = useQueryClient();
  const opts = useOptions();
  const f = useForm({
    name: str(item?.name),
    category: str(item?.category),
    location_id: str(item?.location_id),
    brand: str(item?.brand),
    model: str(item?.model),
    serial_number: str(item?.serial_number),
    purchase_date: str(item?.purchase_date),
    price: formatKr(item?.purchase_price_minor as number | null | undefined),
    vendor_name: str(item?.vendor_name),
    warranty_until: str(item?.warranty_until),
    complaint_until: str(item?.complaint_until),
    notes: str(item?.notes),
  });
  const save = useMutation({
    mutationFn: async () => {
      const price = parseKr(f.v.price!);
      if (price === undefined) throw new Error("Skriv prisen som fx 1.299,95");
      const { price: _p, ...rest } = f.v;
      const body = { ...rest, purchase_price_minor: price };
      return item ? api<{ id: string }>(`/api/items/${String(item.id)}`, { method: "PATCH", body }) : api<{ id: string }>("/api/items", { body });
    },
    onSuccess: async (r) => {
      await qc.invalidateQueries();
      onDone(String(r.id));
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  return (
    <>
      <Header title={item ? "Ret genstand" : "Ny genstand"} onBack={onCancel} backLabel="Annullér" />
      <form className="card form" onSubmit={submit}>
        <Field label="Navn">
          <input {...f.bind("name")} required autoFocus={!item} placeholder="Fx Opvaskemaskine" />
        </Field>
        <Field label="Kategori">
          <input {...f.bind("category")} list="item-categories" placeholder="Vælg eller skriv" />
          <datalist id="item-categories">
            {(opts.data?.categories ?? []).map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Placering">
          <select {...f.bind("location_id")}>
            <option value="">– ingen –</option>
            {(opts.data?.locations ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </Field>
        <div className="two">
          <Field label="Mærke">
            <input {...f.bind("brand")} />
          </Field>
          <Field label="Model">
            <input {...f.bind("model")} />
          </Field>
        </div>
        <Field label="Serienummer">
          <input {...f.bind("serial_number")} autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
        </Field>
        <div className="two">
          <Field label="Købsdato">
            <input type="date" {...f.bind("purchase_date")} />
          </Field>
          <Field label="Pris (kr.)">
            <input {...f.bind("price")} inputMode="decimal" placeholder="0,00" />
          </Field>
        </div>
        <Field label="Forhandler">
          <input {...f.bind("vendor_name")} />
        </Field>
        <div className="two">
          <Field label="Garanti til">
            <input type="date" {...f.bind("warranty_until")} />
          </Field>
          <Field label="Reklamationsret til">
            <input type="date" {...f.bind("complaint_until")} />
          </Field>
        </div>
        <Field label="Noter">
          <textarea rows={3} {...f.bind("notes")} />
        </Field>
        <Actions busy={save.isPending} label={item ? "Gem ændringer" : "Opret genstand"} error={save.error} onCancel={onCancel} />
      </form>
    </>
  );
}

// ---------------------------------------------------------------- persons

/** Picks a person; "+ Ny person" creates one outside the household right here. */
function PersonSelect({ value, onChange, label }: { value: string; onChange(id: string): void; label: string }) {
  const qc = useQueryClient();
  const opts = useOptions();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const add = useMutation({
    mutationFn: () => api<{ id: string }>("/api/people", { body: { name } }),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ["options"] });
      await qc.invalidateQueries({ queryKey: ["people"] });
      onChange(r.id);
      setAdding(false);
      setName("");
    },
  });
  const persons = opts.data?.persons ?? [];
  return (
    <Field label={label}>
      {adding ? (
        <span className="inline-add">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Navn, fx Karl (ven)" autoFocus />
          <button type="button" className="pill" disabled={!name.trim() || add.isPending} onClick={() => add.mutate()}>
            Tilføj
          </button>
          <button type="button" className="plain-btn small" onClick={() => setAdding(false)}>
            Fortryd
          </button>
          {add.error ? <small className="error">{errorText(add.error)}</small> : null}
        </span>
      ) : (
        <select value={value} onChange={(e) => (e.target.value === "__new" ? setAdding(true) : onChange(e.target.value))}>
          <option value="">– vælg –</option>
          <optgroup label="Husstanden">
            {persons.filter((p) => p.household === 1).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Familie, venner og andre">
            {persons.filter((p) => p.household === 0).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.relation ? ` (${p.relation})` : ""}
              </option>
            ))}
          </optgroup>
          <option value="__new">+ Ny person …</option>
        </select>
      )}
    </Field>
  );
}

export function NewPersonForm({ onDone, onCancel }: { onDone(id: string): void; onCancel(): void }) {
  const qc = useQueryClient();
  const f = useForm({ name: "", relation: "" });
  const save = useMutation({
    mutationFn: () => api<{ id: string }>("/api/people", { body: f.v }),
    onSuccess: async (r) => {
      await qc.invalidateQueries();
      onDone(r.id);
    },
  });
  return (
    <>
      <Header title="Ny person" onBack={onCancel} backLabel="Annullér" />
      <form
        className="card form"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <p className="small muted">Fx familie, venner eller naboer, som du låner ting ud til eller giver gaver. Personer i husstanden oprettes på computeren.</p>
        <Field label="Navn">
          <input {...f.bind("name")} required autoFocus />
        </Field>
        <Field label="Relation" hint="Fx mor, ven, nabo, kollega">
          <input {...f.bind("relation")} />
        </Field>
        <Actions busy={save.isPending} label="Opret person" error={save.error} onCancel={onCancel} />
      </form>
    </>
  );
}

// ---------------------------------------------------------------- gift

export interface GiftValue {
  id: string;
  direction: "given" | "received";
  title: string;
  occasion: string | null;
  date: string;
  amount_minor: number | null;
  notes: string | null;
}

export function GiftForm({ personId, gift, today, onDone, onCancel }: { personId?: string; gift?: GiftValue; today: string; onDone(): void; onCancel(): void }) {
  const qc = useQueryClient();
  const opts = useOptions();
  const f = useForm({
    direction: gift?.direction ?? "given",
    person_id: personId ?? "",
    title: gift?.title ?? "",
    occasion: gift?.occasion ?? "",
    gift_date: gift?.date ?? today,
    price: formatKr(gift?.amount_minor),
    notes: gift?.notes ?? "",
  });
  const save = useMutation({
    mutationFn: async () => {
      const amount = parseKr(f.v.price!);
      if (amount === undefined) throw new Error("Skriv prisen som fx 299,95");
      const { price: _p, ...rest } = f.v;
      const body = { ...rest, amount_minor: amount };
      return gift ? api(`/api/gifts/${gift.id}`, { method: "PATCH", body }) : api("/api/gifts", { body });
    },
    onSuccess: async () => {
      await qc.invalidateQueries();
      onDone();
    },
  });
  const given = f.v.direction === "given";
  return (
    <>
      <Header title={gift ? "Ret gave" : "Ny gave"} onBack={onCancel} backLabel="Annullér" />
      <form
        className="card form"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="segmented" role="group" aria-label="Givet eller fået">
          <button type="button" aria-pressed={given} onClick={() => f.setV((x) => ({ ...x, direction: "given" }))}>
            Jeg giver
          </button>
          <button type="button" aria-pressed={!given} onClick={() => f.setV((x) => ({ ...x, direction: "received" }))}>
            Jeg har fået
          </button>
        </div>
        <PersonSelect label={given ? "Til" : "Fra"} value={f.v.person_id!} onChange={(id) => f.setV((x) => ({ ...x, person_id: id }))} />
        <Field label="Gave">
          <input {...f.bind("title")} required placeholder="Fx Brætspil" />
        </Field>
        <Field label="Anledning">
          <input {...f.bind("occasion")} list="gift-occasions" placeholder="Vælg eller skriv" />
          <datalist id="gift-occasions">
            {(opts.data?.occasions ?? []).map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        </Field>
        <div className="two">
          <Field label="Dato">
            <input type="date" {...f.bind("gift_date")} required />
          </Field>
          <Field label="Pris (kr.)">
            <input {...f.bind("price")} inputMode="decimal" placeholder="0,00" />
          </Field>
        </div>
        <Field label="Noter">
          <textarea rows={2} {...f.bind("notes")} />
        </Field>
        <Actions busy={save.isPending} label={gift ? "Gem ændringer" : "Gem gave"} error={save.error} onCancel={onCancel} />
      </form>
    </>
  );
}

// ---------------------------------------------------------------- lending

export function LendForm({ itemId, personId, today, onDone, onCancel }: { itemId?: string; personId?: string; today: string; onDone(): void; onCancel(): void }) {
  const qc = useQueryClient();
  const opts = useOptions();
  const f = useForm({ item_id: itemId ?? "", title: "", borrower_person_id: personId ?? "", lent_date: today, due_date: "", notes: "" });
  const save = useMutation({
    mutationFn: () => api("/api/lending", { body: f.v }),
    onSuccess: async () => {
      await qc.invalidateQueries();
      onDone();
    },
  });
  return (
    <>
      <Header title="Lån noget ud" onBack={onCancel} backLabel="Annullér" />
      <form
        className="card form"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Genstand">
          <select {...f.bind("item_id")}>
            <option value="">– ikke registreret –</option>
            {(opts.data?.items ?? []).map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </Field>
        {!f.v.item_id && (
          <Field label="Hvad lånes ud">
            <input {...f.bind("title")} placeholder="Fx Brætspil, stige, bog" />
          </Field>
        )}
        <PersonSelect label="Låner" value={f.v.borrower_person_id!} onChange={(id) => f.setV((x) => ({ ...x, borrower_person_id: id }))} />
        <div className="two">
          <Field label="Udlånt">
            <input type="date" {...f.bind("lent_date")} required />
          </Field>
          <Field label="Afleveres senest">
            <input type="date" {...f.bind("due_date")} />
          </Field>
        </div>
        <Field label="Noter">
          <textarea rows={2} {...f.bind("notes")} />
        </Field>
        <Actions busy={save.isPending} label="Registrér udlån" error={save.error} onCancel={onCancel} />
      </form>
    </>
  );
}
