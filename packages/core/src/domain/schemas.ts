import { z } from "zod";

// ---------- Primitives ----------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export const zDate = z.string().refine(isValidDate, { message: "Ugyldig dato (forventet ÅÅÅÅ-MM-DD)" });
export const zTimestamp = z.string().datetime({ message: "Ugyldigt tidspunkt (ISO 8601)" });
export const zMoney = z.number().int({ message: "Beløb skal være et helt antal øre" });
export const zId = z.string().uuid({ message: "Ugyldigt id" });
export const zText = z.string().trim().min(1, { message: "Feltet skal udfyldes" });
export const zCurrency = z.string().regex(/^[A-Z]{3}$/, { message: "Valuta skal være en ISO-kode, fx DKK" });
const opt = <T extends z.ZodTypeAny>(t: T) => t.nullish();
const zBool01 = z.union([z.literal(0), z.literal(1)]);

// ---------- Madplan primitives ----------

/** Allergen keys (spec 04 "Allergi-advarsler"). */
export const ALLERGEN_KEYS = [
  "gluten",
  "milk",
  "egg",
  "nuts",
  "peanut",
  "fish",
  "shellfish",
  "soy",
  "sesame",
  "celery",
  "mustard",
] as const;
export type AllergenKey = (typeof ALLERGEN_KEYS)[number];
export const MEALS = ["breakfast", "lunch", "dinner", "snack"] as const;
export type Meal = (typeof MEALS)[number];
const zMeal = z.enum(MEALS);

function jsonArrayOf(check: (v: unknown) => boolean, message: string) {
  return z.string().refine(
    (s) => {
      try {
        const v: unknown = JSON.parse(s);
        return Array.isArray(v) && v.every(check);
      } catch {
        return false;
      }
    },
    { message },
  );
}
const zJsonStrings = jsonArrayOf((v) => typeof v === "string", "Skal være en JSON-liste af tekster");
const zAllergenJson = jsonArrayOf(
  (v) => typeof v === "string" && (ALLERGEN_KEYS as readonly string[]).includes(v),
  "Ukendt allergen",
);

// ---------- Recurrence ----------

const zUnit = z.enum(["day", "week", "month", "year"]);
export const zRecurrence = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("fixed"),
        unit: zUnit,
        every: z.number().int().min(1),
        month: z.number().int().min(1).max(12).optional(),
        day: z.number().int().min(1).max(31).optional(),
      })
      .strict(),
    z.object({ kind: z.literal("interval"), unit: zUnit, every: z.number().int().min(1) }).strict(),
  ])
  .superRefine((r, ctx) => {
    if (r.kind !== "fixed") return;
    if (r.unit === "year" && (r.month === undefined || r.day === undefined)) {
      ctx.addIssue({ code: "custom", message: "Årlig fast dato kræver måned og dag" });
    }
    if (r.unit === "month" && r.day === undefined) {
      ctx.addIssue({ code: "custom", message: "Månedlig fast dato kræver dag" });
    }
    if (r.unit === "month" && r.month !== undefined) {
      ctx.addIssue({ code: "custom", message: "Måned bruges kun ved årlig gentagelse" });
    }
    if ((r.unit === "day" || r.unit === "week") && (r.month !== undefined || r.day !== undefined)) {
      ctx.addIssue({ code: "custom", message: "Måned og dag bruges kun ved måned eller år" });
    }
  });
export type Recurrence = z.infer<typeof zRecurrence>;

// ---------- Entity field schemas (columns except id/created_at/updated_at/archived_at) ----------

