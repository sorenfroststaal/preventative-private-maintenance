-- Preventative Private Maintenance: normativ migration 0003 (schemaVersion 3) – bilag på reservedele.
-- Implementeringer kopierer denne fil uændret til packages/core/migrations/0003_item_part_documents.sql.
-- SQLite kan ikke ændre en CHECK-regel, så document_link genopbygges med 'item_part' som tilladt mål.
-- Data og indeks bevares. Ingen andre tabeller peger på document_link.

CREATE TABLE document_link_new (
  document_id TEXT NOT NULL REFERENCES document(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('property','location','item','item_part','building_part','vehicle','work_order','claim','policy','person','health_visit','health_screening','health_vaccination','health_medication','bank_transaction','task_occurrence','recurring_expense')),
  target_id   TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('receipt','invoice','quote','photo','photo_before','photo_after','manual','policy_terms','report','letter','other')),
  PRIMARY KEY (document_id, target_type, target_id, role)
);
INSERT INTO document_link_new (document_id, target_type, target_id, role)
  SELECT document_id, target_type, target_id, role FROM document_link;
DROP TABLE document_link;
ALTER TABLE document_link_new RENAME TO document_link;
CREATE INDEX idx_doclink_target ON document_link(target_type, target_id);
