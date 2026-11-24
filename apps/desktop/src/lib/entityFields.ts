import type { EntityType } from "@ppm/core";

export type FieldType = "text" | "textarea" | "date" | "money" | "number" | "select" | "ref" | "datetime";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: [string, string][];
  /** For type "ref": which entity and which column is shown. */
  ref?: { type: EntityType; label: string; where?: Record<string, string> };
  help?: string;
  /** Hidden in forms (set by context, e.g. person_id). */
  hidden?: boolean;
}

const t = (key: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, type: "text", ...extra });
const ta = (key: string, label: string): FieldDef => ({ key, label, type: "textarea" });
const d = (key: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, type: "date", ...extra });
const m = (key: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, type: "money", ...extra });
const n = (key: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, type: "number", ...extra });
const s = (key: string, label: string, options: [string, string][], extra: Partial<FieldDef> = {}): FieldDef => ({
  key,
  label,
  type: "select",
  options,
  ...extra,
});
const r = (key: string, label: string, type: EntityType, labelCol = "name", extra: Partial<FieldDef> = {}): FieldDef => ({
  key,
  label,
  type: "ref",
  ref: { type, label: labelCol },
  ...extra,
});

export const CONTACT_KINDS: [string, string][] = [
  ["craftsman", "Håndværker"],
  ["shop", "Butik"],
  ["insurer", "Forsikringsselskab"],
  ["doctor", "Læge"],
  ["dentist", "Tandlæge"],
  ["workshop", "Værksted"],
  ["bank", "Bank"],
  ["other", "Andet"],
];
export const WO_STATUS: [string, string][] = [
  ["registered", "Registreret"],
  ["quote_requested", "Tilbud indhentet"],
  ["ordered", "Bestilt"],
  ["done", "Udført"],
  ["invoiced", "Faktureret"],
  ["closed", "Afsluttet"],
  ["cancelled", "Annulleret"],
];
export const WO_KIND: [string, string][] = [
  ["repair", "Reparation"],
  ["service", "Service"],
  ["damage", "Skade"],
  ["improvement", "Forbedring"],
  ["inspection", "Eftersyn"],
];
export const POLICY_KIND: [string, string][] = [
  ["home_contents", "Indbo"],
  ["building", "Hus/bygning"],
  ["car", "Bil"],
  ["accident", "Ulykke"],
  ["health", "Sundhed"],
  ["life", "Liv"],
  ["travel", "Rejse"],
  ["change_of_ownership", "Ejerskifte"],
  ["pet", "Dyr"],
  ["other", "Andet"],
];
export const PERIODS: [string, string][] = [
  ["month", "Måned"],
  ["quarter", "Kvartal"],
  ["half_year", "Halvår"],
  ["year", "År"],
];
export const CLAIM_STATUS: [string, string][] = [
  ["reported", "Anmeldt"],
  ["in_progress", "Under behandling"],
  ["approved", "Godkendt"],
  ["rejected", "Afvist"],
  ["paid", "Udbetalt"],
  ["closed", "Lukket"],
];
export const DOC_ROLES: [string, string][] = [
  ["receipt", "Kvittering"],
  ["invoice", "Faktura"],
  ["quote", "Tilbud"],
  ["photo", "Foto"],
  ["photo_before", "Foto før"],
  ["photo_after", "Foto efter"],
  ["manual", "Manual"],
  ["policy_terms", "Policevilkår"],
  ["report", "Rapport"],
  ["letter", "Brev"],
  ["other", "Andet"],
];

