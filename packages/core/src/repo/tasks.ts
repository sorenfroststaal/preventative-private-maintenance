import { saveRecord } from './records';
import templates from "../../../../templates/da/basis.json";
import { z } from 'zod';
import type { DbAdapter } from '../db/adapter';
import { date, recurrence, today } from '../domain/dates';
import { now } from '../db/migrate';
import { firstDate, nextDate } from '../recurrence/next';
import { recordChange, type WriteContext } from './write';

const taskInput = z.object({
  title: z.string().trim().min(1, 'Skriv en titel.'),
  description: z.string().default(''),
  module: z.enum(['home', 'maintenance', 'vehicle', 'finance', 'insurance', 'health', 'custom']).default('maintenance'),
  due_date: date.nullable().default(null),
  recurrence: recurrence.nullable().default(null),
});

async function occurrence(tx: DbAdapter, taskId: string, due: string | null, ctx: WriteContext) {
  const id = crypto.randomUUID();
  await tx.execute('INSERT INTO task_occurrence (id, task_id, due_date) VALUES (?, ?, ?)', [id, taskId, due]);
  const [created] = await tx.select<Record<string, unknown>>('SELECT * FROM task_occurrence WHERE id = ?', [id]);
  await recordChange(tx, ctx, 'task_occurrence', id, null, created);
  return id;
}

