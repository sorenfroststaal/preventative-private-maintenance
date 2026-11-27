# 03 Datamodel

[schema.sql](schema.sql) er det normative skema for `schemaVersion 1`, [schema-0002.sql](schema-0002.sql) bringer det til `schemaVersion 2` (madplan), [schema-0003.sql](schema-0003.sql) bringer det til `schemaVersion 3` (bilag og fotos på reservedele, `document_link.target_type = 'item_part'`), [schema-0004.sql](schema-0004.sql) bringer det til `schemaVersion 4` (husdyr: tabellen `pet`, som bilag og forsikringsdækning kan pege på), [schema-0005.sql](schema-0005.sql) bringer det til `schemaVersion 5` (`recurring_expense.priority` 1–5: 5 = obligatorisk, 1 = kan undværes), og [schema-0006.sql](schema-0006.sql) bringer det til `schemaVersion 6` (tabellen `loan`; bilag på kontakter, konti og lån; dokumentrollerne garantibevis, kontrakt og certifikat; posteringer kan kobles til lån; købsdato og købspris på bil; faste udgifter med bolig, bil, slutdato og variabelt beløb), og [schema-0007.sql](schema-0007.sql) bringer det til `schemaVersion 7` (tabellen `lending` til udlån; mærke, model og serienummer på bygningsdele og serienummer på reservedele), og [schema-0008.sql](schema-0008.sql) bringer det til `schemaVersion 8` (en fast udgift kan høre til en person), og [schema-0009.sql](schema-0009.sql) bringer det til `schemaVersion 9` (en genstand kan have en ejer i husstanden), og [schema-0010.sql](schema-0010.sql) bringer det til `schemaVersion 10` (flere personer pr. fast udgift og genstand i `person_link`; enkeltkolonnerne fra 0008 og 0009 bruges ikke længere), og [schema-0011.sql](schema-0011.sql) bringer det til `schemaVersion 11` (`person.household`: personer uden for husstanden; tabellen `gift` til gaver givet og fået), og [schema-0012.sql](schema-0012.sql) bringer det til `schemaVersion 12` (komponenter: genstande under genstande som indbygget del, tilbehør, forbrugsstof eller reservedel, med antal og lagerstatus; `item_part` flyttes til `item`). Dokumentet her forklarer regler, som skemaet ikke selv kan håndhæve.

## Polymorfe koblinger

Kolonnerne `target_type` og `target_id` peger på en vilkårlig post. Core SKAL kontrollere, at målet findes, inden der skrives. Tilladte typer står i `CHECK` for hver tabel. Når en post arkiveres, bevares dens koblinger.

## Fælles regler for skrivning (core)

Hver skrivning gennem `repo/*` SKAL i samme transaktion:

1. validere input med entitetens Zod-skema
2. sætte tidsstempler (se nedenfor)
3. skrive en række i `audit_log` med `via` og `diff_json` (kun ændrede felter)
4. opdatere `search_index` for posten, hvis typen er søgbar (slet den gamle række og indsæt en ny)
5. køre afledte regler (se nedenfor).

Kravene gælder for alle handlinger: oprettelse, ændring, arkivering, gendannelse og sletning af koblingsrækker.

### Hvilke tabeller reglerne gælder for

| Regel | Gælder for | Gælder ikke for |
| --- | --- | --- |
| Audit | Alle tabeller i skemaet, inklusive koblingstabeller (`document_link`, `policy_coverage`, `transaction_link`, `entity_tag`), `setting` (entity_id = nøglen) og afgørelser på `ai_draft` (status ændres i appen) | `schema_migrations`, `search_index`, `audit_log`, `ai_access_log` og MCP-serverens oprettelse af `ai_draft` (den logges i `ai_access_log`) |
| `created_at` | Sættes ved oprettelse på de tabeller, som har kolonnen i schema.sql | Der tilføjes ingen kolonner |
| `updated_at` | Sættes ved hver ændring på de tabeller, som har kolonnen (`item`, `work_order`, `task`, `recipe`) | Andre tabeller |
| Søgeindeks | Kun de typer, som står i tabellen "Søgeindeks" nedenfor | Alle andre typer |