export const FIELDS: Partial<Record<EntityType, FieldDef[]>> = {
  property: [
    t("name", "Navn", { required: true }),
    t("address", "Adresse"),
    s("kind", "Type", [["house", "Hus"], ["apartment", "Lejlighed"], ["summerhouse", "Sommerhus"], ["other", "Andet"]], { required: true }),
    s("owned", "Ejerforhold", [["1", "Ejer"], ["0", "Lejer"]]),
    ta("notes", "Noter"),
  ],
  location: [r("property_id", "Bolig", "property", "name", { required: true }), r("parent_id", "Ligger i", "location"), t("name", "Navn", { required: true })],
  item: [
    t("name", "Navn", { required: true }),
    t("category", "Kategori", { help: "Fx Hvidevarer, Elektronik, Møbler" }),
    r("location_id", "Placering", "location"),
    t("brand", "Mærke"),
    t("model", "Model"),
    t("serial_number", "Serienummer"),
    d("purchase_date", "Købsdato"),
    m("purchase_price_minor", "Købspris"),
    r("vendor_contact_id", "Forhandler (kontakt)", "contact"),
    t("vendor_name", "Forhandler (tekst)"),
    d("warranty_until", "Garanti til"),
    d("complaint_until", "Reklamationsret til"),
    ta("notes", "Noter"),
  ],
  item_part: [t("name", "Navn", { required: true }), t("part_number", "Varenummer"), t("vendor", "Leverandør"), ta("notes", "Noter")],
  building_part: [
    r("property_id", "Bolig", "property", "name", { required: true }),
    t("name", "Navn", { required: true, help: "Fx Regnvandsbrønd, Tag, Varmepumpe" }),
    t("kind", "Type"),
    d("installed_date", "Installeret"),
    ta("notes", "Noter"),
  ],
  contact: [
    t("name", "Navn", { required: true }),
    s("kind", "Type", CONTACT_KINDS, { required: true }),
    t("phone", "Telefon"),
    t("email", "E-mail"),
    t("website", "Hjemmeside"),
    ta("notes", "Noter"),
  ],
  work_order: [
    t("title", "Titel", { required: true }),
    s("kind", "Type", WO_KIND, { required: true }),
    s("status", "Status", WO_STATUS),
    ta("description", "Beskrivelse"),
    r("contact_id", "Håndværker/værksted", "contact"),
    d("reported_date", "Registreret", { required: true }),
    d("completed_date", "Udført"),
    m("cost_minor", "Omkostning"),
    n("odometer_km", "Km-stand", { help: "Kun for biler" }),
  ],
  vehicle: [
    t("name", "Navn", { required: true }),
    t("registration", "Nummerplade"),
    t("vin", "Stelnummer"),
    t("make", "Mærke"),
    t("model", "Model"),
    n("model_year", "Årgang"),
    d("first_registration_date", "Første registrering"),
    s("fuel", "Drivmiddel", [["petrol", "Benzin"], ["diesel", "Diesel"], ["electric", "El"], ["hybrid", "Hybrid"], ["plugin_hybrid", "Plugin-hybrid"], ["other", "Andet"]]),
    ta("notes", "Noter"),
  ],
  odometer_reading: [d("reading_date", "Dato", { required: true }), n("km", "Km", { required: true })],
  policy: [
    t("title", "Titel", { required: true }),
    s("kind", "Type", POLICY_KIND, { required: true }),
    r("insurer_contact_id", "Selskab (kontakt)", "contact"),
    t("insurer_name", "Selskab (tekst)"),
    t("policy_number", "Policenummer"),
    m("premium_minor", "Præmie"),
    s("premium_period", "Betales pr.", PERIODS),
    d("start_date", "Start"),
    d("renewal_date", "Fornyelse"),
    m("deductible_minor", "Selvrisiko"),
    m("coverage_sum_minor", "Dækningssum"),
    ta("notes", "Noter"),
  ],
  claim: [
    d("incident_date", "Skadesdato", { required: true }),
    ta("description", "Beskrivelse"),
    t("claim_number", "Skadenummer"),
    s("status", "Status", CLAIM_STATUS),
    m("payout_minor", "Udbetaling"),
  ],
  account: [t("name", "Navn", { required: true }), t("bank", "Bank"), t("last4", "Sidste 4 cifre", { help: "Kun de sidste fire cifre" })],
  recurring_expense: [
    t("name", "Navn", { required: true }),
    r("category_id", "Kategori", "category"),
    m("amount_minor", "Beløb", { required: true }),
    s("period", "Pr.", PERIODS, { required: true }),
    d("next_date", "Næste betaling"),
    d("binding_until", "Binding til"),
    r("contact_id", "Leverandør", "contact"),
    r("policy_id", "Police", "policy", "title"),
    ta("notes", "Noter"),
  ],
  health_visit: [
    d("visit_date", "Dato", { required: true }),
    s("kind", "Type", [["gp", "Egen læge"], ["dentist", "Tandlæge"], ["specialist", "Speciallæge"], ["hospital", "Hospital"], ["physio", "Fysioterapeut"], ["other", "Andet"]], { required: true }),
    r("contact_id", "Behandler", "contact"),
    t("reason", "Årsag"),
    ta("notes", "Noter"),
    t("referral", "Henvisning"),
  ],
  health_screening: [t("name", "Screening", { required: true }), d("screening_date", "Dato"), t("result", "Resultat"), d("next_due_date", "Næste gang"), ta("notes", "Noter")],
  health_vaccination: [t("vaccine", "Vaccine", { required: true }), t("dose", "Dosis"), d("given_date", "Givet", { required: true }), d("next_due_date", "Næste gang"), ta("notes", "Noter")],
  health_medication: [
    t("name", "Medicin", { required: true }),
    t("strength", "Styrke"),
    t("dosage", "Dosering"),
    d("start_date", "Start"),
    d("end_date", "Slut"),
    d("prescription_renewal_date", "Forny recept"),
    ta("notes", "Noter"),
  ],
  health_allergy: [t("substance", "Stof", { required: true }), t("reaction", "Reaktion"), s("severity", "Sværhedsgrad", [["mild", "Mild"], ["moderate", "Moderat"], ["severe", "Svær"]])],
  health_measurement: [t("type", "Type", { required: true, help: "Fx Blodtryk (systolisk), Vægt" }), n("value", "Værdi", { required: true }), t("unit", "Enhed", { required: true }), { key: "measured_at", label: "Tidspunkt", type: "datetime", required: true }, t("note", "Note")],
  budget: [n("year", "År", { required: true }), t("name", "Navn", { required: true })],
  budget_line: [r("category_id", "Kategori", "category", "name", { required: true }), n("month", "Måned (tom = hver måned)"), m("amount_minor", "Beløb", { required: true })],
  category_rule: [
    s("match_type", "Match", [["contains", "Indeholder"], ["starts_with", "Starter med"], ["regex", "Regulært udtryk"]], { required: true }),
    t("pattern", "Mønster", { required: true }),
    r("category_id", "Kategori", "category", "name", { required: true }),
    n("priority", "Prioritet (lavest vinder)"),
  ],
  recipe: [
    t("name", "Navn", { required: true }),
    n("servings", "Portioner", { required: true }),
    n("prep_minutes", "Tid (minutter)"),
    m("estimated_cost_minor", "Anslået pris (hele opskriften)"),
    ta("description", "Beskrivelse"),
    ta("instructions", "Fremgangsmåde"),
  ],
  category: [t("name", "Navn", { required: true }), s("kind", "Type", [["expense", "Udgift"], ["income", "Indtægt"], ["transfer", "Overførsel"]], { required: true }), r("parent_id", "Underkategori af", "category")],
};

export function fieldsFor(type: EntityType): FieldDef[] {
  return FIELDS[type] ?? [];
}

export function optionLabel(options: [string, string][], value: unknown): string {
  return options.find(([k]) => k === String(value))?.[1] ?? (value === null || value === undefined ? "–" : String(value));
}
