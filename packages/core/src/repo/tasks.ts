import type { DbAdapter } from "../db/adapter";
import type { Row } from "../domain/registry";
import { zDate, zRecurrence, type EntityInput, type Recurrence } from "../domain/schemas";
import { firstDueDate, nextDueDate } from "../recurrence/next";
import { createEntity, mustGet, parseOrThrow, updateEntity, ValidationError, type Ctx } from "./entities";

export function parseRecurrence(json: unknown): Recurrence | null {
  if (json === null || json === undefined || json === "") return null;
  const value = typeof json === "string" ? JSON.parse(json) : json;
  return parseOrThrow(zRecurrence, value, "task");
}

export type NewTask = Omit<EntityInput<"task">, "recurrence_json"> & {
  recurrence?: Recurrence | null;
  /** Due date of the first occurrence. If omitted, derived for fixed patterns, else missing. */
  firstDueDate?: string | null;
};

/** Creates a task and its first open occurrence in one transaction. */
export async function createTask(ctx: Ctx, input: NewTask): Promise<{ task: Row; occurrence: Row }> {
  const { recurrence, firstDueDate: due, ...rest } = input;
  const rec = recurrence ? parseRecurrence(recurrence) : null;
  if (due) parseOrThrow(zDate, due, "task_occurrence");
  return ctx.db.transaction(async (tx) => {
    const c = { ...ctx, db: tx };
    const task = await createEntity(c, "task", {
      ...rest,
      recurrence_json: rec ? JSON.stringify(rec) : null,
    });
    const occurrence = await createEntity(c, "task_occurrence", {
      task_id: String(task.id),
      due_date: due ?? firstDueDate(rec, ctx.clock.today()),
      status: "open",
    });
    return { task, occurrence };
  });
}

export async function getOpenOccurrence(db: DbAdapter, taskId: string): Promise<Row | null> {
  const r = await db.select<Row>("SELECT * FROM task_occurrence WHERE task_id = ? AND status = 'open'", [taskId]);
  return r[0] ?? null;
}

export interface CompleteInput {
  completedDate: string;
  note?: string | null;
  workOrderId?: string | null;
  skip?: boolean;
}

/**
 * Marks an open occurrence done or skipped and creates the next open occurrence for
 * recurring, active tasks — all in one transaction (spec 04).
 */
export async function completeOccurrence(
  ctx: Ctx,
  occurrenceId: string,
  input: CompleteInput,
): Promise<{ completed: Row; next: Row | null }> {
  parseOrThrow(zDate, input.completedDate, "task_occurrence");
  return ctx.db.transaction(async (tx) => {
    const c = { ...ctx, db: tx };
    const occ = await mustGet(tx, "task_occurrence", occurrenceId);
    if (occ.status !== "open") {
      throw new ValidationError([{ path: "status", message: "Forekomsten er allerede afsluttet" }], "task_occurrence");
    }
    const status = input.skip ? "skipped" : "done";
    const completed = await updateEntity(c, "task_occurrence", occurrenceId, {
      status,
      completed_date: input.completedDate,
      completed_by: ctx.userId,
      note: input.note ?? null,
      work_order_id: input.workOrderId ?? null,
    });
    const task = await mustGet(tx, "task", String(occ.task_id));
    const rec = parseRecurrence(task.recurrence_json);
    let next: Row | null = null;
    if (rec && task.status === "active") {
      next = await createEntity(c, "task_occurrence", {
        task_id: String(task.id),
        status: "open",
        due_date: nextDueDate(rec, {
          dueDate: (occ.due_date as string | null) ?? null,
          completedDate: input.completedDate,
          status,
        }),
      });
    }
    return { completed, next };
  });
}

/** Postpones (or sets a missing date on) the open occurrence. */
export async function setOccurrenceDueDate(ctx: Ctx, occurrenceId: string, dueDate: string | null): Promise<Row> {
  return updateEntity(ctx, "task_occurrence", occurrenceId, { due_date: dueDate });
}

export interface TaskListRow {
  task_id: string;
  title: string;
  module: string;
  status: string;
  recurrence_json: string | null;
  occurrence_id: string | null;
  due_date: string | null;
  assignee_person_id: string | null;
}

/** Active tasks with their open occurrence, overdue first, missing dates last. */
export async function listTasksWithOpen(db: DbAdapter): Promise<TaskListRow[]> {
  return db.select<TaskListRow>(
    `SELECT t.id AS task_id, t.title, t.module, t.status, t.recurrence_json, t.assignee_person_id,
            o.id AS occurrence_id, o.due_date
       FROM task t
       LEFT JOIN task_occurrence o ON o.task_id = t.id AND o.status = 'open'
      WHERE t.status != 'archived'
      ORDER BY o.due_date IS NULL, o.due_date, t.title`,
  );
}

export async function listOccurrenceHistory(db: DbAdapter, taskId: string): Promise<Row[]> {
  return db.select<Row>(
    "SELECT * FROM task_occurrence WHERE task_id = ? AND status != 'open' ORDER BY completed_date DESC",
    [taskId],
  );
}
