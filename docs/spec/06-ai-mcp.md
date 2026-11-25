# 06 AI-integration (MCP)

## Server

- Pakken `packages/mcp-server` startes med `ppm-mcp --archive <sti>` over stdio. Bruges `--archive` ikke, læses `archivePath` fra appens `config.json`.
- Serveren åbner `arkiv.sqlite` med `better-sqlite3` (WAL, `busy_timeout=5000`). Den kører aldrig migrationer. Svarer `schema_migrations` ikke til den version, serveren er bygget til, returnerer alle værktøjer fejlen `"Arkivets version (X) passer ikke til MCP-serveren (Y). Opdatér programmet."`.
- **Serveren må kun skrive til** `ai_draft`, `ai_access_log` og filer i `indbakke/ai/`. Al anden skrivning sker i appen, når en kladde godkendes.
- Serveren laver ingen netværkskald.
- Appen viser en kopiérbar konfiguration til Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "ppm": { "command": "C:\\Program Files\\PPM\\ppm-mcp.exe", "args": ["--archive", "C:\\Users\\…\\PPM-arkiv"] }
  }
}
```

  Installationen SKAL indeholde en selvstændig `ppm-mcp`-binær. Den kan være pakket med Node SEA eller `pkg` og ligges som sidecar i Tauri-bundlen, så brugeren ikke behøver at have Node installeret. En SEA kan ikke indlejre native addons, så `better_sqlite3.node` ligger ved siden af binæren og indlæses derfra. Binæren må ligge i en undermappe af installationsmappen (fx `resources\mcp`). Det er den mappe, der lægges i `PATH`.

## Adgangskontrol

Hvert værktøjskald:

1. Læser `ai.modules` og `ai.as_user_id` fra `setting` (ved hvert kald, så ændringer virker med det samme).
2. Fjerner poster fra moduler, der er slået fra, og helbredsdata, som `as_user_id` ikke må se (`health_private_user_id`).
3. Skriver én række i `ai_access_log` med værktøj, argumenter, returnerede `{type,id}` og eventuelt `denied_reason`.

Rettes et kald direkte mod et modul, der er slået fra, returneres fejlen `"Modulet 'health' er ikke delt med AI. Det kan slås til i Indstillinger → AI-adgang."`.

Moduler for entitetstyper: `home` (property, location, item, item_part, building_part, pet), `maintenance` (work_order, task), `vehicle`, `finance` (account, bank_transaction, budget, recurring_expense, category), `insurance` (policy, claim), `health` (health_*, men ikke person selv), `documents` (document), `food` (recipe, recipe_ingredient, meal_plan_entry, shopping_list, shopping_item). Et dokument er kun synligt, hvis både `documents` og modulet for mindst én af dets koblinger er slået til. Et dokument uden koblinger kræver kun `documents`. Opgaver hører til `maintenance`. En opgave med `module = 'health'` kræver desuden `health` og må ikke være for en person, hvis helbredsdata er private for en anden bruger. Allergi-advarsler i `meal_plan` er helbredsdata: de vises kun, når `health` er delt, og ellers svarer værktøjet med `warnings_hidden: true`.

## Regler for værktøjerne

Værktøjslisten står under "Værktøjer" nedenfor, og formatet følger "Få tokens". Alle input valideres med Zod. Output er kompakt JSON som `text`-indhold, medmindre andet er nævnt.

**`document`:** Med `content: "text"` returneres metadata og `extracted_text`. Med `content: "file"` returneres billeder (`jpg`/`png`) desuden som `image`-indhold (base64) og PDF-filer som et indlejret `resource` med `blob` og `mimeType: application/pdf`. Filer over 10 MB returneres kun som metadata og tekst.

**`propose`:** Skriver kun til `ai_draft` og returnerer `{"group":"…","n":antal,"status":"pending"}`.

- `type` ved `create` og `update` er en af: person og property (AI kan ikke sætte `app_user_id` og `health_private_user_id`), item, item_part, building_part, location, contact, vehicle, odometer_reading, work_order, task, policy, claim, bank_transaction (kun ved `update` af kategori og note), recurring_expense, budget_line, health_visit, health_screening, health_vaccination, health_medication, health_allergy, health_measurement, pet, recipe (med `ingredients` som tekstlinjer eller strukturerede rækker), meal_plan_entry og shopping_item. `policy_coverage` kan oprettes (ikke ændres), så en police kan kobles til det, den dækker.
- `propose` tager `dry_run: true`, som validerer alle operationer uden at gemme noget. Ved ugyldige data rapporteres alle fejlende operationer, og fejlen viser de gyldige felter for typen (påkrævede felter, tilladte værdier og enheder).
- `data` valideres med det samme Zod-skema, som UI bruger (ved `update` som et partielt skema), **når kladden oprettes**. Er data ugyldige, returneres valideringsfejlen med operationens indeks, og der oprettes ingen kladde.
- `attach_document` tager `document` (ref) eller `file_path`. `file_path` må kun pege ind i mapper, som er tilladt i `setting` under `ai.allowed_import_dirs` (standard: `<arkiv>/indbakke` og brugerens mappe `Overførsler`/`Downloads`). Filen kopieres til `indbakke/ai/<group>-<n>.<ext>` og importeres først, når kladden godkendes.
- Operationer på moduler, der ikke er delt, afvises på samme måde som læsning.

## Godkendelse i appen

- AI-indbakken viser kladder med status `pending`, de nyeste først.
- *Godkend* udfører handlingen gennem core i én transaktion med `audit_log.via='ai_draft'` og den godkendende bruger. Status sættes til `approved` med `result_entity_id`.
- Er det mål, en `update` peger på, ændret siden kladden blev oprettet (`updated_at` er nyere), vises en advarsel, og brugeren skal bekræfte.
- Fejler godkendelsen, sættes `status='failed'` med `error`, og der er intet ændret.
- *Afvis* sætter `rejected`. Filer i `indbakke/ai/` fra afviste kladder slettes.

## Færdigpakkede forbindelser

Appen SKAL levere disse forbindelser. Alle bruger den samme `ppm-mcp`-binær over stdio. Installeren lægger binæren i installationsmappen og tilføjer den til brugerens `PATH`. Uden `--archive` læser serveren arkivstien fra appens `config.json`, så konfigurationen ikke indeholder personlige stier.

| Kanal | Leverance | Godkendelse |
| --- | --- | --- |
| **Claude Desktop** | `ppm.mcpb` (MCP Bundle med `manifest.json`), bygget i CI som artefakt. Installeren behøver ikke indeholde selve `.mcpb`, da den indeholder hele binæren igen: knappen *Installér i Claude Desktop* under Indstillinger → AI-adgang MÅ bygge `ppm.mcpb` af den installerede binær og et medfølgende manifest og derefter åbne filen. Alternativet er en kopiérbar `claude_desktop_config.json`-stump. | Ingen ved privat distribution. Optagelse i Anthropics katalog er uden for v1. |
| **Claude Code** | Plugin og marketplace i dette repo: `.claude-plugin/marketplace.json` og `plugins/ppm/` med `.mcp.json` (kommando `ppm-mcp`) og en kort skill med arbejdsgange, fx "registrér kvittering" og "lav ugens madplan". Indstillingssiden viser kommandoerne `/plugin marketplace add <repo>` og `/plugin install ppm`. | Ingen. |
| **Codex / ChatGPT desktop** | Indstillingssiden viser og kopierer `codex mcp add ppm -- ppm-mcp`. Samme konfiguration bruges af Codex CLI, IDE-udvidelsen og ChatGPT-desktopappen. | Ingen. |
| **Lokal AI** | Dokumentation af opsætning med en MCP-kompatibel klient og en lokal model (fx Ollama). Projektet garanterer ikke en bestemt klient. | Ingen. |

- ChatGPT i browseren kræver en server, der kan nås fra internettet, og er **uden for v1**.
- Formaterne for `.mcpb` og plugins og de præcise kommandoer ændrer sig. De SKAL verificeres mod udbydernes aktuelle dokumentation ved hver release, og indstillingssiden viser datoen for seneste verifikation.

## Få tokens (krav)

Hvert værktøjs navn, beskrivelse og skema sendes med i hver eneste besked. Svarene fylder i samtalen. Serveren SKAL derfor:

1. **Have få, brede værktøjer:** højst 14 værktøjer i alt. Værktøjsbeskrivelser er på engelsk, højst 160 tegn, og input-skemaerne har ingen `description` på felter, hvis navnet er selvforklarende. Hele `tools/list`-svaret SKAL være under 10.000 tegn.
2. **Svare kompakt:** JSON uden mellemrum og uden felter, der er `null`, tomme eller standardværdier, med ISO-datoer og beløb i øre (ingen formaterede dubletter som `"1.234,50 kr."`). Lister svarer med `{"n":total,"items":[…],"more":true|false}`.
3. **Bruge korte referencer:** poster returneres med `ref`, som er de første 8 hex-tegn af id'et uden bindestreger. Alle værktøjer tager imod både `ref` og fuldt id. En tvetydig `ref` giver en fejl med de mulige poster.
4. **Have fornuftige standarder:** `limit` er 20 som standard (højst 100). Tekstfelter afkortes til 300 tegn i lister og til 4.000 tegn i `get` med `offset` til resten. `fields` kan begrænse felterne.
5. **Have et samlet overblik:** `overview` returnerer antal og de 5 vigtigste poster pr. sektion af overblikket (04) og ugens madplan. Svaret SKAL være under 1.500 tegn for seed-arkivet.
6. **Samle ændringer:** `propose` tager en liste af operationer og laver **én kladdegruppe**. Så kan en hel madplan eller ti genstande foreslås i ét kald og godkendes samlet.

## Værktøjer

| Værktøj | Formål |
| --- | --- |
| `overview` | Overblikket (krav 5) |
| `search` | `q`, `modules?`, `limit?` |
| `get` | `ref`, `fields?`, `offset?`. Posten med koblinger (kun `ref`, titel og rolle) og de seneste 10 historikposter (for bolig, bygningsdel, genstand og bil: arbejdsordrer og udførte opgaver; for andre typer: de seneste 10 linjer i `audit_log`) |
| `list` | `type`, `filter?` (simple felt=værdi og `from`/`to` på datofelter), `fields?`, `limit?`, `cursor?` |
| `tasks` | `status?` (overdue, upcoming, open, done), `from?`, `to?`, `module?` |
| `history` | `ref` på mål |
| `finance` | `kind` (`budget`, `month`, `recurring`), `year?`, `month?` |
| `health` | `person` (ref). Kun hvis `health` er delt |
| `meal_plan` | `week?` (mandag). Ugens retter, anslået pris, allergi-advarsler og indkøbsliste |
| `recipes` | `q?`, `tag?`, `limit?`. Opskrifter med ingredienser i kort form (`"500 g hakket oksekød"`) |
| `document` | `ref`, `content?` (`text`, `file`). Som `get_document` ovenfor |
| `inbox` | Dokumenter uden kobling og filer i indbakken |
| `propose` | `ops: [{op: "create"\|"update"\|"complete_task"\|"attach_document", type?, ref?, data?}]`, `rationale`. Opretter én kladdegruppe |
| `draft_status` | `group` |

Alle operationer i `propose` valideres, før noget gemmes. Fejler én, oprettes intet, og fejlen angiver operationens indeks. Inden for en gruppe kan en operation referere til et objekt, som en tidligere operation opretter, med `"$1"`, `"$2"` osv. (fx en ny opskrift og dens planlægning).

## Kladdegrupper og godkendelse

- `ai_draft` får gruppen gemt i `payload_json.group` (uuid). Det kræver ingen ny kolonne.
- AI-indbakken viser grupper med begrundelse og antal operationer. Hver operation kan foldes ud. Knapperne er *Godkend alle*, *Godkend valgte*, *Redigér* og *Afvis alle*.
- *Godkend alle* udfører gruppens operationer i én transaktion. Fejler én, rulles alle tilbage, og gruppen markeres `failed` med en fejltekst. *Godkend valgte* virker på samme måde for de valgte operationer: fejler én, markeres de valgte `failed`, mens de ikke-valgte forbliver `pending`.

## Vejledning til AI-klienten

Serveren SKAL sende `instructions` i `initialize` (på dansk):

> Du har adgang til brugerens lokale husstandsarkiv. Start med `overview` eller `search`. Hent kun de felter, du har brug for. Du kan ikke ændre data direkte: saml ændringer i ét `propose`-kald, og fortæl brugeren, at forslaget skal godkendes i appen under AI-indbakke. Gæt ikke datoer eller beløb. Spørg hellere. Helbredsoplysninger er følsomme. Gentag kun det, der er nødvendigt.

Instruktionsteksten SKAL være under 700 tegn.
