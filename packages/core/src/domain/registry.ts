import type { DbAdapter } from "../db/adapter";
import type { EntityType } from "./schemas";

export type Module =
  | "home"
  | "maintenance"
  | "vehicle"
  | "finance"
  | "insurance"
  | "health"
  | "documents"
  | "food"
  | "core";

export type Row = Record<string, unknown>;

export interface SearchConfig {
  title(row: Row): string;
  body(row: Row, db: DbAdapter): Promise<string>;
}

export interface EntityMeta {
  module: Module;
  /** Primary key columns; ["id"] for normal entities. */
  pk: string[];
  createdAt: boolean;
  updatedAt: boolean;
  archivable: boolean;
  /** Child rows without archived_at that may be deleted physically (with audit). */
  deletable?: boolean;
  search?: SearchConfig;
}

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const jsonList = (v: unknown): string[] => {
  if (typeof v !== "string") return [];
  try {
    const a: unknown = JSON.parse(v);
    return Array.isArray(a) ? a.map(String) : [];
  } catch {
    return [];
  }
};
const join = (...parts: unknown[]) => parts.map(s).filter(Boolean).join(" ");

async function nameOf(db: DbAdapter, table: string, id: unknown, col = "name"): Promise<string> {
  if (!id) return "";
  const r = await db.select<{ v: string }>(`SELECT ${col} AS v FROM ${table} WHERE id = ?`, [String(id)]);
  return r[0]?.v ?? "";
}

async function tagsOf(db: DbAdapter, type: string, id: unknown): Promise<string> {
  const r = await db.select<{ name: string }>(
    "SELECT t.name FROM entity_tag et JOIN tag t ON t.id = et.tag_id WHERE et.target_type = ? AND et.target_id = ?",
    [type, String(id)],
  );
  return r.map((x) => x.name).join(" ");
}

const plain = (module: Module, extra: Partial<EntityMeta> = {}): EntityMeta => ({
  module,
  pk: ["id"],
  createdAt: false,
  updatedAt: false,
  archivable: false,
  ...extra,
});
const link = (module: Module, pk: string[]): EntityMeta => plain(module, { pk });

