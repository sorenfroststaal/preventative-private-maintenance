import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { addDays, getSetting, listTasksWithOpen, type TaskListRow } from "@ppm/core";
import { useSession } from "../app/session";
import { daysBetween, formatDate, formatDateTime } from "../lib/format";

export function Overview() {
  const { archive, env } = useSession();
  const today = env.clock.today();
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: () => listTasksWithOpen(archive.db) });
  const horizon = useQuery({
    queryKey: ["setting", "dashboard.horizon_days"],
    queryFn: async () => (await getSetting<number>(archive.db, "dashboard.horizon_days")) ?? 30,
  });
  const lastBackup = useQuery({
    queryKey: ["setting", "backup.last_at"],
    queryFn: async () => (await getSetting<string>(archive.db, "backup.last_at")) ?? null,
  });

  const rows = (tasks.data ?? []).filter((t) => t.occurrence_id && t.status === "active");
  const until = addDays(today, horizon.data ?? 30);
  const overdue = rows.filter((t) => t.due_date && t.due_date < today);
  const upcoming = rows.filter((t) => t.due_date && t.due_date >= today && t.due_date <= until);
  const missing = rows.filter((t) => !t.due_date);
  const backupOld = !lastBackup.data || daysBetween(lastBackup.data.slice(0, 10), today) > 30;

  return (
    <section>
      <h1>Overblik</h1>
      <TaskSection title="Forfaldne" rows={overdue} today={today} empty="Ingen forfaldne opgaver." />
      <TaskSection title={`Næste ${horizon.data ?? 30} dage`} rows={upcoming} today={today} empty="Intet de næste dage." />
      <TaskSection title="Mangler oplysninger" rows={missing} today={today} empty="Alle opgaver har en dato." missing />
      {lastBackup.isSuccess && backupOld && (
        <div className="warning">
          {lastBackup.data
            ? `Sidste backup blev taget ${formatDateTime(lastBackup.data)}.`
            : "Der er endnu ikke taget backup af arkivet."}{" "}
          <Link to="/indstillinger">Tag backup nu</Link>
        </div>
      )}
      <p className="small muted">Udløbsfrister, AI-indbakke og økonomi kommer på overblikket i fase 2 og 3.</p>
    </section>
  );
}

function TaskSection(props: { title: string; rows: TaskListRow[]; today: string; empty: string; missing?: boolean }) {
  return (
    <div className="panel">
      <h2>
        {props.title} <span className="count">{props.rows.length}</span>
      </h2>
      {props.rows.length === 0 ? (
        <p className="muted">{props.empty}</p>
      ) : (
        <ul className="plain">
          {props.rows.map((t) => (
            <li key={t.task_id} className="line">
              <span>{t.title}</span>
              <span className={props.missing ? "muted" : t.due_date! < props.today ? "danger" : ""}>
                {props.missing ? "Dato mangler" : formatDate(t.due_date)}
              </span>
              <Link to={`/opgaver?task=${t.task_id}`}>Åbn</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
