-- Preventative Private Maintenance: normativ migration 0013 (schemaVersion 13) – afhændelse af genstande.
-- Implementeringer kopierer denne fil uændret til packages/core/migrations/0013_item_disposal.sql.
-- 1. Når en genstand arkiveres, kan årsagen gemmes: givet væk ('given_away'), givet til en person
--    ('given_to', personen i disposal_person_id), solgt ('sold', prisen i disposal_price_minor og en
--    eventuel køber i disposal_person_id), smidt ud ('discarded') eller en anden årsag ('other').
-- 2. Afhændede genstande står i arkivet og kan gendannes; gendannelse rydder årsagen.
-- 3. Kun "Slet helt" fjerner en genstand fysisk (se 03-datamodel.md, Afhændelse af genstande).

ALTER TABLE item ADD COLUMN disposal_kind TEXT CHECK (disposal_kind IN ('given_away','given_to','sold','discarded','other'));
ALTER TABLE item ADD COLUMN disposal_date TEXT;
ALTER TABLE item ADD COLUMN disposal_price_minor INTEGER;
ALTER TABLE item ADD COLUMN disposal_person_id TEXT REFERENCES person(id);
ALTER TABLE item ADD COLUMN disposal_note TEXT;
