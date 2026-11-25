import type { DbAdapter } from '../db/adapter';

export function vehicleCosts(db: DbAdapter, id: string, year: number) {
  const start = year + '-01-01';
  const end = year + '-12-31';
  return db.select<{ currency: string; amount: number }>(`SELECT currency, SUM(amount) AS amount FROM (
    SELECT currency, cost_minor AS amount FROM work_order WHERE target_type = 'vehicle' AND target_id = ?
      AND COALESCE(completed_date, reported_date) BETWEEN ? AND ? AND cost_minor IS NOT NULL
    UNION ALL SELECT b.currency, -b.amount_minor FROM bank_transaction b JOIN transaction_link l ON l.transaction_id = b.id
      WHERE l.target_type = 'vehicle' AND l.target_id = ? AND b.booking_date BETWEEN ? AND ?
  ) GROUP BY currency ORDER BY currency`, [id, start, end, id, start, end]);
}

export function history(db: DbAdapter, type: string, id: string) {
  if (type === 'work_order') {
    return db.select("SELECT COALESCE(note, CASE status WHEN 'registered' THEN 'Registreret' WHEN 'quote_requested' THEN 'Tilbud udbedt' WHEN 'ordered' THEN 'Bestilt' WHEN 'done' THEN 'Udført' WHEN 'invoiced' THEN 'Faktureret' WHEN 'closed' THEN 'Lukket' WHEN 'cancelled' THEN 'Annulleret' END) AS caption, substr(at, 1, 10) AS date FROM work_order_event WHERE work_order_id = ? ORDER BY at DESC, rowid DESC", [id]);
  }
  return db.select<{ caption: string; date: string }>(`SELECT title AS caption, COALESCE(completed_date, reported_date) AS date
    FROM work_order WHERE target_type = ? AND target_id = ?
    UNION ALL SELECT t.title, o.completed_date FROM task t JOIN task_occurrence o ON o.task_id = t.id
      WHERE t.target_type = ? AND t.target_id = ? AND t.module != 'health' AND o.status = 'done'
    ORDER BY date DESC`, [type, id, type, id]);
}

