-- Preventative Private Maintenance: normativ migration 0007 (schemaVersion 7) – udlån og serienumre.
-- Implementeringer kopierer denne fil uændret til packages/core/migrations/0007_lending_and_serials.sql.
-- 1. Tabellen lending: ting, husstanden låner ud (værktøj, spil, bøger …). Tingen er en genstand
--    (item_id) eller en fri tekst (title). Låneren er en person, en kontakt eller et frit navn.
--    Udlånet er aktivt, indtil returned_date er sat. Modulet er 'home'.
-- 2. Serienummer, mærke og model på bygningsdele (fx varmepumpe) og serienummer på reservedele.

CREATE TABLE lending (
  id                  TEXT PRIMARY KEY,
  item_id             TEXT REFERENCES item(id),
  title               TEXT,                 -- hvis tingen ikke er registreret som genstand
  borrower_person_id  TEXT REFERENCES person(id),
  borrower_contact_id TEXT REFERENCES contact(id),
  borrower_name       TEXT,                 -- hvis låneren hverken er person eller kontakt
  lent_date           TEXT NOT NULL,
  due_date            TEXT,                 -- aftalt afleveringsdato
  returned_date       TEXT,                 -- NULL = stadig udlånt
  notes               TEXT,
  created_at          TEXT NOT NULL,
  CHECK (item_id IS NOT NULL OR title IS NOT NULL),
  CHECK (borrower_person_id IS NOT NULL OR borrower_contact_id IS NOT NULL OR borrower_name IS NOT NULL)
);
CREATE INDEX idx_lending_item ON lending(item_id);

ALTER TABLE building_part ADD COLUMN brand TEXT;
ALTER TABLE building_part ADD COLUMN model TEXT;
ALTER TABLE building_part ADD COLUMN serial_number TEXT;
ALTER TABLE item_part ADD COLUMN serial_number TEXT;
