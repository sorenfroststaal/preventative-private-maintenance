-- Preventative Private Maintenance: normativ migration 0010 (schemaVersion 10) – flere personer pr. post.
-- Implementeringer kopierer denne fil uændret til packages/core/migrations/0010_person_links.sql.
-- En fast udgift eller en genstand kan høre til flere personer i husstanden. Koblingerne fra
-- recurring_expense.person_id (0008) og item.owner_person_id (0009) flyttes hertil, og de to kolonner
-- bruges ikke længere (de står tomme; SQLite kan ikke fjerne en kolonne med REFERENCES).

CREATE TABLE person_link (
  person_id   TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('recurring_expense','item')),
  target_id   TEXT NOT NULL,
  PRIMARY KEY (person_id, target_type, target_id)
);
CREATE INDEX idx_person_link_target ON person_link(target_type, target_id);

INSERT INTO person_link (person_id, target_type, target_id)
  SELECT person_id, 'recurring_expense', id FROM recurring_expense WHERE person_id IS NOT NULL;
INSERT INTO person_link (person_id, target_type, target_id)
  SELECT owner_person_id, 'item', id FROM item WHERE owner_person_id IS NOT NULL;
UPDATE recurring_expense SET person_id = NULL WHERE person_id IS NOT NULL;
UPDATE item SET owner_person_id = NULL WHERE owner_person_id IS NOT NULL;
