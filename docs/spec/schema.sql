-- Preventative Private Maintenance: normativt skema, schemaVersion 1.
-- Implementeringer kopierer denne fil til packages/core/migrations/0001_init.sql.
-- Konventioner: id = UUID-tekst, *_date = 'YYYY-MM-DD', *_at = ISO 8601 UTC,
-- *_minor = heltal i øre, currency = ISO 4217 (standard 'DKK').

PRAGMA foreign_keys = ON;

CREATE TABLE schema_migrations (
  version     INTEGER PRIMARY KEY,
  applied_at  TEXT NOT NULL
);

CREATE TABLE setting (
  key         TEXT PRIMARY KEY,          -- fx 'ai.modules', 'backup.last_at'
  value_json  TEXT NOT NULL
);

-- ---------- Brugere og personer ----------

CREATE TABLE app_user (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  pin_hash    TEXT,                      -- PBKDF2-SHA256, 'pbkdf2$<iter>$<salt_b64>$<hash_b64>'; er IKKE en sikkerhedsgrænse
  is_admin    INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0,1)),
  created_at  TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE person (
  id                      TEXT PRIMARY KEY,
  name                    TEXT NOT NULL,
  relation                TEXT,          -- fri tekst: 'mig', 'partner', 'barn' …
  birth_year              INTEGER,
  app_user_id             TEXT REFERENCES app_user(id),
  health_private_user_id  TEXT REFERENCES app_user(id), -- NULL = helbred synligt for alle brugere
  notes                   TEXT,
  created_at              TEXT NOT NULL,
  archived_at             TEXT
);

CREATE TABLE contact (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('craftsman','shop','insurer','doctor','dentist','workshop','bank','other')),
  phone       TEXT,
  email       TEXT,
  website     TEXT,
  notes       TEXT,
  created_at  TEXT NOT NULL,
  archived_at TEXT
);

-- ---------- Bolig og inventar ----------

