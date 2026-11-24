import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { completeOccurrence, dashboard, setOccurrenceDueDate, type DashboardTask } from "@ppm/core";
import { errorText, useSession } from "../app/session";
import { daysBetween, formatDate, formatDateTime, formatMoney } from "../lib/format";
import { Modal } from "../components/ui";
import { useToast } from "../layout/Shell";

const TARGET_ROUTE: Record<string, string> = {
  item: "/bolig?id=",
  vehicle: "/bil?id=",
  policy: "/forsikring?id=",
  person: "/helbred?person=",
  building_part: "/bolig?part=",
};

/** Dashboard in the fixed order of spec 04. */
export function Overview() {
  const session = useSession();
  const today = session.env.clock.today();
  const q = useQuery({ queryKey: ["dashboard", today, session.user.id], queryFn: () => dashboard(session.archive.db, { today, userId: session.user.id }) });
  const d = q.data;
  if (!d) return <section><h1>Overblik</h1><p className="muted">Indlæser…</p></section>;
  const m = d.missing;
  const missingCount = m.itemsWithoutReceipt.length + m.tasksWithoutDate.length + m.policiesWithoutRenewal.length + m.vehiclesWithoutOdometer.length;

  return (
    <section>
      <h1>Overblik</h1>
      <TaskSection title="Forfaldne" rows={d.overdue} today={today} empty="Ingen forfaldne opgaver." />
      <TaskSection title={`Næste ${d.horizonDays} dage`} rows={d.upcoming} today={today} empty="Intet de næste dage." />
      <TaskSection title="Udløber snart" rows={d.expiring} today={today} empty="Ingen garantier, policer, bindinger eller recepter udløber de næste 60 dage." />

      <div className="panel">
        <h2>
          Mangler oplysninger <span className="count">{missingCount}</span>
        </h2>
        {missingCount === 0 && <p className="muted">Intet mangler.</p>}
        <ul className="plain">
          {m.itemsWithoutReceipt.map((i) => (
            <li key={`i${i.id}`} className="line">
              <span>{i.name}</span>
              <span className="muted">Pris, men ingen kvittering</span>
              <Link to={`/bolig?id=${i.id}`}>Åbn</Link>
            </li>
          ))}
          {m.tasksWithoutDate.map((t) => (
            <li key={`t${t.occurrence_id}`} className="line">
              <span>{t.title}</span>
              <span className="muted">Dato mangler</span>
              <Link to={`/opgaver?task=${t.task_id}`}>Angiv dato</Link>
            </li>
          ))}
          {m.policiesWithoutRenewal.map((p) => (
            <li key={`p${p.id}`} className="line">
              <span>{p.title}</span>
              <span className="muted">Fornyelsesdato mangler</span>
              <Link to={`/forsikring?id=${p.id}`}>Åbn</Link>
            </li>
          ))}
          {m.vehiclesWithoutOdometer.map((v) => (
            <li key={`v${v.id}`} className="line">
              <span>{v.name}</span>
              <span className="muted">Ingen km-stand det seneste år</span>
              <Link to={`/bil?id=${v.id}&tab=km`}>Åbn</Link>
            </li>
          ))}
        </ul>
      </div>

      <div className="panel">
        <h2>
          AI-indbakke <span className="count">{d.aiPending}</span>
        </h2>
        <p className="muted">
          {d.aiPending ? <Link to="/ai">{d.aiPending} forslag venter på godkendelse</Link> : "Ingen forslag venter."}
        </p>
      </div>

      <div className="panel">
        <h2>Økonomi denne måned</h2>
        {d.finance.rows.length === 0 ? (
          <p className="muted">
            Ingen budget eller posteringer for måneden. <Link to="/okonomi">Gå til Økonomi</Link>
          </p>
        ) : (
          <table className="list compact">
            <thead>
              <tr>
                <th>Kategori</th>
                <th className="num">Budget</th>
                <th className="num">Faktisk</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {d.finance.rows.map((r) => {
                const pct = r.budget ? Math.min(100, Math.round((r.actual / r.budget) * 100)) : 0;
                const over = r.kind === "expense" && r.budget > 0 && r.actual > r.budget;
                return (
                  <tr key={r.category_id}>
                    <td>{r.name}</td>
                    <td className="num">{formatMoney(r.budget)}</td>
                    <td className={`num ${over ? "danger" : ""}`}>{formatMoney(r.actual)}</td>
                    <td className="bar-cell">
                      {r.budget > 0 && (
                        <div className="bar" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${r.name} ${pct}% af budget`}>
                          <div className={`bar-fill ${over ? "over" : ""}`} style={{ width: `${pct}%` }} />
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {d.finance.uncategorized > 0 && (
          <p className="small">
            <Link to="/okonomi">{d.finance.uncategorized} posteringer uden kategori</Link>
          </p>
        )}
      </div>

      {d.backup.due && (
        <div className="warning">
          {d.backup.lastAt ? `Sidste backup blev taget ${formatDateTime(d.backup.lastAt)}.` : "Der er endnu ikke taget backup af arkivet."}{" "}
          <Link to="/indstillinger">Tag backup nu</Link>
        </div>
      )}
    </section>
  );
}

function TaskSection({ title, rows, today, empty }: { title: string; rows: DashboardTask[]; today: string; empty: string }) {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [postpone, setPostpone] = useState<DashboardTask | null>(null);
  const [date, setDate] = useState("");
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["dashboard"] }), qc.invalidateQueries({ queryKey: ["tasks"] })]);
  const done = useMutation({
    mutationFn: (t: DashboardTask) => completeOccurrence(session.ctx(), t.occurrence_id, { completedDate: today }),
    onSuccess: async (r) => {
      toast(r.next ? `Udført. Næste gang: ${formatDate(String(r.next.due_date))}` : "Udført");
      await refresh();
    },
    onError: (e) => toast(errorText(e), "error"),
  });
  const move = useMutation({
    mutationFn: () => setOccurrenceDueDate(session.ctx(), postpone!.occurrence_id, date),
    onSuccess: async () => {
      setPostpone(null);
      await refresh();
    },
  });
  return (
    <div className="panel">
      <h2>
        {title} <span className="count">{rows.length}</span>
      </h2>
      {rows.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <ul className="plain">
          {rows.map((t) => {
            const days = t.due_date ? daysBetween(today, t.due_date) : null;
            const target = t.target_type && TARGET_ROUTE[t.target_type] ? `${TARGET_ROUTE[t.target_type]}${t.target_id}` : `/opgaver?task=${t.task_id}`;
            return (
              <li key={t.occurrence_id} className="line actions">
                <span>{t.title}</span>
                <span className={days !== null && days < 0 ? "danger" : ""}>
                  {formatDate(t.due_date)}
                  {days !== null && <span className="small muted"> ({days < 0 ? `${-days} dage over` : days === 0 ? "i dag" : `om ${days} dage`})</span>}
                </span>
                <span className="row tight">
                  <button onClick={() => done.mutate(t)} disabled={session.archive.readOnly}>
                    Udført
                  </button>
                  <button
                    onClick={() => {
                      setPostpone(t);
                      setDate(t.due_date ?? today);
                    }}
                    disabled={session.archive.readOnly}
                  >
                    Udskyd
                  </button>
                  <Link to={target}>Åbn</Link>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {postpone && (
        <Modal title={`Udskyd: ${postpone.title}`} onClose={() => setPostpone(null)}>
          <label>
            Ny dato
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <button className="primary" onClick={() => move.mutate()} disabled={!date}>
            Gem
          </button>
        </Modal>
      )}
    </div>
  );
}
