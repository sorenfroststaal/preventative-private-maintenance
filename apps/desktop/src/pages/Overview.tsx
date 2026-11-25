import { useState } from "react";
import { OnboardingOffer } from "../components/Onboarding";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { completeOccurrence, dashboard, setOccurrenceDueDate, type DashboardTask } from "@ppm/core";
import { errorText, useSession } from "../app/session";
import { daysBetween, formatDate, formatDateTime } from "../lib/format";
import { Modal } from "../components/ui";
import { CalendarClock, CircleHelp, Hourglass, TriangleAlert } from "lucide-react";
import { HBar, LineChart } from "../components/charts";
import { KpiCard, ModuleIcon, moduleStyle, StatusBadge } from "../components/visual";
import { uiModuleOf, type ModuleId } from "../lib/modules";
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

  const financeMax = Math.max(1, ...d.finance.rows.map((r) => Math.max(r.budget, r.actual)));

  return (
    <section>
      <PageTitle />
      <OnboardingOffer />
      <div className="kpis">
        <KpiCard module="tasks" icon={TriangleAlert} n={d.overdue.length} label="Forfaldne" target="forfaldne" />
        <KpiCard module="tasks" icon={CalendarClock} n={d.upcoming.length} label={`Næste ${d.horizonDays} dage`} target="naeste" />
        <KpiCard module="insurance" icon={Hourglass} n={d.expiring.length} label="Udløber snart" target="udloeber" />
        <KpiCard module="home" icon={CircleHelp} n={missingCount} label="Mangler oplysninger" target="mangler" />
      </div>
      {d.meals && (
        <div className="panel module" style={moduleStyle("food")}>
          <h2>
            <ModuleIcon id="food" /> Madplan
          </h2>
          <div className="overview-meals">
            {(["today", "tomorrow"] as const).map((k) => (
              <div key={k}>
                <h3>{k === "today" ? "I dag" : "I morgen"}</h3>
                {d.meals![k].length === 0 ? (
                  <p className="muted small">Intet planlagt.</p>
                ) : (
                  <ul className="plain">
                    {d.meals![k].map((m) => (
                      <li key={m.id}>
                        {m.label}
                        {m.warnings.map((w) => (
                          <span key={w.text}>
                            {" "}
                            <StatusBadge kind="allergy">{w.text}</StatusBadge>
                          </span>
                        ))}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
          <Link to="/madplan">Se ugens madplan</Link>
        </div>
      )}
      <TaskSection id="forfaldne" title="Forfaldne" rows={d.overdue} today={today} empty="Ingen forfaldne opgaver." />
      <TaskSection id="naeste" title={`Næste ${d.horizonDays} dage`} rows={d.upcoming} today={today} empty="Intet de næste dage." />
      <TaskSection id="udloeber" title="Udløber snart" rows={d.expiring} today={today} empty="Ingen garantier, policer, bindinger eller recepter udløber de næste 60 dage." />

      <div className="panel module" id="mangler" tabIndex={-1} style={moduleStyle("home")}>
        <h2>
          <ModuleIcon id="home" /> Mangler oplysninger <span className="count">{missingCount}</span>
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

      <div className="panel module" style={moduleStyle("ai")}>
        <h2>
          <ModuleIcon id="ai" /> AI-indbakke <span className="count">{d.aiPending}</span>
        </h2>
        <p className="muted">
          {d.aiPending ? <Link to="/ai">{d.aiPending} forslag venter på godkendelse</Link> : "Ingen forslag venter."}
        </p>
      </div>

      <div className="panel module" style={moduleStyle("finance")}>
        <h2>
          <ModuleIcon id="finance" /> Økonomi denne måned
        </h2>
        <div className="finance-grid">
          <div>
            {d.finance.rows.length === 0 ? (
              <p className="muted">
                Ingen budget eller posteringer for måneden. <Link to="/okonomi">Gå til Økonomi</Link>
              </p>
            ) : (
              d.finance.rows.map((r) => <HBar key={r.category_id} label={r.name} value={r.actual} budget={r.budget} max={financeMax} />)
            )}
          </div>
          <LineChart points={d.spending.map((m) => ({ x: m.month, y: m.expense_minor }))} label="Forbrug de seneste 6 måneder" />
        </div>
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

function PageTitle() {
  return (
    <div className="page-header">
      <div className="title">
        <ModuleIcon id="overview" large />
        <h1>Overblik</h1>
      </div>
    </div>
  );
}

function TaskSection({ id, title, rows, today, empty }: { id: string; title: string; rows: DashboardTask[]; today: string; empty: string }) {
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
    <div className="panel module" id={id} tabIndex={-1} style={moduleStyle("tasks")}>
      <h2>
        <ModuleIcon id="tasks" /> {title} <span className="count">{rows.length}</span>
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
                <span className="with-icon">
                  <ModuleIcon id={uiModuleOf(t.module) as ModuleId} /> {t.title}
                </span>
                <span>
                  {formatDate(t.due_date)}{" "}
                  {days !== null && days < 0 ? (
                    <StatusBadge kind="overdue">{-days} dage over</StatusBadge>
                  ) : days === 0 ? (
                    <StatusBadge kind="today">I dag</StatusBadge>
                  ) : days !== null ? (
                    <span className="small muted">(om {days} dage)</span>
                  ) : null}
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
