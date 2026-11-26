-- Preventative Private Maintenance: normativ migration 0009 (schemaVersion 9) – ejer af en genstand.
-- Implementeringer kopierer denne fil uændret til packages/core/migrations/0009_item_owner.sql.
-- En genstand kan høre til en person i husstanden (fx høretelefoner, cykel, legetøj).

ALTER TABLE item ADD COLUMN owner_person_id TEXT REFERENCES person(id);
CREATE INDEX idx_item_owner ON item(owner_person_id);