export const fields = {
  app_user: {
    name: zText,
    pin_hash: opt(z.string()),
    is_admin: zBool01.default(0),
  },
  person: {
    name: zText,
    relation: opt(z.string()),
    birth_year: opt(z.number().int().min(1900).max(2200)),
    app_user_id: opt(zId),
    health_private_user_id: opt(zId),
    notes: opt(z.string()),
  },
  contact: {
    name: zText,
    kind: z.enum(["craftsman", "shop", "insurer", "doctor", "dentist", "workshop", "bank", "other"]),
    phone: opt(z.string()),
    email: opt(z.string()),
    website: opt(z.string()),
    notes: opt(z.string()),
  },
  property: {
    name: zText,
    address: opt(z.string()),
    kind: z.enum(["house", "apartment", "summerhouse", "other"]),
    owned: zBool01.default(1),
    notes: opt(z.string()),
  },
  location: {
    property_id: zId,
    parent_id: opt(zId),
    name: zText,
  },
  item: {
    name: zText,
    category: opt(z.string()),
    location_id: opt(zId),
    brand: opt(z.string()),
    model: opt(z.string()),
    serial_number: opt(z.string()),
    purchase_date: opt(zDate),
    purchase_price_minor: opt(zMoney),
    currency: zCurrency.default("DKK"),
    vendor_contact_id: opt(zId),
    vendor_name: opt(z.string()),
    warranty_until: opt(zDate),
    complaint_until: opt(zDate),
    notes: opt(z.string()),
  },
  item_part: {
    item_id: zId,
    name: zText,
    part_number: opt(z.string()),
    vendor: opt(z.string()),
    notes: opt(z.string()),
  },
  building_part: {
    property_id: zId,
    name: zText,
    kind: opt(z.string()),
    installed_date: opt(zDate),
    notes: opt(z.string()),
  },
  vehicle: {
    name: zText,
    registration: opt(z.string()),
    vin: opt(z.string()),
    make: opt(z.string()),
    model: opt(z.string()),
    model_year: opt(z.number().int().min(1886).max(2200)),
    first_registration_date: opt(zDate),
    fuel: opt(z.enum(["petrol", "diesel", "electric", "hybrid", "plugin_hybrid", "other"])),
    purchase_date: opt(zDate),
    purchase_price_minor: opt(zMoney),
    notes: opt(z.string()),
  },
  pet: {
    name: zText,
    species: z.enum(["dog", "cat", "horse", "rabbit", "bird", "other"]).default("dog"),
    breed: opt(z.string()),
    sex: opt(z.enum(["female", "male"])),
    birth_date: opt(zDate),
    chip_number: opt(z.string()),
    owner_person_id: opt(zId),
    vet_contact_id: opt(zId),
    notes: opt(z.string()),
  },
  odometer_reading: {
    vehicle_id: zId,
    reading_date: zDate,
    km: z.number().int().min(0),
    source: z.enum(["manual", "work_order", "ai"]).default("manual"),
  },
  policy: {
    insurer_contact_id: opt(zId),
    insurer_name: opt(z.string()),
    policy_number: opt(z.string()),
    kind: z.enum([
      "home_contents",
      "building",
      "car",
      "accident",
      "health",
      "life",
      "travel",
      "change_of_ownership",
      "pet",
      "other",
    ]),
    title: zText,
    premium_minor: opt(zMoney),
    premium_period: opt(z.enum(["month", "quarter", "half_year", "year"])),
    currency: zCurrency.default("DKK"),
    start_date: opt(zDate),
    renewal_date: opt(zDate),
    deductible_minor: opt(zMoney),
    coverage_sum_minor: opt(zMoney),
    notes: opt(z.string()),
  },
  policy_coverage: {
    policy_id: zId,
    target_type: z.enum(["property", "item", "vehicle", "person", "pet"]),
    target_id: zId,
  },
  claim: {
    policy_id: zId,
    claim_number: opt(z.string()),
    incident_date: zDate,
    description: zText,
    status: z.enum(["reported", "in_progress", "approved", "rejected", "paid", "closed"]).default("reported"),
    payout_minor: opt(zMoney),
    currency: zCurrency.default("DKK"),
  },
  work_order: {
    title: zText,
    description: opt(z.string()),
    kind: z.enum(["repair", "service", "damage", "improvement", "inspection"]),
    status: z
      .enum(["registered", "quote_requested", "ordered", "done", "invoiced", "closed", "cancelled"])
      .default("registered"),
    target_type: opt(z.enum(["property", "building_part", "item", "vehicle"])),
    target_id: opt(zId),
    contact_id: opt(zId),
    reported_date: zDate,
    completed_date: opt(zDate),
    cost_minor: opt(zMoney),
    currency: zCurrency.default("DKK"),
    odometer_km: opt(z.number().int().min(0)),
    claim_id: opt(zId),
    created_by: opt(zId),
  },
  work_order_event: {
    work_order_id: zId,
    at: zTimestamp,
    status: opt(z.string()),
    note: opt(z.string()),
    user_id: opt(zId),
  },
  task: {
    title: zText,
    description: opt(z.string()),
    module: z.enum(["home", "maintenance", "vehicle", "finance", "insurance", "health", "custom"]),
    target_type: opt(z.enum(["property", "building_part", "item", "vehicle", "person", "policy"])),
    target_id: opt(zId),
    assignee_person_id: opt(zId),
    recurrence_json: opt(z.string()),
    reminder_days: z.number().int().min(0).default(14),
    status: z.enum(["active", "paused", "archived"]).default("active"),
    template_id: opt(z.string()),
    template_version: opt(z.number().int()),
    source: z.enum(["user", "template", "ai", "system"]).default("user"),
    system_ref: opt(z.string()),
  },
  task_occurrence: {
    task_id: zId,
    due_date: opt(zDate),
    status: z.enum(["open", "done", "skipped"]).default("open"),
    completed_date: opt(zDate),
    completed_by: opt(zId),
    note: opt(z.string()),
    work_order_id: opt(zId),
  },
  account: {
    name: zText,
    bank: opt(z.string()),
    last4: opt(z.string().regex(/^\d{4}$/, { message: "Kun de sidste fire cifre" })),
    currency: zCurrency.default("DKK"),
  },
  category: {
    name: zText,
    parent_id: opt(zId),
    kind: z.enum(["expense", "income", "transfer"]),
  },
  import_batch: {
    account_id: zId,
    profile: zText,
    file_document_id: opt(zId),
    imported_at: zTimestamp,
    rows_total: z.number().int().min(0),
    rows_imported: z.number().int().min(0),
    rows_duplicate: z.number().int().min(0),
  },
  bank_transaction: {
    account_id: zId,
    booking_date: zDate,
    text: z.string(),
    amount_minor: zMoney,
    balance_minor: opt(zMoney),
    currency: zCurrency.default("DKK"),
    category_id: opt(zId),
    category_source: opt(z.enum(["rule", "user", "ai"])),
    import_batch_id: opt(zId),
    dedupe_hash: zText,
    note: opt(z.string()),
  },
  transaction_link: {
    transaction_id: zId,
    target_type: z.enum(["item", "work_order", "policy", "vehicle", "recurring_expense", "loan"]),
    target_id: zId,
  },
  category_rule: {
    match_type: z.enum(["contains", "starts_with", "regex"]),
    pattern: zText,
    category_id: zId,
    priority: z.number().int().default(100),
    created_from: z.enum(["user", "learned"]).default("user"),
  },
  budget: {
    year: z.number().int().min(1900).max(2200),
    name: zText,
  },
  budget_line: {
    budget_id: zId,
    category_id: zId,
    month: opt(z.number().int().min(1).max(12)),
    amount_minor: zMoney.nonnegative(),
  },
  recurring_expense: {
    name: zText,
    category_id: opt(zId),
    amount_minor: zMoney,
    currency: zCurrency.default("DKK"),
    period: z.enum(["month", "quarter", "half_year", "year"]),
    next_date: opt(zDate),
    binding_until: opt(zDate),
    contact_id: opt(zId),
    policy_id: opt(zId),
    priority: opt(z.number().int().min(1).max(5)),
    property_id: opt(zId),
    vehicle_id: opt(zId),
    end_date: opt(zDate),
    amount_variable: z.union([z.literal(0), z.literal(1)]).default(0),
    notes: opt(z.string()),
  },
  loan: {
    name: zText,
    kind: z.enum(["mortgage", "bank", "car", "student", "consumer", "private", "other"]).default("other"),
    lender_contact_id: opt(zId),
    loan_number: opt(z.string()),
    principal_minor: opt(zMoney.nonnegative()),
    balance_minor: opt(zMoney.nonnegative()),
    balance_date: opt(zDate),
    interest_rate: opt(z.number().min(-10).max(100)),
    payment_minor: opt(zMoney.nonnegative()),
    payment_period: z.enum(["month", "quarter", "half_year", "year"]).default("month"),
    start_date: opt(zDate),
    end_date: opt(zDate),
    property_id: opt(zId),
    vehicle_id: opt(zId),
    account_id: opt(zId),
    notes: opt(z.string()),
  },
  health_visit: {
    person_id: zId,
    visit_date: zDate,
    kind: z.enum(["gp", "dentist", "specialist", "hospital", "physio", "other"]),
    contact_id: opt(zId),
    reason: opt(z.string()),
    notes: opt(z.string()),
    referral: opt(z.string()),
  },
  health_screening: {
    person_id: zId,
    name: zText,
    screening_date: opt(zDate),
    result: opt(z.string()),
    next_due_date: opt(zDate),
    notes: opt(z.string()),
  },
  health_vaccination: {
    person_id: zId,
    vaccine: zText,
    dose: opt(z.string()),
    given_date: zDate,
    next_due_date: opt(zDate),
    notes: opt(z.string()),
  },
  health_medication: {
    person_id: zId,
    name: zText,
    strength: opt(z.string()),
    dosage: opt(z.string()),
    start_date: opt(zDate),
    end_date: opt(zDate),
    prescription_renewal_date: opt(zDate),
    notes: opt(z.string()),
  },
  health_allergy: {
    person_id: zId,
    substance: zText,
    reaction: opt(z.string()),
    severity: opt(z.enum(["mild", "moderate", "severe"])),
  },
  health_measurement: {
    person_id: zId,
    type: zText,
    value: z.number().finite(),
    unit: zText,
    measured_at: zTimestamp,
    note: opt(z.string()),
  },
  document: {
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    filename: zText,
    ext: zText,
    mime: zText,
    size_bytes: z.number().int().min(0),
    title: opt(z.string()),
    doc_date: opt(zDate),
    source: z.enum(["drop", "inbox", "ai", "bank_import"]),
    extracted_text: opt(z.string()),
    created_by: opt(zId),
  },
  document_link: {
    document_id: zId,
    target_type: z.enum([
      "property",
      "location",
      "item",
      "item_part",
      "building_part",
      "vehicle",
      "pet",
      "work_order",
      "claim",
      "policy",
      "person",
      "contact",
      "account",
      "loan",
      "health_visit",
      "health_screening",
      "health_vaccination",
      "health_medication",
      "bank_transaction",
      "task_occurrence",
      "recurring_expense",
    ]),
    target_id: zId,
    role: z.enum([
      "receipt",
      "invoice",
      "quote",
      "photo",
      "photo_before",
      "photo_after",
      "manual",
      "policy_terms",
      "warranty",
      "contract",
      "certificate",
      "report",
      "letter",
      "other",
    ]),
  },
  // ---------- Madplan (schemaVersion 2) ----------
  recipe: {
    name: zText,
    description: opt(z.string()),
    servings: z.number().int().min(1, { message: "Mindst 1 portion" }).default(4),
    prep_minutes: opt(z.number().int().min(0)),
    instructions: opt(z.string()),
    tags_json: opt(zJsonStrings),
    allergens_json: opt(zAllergenJson),
    estimated_cost_minor: opt(zMoney.nonnegative()),
    currency: zCurrency.default("DKK"),
    source: z.enum(["user", "import", "ai", "template"]).default("user"),
    source_ref: opt(z.string()),
    photo_document_id: opt(zId),
  },
  recipe_ingredient: {
    recipe_id: zId,
    position: z.number().int().min(0),
    amount: opt(z.number().finite().positive({ message: "Mængden skal være større end 0" })),
    unit: opt(z.string()),
    name: zText,
    note: opt(z.string()),
    raw_text: opt(z.string()),
  },
  meal_plan_entry: {
    plan_date: zDate,
    meal: zMeal.default("dinner"),
    recipe_id: opt(zId),
    title: opt(z.string()),
    servings: opt(z.number().int().min(1, { message: "Mindst 1 portion" })),
    note: opt(z.string()),
  },
  shopping_list: {
    name: zText,
    week_start: opt(zDate),
  },
  shopping_item: {
    list_id: zId,
    position: z.number().int().min(0),
    name: zText,
    amount: opt(z.number().finite().positive({ message: "Mængden skal være større end 0" })),
    unit: opt(z.string()),
    category: opt(z.string()),
    checked: zBool01.default(0),
    source: z.enum(["plan", "manual", "ai"]).default("manual"),
  },
  tag: { name: zText },
  entity_tag: { tag_id: zId, target_type: zText, target_id: zId },
} satisfies Record<string, z.ZodRawShape>;

export type EntityType = keyof typeof fields;
export const ENTITY_TYPES = Object.keys(fields) as EntityType[];

export const createSchema = <T extends EntityType>(t: T) => z.object(fields[t]).strict();
export const updateSchema = <T extends EntityType>(t: T) => {
  // In updates, defaults must not silently overwrite existing values.
  const shape = Object.fromEntries(
    Object.entries(fields[t]).map(([k, v]) => [
      k,
      (v instanceof z.ZodDefault ? v.removeDefault() : v).optional(),
    ]),
  );
  return z.object(shape).strict();
};

export type EntityInput<T extends EntityType> = z.input<ReturnType<typeof createSchema<T>>>;