export const registry: Record<EntityType, EntityMeta> = {
  app_user: plain("core", { createdAt: true, archivable: true }),
  person: plain("core", { createdAt: true, archivable: true }),
  contact: plain("core", {
    createdAt: true,
    archivable: true,
    search: {
      title: (r) => s(r.name),
      body: async (r) => join(r.notes, r.email, r.phone),
    },
  }),
  property: plain("home", { createdAt: true, archivable: true }),
  location: plain("home", { archivable: true }),
  item: plain("home", {
    createdAt: true,
    updatedAt: true,
    archivable: true,
    search: {
      title: (r) => s(r.name),
      body: async (r, db) =>
        join(
          r.brand,
          r.model,
          r.serial_number,
          r.part_number,
          await nameOf(db, "item", r.parent_item_id),
          r.category,
          await nameOf(db, "location", r.location_id),
          r.notes,
          await tagsOf(db, "item", r.id),
        ),
    },
  }),
  item_part: plain("home"),
  building_part: plain("home", {
    createdAt: true,
    archivable: true,
    search: { title: (r) => s(r.name), body: async (r) => join(r.kind, r.brand, r.model, r.serial_number, r.notes) },
  }),
  lending: plain("home", {
    createdAt: true,
    deletable: true,
    search: {
      title: (r) => s(r.title) || "Udlån",
      body: async (r, db) => join(await nameOf(db, "item", r.item_id), r.borrower_name, await nameOf(db, "person", r.borrower_person_id), await nameOf(db, "contact", r.borrower_contact_id), r.notes),
    },
  }),
  gift: plain("home", {
    createdAt: true,
    deletable: true,
    search: {
      title: (r) => s(r.title),
      body: async (r, db) => join(await nameOf(db, "person", r.person_id), r.occasion, r.notes),
    },
  }),
  vehicle: plain("vehicle", {
    createdAt: true,
    archivable: true,
    search: {
      title: (r) => s(r.name),
      body: async (r) => join(r.registration, r.make, r.model, r.notes),
    },
  }),
  odometer_reading: plain("vehicle"),
  pet: plain("home", {
    createdAt: true,
    archivable: true,
    search: {
      title: (r) => s(r.name),
      body: async (r, db) => join(r.breed, r.chip_number, await nameOf(db, "contact", r.vet_contact_id), r.notes),
    },
  }),
  policy: plain("insurance", {
    createdAt: true,
    archivable: true,
    search: {
      title: (r) => s(r.title),
      body: async (r) => join(r.insurer_name, r.policy_number, r.notes),
    },
  }),
  policy_coverage: link("insurance", ["policy_id", "target_type", "target_id"]),
  person_link: link("core", ["person_id", "target_type", "target_id"]),
  claim: plain("insurance", { createdAt: true }),
  work_order: plain("maintenance", {
    createdAt: true,
    updatedAt: true,
    search: {
      title: (r) => s(r.title),
      body: async (r, db) => {
        const notes = await db.select<{ note: string | null }>(
          "SELECT note FROM work_order_event WHERE work_order_id = ? ORDER BY at",
          [String(r.id)],
        );
        return join(r.description, await nameOf(db, "contact", r.contact_id), ...notes.map((n) => n.note));
      },
    },
  }),
  work_order_event: plain("maintenance"),
  task: plain("maintenance", {
    createdAt: true,
    updatedAt: true,
    search: { title: (r) => s(r.title), body: async (r) => join(r.description) },
  }),
  task_occurrence: plain("maintenance"),
  account: plain("finance", { archivable: true }),
  category: plain("finance", { archivable: true }),
  import_batch: plain("finance"),
  bank_transaction: plain("finance", {
    search: {
      title: (r) => s(r.text),
      body: async (r, db) => join(r.note, await nameOf(db, "category", r.category_id)),
    },
  }),
  transaction_link: link("finance", ["transaction_id", "target_type", "target_id"]),
  category_rule: plain("finance"),
  budget: plain("finance"),
  budget_line: plain("finance"),
  recurring_expense: plain("finance", { archivable: true }),
  loan: plain("finance", {
    createdAt: true,
    archivable: true,
    search: {
      title: (r) => s(r.name),
      body: async (r, db) => join(r.loan_number, await nameOf(db, "contact", r.lender_contact_id), r.notes),
    },
  }),
  health_visit: plain("health", {
    createdAt: true,
    search: { title: (r) => s(r.reason) || "Besøg", body: async (r) => join(r.notes, r.referral) },
  }),
  health_screening: plain("health", {
    search: { title: (r) => s(r.name), body: async (r) => join(r.notes, r.result) },
  }),
  health_vaccination: plain("health", {
    search: { title: (r) => s(r.vaccine), body: async (r) => join(r.notes, r.dose) },
  }),
  health_medication: plain("health", {
    search: { title: (r) => s(r.name), body: async (r) => join(r.notes, r.strength, r.dosage) },
  }),
  health_allergy: plain("health", {
    search: { title: (r) => s(r.substance), body: async (r) => join(r.reaction) },
  }),
  health_measurement: plain("health"),
  document: plain("documents", {
    createdAt: true,
    search: {
      title: (r) => s(r.title) || s(r.filename),
      body: async (r) => join(r.filename, r.extracted_text),
    },
  }),
  document_link: link("documents", ["document_id", "target_type", "target_id", "role"]),
  recipe: plain("food", {
    createdAt: true,
    updatedAt: true,
    archivable: true,
    search: {
      title: (r) => s(r.name),
      body: async (r, db) => {
        const ing = await db.select<{ name: string }>(
          "SELECT name FROM recipe_ingredient WHERE recipe_id = ? ORDER BY position",
          [String(r.id)],
        );
        return join(r.description, ...ing.map((i) => i.name), r.instructions, ...jsonList(r.tags_json));
      },
    },
  }),
  recipe_ingredient: plain("food", { deletable: true }),
  meal_plan_entry: plain("food", { createdAt: true, deletable: true }),
  shopping_list: plain("food", { createdAt: true, archivable: true }),
  shopping_item: plain("food", { deletable: true }),
  tag: plain("core"),
  entity_tag: link("core", ["tag_id", "target_type", "target_id"]),
};

export function moduleOf(type: EntityType): Module {
  return registry[type].module;
}
