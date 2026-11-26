/** "Folk": the household and people outside it, with gifts and lending per person. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gift, HandHelping, UserPlus } from "lucide-react";
import { api } from "./api";
import type { GiftValue } from "./forms";
import { errorText, fmtDate, Header, kr } from "./ui";

interface PersonRow {
  id: string;
  name: string;
  relation: string | null;
  household: 0 | 1;
  gifts: number;
  lent: number;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

export function PeopleScreen({ onOpen, onNew }: { onOpen(id: string): void; onNew(): void }) {
  const q = useQuery({ queryKey: ["people"], queryFn: () => api<PersonRow[]>("/api/people") });
  const group = (title: string, rows: PersonRow[]) =>
    rows.length > 0 && (
      <section>
        <h2>{title}</h2>
        <ul className="card rows">
          {rows.map((p) => (
            <li key={p.id}>
              <button className="row link-row" onClick={() => onOpen(p.id)}>
                <span className={`avatar${p.household ? "" : " other"}`} aria-hidden="true">
                  {initials(p.name)}
                </span>
                <div className="grow">
                  <div>{p.name}</div>
                  {(p.relation || p.gifts || p.lent) ? (
                    <div className="small muted">
                      {[p.relation, p.gifts ? `${p.gifts} ${p.gifts === 1 ? "gave" : "gaver"}` : null, p.lent ? `låner ${p.lent} ${p.lent === 1 ? "ting" : "ting"}` : null].filter(Boolean).join(" · ")}
                    </div>
                  ) : null}
                </div>
                <span className="chev" aria-hidden="true">
                  ›
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    );
  return (
    <>
      <Header title="Folk">
        <button className="icon-btn" onClick={onNew} aria-label="Ny person">
          <UserPlus size={22} aria-hidden="true" />
        </button>
      </Header>
      {q.isLoading && <p className="muted">Henter …</p>}
      {q.error && <p className="banner error">{errorText(q.error)}</p>}
      {q.data && group("Husstanden", q.data.filter((p) => p.household === 1))}
      {q.data && group("Familie, venner og andre", q.data.filter((p) => p.household === 0))}
      {q.data && q.data.filter((p) => p.household === 0).length === 0 && (
        <p className="empty">
          Tilføj familie og venner, så du kan registrere, hvad du låner ud og giver dem.
          <br />
          <button className="pill" onClick={onNew}>
            Tilføj en person
          </button>
        </p>
      )}
    </>
  );
}

interface PersonDetailData {
  person: { id: string; name: string; relation: string | null; household: 0 | 1 };
  gifts: GiftValue[];
  lendings: { id: string; thing: string; since: string; due: string | null; returned: string | null; overdue: boolean }[];
}

export function PersonDetail({ id, onBack, onGift, onEditGift, onLend }: { id: string; onBack(): void; onGift(): void; onEditGift(g: GiftValue): void; onLend(): void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["person", id], queryFn: () => api<PersonDetailData>(`/api/people/${id}`) });
  const ret = useMutation({
    mutationFn: (lendingId: string) => api(`/api/lending/${lendingId}/return`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries(),
  });
  const d = q.data;
  const active = (d?.lendings ?? []).filter((l) => !l.returned);
  const given = (d?.gifts ?? []).filter((g) => g.direction === "given");
  const received = (d?.gifts ?? []).filter((g) => g.direction === "received");
  const giftList = (title: string, gifts: GiftValue[]) =>
    gifts.length > 0 && (
      <section className="card">
        <h2>
          {title} <span className="count">{gifts.length}</span>
        </h2>
        <ul className="rows">
          {gifts.map((g) => (
            <li key={g.id}>
              <button className="row link-row" onClick={() => onEditGift(g)}>
                <div className="grow">
                  <div>{g.title}</div>
                  <div className="small muted">{[g.occasion, fmtDate(g.date)].filter(Boolean).join(" · ")}</div>
                </div>
                <span className="small muted">{kr(g.amount_minor)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    );
  return (
    <>
      <Header title={d?.person.name ?? ""} onBack={onBack} />
      {d?.person.relation && <p className="muted greeting">{d.person.relation}{d.person.household ? " · husstanden" : ""}</p>}
      {q.error && <p className="banner error">{errorText(q.error)}</p>}
      <div className="action-row">
        <button className="pill big-pill" onClick={onGift}>
          <Gift size={18} aria-hidden="true" /> Registrér gave
        </button>
        <button className="pill big-pill" onClick={onLend}>
          <HandHelping size={18} aria-hidden="true" /> Lån noget ud
        </button>
      </div>
      {active.length > 0 && (
        <section className="card">
          <h2>Låner nu</h2>
          <ul className="rows">
            {active.map((l) => (
              <li key={l.id} className="row">
                <div className="grow">
                  <div>{l.thing}</div>
                  <div className={`small ${l.overdue ? "danger" : "muted"}`}>
                    siden {fmtDate(l.since)}
                    {l.due ? ` · afleveres ${fmtDate(l.due)}` : ""}
                  </div>
                </div>
                <button className="pill" onClick={() => ret.mutate(l.id)} disabled={ret.isPending}>
                  Afleveret
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {giftList("Gaver givet", given)}
      {giftList("Gaver fået", received)}
      {d && !d.gifts.length && !active.length && <p className="empty">Ingen gaver eller udlån endnu.</p>}
    </>
  );
}
