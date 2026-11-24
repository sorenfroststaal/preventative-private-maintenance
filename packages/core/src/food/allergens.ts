/** Allergen keywords and matching against health_allergy (spec 04 "Allergi-advarsler"). */
import type { DbAdapter } from "../db/adapter";
import { ALLERGEN_KEYS, type AllergenKey } from "../domain/schemas";

export interface AllergenDef {
  key: AllergenKey;
  label: string;
  keywords: string[];
}

/** The keyword list from spec 04. It MAY be extended, never shortened. */
export const ALLERGENS: AllergenDef[] = [
  { key: "gluten", label: "Gluten", keywords: ["hvede", "mel", "rug", "byg", "spelt", "pasta", "brød", "rasp", "couscous", "bulgur", "gluten"] },
  { key: "milk", label: "Mælk", keywords: ["mælk", "fløde", "smør", "ost", "yoghurt", "skyr", "creme fraiche", "laktose"] },
  { key: "egg", label: "Æg", keywords: ["æg", "mayonnaise"] },
  { key: "nuts", label: "Nødder", keywords: ["nød", "nødder", "mandel", "hasselnød", "valnød", "cashew", "pistacie", "pekan"] },
  { key: "peanut", label: "Jordnødder", keywords: ["jordnød", "peanut"] },
  { key: "fish", label: "Fisk", keywords: ["fisk", "laks", "torsk", "tun", "sild", "makrel", "rødspætte"] },
  { key: "shellfish", label: "Skaldyr", keywords: ["rejer", "reje", "krabbe", "hummer", "muslinger", "skaldyr"] },
  { key: "soy", label: "Soja", keywords: ["soja", "tofu", "edamame"] },
  { key: "sesame", label: "Sesam", keywords: ["sesam", "tahin"] },
  { key: "celery", label: "Selleri", keywords: ["selleri"] },
  { key: "mustard", label: "Sennep", keywords: ["sennep"] },
];

const BY_KEY = new Map(ALLERGENS.map((a) => [a.key, a]));
export const allergenLabel = (key: string) => BY_KEY.get(key as AllergenKey)?.label ?? key;

/** "crème fraîche" and "creme fraiche" match alike; case is ignored. */
const fold = (s: string) => s.toLowerCase().replace(/è/g, "e").replace(/î/g, "i").replace(/é/g, "e");

/** Allergen keys whose keywords occur in the text (substring match, spec 04). */
export function allergensInText(text: string): AllergenKey[] {
  const t = fold(text);
  return ALLERGENS.filter((a) => a.keywords.some((k) => t.includes(fold(k)))).map((a) => a.key);
}

/** A health_allergy matches a key if substance contains the display name or a keyword. */
export function allergyKeys(substance: string): AllergenKey[] {
  const t = fold(substance);
  return ALLERGENS.filter((a) => t.includes(fold(a.label)) || a.keywords.some((k) => t.includes(fold(k)))).map((a) => a.key);
}

export function parseAllergenJson(v: unknown): AllergenKey[] {
  if (typeof v !== "string") return [];
  try {
    const a: unknown = JSON.parse(v);
    return Array.isArray(a) ? a.filter((x): x is AllergenKey => (ALLERGEN_KEYS as readonly string[]).includes(String(x))) : [];
  } catch {
    return [];
  }
}

/** Marked (allergens_json) and derived (ingredient names) allergens of a recipe. */
export function recipeAllergens(allergensJson: unknown, ingredientNames: string[]): { marked: AllergenKey[]; derived: AllergenKey[]; all: AllergenKey[] } {
  const marked = parseAllergenJson(allergensJson);
  const derived = [...new Set(ingredientNames.flatMap(allergensInText))];
  const all = ALLERGEN_KEYS.filter((k) => marked.includes(k) || derived.includes(k));
  return { marked, derived: derived.filter((k) => !marked.includes(k)), all };
}

export interface AllergyWarning {
  /** Null for private warnings: not even the allergen class is revealed. */
  key: AllergenKey | null;
  allergen: string;
  /** Null when the person's health data is private to another user. */
  person: string | null;
  substance: string | null;
  private: boolean;
  /** Text for the badge, e.g. "Rejer (Ida)" or "Allergi hos et husstandsmedlem (privat)". */
  text: string;
}

export const PRIVATE_ALLERGY_TEXT = "Allergi hos et husstandsmedlem (privat)";

export interface HouseholdAllergy {
  person: string;
  substance: string;
  private: boolean;
  keys: AllergenKey[];
}

/** Allergies of active persons with the keys they match. Private ones are masked for other users. */
export async function householdAllergies(db: DbAdapter, userId: string | null): Promise<HouseholdAllergy[]> {
  const rows = await db.select<{ substance: string; name: string; priv: string | null }>(
    `SELECT a.substance, p.name, p.health_private_user_id AS priv FROM health_allergy a
       JOIN person p ON p.id = a.person_id WHERE p.archived_at IS NULL ORDER BY p.name, a.substance`,
  );
  return rows.map((r) => ({
    person: r.name,
    substance: r.substance,
    private: r.priv !== null && r.priv !== userId,
    keys: allergyKeys(r.substance),
  }));
}

/** Warnings for a dish with the given allergens. Private matches collapse into one masked warning. */
export function warningsFor(allergens: AllergenKey[], household: HouseholdAllergy[]): AllergyWarning[] {
  const out: AllergyWarning[] = [];
  let privateHit = false;
  for (const a of household) {
    const hit = a.keys.find((k) => allergens.includes(k));
    if (!hit) continue;
    if (a.private) {
      privateHit = true;
      continue;
    }
    out.push({
      key: hit,
      allergen: allergenLabel(hit),
      person: a.person,
      substance: a.substance,
      private: false,
      text: `${a.substance} (${a.person})`,
    });
  }
  if (privateHit) {
    out.push({ key: null, allergen: "", person: null, substance: null, private: true, text: PRIVATE_ALLERGY_TEXT });
  }
  return out;
}
