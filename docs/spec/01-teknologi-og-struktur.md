# 01 Teknologi og struktur

## Stak

| Del | Valg |
| --- | --- |
| Desktop-skal | Tauri 2 (Rust) |
| Brugerflade | React 18+, TypeScript (strict), Vite |
| Routing og state | React Router. Server-state via TanStack Query mod core-laget |
| Validering | Zod. Skemaerne deles mellem UI, core og MCP |
| Database i appen | SQLite med FTS5. Valget af driver er frit, men det SKAL opfylde kravene under "Database-adgang i appen" nedenfor |
| Database i MCP | `better-sqlite3` |
| Filer | Native dialoger (`@tauri-apps/plugin-dialog` eller tilsvarende). Filadgangen SKAL opfylde kravene under "Filadgang" nedenfor |
| PDF | `pdf-lib` til at generere rapporter og flette bilag |
| MCP | `@modelcontextprotocol/sdk` (TypeScript), stdio-transport |
| Tests | Vitest og Testing Library. Core testes mod `better-sqlite3` i hukommelsen |
| Pakkehåndtering | pnpm workspaces, Node 20 LTS eller nyere |
| Lint og format | ESLint og Prettier. `cargo fmt` og `clippy` til Rust |
| Første målplatform | Windows 10/11 (x64). Koden må ikke udelukke macOS og Linux |

## Mappestruktur

```
apps/
  desktop/
    src/              React-UI
    src-tauri/        Rust: vinduer, filrettigheder, arkivlås og zip
packages/
  core/
    migrations/       0001_init.sql … (kopi af docs/spec/schema.sql ved v1)
    src/
      db/             DbAdapter-interface, migration-runner
      domain/         Zod-skemaer pr. entitet
      repo/           Læs og skriv pr. modul. Opdaterer søgeindeks og audit_log
      recurrence/     Beregning af næste forekomst
      import/         CSV-profiler og dokumentimport
      report/         Forsikringsrapport (pdf-lib)
      backup/         Manifest og verifikation
  mcp-server/
    src/              Værktøjer, adgangskontrol og log
templates/
  da/                 Opgaveskabeloner (JSON)
fixtures/             Syntetiske testdata, eksempel-CSV og bilag
docs/
```

## Database-adapter

Core SKAL være uafhængig af SQLite-driveren:

```ts
interface DbAdapter {
  select<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number }>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
  executeScript(sql: string): Promise<void>; // flere sætninger, bruges af migrationer
}
```

### Database-adgang i appen

- Alle kald i en transaktion SKAL køre på samme forbindelse. Andre kald SKAL vente, til transaktionen er afsluttet. En connection-pool, hvor `BEGIN` og `COMMIT` kan ramme forskellige forbindelser, er ikke tilladt.
- Tilladte eksempler: egne Tauri-kommandoer med `rusqlite` og én forbindelse pr. handle, eller en lokal proces med `better-sqlite3` og en kø.
- Bruger appen en anden SQLite-driver end testene (fx `rusqlite` i appen og `better-sqlite3` i tests), SKAL appens driver have egne automatiske tests af transaktioner, FTS5 og `VACUUM INTO` gennem den samme vej, appen bruger.

### Filadgang

- Brugerfladen (webviewet) må kun kunne nå:
  - arkivmappen
  - mapper og filer, som brugeren har valgt i en native dialog eller sluppet i vinduet
  - søskende-mapperne til gendannelse (`<arkiv>.restore-*` og `<arkiv>.old-*`)
  - appens egen konfiguration.
- Listen over tilladte stier SKAL vedligeholdes på den betroede side (Rust eller en lokal proces). Den må aldrig udvides ud fra en sti, som brugerfladen selv sender.
- Stier SKAL normaliseres, så `..` ikke kan føre ud af en tilladt mappe.
- SQL fra brugerfladen må ikke kunne skrive filer uden for arkivet. `ATTACH` SKAL være spærret, og `VACUUM INTO` er kun tilladt med et mål i arkivet.

Der er mindst to implementeringer: én til appen (se kravene ovenfor) og `BetterSqliteAdapter` (i MCP og tests). Al forretningslogik ligger i `packages/core`. UI og MCP SKAL kalde core og må ikke skrive SQL selv.

## Kommandoer

Disse kommandoer SKAL findes og virke fra roden:

| Kommando | Formål |
| --- | --- |
| `pnpm install` | Installér afhængigheder |
| `pnpm dev` | Start desktop-appen i udviklingstilstand |
| `pnpm build` | Byg alle pakker og Windows-installer (`tauri build`) |
| `pnpm test` | Kør alle tests |
| `pnpm lint` | ESLint og typecheck |
| `pnpm mcp -- --archive <sti>` | Start MCP-serveren mod et arkiv. Før fase 3 SKAL kommandoen findes og afslutte med en forklarende besked og en exit-kode, der ikke er 0 |
| `pnpm seed -- --archive <sti>` | Opret et demoarkiv med syntetiske data fra `fixtures/` |

## CI

GitHub Actions: `lint` og `test` på ubuntu-latest, `tauri build` på windows-latest. Byggeartefakter uploades. Der laves ingen automatisk release.

## Konventioner for kode

- Commits følger Conventional Commits (`feat(core): …`).
- Hver ændring af databasen kommer i en ny migrationsfil. En eksisterende migration må aldrig ændres efter et merge.
- Ingen netværkskald i app eller MCP, undtagen dem specifikationen udtrykkeligt tillader (der er ingen i v1).
- Tilladelser i Tauri gives så snævert som muligt: fs-adgang kun til arkivmappen, app-config og stier valgt i en dialog.
