-- Preventative Private Maintenance: normativ migration 0006 (schemaVersion 6) – lån, flere bilag og felter.
-- Implementeringer kopierer denne fil uændret til packages/core/migrations/0006_loans_and_documents.sql.
-- 1. Tabellen loan (lån: boliglån, billån, SU-lån, forbrugslån …) i modulet 'finance'.
-- 2. document_link genopbygges: bilag kan også kobles til contact, account og loan, og rollerne
--    'warranty' (garantibevis), 'contract' (kontrakt/aftale) og 'certificate' (certifikat/attest) tilføjes.
-- 3. transaction_link genopbygges, så en postering kan kobles til et lån (afdrag og renter).
-- 4. vehicle får købsdato og købspris.
-- 5. recurring_expense får kobling til bolig eller bil, slutdato og markering af variabelt beløb
--    (amount_minor er da et skøn, fx el og varme).
-- Data og indeks bevares. Ingen andre tabeller peger på document_link eller transaction_link.

CREATE TABLE loan (
  id                      TEXT PRIMARY KEY,
  name                    TEXT NOT NULL,
  kind                    TEXT NOT NULL DEFAULT 'other' CHECK (kind IN ('mortgage','bank','car','student','consumer','private','other')),
  lender_contact_id       TEXT REFERENCES contact(id),
  loan_number             TEXT,
  principal_minor         INTEGER,             -- oprindelig hovedstol
  balance_minor           INTEGER,             -- restgæld pr. balance_date
  balance_date            TEXT,
  interest_rate           REAL,                -- årlig rente i procent, fx 4.25
  payment_minor           INTEGER,             -- ydelse pr. termin
  payment_period          TEXT NOT NULL DEFAULT 'month' CHECK (payment_period IN ('month','quarter','half_year','year')),
  start_date              TEXT,
  end_date                TEXT,                -- forventet sidste ydelse
  property_id             TEXT REFERENCES property(id),
  vehicle_id              TEXT REFERENCES vehicle(id),
  account_id              TEXT REFERENCES account(id),
  notes                   TEXT,
  created_at              TEXT NOT NULL,
  archived_at             TEXT
);

CREATE TABLE document_link_new (
  document_id TEXT NOT NULL REFERENCES document(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('property','location','item','item_part','building_part','vehicle','pet','work_order','claim','policy','person','contact','account','loan','health_visit','health_screening','health_vaccination','health_medication','bank_transaction','task_occurrence','recurring_expense')),
  target_id   TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('receipt','invoice','quote','photo','photo_before','photo_after','manual','policy_terms','warranty','contract','certificate','report','letter','other')),
  PRIMARY KEY (document_id, target_type, target_id, role)
);
INSERT INTO document_link_new (document_id, target_type, target_id, role)
  SELECT document_id, target_type, target_id, role FROM document_link;
DROP TABLE document_link;
ALTER TABLE document_link_new RENAME TO document_link;
CREATE INDEX idx_doclink_target ON document_link(target_type, target_id);

CREATE TABLE transaction_link_new (
  transaction_id TEXT NOT NULL REFERENCES bank_transaction(id) ON DELETE CASCADE,
  target_type    TEXT NOT NULL CHECK (target_type IN ('item','work_order','policy','vehicle','recurring_expense','loan')),
  target_id      TEXT NOT NULL,
  PRIMARY KEY (transaction_id, target_type, target_id)
);
INSERT INTO transaction_link_new (transaction_id, target_type, target_id)
  SELECT transaction_id, target_type, target_id FROM transaction_link;
DROP TABLE transaction_link;
ALTER TABLE transaction_link_new RENAME TO transaction_link;

ALTER TABLE vehicle ADD COLUMN purchase_date TEXT;
ALTER TABLE vehicle ADD COLUMN purchase_price_minor INTEGER;

ALTER TABLE recurring_expense ADD COLUMN property_id TEXT REFERENCES property(id);
ALTER TABLE recurring_expense ADD COLUMN vehicle_id TEXT REFERENCES vehicle(id);
ALTER TABLE recurring_expense ADD COLUMN end_date TEXT;
ALTER TABLE recurring_expense ADD COLUMN amount_variable INTEGER NOT NULL DEFAULT 0 CHECK (amount_variable IN (0,1));
