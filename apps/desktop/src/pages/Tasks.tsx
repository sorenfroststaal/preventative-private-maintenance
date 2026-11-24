import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  completeOccurrence,
  createTask,
  listOccurrenceHistory,
  listTasksWithOpen,
  parseRecurrence,
  setOccurrenceDueDate,
  type TaskListRow,
} from "@ppm/core";
import { errorText, useSession } from "../app/session";
import { describeRecurrence, formatDate, MODULE_LABELS, MONTH_NAMES } from "../lib/format";
import { emptyRecurrenceForm, toRecurrence, type RecurrenceFormState } from "../lib/recurrenceForm";
import { useToast } from "../layout/Shell";
import { EmptyState, PageTitle } from "../components/visual";

export function Tasks() {
  const { archive } = useSession();
  const [params, setParams] = useSearchParams();
  const [module, setModule] = useState("");
  const [showNew, setShowNew] = useState(false);
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: () => listTasksWithOpen(archive.db) });
  const selectedId = params.get("task");
  const rows = (tasks.data ?? []).filter((t) => !module || t.module === module);
  const selected = tasks.data?.find((t) => t.task_id === selectedId) ?? null;

  return (
    <section>
      <div className="page-header">
        <PageTitle module="tasks" />
        <button className="primary" onClick={() => setShowNew(true)} disabled={archive.readOnly}>
          Ny opgave
        </button>
      </div>
      {showNew && <NewTaskForm onClose={() => setShowNew(false)} />}
      <div className="row filters">
        <label>
          Modul
          <select value={module} onChange={(e) => setModule(e.target.value)}>
            <option value="">Alle</option>
            {Object.entries(MODULE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="split">
        <table className="list">
          <thead>
            <tr>
              <th>Opgave</th>
              <th>Modul</th>
              <th>Gentagelse</th>
              <th>Næste</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr
                key={t.task_id}
                className={t.task_id === selectedId ? "selected" : ""}
                tabIndex={0}
                onClick={() => setParams({ task: t.task_id })}
                onKeyDown={(e) => e.key === "Enter" && setParams({ task: t.task_id })}
              >
                <td>{t.title}</td>
                <td>{MODULE_LABELS[t.module] ?? t.module}</td>
                <td>{describeRecurrence(parseRecurrence(t.recurrence_json))}</td>
                <td>{t.occurrence_id ? (t.due_date ? formatDate(t.due_date) : <span className="muted">Dato mangler</span>) : "Afsluttet"}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4}>
                  <EmptyState module="tasks" text="Saml tilbagevendende opgaver med påmindelser ét sted." action="Opret din første opgave" onAction={() => setShowNew(true)} disabled={archive.readOnly} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {selected && <TaskDetail key={`${selected.task_id}:${selected.occurrence_id ?? ""}`} task={selected} />}
      </div>
    </section>
  );
}

function TaskDetail({ task }: { task: TaskListRow }) {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const today = session.env.clock.today();
  const [completedDate, setCompletedDate] = useState(today);
  const [note, setNote] = useState("");
  const [postpone, setPostpone] = useState(task.due_date ?? "");
  const history = useQuery({
    queryKey: ["task-history", task.task_id],
    queryFn: () => listOccurrenceHistory(session.archive.db, task.task_id),
  });
  const refresh = () =>
    Promise.all([qc.invalidateQueries({ queryKey: ["tasks"] }), qc.invalidateQueries({ queryKey: ["task-history", task.task_id] })]);

  const complete = useMutation({
    mutationFn: (skip: boolean) =>
      completeOccurrence(session.ctx(), task.occurrence_id!, { completedDate, note: note || null, skip }),
    onSuccess: async (r) => {
      setNote("");
      toast(r.next ? `Næste gang: ${formatDate(r.next.due_date as string)}` : "Opgaven er afsluttet");
      await refresh();
    },
    onError: (e) => toast(errorText(e), "error"),
  });
  const move = useMutation({
    mutationFn: () => setOccurrenceDueDate(session.ctx(), task.occurrence_id!, postpone || null),
    onSuccess: refresh,
    onError: (e) => toast(errorText(e), "error"),
  });

  return (
    <aside className="detail" aria-label="Opgavedetaljer">
      <h2>{task.title}</h2>
      <p className="muted">{describeRecurrence(parseRecurrence(task.recurrence_json))}</p>
      {task.occurrence_id ? (
        <>
          <p>
            Forfalder: <strong>{task.due_date ? formatDate(task.due_date) : "dato mangler"}</strong>
          </p>
          <fieldset disabled={session.archive.readOnly}>
            <legend>Markér som udført</legend>
            <label>
              Udført dato
              <input type="date" value={completedDate} onChange={(e) => setCompletedDate(e.target.value)} />
            </label>
            <label>
              Note
              <input value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <div className="row">
              <button className="primary" onClick={() => complete.mutate(false)} disabled={complete.isPending}>
                Udført
              </button>
              <button onClick={() => complete.mutate(true)} disabled={complete.isPending}>
                Spring over
              </button>
            </div>
          </fieldset>
          <fieldset disabled={session.archive.readOnly}>
            <legend>{task.due_date ? "Udskyd" : "Angiv dato"}</legend>
            <div className="row">
              <input type="date" aria-label="Ny dato" value={postpone} onChange={(e) => setPostpone(e.target.value)} />
              <button onClick={() => move.mutate()} disabled={move.isPending}>
                Gem dato
              </button>
            </div>
          </fieldset>
        </>
      ) : (
        <p className="muted">Ingen åben forekomst.</p>
      )}
      <h3>Historik</h3>
      <ul className="plain">
        {(history.data ?? []).map((o) => (
          <li key={String(o.id)} className="line">
            <span>{formatDate(o.completed_date as string)}</span>
            <span>{o.status === "done" ? "Udført" : "Sprunget over"}</span>
            <span className="muted">{(o.note as string) ?? ""}</span>
          </li>
        ))}
        {history.data?.length === 0 && <li className="muted">Ingen historik endnu.</li>}
      </ul>
    </aside>
  );
}

