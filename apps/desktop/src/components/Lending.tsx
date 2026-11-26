import { useState } from "react";
import { RowThumb, useThumbnails } from "./RowThumb";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { HandHelping } from "lucide-react";
import { activeLendingForItem, lendItem, listLendings, returnLending, ValidationError, type LendingRow } from "@ppm/core";
import { errorText, useSession } from "../app/session";
import { useToast } from "../layout/Shell";
import { Modal, rowProps } from "./ui";
import { EmptyState, StatusBadge, TextIconButton } from "./visual";
import { formatDate } from "../lib/format";
import { EntityForm, RefSelect } from "./EntityForm";

/** Bolig og inventar → Udlån: what is lent out, to whom and until when (migration 0007). */
export function LendingTab() {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [showReturned, setShowReturned] = useState(false);
  const today = session.env.clock.today();
  const active = useQuery({ queryKey: ["lending", "active", today], queryFn: () => listLendings(session.archive.db, today, { active: true }) });
  const returned = useQuery({ queryKey: ["lending", "returned", today], queryFn: () => listLendings(session.archive.db, today, { active: false }), enabled: showReturned });
  const back = useMutation({
    mutationFn: (l: LendingRow) => returnLending(session.ctx(), l.id),
    onSuccess: async (_, l) => {
      toast(`${l.thing} er afleveret`);
      await qc.invalidateQueries({ queryKey: ["lending"] });
      await qc.invalidateQueries({ queryKey: ["calendar"] });
    },
    onError: (e) => toast(errorText(e), "error"),
  });
  const selectedId = params.get("udlaan");
  const thumbs = useThumbnails("item");
  const all = [...(active.data ?? []), ...(returned.data ?? [])];
  const selected = all.find((l) => l.id === selectedId) ?? null;
  const ro = session.archive.readOnly;
  return (
    <div>
      <div className="row">
        <TextIconButton icon={HandHelping} className="primary" onClick={() => setCreating(true)} disabled={ro}>
          Lån noget ud
        </TextIconButton>
        <label className="inline">
          <input type="checkbox" checked={showReturned} onChange={(e) => setShowReturned(e.target.checked)} /> Vis også afleverede
        </label>
      </div>
      {active.data?.length === 0 && !showReturned ? (
        <EmptyState module="home" text="Hold styr på værktøj, spil og bøger, du har lånt ud: hvem har det, og hvornår kommer det tilbage." action="Registrér dit første udlån" onAction={() => setCreating(true)} disabled={ro} />
      ) : (
        <div className="split">
          <table className="list">
            <thead>
              <tr>
                <th>Ting</th>
                <th>Lånt af</th>
                <th>Udlånt</th>
                <th>Afleveres</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {(active.data ?? []).map((l) => (
                <tr key={l.id} {...rowProps(l.id === selectedId, () => setParams({ tab: "lending", udlaan: l.id }))}>
                  <td>
                    <span className="with-thumb">
                      <RowThumb doc={l.item_id ? thumbs?.get(String(l.item_id)) : null} icon={HandHelping} />
                      <span className="text">{l.thing}</span>
                    </span>
                  </td>
                  <td>{l.borrower}</td>
                  <td>{formatDate(l.lent_date)}</td>
                  <td>{formatDate(l.due_date)}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {l.overdue && <StatusBadge kind="overdue">Overskredet</StatusBadge>}{" "}
                    <button className="link" onClick={() => back.mutate(l)} disabled={ro || back.isPending} aria-label={`Markér ${l.thing} som afleveret`} title="Markér som afleveret">
                      Markér afleveret
                    </button>
                  </td>
                </tr>
              ))}
              {showReturned &&
                (returned.data ?? []).map((l) => (
                  <tr key={l.id} {...rowProps(l.id === selectedId, () => setParams({ tab: "lending", udlaan: l.id }))} className={`muted ${l.id === selectedId ? "selected" : ""}`}>
                    <td>{l.thing}</td>
                    <td>{l.borrower}</td>
                    <td>{formatDate(l.lent_date)}</td>
                    <td>{formatDate(l.due_date)}</td>
                    <td>
                      <StatusBadge kind="done">Afleveret {formatDate(l.returned_date)}</StatusBadge>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {selected && (
            <aside className="detail" aria-label="Udlån" key={selected.id}>
              <h2>{selected.thing}</h2>
              <EntityForm type="lending" row={selected} invalidate={[["lending"], ["calendar"]]} />
            </aside>
          )}
        </div>
      )}
      {creating && <LendDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

/** "Lån ud": item or free text, borrower as person, contact or name, dates. */
export function LendDialog({ itemId, onClose }: { itemId?: string; onClose(): void }) {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const today = session.env.clock.today();
  const [v, setV] = useState({ item_id: itemId ?? "", title: "", borrower_person_id: "", borrower_contact_id: "", borrower_name: "", lent_date: today, due_date: "", notes: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof v, value: string) => setV((x) => ({ ...x, [k]: value }));
  const save = useMutation({
    mutationFn: () =>
      lendItem(session.ctx(), {
        item_id: v.item_id || null,
        title: v.title || null,
        borrower_person_id: v.borrower_person_id || null,
        borrower_contact_id: v.borrower_contact_id || null,
        borrower_name: v.borrower_name || null,
        lent_date: v.lent_date,
        due_date: v.due_date || null,
        notes: v.notes || null,
      }),
    onSuccess: async () => {
      toast("Udlånet er registreret");
      await qc.invalidateQueries({ queryKey: ["lending"] });
      await qc.invalidateQueries({ queryKey: ["calendar"] });
      onClose();
    },
    onError: (e) => {
      if (e instanceof ValidationError) setErrors(Object.fromEntries(e.issues.map((i) => [i.path, i.message])));
      else toast(errorText(e), "error");
    },
  });
  const err = (k: string) =>
    errors[k] ? (
      <span className="error small" role="alert">
        {errors[k]}
      </span>
    ) : null;
  return (
    <Modal title="Lån noget ud" onClose={onClose} wide>
      <form
        className="entity-form"
        onSubmit={(e) => {
          e.preventDefault();
          setErrors({});
          save.mutate();
        }}
      >
        <div className="grid2">
          <label>
            Genstand
            <RefSelect type="item" labelCol="name" value={v.item_id} onChange={(x) => set("item_id", x)} />
            {err("item_id")}
          </label>
          <label>
            Eller beskriv tingen
            <input value={v.title} onChange={(e) => set("title", e.target.value)} placeholder="Fx Brætspil, stige, bog" disabled={Boolean(v.item_id)} />
          </label>
          <label>
            Låner (person)
            <RefSelect type="person" labelCol="name" value={v.borrower_person_id} onChange={(x) => set("borrower_person_id", x)} createDefaults={{ household: 0 }} />
          </label>
          <label>
            Låner (kontakt)
            <RefSelect type="contact" labelCol="name" value={v.borrower_contact_id} onChange={(x) => set("borrower_contact_id", x)} />
          </label>
          <label>
            Eller lånerens navn
            <input value={v.borrower_name} onChange={(e) => set("borrower_name", e.target.value)} placeholder="Fx Naboen i nr. 5" />
            {err("borrower_name")}
          </label>
          <span />
          <label>
            Udlånt
            <input type="date" required value={v.lent_date} onChange={(e) => set("lent_date", e.target.value)} />
          </label>
          <label>
            Afleveres senest
            <input type="date" value={v.due_date} onChange={(e) => set("due_date", e.target.value)} />
            {err("due_date")}
          </label>
        </div>
        <label>
          Noter
          <textarea rows={2} value={v.notes} onChange={(e) => set("notes", e.target.value)} />
        </label>
        <div className="row">
          <button type="submit" className="primary" disabled={save.isPending}>
            Registrér udlån
          </button>
          <button type="button" onClick={onClose}>
            Annullér
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** On the item: "Udlånt til … siden …" or a button to lend it out. */
export function ItemLending({ itemId }: { itemId: string }) {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [lending, setLending] = useState(false);
  const q = useQuery({ queryKey: ["lending", "item", itemId], queryFn: () => activeLendingForItem(session.archive.db, itemId) });
  const back = useMutation({
    mutationFn: (id: string) => returnLending(session.ctx(), id),
    onSuccess: async () => {
      toast("Genstanden er afleveret");
      await qc.invalidateQueries({ queryKey: ["lending"] });
      await qc.invalidateQueries({ queryKey: ["calendar"] });
    },
  });
  const ro = session.archive.readOnly;
  if (q.data)
    return (
      <p className="small lending-note">
        <StatusBadge kind="today">Udlånt</StatusBadge> til <strong>{q.data.borrower}</strong> siden {formatDate(q.data.lent_date)}
        {q.data.due_date ? `, afleveres ${formatDate(q.data.due_date)}` : ""}.{" "}
        <button className="link" onClick={() => back.mutate(q.data!.id)} disabled={ro}>
          Markér som afleveret
        </button>
      </p>
    );
  return (
    <>
      <button className="link small" onClick={() => setLending(true)} disabled={ro}>
        Lån ud…
      </button>
      {lending && <LendDialog itemId={itemId} onClose={() => setLending(false)} />}
    </>
  );
}
