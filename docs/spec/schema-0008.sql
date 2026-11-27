-- Preventative Private Maintenance: normativ migration 0008 (schemaVersion 8) – faste udgifter pr. person.
-- Implementeringer kopierer denne fil uændret til packages/core/migrations/0008_recurring_person.sql.
-- En fast udgift kan høre til en person i husstanden (fx kontingent, fagforening, mobilabonnement).

ALTER TABLE recurring_expense ADD COLUMN person_id TEXT REFERENCES person(id);
