-- Preventative Private Maintenance: normativ migration 0002 (schemaVersion 2) – madplan.
-- Implementeringer kopierer denne fil uændret til packages/core/migrations/0002_meal_plan.sql.
-- Samme konventioner som schema.sql.

CREATE TABLE recipe (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  description          TEXT,
  servings             INTEGER NOT NULL DEFAULT 4 CHECK (servings > 0),
  prep_minutes         INTEGER CHECK (prep_minutes IS NULL OR prep_minutes >= 0),
  instructions         TEXT,                  -- fremgangsmåde, ren tekst
  tags_json            TEXT,                  -- JSON-array af tekster: ["vegetar","hurtig"]
  allergens_json       TEXT,                  -- JSON-array af allergen-nøgler (se 04 Madplan)
  estimated_cost_minor INTEGER,               -- anslået pris for hele opskriften (servings)
  currency             TEXT NOT NULL DEFAULT 'DKK',
  source               TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user','import','ai','template')),
  source_ref           TEXT,                  -- fx 'open-planner:pasta-med-kodsovs'
  photo_document_id    TEXT REFERENCES document(id),
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  archived_at          TEXT
);
CREATE UNIQUE INDEX recipe_source_ref ON recipe(source_ref) WHERE source_ref IS NOT NULL;

CREATE TABLE recipe_ingredient (
  id         TEXT PRIMARY KEY,
  recipe_id  TEXT NOT NULL REFERENCES recipe(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL,
  amount     REAL CHECK (amount IS NULL OR amount > 0),
  unit       TEXT,                            -- normaliseret enhed, se 04 Madplan
  name       TEXT NOT NULL,                   -- vare, fx 'hakket oksekød'
  note       TEXT,
  raw_text   TEXT                             -- oprindelig linje ved import
);
CREATE INDEX idx_ingredient_recipe ON recipe_ingredient(recipe_id, position);

CREATE TABLE meal_plan_entry (
  id         TEXT PRIMARY KEY,
  plan_date  TEXT NOT NULL,
  meal       TEXT NOT NULL DEFAULT 'dinner' CHECK (meal IN ('breakfast','lunch','dinner','snack')),
  recipe_id  TEXT REFERENCES recipe(id),
  title      TEXT,                            -- bruges uden opskrift, fx 'Rester'
  servings   INTEGER CHECK (servings IS NULL OR servings > 0),
  note       TEXT,
  created_at TEXT NOT NULL,
  CHECK (recipe_id IS NOT NULL OR title IS NOT NULL)
);
CREATE INDEX idx_meal_plan_date ON meal_plan_entry(plan_date, meal);

CREATE TABLE shopping_list (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  week_start  TEXT,                           -- mandag i ugen, hvis listen hører til en madplan
  created_at  TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE shopping_item (
  id        TEXT PRIMARY KEY,
  list_id   TEXT NOT NULL REFERENCES shopping_list(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL,
  name      TEXT NOT NULL,
  amount    REAL CHECK (amount IS NULL OR amount > 0),
  unit      TEXT,
  category  TEXT,                             -- butiksafdeling, se 04 Madplan
  checked   INTEGER NOT NULL DEFAULT 0 CHECK (checked IN (0,1)),
  source    TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('plan','manual','ai'))
);
CREATE INDEX idx_shopping_item_list ON shopping_item(list_id, position);

-- Nye standardindstillinger (spec 03) skrives af migrationen, så eksisterende arkiver får dem.
UPDATE setting
   SET value_json = json_set(value_json, '$.food', json('true'))
 WHERE key = 'ai.modules' AND json_extract(value_json, '$.food') IS NULL;
