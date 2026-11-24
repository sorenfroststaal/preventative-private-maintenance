# 03 Datamodel

[schema.sql](schema.sql) er det normative skema for `schemaVersion 1`. Dokumentet her forklarer regler, som skemaet ikke selv kan håndhæve.

## Polymorfe koblinger

Kolonnerne `target_type` og `target_id` peger på en vilkårlig post. Core SKAL kontrollere, at målet findes, inden der skrives. Tilladte typer står i `CHECK` for hver tabel. Når en post arkiveres, bevares dens koblinger.

## Fælles regler for skrivning (core)

Hver skrivning gennem `repo/*` SKAL i samme transaktion:

1. validere input med entitetens Zod-skema
2. sætte `created_at` og `updated_at`
3. skrive en række i `audit_log` med `via` og `diff_json` (kun ændrede felter)
4. opdatere `search_index` for posten (slet den gamle række og indsæt en ny)
5. køre afledte regler (se nedenfor).

## Søgeindeks

| entity_type | title | body |
| --- | --- | --- |
| item | name | brand, model, serial_number, category, placering, notes, tags |
| work_order | title | description, kontaktnavn, events.note |
| task | title | description |
| vehicle | name | registration, make, model, notes |
| policy | title | insurer_name, policy_number, notes |
| document | title eller filename | extracted_text |
| contact | name | notes, email, phone |
| bank_transaction | text | note, kategorinavn |
| health_* | name, vaccine eller reason | notes, result |

`module` sættes, så søgningen kan filtreres pr. modul og respektere AI-adgangen.

## Afledte regler (automatiske opgaver)

Disse felter opretter eller opdaterer én opgave med `source='system'` og et entydigt `system_ref`:

| Felt | system_ref | Opgavetitel | Modul |
| --- | --- | --- | --- |
| `item.complaint_until` | `item.complaint_until:<id>` | "Reklamationsret udløber: <navn>" | home |
| `item.warranty_until` | `item.warranty_until:<id>` | "Garanti udløber: <navn>" | home |
| `policy.renewal_date` | `policy.renewal:<id>` | "Forsikring fornyes: <titel>" | insurance |
| `recurring_expense.binding_until` | `recurring_expense.binding:<id>` | "Binding udløber: <navn>" | finance |
| `health_screening.next_due_date` | `health_screening.next:<id>` | "<navn> (<person>)" | health |
| `health_vaccination.next_due_date` | `health_vaccination.next:<id>` | "<vaccine> (<person>)" | health |
| `health_medication.prescription_renewal_date` | `health_medication.renewal:<id>` | "Forny recept: <navn> (<person>)" | health |

Den åbne forekomst har feltets dato som `due_date`. Bliver feltet tomt, eller arkiveres posten, arkiveres opgaven. Opgaverne har ingen gentagelse. Når brugeren opdaterer datoen på posten, opdateres opgaven.

## Reklamationsret

Når `purchase_date` udfyldes, og `complaint_until` er tom, SKAL UI foreslå (men ikke gemme uden visning) `purchase_date + 24 måneder`. Teksten ved feltet: *"Forslag ud fra 2 års reklamationsret ved forbrugerkøb. Kontrollér dine egne vilkår."*

## Personer og brugere

- `app_user` er den, der logger ind i appen. `person` er et familiemedlem. En bruger er normalt koblet til sin egen person.
- Er `person.health_private_user_id` sat, vises personens helbredsdata kun for den bruger, både i UI og i MCP. Brugerfladen SKAL forklare, at det ikke er en sikkerhedsgrænse, fordi arkivet ikke er krypteret.

## Indstillinger (`setting`)

| key | værdi |
| --- | --- |
| `ai.modules` | `{"home":true,"maintenance":true,"vehicle":true,"finance":true,"insurance":true,"health":false,"documents":true}` |
| `ai.as_user_id` | id på den bruger, MCP agerer som (styrer synligheden af helbredsdata) |
| `backup.last_at` | ISO-tidspunkt |
| `dashboard.horizon_days` | `30` |
| `import.inbox_enabled` | `true` |
