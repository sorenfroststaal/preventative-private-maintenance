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

  Installationen SKAL indeholde en selvstændig `ppm-mcp`-binær. Den kan være pakket med Node SEA eller `pkg` og ligges som sidecar i Tauri-bundlen, så brugeren ikke behøver at have Node installeret.

## Adgangskontrol

Hvert værktøjskald:

1. Læser `ai.modules` og `ai.as_user_id` fra `setting` (ved hvert kald, så ændringer virker med det samme).
2. Fjerner poster fra moduler, der er slået fra, og helbredsdata, som `as_user_id` ikke må se (`health_private_user_id`).
3. Skriver én række i `ai_access_log` med værktøj, argumenter, returnerede `{type,id}` og eventuelt `denied_reason`.

Rettes et kald direkte mod et modul, der er slået fra, returneres fejlen `"Modulet 'health' er ikke delt med AI. Det kan slås til i Indstillinger → AI-adgang."`.

Moduler for entitetstyper: `home` (property, location, item, item_part, building_part), `maintenance` (work_order, task), `vehicle`, `finance` (account, bank_transaction, budget, recurring_expense, category), `insurance` (policy, claim), `health` (health_*, men ikke person selv), `documents` (document). Et dokument er kun synligt, hvis både `documents` og modulet for mindst én af dets koblinger er slået til. Et dokument uden koblinger kræver kun `documents`.

## Værktøjer

Alle input valideres med Zod. Output er JSON som `text`-indhold, medmindre andet er nævnt. Beløb returneres både som `*_minor` og som en formateret streng (`"1.234,50 kr."`).

### Læsning

| Værktøj | Input | Output |
| --- | --- | --- |
| `search` | `query: string, modules?: string[], limit?: number (≤50, std 20)` | `[{type,id,module,title,snippet}]` fra FTS5 |
| `get_entity` | `type, id` | Posten, dens koblede dokumenter (metadata), tags, de seneste 20 historikposter og åbne opgaver |
| `list_tasks` | `from?, to?, status?: 'overdue'\|'upcoming'\|'open'\|'done', module?, person_id?` | Forekomster med opgave og mål |
| `get_history` | `target_type, target_id` | Kronologisk liste over arbejdsordrer og udførte forekomster |
| `list_items` | `location_id?, category?, text?, has_receipt?: boolean, warranty_active?: boolean` | Genstande |
| `list_vehicles` | – | Biler med seneste km-stand og næste frister |
| `list_policies` | `kind?` | Policer med årlig præmie, fornyelse og dækning |
| `list_transactions` | `from, to, account_id?, category_id?, text?, uncategorized?: boolean, limit? (≤500)` | Transaktioner |
| `budget_summary` | `year, month?` | Budget og faktisk forbrug pr. kategori |
| `list_persons` | – | id, navn og relation (altid tilladt) |
| `health_overview` | `person_id` | Aktiv medicin, allergier, kommende screeninger og vaccinationer, de seneste 10 besøg og de seneste målinger pr. type |
| `list_inbox_documents` | – | Dokumenter uden koblinger og filer, der afventer i indbakken |
| `get_document` | `document_id` | Se nedenfor |

**`get_document`:** Returnerer metadata og `extracted_text` som tekst. Billeder (`jpg`/`png`) returneres desuden som `image`-indhold (base64), og PDF-filer som et indlejret `resource` med `blob` og `mimeType: application/pdf`. Filer over 10 MB returneres kun som metadata og tekst.

### Kladder

Værktøjerne her skriver kun til `ai_draft` og returnerer `{draft_id, status:'pending', message:"Forslaget ligger i AI-indbakken og skal godkendes i appen."}`.

| Værktøj | Input |
| --- | --- |
| `propose_create` | `entity_type, data: object, rationale: string, links?: [{document_id, role}]` |
| `propose_update` | `entity_type, id, changes: object, rationale` |
| `propose_complete_task` | `occurrence_id, completed_date, note?, rationale` |
| `propose_attach_document` | `document_id \| file_path, target_type, target_id, role, title?, doc_date?, rationale` |
| `get_draft_status` | `draft_id` returnerer status, eventuelt `result_entity_id` og `error` |

- `entity_type` til `propose_create` og `propose_update` er en af: item, item_part, building_part, location, contact, vehicle, odometer_reading, work_order, task, policy, claim, bank_transaction (kun ved `update` af kategori og note), recurring_expense, budget_line, health_visit, health_screening, health_vaccination, health_medication, health_allergy, health_measurement.
- `data` og `changes` valideres med det samme Zod-skema, som UI bruger (ved `update` som et partielt skema), **når kladden oprettes**. Er data ugyldige, returneres valideringsfejlen, og der oprettes ingen kladde.
- `file_path` må kun pege ind i mapper, som er tilladt i `setting` under `ai.allowed_import_dirs` (standard: `<arkiv>/indbakke` og brugerens mappe `Overførsler`/`Downloads`). Filen kopieres til `indbakke/ai/<draft_id>.<ext>` og importeres først, når kladden godkendes.
- Kladder til moduler, der er slået fra, afvises på samme måde som læsning.

## Godkendelse i appen

- AI-indbakken viser kladder med status `pending`, de nyeste først.
- *Godkend* udfører handlingen gennem core i én transaktion med `audit_log.via='ai_draft'` og den godkendende bruger. Status sættes til `approved` med `result_entity_id`.
- Er det mål, en `update` peger på, ændret siden kladden blev oprettet (`updated_at` er nyere), vises en advarsel, og brugeren skal bekræfte.
- Fejler godkendelsen, sættes `status='failed'` med `error`, og der er intet ændret.
- *Afvis* sætter `rejected`. Filer i `indbakke/ai/` fra afviste kladder slettes.

## Andre klienter

- **Claude Desktop og Claude Code:** primære målklienter, via stdio som ovenfor.
- **OpenAI-klienter med lokal MCP over stdio** (for eksempel Codex CLI): samme binær og samme argumenter.
- **Lokal model:** dokumentationen beskriver en opsætning med en MCP-kompatibel klient og Ollama. Projektet garanterer ikke, at en bestemt klient virker.
- **ChatGPT-connectors:** kræver en server, der kan nås fra internettet, og er **uden for v1**.

## Vejledning til AI-klienten

Serveren SKAL sende `instructions` i `initialize` (på dansk):

> Du har adgang til brugerens lokale husstandsarkiv. Brug `search` først, når brugeren spørger om noget. Du kan ikke ændre data direkte. Brug `propose_*`, og fortæl brugeren, at forslaget skal godkendes i appen under AI-indbakke. Gæt ikke datoer eller beløb. Spørg hellere. Helbredsoplysninger er følsomme. Gentag kun det, der er nødvendigt for at svare.
