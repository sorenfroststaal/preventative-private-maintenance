import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, RotateCcw } from "lucide-react";
import {
  deleteItemsPermanently,
  deletionImpact,
  disposalLabel,
  disposeItems,
  DISPOSAL_KINDS,
  listArchivedItems,
  parseDanishAmount,
  restoreItems,
  type DisposalKind,
} from "@ppm/core";
import { errorText, useSession } from "../app/session";
import { useToast } from "../layout/Shell";
import { Modal, rowProps, SearchBox } from "./ui";
import { EmptyState, TextIconButton } from "./visual";
import { RefSelect } from "./EntityForm";
import { formatDate, formatDateTime, formatMoney } from "../lib/format";

type Choice = DisposalKind | "archive" | "delete";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * "Arkivér" for items: choose a reason (given away, given to, sold with price, discarded, other, no reason)
 * or "Slet helt" – the only choice that removes the item for good (spec 03, Afhændelse af genstande).
 */
export function DisposeDialog({ ids, what, onClose, onDone, initial = "given_away" }: { ids: string[]; what: string; onClose(): void; onDone?(): void; initial?: Choice }) {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [choice, setChoice] = useState<Choice>(initial);
  const [date, setDate] = useState(session.env.clock.today());
  const [price, setPrice] = useState("");
  const [personId, setPersonId] = useState("");
  const [note, setNote] = useState("");
  const [alsoGift, setAlsoGift] = useState(true);
  const [withComponents, setWithComponents] = useState(true);
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const impact = useQuery({
    queryKey: ["item", "deletion-impact", ids],
    queryFn: () => deletionImpact(session.archive.db, ids),
    enabled: choice === "delete",
  });
  const save = useMutation({
    mutationFn: async () => {
      const ctx = session.ctx();
      if (choice === "delete") return deleteItemsPermanently(ctx, ids, { withComponents });
      let priceMinor: number | null = null;
      if (choice === "sold" && price.trim()) {
        priceMinor = parseDanishAmount(price.trim());
        if (priceMinor === null) throw new Error("Skriv prisen som fx 1.234,50");
      }
      return disposeItems(ctx, ids, {
        kind: choice === "archive" ? null : choice,
        date,
        priceMinor,
        personId: personId || null,
        note,
        alsoGift: choice === "given_to" && alsoGift,
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries();
      const label = choice === "delete" ? "er slettet helt" : choice === "archive" ? "er arkiveret" : `er arkiveret som "${disposalLabel(choice).toLowerCase()}"`;
      toast(`${what[0]!.toUpperCase()}${what.slice(1)} ${label}`);
      onDone?.();
      onClose();
    },
    onError: (e) => setError(errorText(e)),
  });
  const ro = session.archive.readOnly;
  const needsPerson = choice === "given_to";
  const deleteBlocked = choice === "delete" && confirmText.trim().toLowerCase() !== "slet";
  const options: [Choice, string, string][] = [
    ...DISPOSAL_KINDS.map(([k, l]): [Choice, string, string] => [
      k,
      l,
      k === "given_away" ? "Fx til genbrug eller en ukendt" : k === "given_to" ? "En bestemt person, evt. som gave" : k === "sold" ? "Med pris og evt. køber" : k === "discarded" ? "Kasseret eller afleveret til genbrugsstation" : "Skriv årsagen i noten",
    ]),
    ["archive", "Bare arkivér", "Uden årsag"],
    ["delete", "Slet helt", "Fjernes permanent og kan ikke findes i arkivet"],
  ];
  return (
    <Modal title={`Arkivér ${what}`} onClose={onClose}>
      <form
        className="entity-form"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (needsPerson && !personId) return setError("Vælg, hvem tingen er givet til");
          save.mutate();
        }}
      >
        <fieldset className="choice-list" aria-label="Hvad skete der med tingen?">
          <legend>Hvad skete der med {ids.length === 1 ? "tingen" : "tingene"}?</legend>
          {options.map(([k, l, hint]) => (
            <label key={k} className={`choice${k === "delete" ? " danger" : ""}`}>
              <input type="radio" name="disposal" value={k} checked={choice === k} onChange={() => setChoice(k)} />
              <span>
                <strong>{l}</strong>
                <span className="muted small"> – {hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {choice !== "delete" && choice !== "archive" && (
          <div className="grid2">
            <label>
              Dato
              <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            {choice === "sold" ? (
              <label>
                Pris
                <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Fx 1.250" aria-label="Pris" />
              </label>
            ) : (
              <span />
            )}
            {(choice === "given_to" || choice === "sold") && (
              <label>
                {choice === "sold" ? "Køber (valgfri)" : "Givet til"}
                <RefSelect type="person" labelCol="name" value={personId} onChange={setPersonId} createDefaults={{ household: 0 }} />
              </label>
            )}
            {choice === "given_to" && (
              <label className="checkbox">
                <input type="checkbox" checked={alsoGift} onChange={(e) => setAlsoGift(e.target.checked)} />
                Registrér også som gave
              </label>
            )}
          </div>
        )}
        {choice !== "delete" && (
          <label>
            Note
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        )}
        {choice !== "delete" && <p className="muted small">Tingen og dens komponenter flyttes til Arkiv, hvor de kan findes og gendannes.</p>}

        {choice === "delete" && (
          <div className="banner error">
            <p>
              <strong>Kan ikke fortrydes.</strong> {plural(ids.length, "genstand", "genstande")} slettes permanent
              {impact.data && (
                <>
                  {" "}
                  sammen med {plural(impact.data.documents, "koblet bilag", "koblede bilag")} (selve filerne bliver i arkivet)
                  {impact.data.workOrders > 0 && <>; {plural(impact.data.workOrders, "arbejdsordre", "arbejdsordrer")} beholdes uden genstand</>}
                  {impact.data.lendings + impact.data.gifts > 0 && <>; udlån og gaver beholder navnet</>}
                </>
              )}
              .
            </p>
            {(impact.data?.components ?? 0) > 0 && (
              <label className="checkbox">
                <input type="checkbox" checked={withComponents} onChange={(e) => setWithComponents(e.target.checked)} />
                Slet også {plural(impact.data!.components, "komponent", "komponenter")} (ellers bliver de selvstændige genstande)
              </label>
            )}
            <label>
              Skriv <strong>slet</strong> for at bekræfte
              <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} aria-label="Bekræft sletning" autoComplete="off" />
            </label>
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button type="submit" className={choice === "delete" ? "danger" : "primary"} disabled={ro || save.isPending || deleteBlocked}>
            {choice === "delete" ? "Slet helt" : "Arkivér"}
          </button>
          <button type="button" onClick={onClose}>
            Annullér
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** The "Arkivér" link in an item's detail. */
export function DisposeButton({ id, onDone }: { id: string; onDone?(): void }) {
  const session = useSession();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="link" disabled={session.archive.readOnly} onClick={() => setOpen(true)}>
        Arkivér …
      </button>
      {open && <DisposeDialog ids={[id]} what="genstanden" onClose={() => setOpen(false)} onDone={onDone} />}
    </>
  );
}

/** Bolig og inventar → Arkiv: archived items with reason, date, price and person, searchable and restorable. */
export function ArchiveTab() {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"" | DisposalKind | "none">("");
  const [selected, setSelected] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const list = useQuery({ queryKey: ["item", "archived", q, kind], queryFn: () => listArchivedItems(session.archive.db, { q, kind: kind || undefined }) });
  const restore = useMutation({
    mutationFn: (id: string) => restoreItems(session.ctx(), [id]),
    onSuccess: async (_, id) => {
      const name = list.data?.find((r) => r.id === id)?.name ?? "Genstanden";
      await qc.invalidateQueries();
      setSelected(null);
      toast(`${name} er gendannet`);
    },
    onError: (e) => toast(errorText(e), "error"),
  });
  const ro = session.archive.readOnly;
  const rows = list.data ?? [];
  const sel = rows.find((r) => r.id === selected) ?? null;
  const totalSold = rows.reduce((s, r) => s + (r.disposal_kind === "sold" ? r.disposal_price_minor ?? 0 : 0), 0);
  return (
    <div>
      <div className="row filters">
        <SearchBox value={q} onChange={setQ} placeholder="Søg i arkivet" />
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Årsag">
          <option value="">Alle årsager</option>
          {DISPOSAL_KINDS.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
          <option value="none">Uden årsag</option>
        </select>
        {totalSold > 0 && <span className="muted small">Solgt for i alt {formatMoney(totalSold)}</span>}
      </div>
      {list.isError && <p className="error">Arkivet kunne ikke hentes: {errorText(list.error)}</p>}
      {list.data && rows.length === 0 && !q && !kind ? (
        <EmptyState module="home" text="Når du arkiverer ting, du har givet væk, solgt eller smidt ud, kan du finde dem her igen." />
      ) : (
        <div className="split">
          <div>
            <table className="list" aria-label="Arkiverede genstande">
              <thead>
                <tr>
                  <th>Genstand</th>
                  <th>Årsag</th>
                  <th>Dato</th>
                  <th>Person</th>
                  <th className="num">Pris</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} {...rowProps(r.id === selected, () => setSelected(r.id))}>
                    <td>
                      {r.name}
                      {r.parent_name && <span className="muted small"> · del af {r.parent_name}</span>}
                    </td>
                    <td>{disposalLabel(r.disposal_kind)}</td>
                    <td>{formatDate(r.disposal_date ?? r.archived_at.slice(0, 10))}</td>
                    <td>{r.disposal_person ?? "–"}</td>
                    <td className="num">{r.disposal_price_minor != null ? formatMoney(r.disposal_price_minor) : "–"}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">
                      Intet i arkivet passer til søgningen.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {sel && (
            <aside className="detail" aria-label="Arkiveret genstand">
              <h2>{sel.name}</h2>
              <dl className="facts">
                <dt>Årsag</dt>
                <dd>{disposalLabel(sel.disposal_kind)}</dd>
                {sel.disposal_date && (
                  <>
                    <dt>Dato</dt>
                    <dd>{formatDate(sel.disposal_date)}</dd>
                  </>
                )}
                {sel.disposal_person && (
                  <>
                    <dt>{sel.disposal_kind === "sold" ? "Køber" : "Givet til"}</dt>
                    <dd>{sel.disposal_person}</dd>
                  </>
                )}
                {sel.disposal_price_minor != null && (
                  <>
                    <dt>Pris</dt>
                    <dd>{formatMoney(sel.disposal_price_minor)}</dd>
                  </>
                )}
                {sel.disposal_note && (
                  <>
                    <dt>Note</dt>
                    <dd>{sel.disposal_note}</dd>
                  </>
                )}
                <dt>Arkiveret</dt>
                <dd>{formatDateTime(sel.archived_at)}</dd>
                {sel.parent_name && (
                  <>
                    <dt>Del af</dt>
                    <dd>{sel.parent_name}</dd>
                  </>
                )}
                {sel.location && (
                  <>
                    <dt>Placering</dt>
                    <dd>{sel.location}</dd>
                  </>
                )}
                {sel.components > 0 && (
                  <>
                    <dt>Komponenter</dt>
                    <dd>{sel.components}</dd>
                  </>
                )}
              </dl>
              <div className="row">
                <TextIconButton icon={RotateCcw} className="primary" disabled={ro || restore.isPending} onClick={() => restore.mutate(sel.id)}>
                  Gendan
                </TextIconButton>
                <TextIconButton icon={Archive} className="danger" disabled={ro} onClick={() => setDeleting(sel.id)}>
                  Slet helt …
                </TextIconButton>
              </div>
              {deleting === sel.id && <DisposeDialog ids={[sel.id]} what={`"${sel.name}"`} initial="delete" onClose={() => setDeleting(null)} onDone={() => setSelected(null)} />}
            </aside>
          )}
        </div>
      )}
    </div>
  );
}
