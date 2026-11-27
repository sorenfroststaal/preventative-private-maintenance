-- Preventative Private Maintenance: normativ migration 0004 (schemaVersion 4) – husdyr.
-- Implementeringer kopierer denne fil uændret til packages/core/migrations/0004_pets.sql.
-- Husdyr hører til modulet 'home'. Bilag (document_link) og forsikringsdækning
-- (policy_coverage) kan pege på et husdyr; begge tabeller genopbygges, fordi SQLite ikke kan
-- ændre en CHECK-regel. Data og indeks bevares. Ingen andre tabeller peger på dem.

CREATE TABLE pet (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  species         TEXT NOT NULL DEFAULT 'dog' CHECK (species IN ('dog','cat','horse','rabbit','bird','other')),
  breed           TEXT,                       -- race, fx 'Golden retriever'
  sex             TEXT CHECK (sex IS NULL OR sex IN ('female','male')),
  birth_date      TEXT,
  chip_number     TEXT,                       -- ID-chip / øremærke
  owner_person_id TEXT REFERENCES person(id),
  vet_contact_id  TEXT REFERENCES contact(id),
  notes           TEXT,
  created_at      TEXT NOT NULL,
  archived_at     TEXT
);

CREATE TABLE document_link_new (
  document_id TEXT NOT NULL REFERENCES document(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('property','location','item','item_part','building_part','vehicle','pet','work_order','claim','policy','person','health_visit','health_screening','health_vaccination','health_medication','bank_transaction','task_occurrence','recurring_expense')),
  target_id   TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('receipt','invoice','quote','photo','photo_before','photo_after','manual','policy_terms','report','letter','other')),
  PRIMARY KEY (document_id, target_type, target_id, role)
);
INSERT INTO document_link_new (document_id, target_type, target_id, role)
  SELECT document_id, target_type, target_id, role FROM document_link;
DROP TABLE document_link;
ALTER TABLE document_link_new RENAME TO document_link;
CREATE INDEX idx_doclink_target ON document_link(target_type, target_id);

CREATE TABLE policy_coverage_new (
  policy_id   TEXT NOT NULL REFERENCES policy(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('property','item','vehicle','person','pet')),
  target_id   TEXT NOT NULL,
  PRIMARY KEY (policy_id, target_type, target_id)
);
INSERT INTO policy_coverage_new (policy_id, target_type, target_id)
  SELECT policy_id, target_type, target_id FROM policy_coverage;
DROP TABLE policy_coverage;
ALTER TABLE policy_coverage_new RENAME TO policy_coverage;
