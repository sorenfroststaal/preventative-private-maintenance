-- Preventative Private Maintenance: normativ migration 0012 (schemaVersion 12) – komponenter.
-- Implementeringer kopierer denne fil uændret til packages/core/migrations/0012_components.sql.
-- 1. En genstand kan høre til en anden genstand (parent_item_id) med en rolle: indbygget del ('part'),
--    tilbehør ('accessory'), forbrugsstof ('consumable') eller reservedel ('spare_part'). Træet kan være
--    flere niveauer dybt; core afviser kredsløb. En komponent kan have sin egen placering og egne ejere.
-- 2. Reservedele og forbrugsstoffer har antal (quantity) og lagerstatus: på lager ('in_stock'), brugt
--    ('used') eller skal købes ('to_buy'). En brugt reservedel kan pege på arbejdsordren, den blev brugt
--    i (used_work_order_id), og datoen (used_date).
-- 3. Reservedele fra item_part (schemaVersion 1) flyttes til item med samme id og rollen 'spare_part';
--    deres bilag følger med. Tabellen item_part bruges ikke længere (den står tom).

ALTER TABLE item ADD COLUMN parent_item_id TEXT REFERENCES item(id);
ALTER TABLE item ADD COLUMN component_role TEXT CHECK (component_role IN ('part','accessory','consumable','spare_part'));
ALTER TABLE item ADD COLUMN part_number TEXT;
ALTER TABLE item ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 0);
ALTER TABLE item ADD COLUMN stock_status TEXT CHECK (stock_status IN ('in_stock','used','to_buy'));
ALTER TABLE item ADD COLUMN used_work_order_id TEXT REFERENCES work_order(id);
ALTER TABLE item ADD COLUMN used_date TEXT;
CREATE INDEX idx_item_parent ON item(parent_item_id);

INSERT INTO item (id, name, parent_item_id, component_role, part_number, serial_number, vendor_name, notes,
                  location_id, quantity, currency, created_at, updated_at)
  SELECT p.id, p.name, p.item_id, 'spare_part', p.part_number, p.serial_number, p.vendor, p.notes,
         i.location_id, 1, 'DKK', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    FROM item_part p JOIN item i ON i.id = p.item_id;
UPDATE document_link SET target_type = 'item' WHERE target_type = 'item_part';
DELETE FROM item_part;