CREATE TABLE property (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  address     TEXT,
  kind        TEXT NOT NULL CHECK (kind IN ('house','apartment','summerhouse','other')),
  owned       INTEGER NOT NULL DEFAULT 1 CHECK (owned IN (0,1)),
  notes       TEXT,
  created_at  TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE location (
  id          TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES property(id),
  parent_id   TEXT REFERENCES location(id),
  name        TEXT NOT NULL,             -- 'Køkken', 'Kælder', 'Have'
  archived_at TEXT
);

CREATE TABLE item (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  category             TEXT,             -- 'Hvidevarer', 'Elektronik' …
  location_id          TEXT REFERENCES location(id),
  brand                TEXT,
  model                TEXT,
  serial_number        TEXT,
  purchase_date        TEXT,
  purchase_price_minor INTEGER,
  currency             TEXT NOT NULL DEFAULT 'DKK',
  vendor_contact_id    TEXT REFERENCES contact(id),
  vendor_name          TEXT,             -- bruges hvis ingen kontakt
  warranty_until       TEXT,             -- producentgaranti
  complaint_until      TEXT,             -- reklamationsret; UI foreslår purchase_date + 24 mdr.
  notes                TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  archived_at          TEXT
);

CREATE TABLE item_part (                 -- reservedele og forbrugsdele
  id          TEXT PRIMARY KEY,
  item_id     TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,             -- 'Emhættefilter'
  part_number TEXT,
  vendor      TEXT,
  notes       TEXT
);

CREATE TABLE building_part (
  id             TEXT PRIMARY KEY,
  property_id    TEXT NOT NULL REFERENCES property(id),
  name           TEXT NOT NULL,          -- 'Regnvandsbrønd', 'Tag', 'Varmepumpe'
  kind           TEXT,
  installed_date TEXT,
  notes          TEXT,
  created_at     TEXT NOT NULL,
  archived_at    TEXT
);

-- ---------- Bil ----------

CREATE TABLE vehicle (
  id                      TEXT PRIMARY KEY,
  name                    TEXT NOT NULL,
  registration            TEXT,          -- nummerplade
  vin                     TEXT,
  make                    TEXT,
  model                   TEXT,
  model_year              INTEGER,
  first_registration_date TEXT,
  fuel                    TEXT CHECK (fuel IN ('petrol','diesel','electric','hybrid','plugin_hybrid','other')),
  notes                   TEXT,
  created_at              TEXT NOT NULL,
  archived_at             TEXT
);

CREATE TABLE odometer_reading (
  id          TEXT PRIMARY KEY,
  vehicle_id  TEXT NOT NULL REFERENCES vehicle(id),
  reading_date TEXT NOT NULL,
  km          INTEGER NOT NULL CHECK (km >= 0),
  source      TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','work_order','ai'))
);

-- ---------- Forsikring ----------

CREATE TABLE policy (
  id                 TEXT PRIMARY KEY,
  insurer_contact_id TEXT REFERENCES contact(id),
  insurer_name       TEXT,
  policy_number      TEXT,
  kind               TEXT NOT NULL CHECK (kind IN ('home_contents','building','car','accident','health','life','travel','change_of_ownership','pet','other')),
  title              TEXT NOT NULL,
  premium_minor      INTEGER,
  premium_period     TEXT CHECK (premium_period IN ('month','quarter','half_year','year')),
  currency           TEXT NOT NULL DEFAULT 'DKK',
  start_date         TEXT,
  renewal_date       TEXT,
  deductible_minor   INTEGER,
  coverage_sum_minor INTEGER,
  notes              TEXT,
  created_at         TEXT NOT NULL,
  archived_at        TEXT
);

CREATE TABLE policy_coverage (
  policy_id   TEXT NOT NULL REFERENCES policy(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('property','item','vehicle','person')),
  target_id   TEXT NOT NULL,
  PRIMARY KEY (policy_id, target_type, target_id)
);

CREATE TABLE claim (
  id             TEXT PRIMARY KEY,
  policy_id      TEXT NOT NULL REFERENCES policy(id),
  claim_number   TEXT,
  incident_date  TEXT NOT NULL,
  description    TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'reported' CHECK (status IN ('reported','in_progress','approved','rejected','paid','closed')),
  payout_minor   INTEGER,
  currency       TEXT NOT NULL DEFAULT 'DKK',
  created_at     TEXT NOT NULL
);

-- ---------- Arbejdsordrer ----------

CREATE TABLE work_order (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  description     TEXT,
  kind            TEXT NOT NULL CHECK (kind IN ('repair','service','damage','improvement','inspection')),
  status          TEXT NOT NULL DEFAULT 'registered'
                  CHECK (status IN ('registered','quote_requested','ordered','done','invoiced','closed','cancelled')),
  target_type     TEXT CHECK (target_type IN ('property','building_part','item','vehicle')),
  target_id       TEXT,
  contact_id      TEXT REFERENCES contact(id),
  reported_date   TEXT NOT NULL,
  completed_date  TEXT,
  cost_minor      INTEGER,
  currency        TEXT NOT NULL DEFAULT 'DKK',
  odometer_km     INTEGER,               -- kun for vehicle
  claim_id        TEXT REFERENCES claim(id),
  created_by      TEXT REFERENCES app_user(id),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE work_order_event (           -- statushistorik og noter
  id            TEXT PRIMARY KEY,
  work_order_id TEXT NOT NULL REFERENCES work_order(id) ON DELETE CASCADE,
  at            TEXT NOT NULL,
  status        TEXT,                     -- ny status, NULL hvis kun note
  note          TEXT,
  user_id       TEXT REFERENCES app_user(id)
);

-- ---------- Opgaver ----------

CREATE TABLE task (
  id                 TEXT PRIMARY KEY,
  title              TEXT NOT NULL,
  description        TEXT,
  module             TEXT NOT NULL CHECK (module IN ('home','maintenance','vehicle','finance','insurance','health','custom')),
  target_type        TEXT CHECK (target_type IN ('property','building_part','item','vehicle','person','policy')),
  target_id          TEXT,
  assignee_person_id TEXT REFERENCES person(id),
  recurrence_json    TEXT,                -- NULL = engangsopgave; se 04-moduler-og-ui.md
  reminder_days      INTEGER NOT NULL DEFAULT 14,
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','archived')),
  template_id        TEXT,
  template_version   INTEGER,
  source             TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user','template','ai','system')),
  system_ref         TEXT,                -- fx 'item.complaint_until:<id>' for automatisk opgave
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE UNIQUE INDEX task_system_ref ON task(system_ref) WHERE system_ref IS NOT NULL;

CREATE TABLE task_occurrence (
  id             TEXT PRIMARY KEY,
  task_id        TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  due_date       TEXT,                    -- NULL = dato mangler
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','skipped')),
  completed_date TEXT,
  completed_by   TEXT REFERENCES app_user(id),
  note           TEXT,
  work_order_id  TEXT REFERENCES work_order(id)
);
CREATE UNIQUE INDEX one_open_occurrence ON task_occurrence(task_id) WHERE status = 'open';

-- ---------- Økonomi ----------

CREATE TABLE account (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  bank        TEXT,
  last4       TEXT,                       -- kun sidste fire cifre
  currency    TEXT NOT NULL DEFAULT 'DKK',
  archived_at TEXT
);

CREATE TABLE category (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  parent_id   TEXT REFERENCES category(id),
  kind        TEXT NOT NULL CHECK (kind IN ('expense','income','transfer')),
  archived_at TEXT
);

CREATE TABLE import_batch (
  id               TEXT PRIMARY KEY,
  account_id       TEXT NOT NULL REFERENCES account(id),
  profile          TEXT NOT NULL,          -- 'sparkron', 'generic:<navn>'
  file_document_id TEXT REFERENCES document(id),
  imported_at      TEXT NOT NULL,
  rows_total       INTEGER NOT NULL,
  rows_imported    INTEGER NOT NULL,
  rows_duplicate   INTEGER NOT NULL
);

CREATE TABLE bank_transaction (
  id              TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL REFERENCES account(id),
  booking_date    TEXT NOT NULL,
  text            TEXT NOT NULL,
  amount_minor    INTEGER NOT NULL,       -- negativ = udgift
  balance_minor   INTEGER,
  currency        TEXT NOT NULL DEFAULT 'DKK',
  category_id     TEXT REFERENCES category(id),
  category_source TEXT CHECK (category_source IN ('rule','user','ai')),
  import_batch_id TEXT REFERENCES import_batch(id),
  dedupe_hash     TEXT NOT NULL,
  note            TEXT,
  UNIQUE (account_id, dedupe_hash)
);

CREATE TABLE transaction_link (
  transaction_id TEXT NOT NULL REFERENCES bank_transaction(id) ON DELETE CASCADE,
  target_type    TEXT NOT NULL CHECK (target_type IN ('item','work_order','policy','vehicle','recurring_expense')),
  target_id      TEXT NOT NULL,
  PRIMARY KEY (transaction_id, target_type, target_id)
);

CREATE TABLE category_rule (
  id          TEXT PRIMARY KEY,
  match_type  TEXT NOT NULL CHECK (match_type IN ('contains','starts_with','regex')),
  pattern     TEXT NOT NULL,              -- sammenlignes uden forskel på store/små bogstaver
  category_id TEXT NOT NULL REFERENCES category(id),
  priority    INTEGER NOT NULL DEFAULT 100, -- lavest vinder
  created_from TEXT NOT NULL DEFAULT 'user' CHECK (created_from IN ('user','learned'))
);

CREATE TABLE budget (
  id    TEXT PRIMARY KEY,
  year  INTEGER NOT NULL,
  name  TEXT NOT NULL,
  UNIQUE (year, name)
);

CREATE TABLE budget_line (
  id           TEXT PRIMARY KEY,
  budget_id    TEXT NOT NULL REFERENCES budget(id) ON DELETE CASCADE,
  category_id  TEXT NOT NULL REFERENCES category(id),
  month        INTEGER CHECK (month BETWEEN 1 AND 12), -- NULL = samme beløb hver måned
  amount_minor INTEGER NOT NULL           -- positivt tal; fortegn følger category.kind
);

CREATE TABLE recurring_expense (          -- faste udgifter og abonnementer
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  category_id  TEXT REFERENCES category(id),
  amount_minor INTEGER NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'DKK',
  period       TEXT NOT NULL CHECK (period IN ('month','quarter','half_year','year')),
  next_date    TEXT,
  binding_until TEXT,                     -- bindingsperiode
  contact_id   TEXT REFERENCES contact(id),
  policy_id    TEXT REFERENCES policy(id),
  notes        TEXT,
  archived_at  TEXT
);

-- ---------- Helbred ----------

CREATE TABLE health_visit (
  id          TEXT PRIMARY KEY,
  person_id   TEXT NOT NULL REFERENCES person(id),
  visit_date  TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('gp','dentist','specialist','hospital','physio','other')),
  contact_id  TEXT REFERENCES contact(id),
  reason      TEXT,
  notes       TEXT,
  referral    TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE health_screening (
  id            TEXT PRIMARY KEY,
  person_id     TEXT NOT NULL REFERENCES person(id),
  name          TEXT NOT NULL,             -- 'Børneundersøgelse 5 år', 'Tarmkræftscreening'
  screening_date TEXT,
  result        TEXT,
  next_due_date TEXT,                      -- opretter/opdaterer task (system_ref)
  notes         TEXT
);

CREATE TABLE health_vaccination (
  id            TEXT PRIMARY KEY,
  person_id     TEXT NOT NULL REFERENCES person(id),
  vaccine       TEXT NOT NULL,
  dose          TEXT,
  given_date    TEXT NOT NULL,
  next_due_date TEXT,
  notes         TEXT
);

CREATE TABLE health_medication (
  id                       TEXT PRIMARY KEY,
  person_id                TEXT NOT NULL REFERENCES person(id),
  name                     TEXT NOT NULL,
  strength                 TEXT,
  dosage                   TEXT,
  start_date               TEXT,
  end_date                 TEXT,           -- NULL = aktiv
  prescription_renewal_date TEXT,          -- opretter/opdaterer task
  notes                    TEXT
);

CREATE TABLE health_allergy (
  id         TEXT PRIMARY KEY,
  person_id  TEXT NOT NULL REFERENCES person(id),
  substance  TEXT NOT NULL,
  reaction   TEXT,
  severity   TEXT CHECK (severity IN ('mild','moderate','severe'))
);

CREATE TABLE health_measurement (
  id          TEXT PRIMARY KEY,
  person_id   TEXT NOT NULL REFERENCES person(id),
  type        TEXT NOT NULL,               -- 'blood_pressure_sys', 'weight', 'hba1c' …
  value       REAL NOT NULL,
  unit        TEXT NOT NULL,
  measured_at TEXT NOT NULL,
  note        TEXT
);

-- ---------- Dokumenter, tags, søgning ----------

CREATE TABLE document (
  id             TEXT PRIMARY KEY,
  sha256         TEXT NOT NULL UNIQUE,
  filename       TEXT NOT NULL,            -- oprindeligt filnavn
  ext            TEXT NOT NULL,
  mime           TEXT NOT NULL,
  size_bytes     INTEGER NOT NULL,
  title          TEXT,
  doc_date       TEXT,
  source         TEXT NOT NULL CHECK (source IN ('drop','inbox','ai','bank_import')),
  extracted_text TEXT,                     -- tekstlag fra PDF/mail; OCR senere
  created_at     TEXT NOT NULL,
  created_by     TEXT REFERENCES app_user(id)
);

CREATE TABLE document_link (
  document_id TEXT NOT NULL REFERENCES document(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('property','location','item','building_part','vehicle','work_order','claim','policy','person','health_visit','health_screening','health_vaccination','health_medication','bank_transaction','task_occurrence','recurring_expense')),
  target_id   TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('receipt','invoice','quote','photo','photo_before','photo_after','manual','policy_terms','report','letter','other')),
  PRIMARY KEY (document_id, target_type, target_id, role)
);

CREATE TABLE tag (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE entity_tag (
  tag_id      TEXT NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  PRIMARY KEY (tag_id, target_type, target_id)
);

-- Vedligeholdes af core ved hver skrivning (ikke triggers).
CREATE VIRTUAL TABLE search_index USING fts5(
  entity_type UNINDEXED,
  entity_id   UNINDEXED,
  module      UNINDEXED,
  title,
  body,
  tokenize = 'unicode61 remove_diacritics 0'
);

-- ---------- AI og audit ----------

CREATE TABLE ai_draft (
  id               TEXT PRIMARY KEY,
  created_at       TEXT NOT NULL,
  tool             TEXT NOT NULL,
  action           TEXT NOT NULL CHECK (action IN ('create','update','attach_document','complete_task')),
  entity_type      TEXT NOT NULL,
  entity_id        TEXT,                    -- ved update/complete
  payload_json     TEXT NOT NULL,
  rationale        TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','failed')),
  decided_at       TEXT,
  decided_by       TEXT REFERENCES app_user(id),
  result_entity_id TEXT,
  error            TEXT
);

CREATE TABLE ai_access_log (
  id            TEXT PRIMARY KEY,
  at            TEXT NOT NULL,
  client_name   TEXT,                       -- fra MCP initialize
  as_user_id    TEXT REFERENCES app_user(id),
  tool          TEXT NOT NULL,
  args_json     TEXT NOT NULL,
  returned_refs TEXT NOT NULL,              -- JSON-array af {type,id}
  denied_reason TEXT
);

CREATE TABLE audit_log (
  id          TEXT PRIMARY KEY,
  at          TEXT NOT NULL,
  user_id     TEXT REFERENCES app_user(id),
  via         TEXT NOT NULL CHECK (via IN ('ui','ai_draft','import','system')),
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('create','update','archive','restore','delete')),
  diff_json   TEXT                          -- {felt: [før, efter]}
);

CREATE INDEX idx_item_location ON item(location_id);
CREATE INDEX idx_wo_target ON work_order(target_type, target_id);
CREATE INDEX idx_occ_due ON task_occurrence(status, due_date);
CREATE INDEX idx_tx_date ON bank_transaction(account_id, booking_date);
CREATE INDEX idx_doclink_target ON document_link(target_type, target_id);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
