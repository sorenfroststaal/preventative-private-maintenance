# 01 Teknologi og struktur

## Stak

| Del | Valg |
| --- | --- |
| Desktop-skal | Tauri 2 (Rust) |
| Brugerflade | React 18+, TypeScript (strict), Vite |
| Routing og state | React Router. Server-state via TanStack Query mod core-laget |
| Validering | Zod. Skemaerne deles mellem UI, core og MCP |
| Database i appen | SQLite via `@tauri-apps/plugin-sql` (sqlx, bundled SQLite med FTS5) |
| Database i MCP | `better-sqlite3` |
| Filer | `@tauri-apps/plugin-fs` (inklusive `watch`) og `@tauri-apps/plugin-dialog` |
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
}
```

Der er to implementeringer: `TauriSqlAdapter` (i appen) og `BetterSqliteAdapter` (i MCP og tests). Al forretningslogik ligger i `packages/core`. UI og MCP SKAL kalde core og må ikke skrive SQL selv.

## Kommandoer

Disse kommandoer SKAL findes og virke fra roden:

| Kommando | Formål |
| --- | --- |
| `pnpm install` | Installér afhængigheder |
| `pnpm dev` | Start desktop-appen i udviklingstilstand |
| `pnpm build` | Byg alle pakker og Windows-installer (`tauri build`) |
| `pnpm test` | Kør alle tests |
| `pnpm lint` | ESLint og typecheck |
| `pnpm mcp -- --archive <sti>` | Start MCP-serveren mod et arkiv |
| `pnpm seed -- --archive <sti>` | Opret et demoarkiv med syntetiske data fra `fixtures/` |

## CI

GitHub Actions: `lint` og `test` på ubuntu-latest, `tauri build` på windows-latest. Byggeartefakter uploades. Der laves ingen automatisk release.

## Konventioner for kode

- Commits følger Conventional Commits (`feat(core): …`).
- Hver ændring af databasen kommer i en ny migrationsfil. En eksisterende migration må aldrig ændres efter et merge.
- Ingen netværkskald i app eller MCP, undtagen dem specifikationen udtrykkeligt tillader (der er ingen i v1).
- Tilladelser i Tauri gives så snævert som muligt: fs-adgang kun til arkivmappen, app-config og stier valgt i en dialog.