- Ved koblingstabeller er `audit_log.entity_id` primærnøglens værdier sat sammen med `:` i kolonnernes rækkefølge.
- `diff_json` har formen `{felt: [før, efter]}`. Ved oprettelse er `før` `null`. Ved sletning er `efter` `null`.
- **`pin_hash` må aldrig stå i `audit_log`.** Ændres den, skrives `{"pin_hash": ["[skjult]", "[skjult]"]}`. Er den tom, skrives `null`.
- Arkiverede poster fjernes fra `search_index`, og de indsættes igen ved gendannelse.
- Søgning matcher hvert ord som præfiks (`"ord"*`). Brugerens input må aldrig sendes direkte som FTS5-syntaks.

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
| recipe | name | description, ingrediensnavne, instructions, tags |

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

Når `complaint_until` eller `warranty_until` er passeret, afsluttes den automatiske opgaves åbne forekomst af sig selv: `status = 'skipped'`, `completed_date` = udløbsdatoen og `note = 'Udløbet'`, auditeret med `via = 'system'`. Det sker, når appen åbnes, og jævnligt mens den kører. Lister og komponentoversigter viser "Reklamationsret udløbet" og "Garanti udløbet".

## Personer og brugere

- `app_user` er den, der logger ind i appen. `person` er et familiemedlem. En bruger er normalt koblet til sin egen person.
- Er `person.health_private_user_id` sat, vises personens helbredsdata kun for den bruger, både i UI og i MCP. Brugerfladen SKAL forklare, at det ikke er en sikkerhedsgrænse, fordi arkivet ikke er krypteret.

## Indstillinger (`setting`)

| key | værdi |
| --- | --- |
| `ai.modules` | `{"home":true,"maintenance":true,"vehicle":true,"finance":true,"insurance":true,"health":false,"documents":true,"food":true}` |
| `ai.as_user_id` | id på den bruger, MCP agerer som (styrer synligheden af helbredsdata) |
| `backup.last_at` | ISO-tidspunkt |
| `dashboard.horizon_days` | `30` |
| `import.inbox_enabled` | `true` |

## Moduler pr. entitetstype

Moduler bruges i `search_index.module`, til AI-adgang (06) og til filtrering. Madplanens tabeller hører til modulet `food`:

| Modul | Typer |
| --- | --- |
| `food` | recipe, recipe_ingredient, meal_plan_entry, shopping_list, shopping_item |

Øvrige typer er beskrevet i [06](06-ai-mcp.md).

## Madplan (schemaVersion 2)

- En opskrifts ingredienser gemmes som rækker i `recipe_ingredient`, ordnet efter `position`. Ved hver gemning erstattes hele listen i samme transaktion (sletning og indsættelse af koblingsrækker auditeres som for andre koblinger).
- `meal_plan_entry` har enten en opskrift eller en fri titel. `servings` overstyrer opskriftens antal portioner for den dag.
- Foto af en opskrift er et `document`, som `recipe.photo_document_id` peger på. `document_link` kan ikke pege på `recipe`, så et dokument, som en opskrift bruger som foto, tæller som koblet (fx i importkøen under Dokumenter).
- `shopping_item.source = 'plan'` betyder, at varen er genereret fra madplanen. Den genereres igen, når madplanen ændres (se 04).

## Værdilister bag rullelister

- Fritekstkolonner, som vælges fra en rulleliste (`item.category` og `building_part.kind`), har en redigerbar værdiliste i `setting` under `lists.item_category` og `lists.building_part_kind` (JSON-array af tekster). Listen vises altid sammen med de værdier, der allerede er i brug, uden forskel på store og små bogstaver.
- Omdøbes en værdi, opdateres alle poster, der bruger den, og hver ændring auditeres. En værdi, der er i brug, kan ikke slettes fra listen.
- Standardværdier: genstandskategorier *Hvidevarer, Elektronik, Møbler, Køkken, Værktøj, Have, Belysning, Sport og fritid, Andet*. Bygningsdelstyper *Tag, Facade, Vinduer og døre, Varme, Ventilation, VVS, El, Kloak og afløb, Have og udearealer, Andet*.

