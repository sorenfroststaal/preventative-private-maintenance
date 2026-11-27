-- Preventative Private Maintenance: normativ migration 0011 (schemaVersion 11) – personer uden for husstanden og gaver.
-- Implementeringer kopierer denne fil uændret til packages/core/migrations/0011_people_and_gifts.sql.
-- 1. person.household: 1 = med i husstanden (standard, som alle hidtidige personer), 0 = familie, venner,
--    naboer o.l. uden for husstanden. Personer uden for husstanden kan låne ting og få gaver, men vælges
--    ikke som ejere, til forsikringsdækning, faste udgifter eller helbred.
-- 2. Tabellen gift: gaver, husstanden giver (direction 'given') eller får ('received'). Personen er
--    modtageren eller giveren. En modtaget gave kan pege på en genstand (item_id). Modulet er 'home'.

ALTER TABLE person ADD COLUMN household INTEGER NOT NULL DEFAULT 1 CHECK (household IN (0,1));

CREATE TABLE gift (
  id           TEXT PRIMARY KEY,
  direction    TEXT NOT NULL DEFAULT 'given' CHECK (direction IN ('given','received')),
  person_id    TEXT NOT NULL REFERENCES person(id),
  title        TEXT NOT NULL,            -- hvad gaven var
  occasion     TEXT,                     -- fri tekst: fødselsdag, jul, bryllup …
  gift_date    TEXT NOT NULL,
  amount_minor INTEGER,                  -- pris i øre
  item_id      TEXT REFERENCES item(id), -- modtaget gave registreret som genstand
  notes        TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_gift_person ON gift(person_id, gift_date);
