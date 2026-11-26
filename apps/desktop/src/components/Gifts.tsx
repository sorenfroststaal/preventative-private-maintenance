import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Gift } from "lucide-react";
import { deleteRow, giftSummary, listGifts, type GiftRow } from "@ppm/core";
import { errorText, useSession } from "../app/session";
import { useToast } from "../layout/Shell";
import { Modal, rowProps } from "./ui";
import { EmptyState, StatusBadge, TextIconButton } from "./visual";
import { EntityForm, RefSelect } from "./EntityForm";
import { formatDate, formatMoney } from "../lib/format";

/** Bolig og inventar → Gaver: gifts given to and received from people, also outside the household (migration 0011). */
export function GiftsTab() {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [direction, setDirection] = useState<"" | "given" | "received">("");
  const [personId, setPersonId] = useState("");
  const [year, setYear] = useState("");
  const db = session.archive.db;
  const all = useQuery({ queryKey: ["gift", "list"], queryFn: () => listGifts(db) });
  const summary = useQuery({ queryKey: ["gift", "summary", year], queryFn: () => giftSummary(db, { year: year ? Number(year) : undefined }) });
  const years = [...new Set((all.data ?? []).map((g) => g.gift_date.slice(0, 4)))].sort().reverse();
  const shown = (all.data ?? []).filter((g) => (!direction || g.direction === direction) && (!personId || g.person_id === personId) && (!year || g.gift_date.startsWith(year)));
  const selectedId = params.get("gave");
  const selected = (all.data ?? []).find((g) => g.id === selectedId) ?? null;
  const ro = session.archive.readOnly;
  const remove = useMutation({
    mutationFn: (g: GiftRow) => deleteRow(session.ctx(), "gift", g.id),
    onSuccess: async (_, g) => {
      toast(`Gaven "${g.title}" er slettet`);
      setConfirmDelete(false);
      setParams({ tab: "gifts" });
      await qc.invalidateQueries({ queryKey: ["gift"] });
      await qc.invalidateQueries({ queryKey: ["calendar"] });
    },
    onError: (e) => toast(errorText(e), "error"),
  });
  const open = (id: string) => {
    setConfirmDelete(false);
    setParams({ tab: "gifts", gave: id });
  };
  return (
    <div>
      <div className="row filters">
        <TextIconButton icon={Gift} className="primary" onClick={() => setCreating(true)} disabled={ro}>
          Registrér gave
        </TextIconButton>
        <select value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)} aria-label="Givet eller fået">
          <option value="">Givet og fået</option>
          <option value="given">Givet</option>
          <option value="received">Fået</option>
        </select>
        <RefSelect type="person" labelCol="name" value={personId} onChange={setPersonId} emptyLabel="Alle personer" allowCreate={false} />
        <select value={year} onChange={(e) => setYear(e.target.value)} aria-label="År">
          <option value="">Alle år</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>
      {all.isError && <p className="error">Gaverne kunne ikke hentes: {errorText(all.error)}</p>}
      {all.data?.length === 0 ? (
        <EmptyState
          module="home"
          text="Husk hvad du har givet familie og venner, og hvad du har fået, så du ikke giver det samme to gange."
          action="Registrér din første gave"
          onAction={() => setCreating(true)}
          disabled={ro}
        />
      ) : (
        <div className="split">
          <div>
            <table className="list">
              <thead>
                <tr>
                  <th>Dato</th>
                  <th>Gave</th>
                  <th>Til / fra</th>
                  <th>Anledning</th>
                  <th className="num">Pris</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((g) => (
                  <tr key={g.id} {...rowProps(g.id === selectedId, () => open(g.id))}>
                    <td>{formatDate(g.gift_date)}</td>
                    <td>{g.title}</td>
                    <td>
                      <StatusBadge kind={g.direction === "given" ? "today" : "done"}>{g.direction === "given" ? "Til" : "Fra"}</StatusBadge> {g.person}
                    </td>
                    <td>{g.occasion ?? "–"}</td>
                    <td className="num">{g.amount_minor != null ? formatMoney(g.amount_minor) : "–"}</td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">
                      Ingen gaver passer til filtrene.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {(summary.data ?? []).length > 0 && (
              <div className="panel">
                <h3>Pr. person{year ? ` i ${year}` : ""}</h3>
                <table className="list">
                  <thead>
                    <tr>
                      <th>Person</th>
                      <th className="num">Givet</th>
                      <th className="num">Brugt</th>
                      <th>Senest givet</th>
                      <th className="num">Fået</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.data!.map((s) => (
                      <tr key={s.person_id} {...rowProps(s.person_id === personId, () => setPersonId(s.person_id === personId ? "" : s.person_id))}>
                        <td>{s.person}</td>
                        <td className="num">{s.given}</td>
                        <td className="num">{formatMoney(s.given_minor)}</td>
                        <td>{s.last_given ? formatDate(s.last_given) : "–"}</td>
                        <td className="num">{s.received}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {selected && (
            <aside className="detail" aria-label="Gave" key={selected.id}>
              <h2>{selected.title}</h2>
              <EntityForm type="gift" row={selected} invalidate={[["gift"], ["calendar"]]} />
              {!ro &&
                (confirmDelete ? (
                  <p className="row">
                    <span>Slet gaven for altid?</span>
                    <button className="danger" onClick={() => remove.mutate(selected)} disabled={remove.isPending}>
                      Ja, slet
                    </button>
                    <button onClick={() => setConfirmDelete(false)}>Fortryd</button>
                  </p>
                ) : (
                  <button className="link danger" onClick={() => setConfirmDelete(true)}>
                    Slet gave
                  </button>
                ))}
            </aside>
          )}
        </div>
      )}
      {creating && (
        <Modal title="Registrér gave" onClose={() => setCreating(false)} wide>
          <EntityForm
            type="gift"
            defaults={{ direction: "given", gift_date: session.env.clock.today() }}
            invalidate={[["gift"], ["calendar"]]}
            submitLabel="Gem gave"
            onSaved={(r) => {
              setCreating(false);
              open(String(r.id));
            }}
            onCancel={() => setCreating(false)}
          />
          <p className="small muted">Personen kan være én uden for husstanden. Vælg "+ Ny person…" for at oprette fx en ven eller et familiemedlem.</p>
        </Modal>
      )}
    </div>
  );
}