## Husdyr (schemaVersion 4)

- `pet` hører til modulet `home` (også for AI-adgang og søgeindeks: titel `name`, brødtekst race, chipnummer, dyrlægens navn og noter).
- Et husdyr kan have bilag og fotos (`document_link.target_type = 'pet'`) og være dækket af en police (`policy_coverage.target_type = 'pet'`, typisk `policy.kind = 'pet'`).
- Dyrlæge er en `contact`, og ejer er en `person`. Vaccinationer og dyrlægebesøg registreres foreløbig som opgaver og bilag (en egen helbredsjournal for dyr er uden for v1).

## Personer uden for husstanden og gaver (schemaVersion 11)

- `person.household = 0` er familie, venner, naboer o.l. De kan låne ting (`lending.borrower_person_id`) og have gaver (`gift.person_id`), men må ikke knyttes som ejere eller personer på faste udgifter (`person_link`), dækkes af forsikringer, være husdyrs ejer eller have helbredsdata. Core håndhæver reglen for `person_link` og viser kun husstanden i helbred.
- `gift.direction` er `given` (personen er modtager) eller `received` (personen er giver). En gave har én person. Gaver kan slettes fysisk med audit.

## Komponenter (schemaVersion 12)

- `item.parent_item_id` gør en genstand til en komponent af en anden med `component_role` (`part`, `accessory`, `consumable`, `spare_part`). Core afviser kredsløb og en arkiveret overordnet genstand.
- Reservedele og forbrugsstoffer har `quantity` og `stock_status` (`in_stock`, `used`, `to_buy`). Bruges en del af lageret i en reparation, deles rækken: den brugte del får `stock_status = 'used'`, `used_work_order_id` og `used_date`, resten står på lager.
- En komponent kan have egen placering og egne ejere; uden egne ejere hører den til genstandens ejere.
- `item_part` bruges ikke længere; dens rækker er flyttet til `item` med samme id, og bilag peger på `item`.

## Afhændelse af genstande (schemaVersion 13)

- Arkiveres en genstand, vælger brugeren en årsag i `disposal_kind`: *Givet væk*, *Givet til* en person (`disposal_person_id`, også personer uden for husstanden), *Solgt* (`disposal_price_minor` og eventuelt køber i `disposal_person_id`), *Smidt ud* eller *Andet*. `disposal_date` er datoen (standard i dag), og `disposal_note` er fri tekst. Arkivering uden årsag er stadig muligt.
- Komponenter arkiveres med genstanden og får samme årsag og dato, men ingen pris.
- *Givet til* kan samtidig registreres som en gave (`gift.direction = 'given'`, `gift.item_id` = genstanden).
- Afhændede genstande står i arkivet (*Bolig og inventar › Arkiv*), hvor de kan søges frem efter navn, årsag og person og gendannes. Gendannelse rydder årsagen og gendanner de komponenter, der blev arkiveret med genstanden.
- *Slet helt* er den eneste fysiske sletning af en primær post (undtagelse fra sletteregeln i README) og kræver en ekstra bekræftelse. I samme transaktion slettes genstandens koblinger (`document_link`, `person_link`, `policy_coverage`, `transaction_link`, `entity_tag`) og søgeindeks. `lending.item_id` og `gift.item_id` sættes til `NULL`, og genstandens navn gemmes i deres titel. Arbejdsordrer og opgaver beholdes uden mål; opgaverne arkiveres. Komponenter slettes med, hvis brugeren vælger det, og bliver ellers selvstændige genstande. Selve dokumenterne bliver i arkivet. Hver sletning auditeres med `action = 'delete'` og hele rækken som `før`.