function NewTaskForm({ onClose }: { onClose(): void }) {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [module, setModule] = useState("maintenance");
  const [description, setDescription] = useState("");
  const [due, setDue] = useState("");
  const [rec, setRec] = useState<RecurrenceFormState>(emptyRecurrenceForm);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = toRecurrence(rec);
    if ("error" in r) return setError(r.error);
    try {
      await createTask(session.ctx(), {
        title,
        module: module as never,
        description: description || null,
        recurrence: r.value,
        firstDueDate: due || null,
      });
      await qc.invalidateQueries({ queryKey: ["tasks"] });
      toast("Opgaven er oprettet");
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  }

  const set = (patch: Partial<RecurrenceFormState>) => setRec((r) => ({ ...r, ...patch }));

  return (
    <form className="panel" onSubmit={submit} aria-label="Ny opgave">
      <h2>Ny opgave</h2>
      <div className="grid2">
        <label>
          Titel
          <input required autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          Modul
          <select value={module} onChange={(e) => setModule(e.target.value)}>
            {Object.entries(MODULE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="span2">
          Beskrivelse
          <input value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label>
          Gentagelse
          <select value={rec.kind} onChange={(e) => set({ kind: e.target.value as RecurrenceFormState["kind"] })}>
            <option value="none">Ingen (engangsopgave)</option>
            <option value="fixed">Fast dato</option>
            <option value="interval">Interval efter udførelse</option>
          </select>
        </label>
        {rec.kind !== "none" && (
          <div className="row">
            <label>
              Hver
              <input type="number" min={1} value={rec.every} onChange={(e) => set({ every: e.target.value })} className="short" />
            </label>
            <label>
              Enhed
              <select value={rec.unit} onChange={(e) => set({ unit: e.target.value as RecurrenceFormState["unit"] })}>
                <option value="day">dag(e)</option>
                <option value="week">uge(r)</option>
                <option value="month">måned(er)</option>
                <option value="year">år</option>
              </select>
            </label>
            {rec.kind === "fixed" && rec.unit === "year" && (
              <label>
                Måned
                <select value={rec.month} onChange={(e) => set({ month: e.target.value })}>
                  {MONTH_NAMES.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {rec.kind === "fixed" && (rec.unit === "year" || rec.unit === "month") && (
              <label>
                Dag
                <input type="number" min={1} max={31} value={rec.day} onChange={(e) => set({ day: e.target.value })} className="short" />
              </label>
            )}
          </div>
        )}
        <label>
          Første forfaldsdato
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          <span className="small muted">
            {rec.kind === "fixed" ? "Tom: beregnes ud fra den faste dato." : "Tom: markeres som manglende dato."}
          </span>
        </label>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row">
        <button className="primary" type="submit">
          Opret
        </button>
        <button type="button" onClick={onClose}>
          Annullér
        </button>
      </div>
    </form>
  );
}
