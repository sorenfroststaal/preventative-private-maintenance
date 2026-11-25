-- Preventative Private Maintenance: normativ migration 0005 (schemaVersion 5) – prioritet på faste udgifter.
-- Implementeringer kopierer denne fil uændret til packages/core/migrations/0005_recurring_priority.sql.
-- priority: 5 = obligatorisk (fx husleje, forsikring), 1 = rart at have, kan undværes (fx streaming).
-- NULL = ikke vurderet. Bruges til at se, hvad der kan spares.

ALTER TABLE recurring_expense ADD COLUMN priority INTEGER CHECK (priority IS NULL OR priority BETWEEN 1 AND 5);