export async function createTask(db: DbAdapter, input: unknown, ctx: WriteContext) {
  const task = taskInput.parse(input);
  return db.transaction(async (tx) => {
    const id = crypto.randomUUID();
    const { title, description, module } = task;
    const recurrenceJson = task.recurrence ? JSON.stringify(task.recurrence) : null;
    const timestamp = now();
    await tx.execute('INSERT INTO task (id, title, description, module, recurrence_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, title, description, module, recurrenceJson, timestamp, timestamp]);
    const [created] = await tx.select<Record<string, unknown>>('SELECT * FROM task WHERE id = ?', [id]);
    await recordChange(tx, ctx, 'task', id, null, created,
      { title, body: description, module });
    return { id, occurrenceId: await occurrence(tx, id, task.due_date ?? firstDate(task.recurrence, today()), ctx) };
  });
}

export function openTasks(db: DbAdapter, userId?: string) {
  return db.select<{ id: string; title: string; due_date: string | null }>(
    "SELECT o.id, t.title, t.module, o.due_date FROM task_occurrence o JOIN task t ON t.id = o.task_id WHERE o.status = 'open' AND t.status = 'active' AND (t.module != 'health' OR EXISTS (SELECT 1 FROM person p WHERE p.id = t.target_id AND p.archived_at IS NULL AND (p.health_private_user_id IS NULL OR p.health_private_user_id = ?))) ORDER BY o.due_date IS NULL, o.due_date", [userId ?? null],
  );
}

export async function completeTask(db: DbAdapter, id: string, status: 'done' | 'skipped', completed: string, ctx: WriteContext, withWorkOrder = false) {
  z.uuid().parse(id);
  z.enum(['done', 'skipped']).parse(status);
  date.parse(completed);
  return db.transaction(async (tx) => {
    const [row] = await tx.select<{ task_id: string; title: string; module: string; target_type: string | null; target_id: string | null; due_date: string | null; recurrence_json: string | null }>(
      "SELECT o.task_id, o.due_date, t.recurrence_json, t.title, t.module, t.target_type, t.target_id FROM task_occurrence o JOIN task t ON t.id = o.task_id WHERE o.id = ? AND o.status = 'open' AND t.status = 'active' AND (t.module != 'health' OR EXISTS (SELECT 1 FROM person p WHERE p.id = t.target_id AND p.archived_at IS NULL AND (p.health_private_user_id IS NULL OR p.health_private_user_id = ?)))", [id, ctx.userId ?? null]);
    if (!row) throw new Error('Opgaven har ingen åben forekomst.');
    let workOrderId: string | null = null;
    if (withWorkOrder) {
      if (status !== 'done' || row.module === 'health') throw new Error('Der kan ikke oprettes en arbejdsordre for denne forekomst.');
      const target = ['property', 'building_part', 'item', 'vehicle'].includes(row.target_type ?? '');
      const order = await saveRecord(tx, 'work_order', { title: row.title, status: 'done', kind: 'service',
        reported_date: completed, completed_date: completed,
        target_type: target ? row.target_type : null, target_id: target ? row.target_id : null }, ctx);
      workOrderId = order.id;
    }
    await tx.execute('UPDATE task_occurrence SET status = ?, completed_date = ?, completed_by = ?, work_order_id = COALESCE(?, work_order_id) WHERE id = ?', [status, completed, ctx.userId ?? null, workOrderId, id]);
    await recordChange(tx, ctx, 'task_occurrence', id, { status: 'open' }, { status, completed_date: completed, completed_by: ctx.userId ?? null, ...(workOrderId && {work_order_id: workOrderId}) });
    if (row.recurrence_json) {
      await occurrence(tx, row.task_id, nextDate(recurrence.parse(JSON.parse(row.recurrence_json)), row.due_date, completed, status === 'skipped'), ctx);
    }
  });
}

export async function postponeTask(db: DbAdapter, id: string, input: unknown, ctx: WriteContext) {
  const due = date.parse(input);
  return db.transaction(async tx => {
    const [before] = await tx.select<Record<string, unknown>>(`SELECT o.* FROM task_occurrence o JOIN task t ON t.id = o.task_id
      WHERE o.id = ? AND o.status = 'open' AND t.status = 'active' AND (t.module != 'health' OR EXISTS
      (SELECT 1 FROM person p WHERE p.id = t.target_id AND p.archived_at IS NULL AND (p.health_private_user_id IS NULL OR p.health_private_user_id = ?)))`, [id, ctx.userId ?? null]);
    if (!before) throw new Error('Opgaven har ingen åben forekomst.');
    await tx.execute('UPDATE task_occurrence SET due_date = ? WHERE id = ?', [due, id]);
    await recordChange(tx, ctx, 'task_occurrence', id, before, { ...before, due_date: due });
  });
}

export const vehicleTemplates = templates.filter(template => template.applies_to === 'vehicle');

export async function addVehicleTemplate(db: DbAdapter, vehicle: string, template: string, rawDate: unknown, ctx: WriteContext) {
  const due = date.nullable().parse(rawDate);
  const selected = vehicleTemplates.find(item => item.id === template);
  if (!selected) throw new Error('Skabelonen findes ikke.');
  const rule = recurrence.nullable().parse(selected.recurrence);
  if (!rule && !due) throw new Error('Vælg datoen for næste syn.');
  return db.transaction(async tx => {
    const [car] = await tx.select<{ name: string }>('SELECT name FROM vehicle WHERE id = ? AND archived_at IS NULL', [vehicle]);
    if (!car) throw new Error('Bilen findes ikke.');
    const [existing] = await tx.select('SELECT id FROM task WHERE target_type = ? AND target_id = ? AND template_id = ? AND status != ?', ['vehicle', vehicle, selected.id, 'archived']);
    if (existing) throw new Error('Skabelonen er allerede føjet til bilen.');
    const id = crypto.randomUUID();
    const title = selected.title + ' · ' + car.name;
    const fields = { title, description: selected.description, module: 'vehicle', target_type: 'vehicle', target_id: vehicle,
      recurrence_json: rule ? JSON.stringify(rule) : null, source: 'template', template_id: selected.id,
      template_version: selected.version, created_at: now(), updated_at: now() };
    await tx.execute(`INSERT INTO task (id, ${Object.keys(fields).join(', ')}) VALUES (?, ${Object.keys(fields).map(() => '?').join(', ')})`, [id, ...Object.values(fields)]);
    await recordChange(tx, ctx, 'task', id, null, fields, { module: 'vehicle', title, body: selected.description });
    return occurrence(tx, id, due ?? firstDate(rule, today()), ctx);
  });
}
