/**
 * Read models for lists in the desktop app (review A1): the UI no longer writes SQL itself.
 * Each function returns rows shaped for one screen.
 */
import type { DbAdapter } from "../db/adapter";
import type { Row } from "../domain/registry";

/** Open tasks on a record with their next open occurrence (detail tab "Opgaver"). */
export const tasksForTarget = (db: DbAdapter, targetType: string, targetId: string) =>
  db.select<Row>(
    `SELECT t.*, o.id AS occurrence_id, o.due_date FROM task t
       LEFT JOIN task_occurrence o ON o.task_id = t.id AND o.status = 'open'
      WHERE t.target_type = ? AND t.target_id = ? AND t.status != 'archived' ORDER BY o.due_date IS NULL, o.due_date`,
    [targetType, targetId],
  );

/** Active vehicles with the latest odometer reading. */
export const vehiclesWithKm = (db: DbAdapter) =>
  db.select<Row>(
    `SELECT v.*, (SELECT km FROM odometer_reading r WHERE r.vehicle_id = v.id ORDER BY reading_date DESC, km DESC LIMIT 1) AS km
       FROM vehicle v WHERE v.archived_at IS NULL ORDER BY v.name`,
  );

/** Active rooms with their property's name. */
export const locationsWithProperty = (db: DbAdapter) =>
  db.select<{ id: string; name: string; property_id: string; property_name: string }>(
    `SELECT l.id, l.name, l.property_id, p.name AS property_name FROM location l JOIN property p ON p.id = l.property_id
      WHERE l.archived_at IS NULL ORDER BY p.name, l.name`,
  );

/** Ids of items that have a receipt or invoice attached. */
export async function itemsWithReceipt(db: DbAdapter): Promise<Set<string>> {
  const rows = await db.select<{ target_id: string }>("SELECT DISTINCT target_id FROM document_link WHERE target_type = 'item' AND role IN ('receipt', 'invoice')");
  return new Set(rows.map((r) => r.target_id));
}

/** Active pets with the owner's and the vet's name. */
export const petsWithNames = (db: DbAdapter) =>
  db.select<Row>(
    `SELECT p.*, o.name AS owner_name, c.name AS vet_name FROM pet p LEFT JOIN person o ON o.id = p.owner_person_id
       LEFT JOIN contact c ON c.id = p.vet_contact_id WHERE p.archived_at IS NULL ORDER BY p.name`,
  );

/** Active policies covering a pet. */
export const policiesForPet = (db: DbAdapter, petId: string) =>
  db.select<Row>(
    "SELECT p.* FROM policy p JOIN policy_coverage c ON c.policy_id = p.id WHERE c.target_type = 'pet' AND c.target_id = ? AND p.archived_at IS NULL ORDER BY p.title",
    [petId],
  );

/** Work orders, newest first, with the target's and the contact's name. */
export const workOrdersWithNames = (db: DbAdapter) =>
  db.select<Row>(
    `SELECT w.*, COALESCE(p.name, b.name, i.name, v.name) AS target_name, c.name AS contact_name
       FROM work_order w
       LEFT JOIN property p ON w.target_type = 'property' AND p.id = w.target_id
       LEFT JOIN building_part b ON w.target_type = 'building_part' AND b.id = w.target_id
       LEFT JOIN item i ON w.target_type = 'item' AND i.id = w.target_id
       LEFT JOIN vehicle v ON w.target_type = 'vehicle' AND v.id = w.target_id
       LEFT JOIN contact c ON c.id = w.contact_id
      ORDER BY w.reported_date DESC`,
  );

/** Categorisation rules in the order they are applied, with the category's name. */
export const categoryRulesWithNames = (db: DbAdapter) =>
  db.select<Row>("SELECT r.*, c.name AS category_name FROM category_rule r JOIN category c ON c.id = r.category_id ORDER BY r.priority, r.rowid");

/** The latest AI calls (Indstillinger → AI-adgang). */
export const aiAccessLog = (db: DbAdapter, limit = 30) =>
  db.select<{ id: string; at: string; client_name: string | null; tool: string; denied_reason: string | null; returned_refs: string }>(
    "SELECT id, at, client_name, tool, denied_reason, returned_refs FROM ai_access_log ORDER BY at DESC LIMIT ?",
    [limit],
  );

/** Number of active recipes. */
export async function recipeCount(db: DbAdapter): Promise<number> {
  return (await db.select<{ n: number }>("SELECT count(*) AS n FROM recipe WHERE archived_at IS NULL"))[0]?.n ?? 0;
}

/** Every document's roles (for the role filter in Dokumenter). */
export const documentRoles = (db: DbAdapter) => db.select<{ document_id: string; role: string }>("SELECT document_id, role FROM document_link");

/** What one document is linked to. */
export const linksOfDocument = (db: DbAdapter, documentId: string) =>
  db.select<Row>("SELECT target_type, target_id, role FROM document_link WHERE document_id = ?", [documentId]);

/** The master-data lists in Lister, by id. Archived records are left out. */
const MASTER_LIST_SQL: Record<string, string> = {
  location: `SELECT l.*, p.name AS property_name, pl.name AS parent_name FROM location l JOIN property p ON p.id = l.property_id
               LEFT JOIN location pl ON pl.id = l.parent_id WHERE l.archived_at IS NULL ORDER BY p.name, l.name`,
  property: "SELECT * FROM property WHERE archived_at IS NULL ORDER BY name",
  contact: "SELECT * FROM contact WHERE archived_at IS NULL ORDER BY name",
  person: "SELECT * FROM person WHERE archived_at IS NULL ORDER BY household DESC, name",
  account: "SELECT * FROM account WHERE archived_at IS NULL ORDER BY name",
  category: `SELECT c.*, p.name AS parent_name FROM category c LEFT JOIN category p ON p.id = c.parent_id WHERE c.archived_at IS NULL
               ORDER BY COALESCE(p.name, c.name), c.parent_id IS NOT NULL, c.name`,
};
export const MASTER_LISTS = Object.keys(MASTER_LIST_SQL);

export function masterListRows(db: DbAdapter, listId: string): Promise<Row[]> {
  const sql = MASTER_LIST_SQL[listId];
  if (!sql) throw new Error(`Ukendt liste: ${listId}`);
  return db.select<Row>(sql);
}