export async function dashboard(db: DbAdapter, userId: string, current: string) {
  const plus = (days: number) => {
    const value = new Date(current + 'T00:00:00Z');
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
  };
  const month = current.slice(0, 7);
  const [horizon] = await db.select<{ value_json: string }>('SELECT value_json FROM setting WHERE key = ?', ['dashboard.horizon_days']);
  const configured = horizon ? Number(JSON.parse(horizon.value_json)) : 30;
  const limit = Number.isInteger(configured) && configured >= 0 && configured <= 3650 ? configured : 30;
  const tasks = await db.select<{ id: string; title: string; due_date: string | null; system_ref: string | null }>(`
    SELECT o.id, t.title, o.due_date, t.system_ref FROM task_occurrence o JOIN task t ON t.id = o.task_id
    WHERE o.status = 'open' AND t.status = 'active' AND (t.module != 'health' OR EXISTS (
      SELECT 1 FROM person p WHERE p.id = t.target_id AND p.archived_at IS NULL AND (p.health_private_user_id IS NULL OR p.health_private_user_id = ?)
    )) ORDER BY o.due_date, o.id`, [userId]);
  const horizonEnd = plus(limit);
  const expiresEnd = plus(60);
  const missing = await db.select<{ title: string }>(`
    SELECT 'Mangler kvittering: ' || i.name AS title FROM item i WHERE i.archived_at IS NULL AND i.purchase_price_minor IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM document_link l WHERE l.target_type = 'item' AND l.target_id = i.id AND l.role = 'receipt')
    UNION ALL SELECT 'Mangler fornyelsesdato: ' || title FROM policy WHERE archived_at IS NULL AND renewal_date IS NULL
    UNION ALL SELECT 'Mangler nyere km-stand: ' || v.name FROM vehicle v WHERE v.archived_at IS NULL AND NOT EXISTS
      (SELECT 1 FROM odometer_reading r WHERE r.vehicle_id = v.id AND date(r.reading_date, '+12 months') >= date(?))`, [current]);
  const [drafts] = await db.select<{ count: number }>("SELECT COUNT(*) AS count FROM ai_draft WHERE status = 'pending'");
  const finances = await db.select<{ category: string; actual: number; budget: number }>(`
    WITH RECURSIVE members(root, id) AS (
      SELECT id, id FROM category WHERE parent_id IS NULL AND archived_at IS NULL AND kind = 'expense'
      UNION SELECT m.root, c.id FROM members m JOIN category c ON c.parent_id = m.id
    )
    SELECT c.name AS category,
      COALESCE((SELECT -SUM(t.amount_minor) FROM bank_transaction t WHERE t.category_id IN (SELECT id FROM members WHERE root = c.id) AND substr(t.booking_date, 1, 7) = ? AND t.currency = 'DKK'), 0) AS actual,
      COALESCE((SELECT SUM(l.amount_minor) FROM budget_line l JOIN budget b ON b.id = l.budget_id
        WHERE l.category_id IN (SELECT id FROM members WHERE root = c.id) AND b.year = ? AND (l.month IS NULL OR l.month = ?)), 0) AS budget
    FROM category c WHERE c.parent_id IS NULL AND c.archived_at IS NULL AND c.kind = 'expense' ORDER BY c.name`,
    [month, Number(current.slice(0, 4)), Number(current.slice(5, 7))]);
  const spending = await db.select<{ month: string; amount: number }>(`
    WITH RECURSIVE months(start) AS (
      SELECT date(?, 'start of month', '-5 months') UNION ALL
      SELECT date(start, '+1 month') FROM months WHERE start < date(?, 'start of month')
    ) SELECT substr(start, 1, 7) AS month, COALESCE((
      SELECT -SUM(t.amount_minor) FROM bank_transaction t JOIN category c ON c.id = t.category_id
      WHERE c.kind = 'expense' AND t.currency = 'DKK' AND t.booking_date >= start
        AND t.booking_date < date(start, '+1 month')
    ), 0) AS amount FROM months ORDER BY start`, [current, current]);
  const meals = await db.select<{ day: string; name: string }>(`
    SELECT e.plan_date AS day, COALESCE(r.name, e.title) AS name FROM meal_plan_entry e
    LEFT JOIN recipe r ON r.id = e.recipe_id WHERE e.plan_date BETWEEN ? AND ?
    ORDER BY e.plan_date, e.meal, e.id`, [current, plus(1)]);
  const [uncategorized] = await db.select<{ count: number }>('SELECT COUNT(*) AS count FROM bank_transaction WHERE category_id IS NULL AND substr(booking_date, 1, 7) = ?', [month]);
  return {
    horizon: limit, overdue: tasks.filter(t => t.due_date && t.due_date < current),
    upcoming: tasks.filter(t => t.due_date && t.due_date >= current && t.due_date <= horizonEnd),
    expires: tasks.filter(t => t.due_date && t.due_date >= current && t.due_date <= expiresEnd &&
      /^(item\.|policy\.|recurring_expense\.|health_medication\.)/.test(t.system_ref ?? '')),
    missing: [...missing.map(r => r.title), ...tasks.filter(t => !t.due_date).map(t => 'Mangler dato: ' + t.title)],
    current, meals, spending, drafts: drafts.count, finances, uncategorized: uncategorized.count,
  };
}

export async function financeYear(db: DbAdapter, year: number) {
  const start = year + '-01-01';
  const end = year + '-12-31';
  const categories = await db.select<{ id: string; name: string; kind: string }>("SELECT id, name, kind FROM category WHERE archived_at IS NULL AND kind != 'transfer' ORDER BY name");
  const budget = await db.select<{ category_id: string; month: number | null; amount_minor: number }>(
    'SELECT l.category_id, l.month, l.amount_minor FROM budget_line l JOIN budget b ON b.id = l.budget_id WHERE b.year = ?', [year]);
  const actual = await db.select<{ category_id: string; month: number; amount_minor: number }>(`
    SELECT category_id, CAST(substr(booking_date, 6, 2) AS INTEGER) AS month, SUM(amount_minor) AS amount_minor
    FROM bank_transaction WHERE booking_date BETWEEN ? AND ? AND currency = 'DKK' AND category_id IS NOT NULL GROUP BY category_id, month`, [start, end]);
  const fixed = await db.select<{ currency: string; annual: number }>(`
    SELECT currency, SUM(amount_minor * CASE period WHEN 'month' THEN 12 WHEN 'quarter' THEN 4 WHEN 'half_year' THEN 2 ELSE 1 END) AS annual
    FROM recurring_expense WHERE archived_at IS NULL GROUP BY currency ORDER BY currency`);
  return {
    categories: categories.map(category => {
      const categoryActual = actual.filter(row => row.category_id === category.id);
      const categoryBudget = budget.filter(row => row.category_id === category.id);
      return { name: category.name, months: Array.from({ length: 12 }, (_, index) => ({
        budget: categoryBudget.filter(row => row.month === null || row.month === index + 1).reduce((sum, row) => sum + row.amount_minor, 0),
        actual: (categoryActual.find(row => row.month === index + 1)?.amount_minor ?? 0) * (category.kind === 'expense' ? -1 : 1),
      })) };
    }), fixed,
  };
}
