# Preventative Private Maintenance

Et open source-desktopprogram, der samler hjemmets dokumentation, tilbagevendende vedligeholdelse og praktiske ansvar i et lokalt arkiv. Arkivet kan også bruges sammen med AI.

Projektet er inspireret af vedligeholdelsessystemer som Sertica, men henvender sig til privatpersoner og familier i Danmark. Det har ingen tilknytning til Sertica.

**Status (branch `claude/app`): Fase 1, 2, 2b og 3 (AI og MCP) er bygget. Se [docs/STATUS.md](docs/STATUS.md).**

## Vision

Kvitteringer, garantier, servicehistorik, forsikringspolicer, budget og lægetjek ligger i dag spredt i skuffer, mails og portaler. Programmet samler det hele i ét lokalt arkiv på egen computer:

- **Hvad ejer vi?** Inventar med kvittering, garanti, placering, fotos og manual.
- **Hvad er gjort?** Historik over reparationer, service og skader, opbygget som arbejdsordrer.
- **Hvad skal gøres?** Tilbagevendende opgaver som at rense brønd, rense tagrender, syn, dækskifte og screeninger.
- **Hvad koster det?** Familiebudget, faste udgifter og import af kontoudtog.
- **Hvordan er vi dækket?** Forsikringspolicer koblet til det, de dækker.

Med den indbyggede MCP-server kan Claude (Desktop eller Code), Codex/ChatGPT desktop eller en lokal AI-model søge i arkivet og læse bilag. Til eget brug kræver det ingen godkendelse hos Anthropic eller OpenAI. Serveren er bygget til at bruge få tokens. For eksempel: *"Hvornår blev brønden sidst renset?"*, *"Er opvaskemaskinen stadig dækket af reklamationsretten?"* eller *"Registrér denne kvittering"*. AI'en kan kun foreslå ændringer. Brugeren godkender dem i appen.

## Moduler

| Modul | Indhold |
| --- | --- |
| Bolig og inventar | Genstande, rum, fotos, serienumre, kvitteringer, garanti, manualer, reservedele og bygningsdele |
| Vedligehold og arbejdsordrer | Gentagne opgaver, reparationer, skader, håndværkere, tilbud, fakturaer og fotos før og efter |
| Bil | Servicebog, reparationer, km-stand, syn, dækskifte, afgifter og vejhjælp |
| Økonomi og budget | Budget pr. kategori, faste udgifter, abonnementer og CSV-import fra banken |
| Madplan | Ugeplan, opskrifter, indkøbsliste, allergi-advarsler ud fra Helbred, pris mod budget og import fra Open Planner |
| Forsikring | Policer, præmier, fornyelse, selvrisiko, dækning og skadesager |
| Helbred | Lægebesøg, screeninger, vaccinationer, medicin, allergier og målinger pr. familiemedlem |
| Egne områder | Brugerdefinerede opgaver, noter og dokumenter |

Eksemplerne beskriver den ønskede funktionalitet. De er ikke en liste over gældende pligter eller frister. Programmet er ikke et bogføringssystem og erstatter ikke journalen hos lægen.

## Centrale principper

- **Lokalt:** én arkivmappe med en SQLite-database og bilag. Der er ingen konto, ingen sky og ingen telemetri.
- **Ens egne data:** fuld backup og eksport i dokumenterede formater (CSV, JSON, ICS og zip).
- **AI på brugerens præmisser:** AI-adgang slås til og fra pr. modul (helbred er slået fra som standard). Alt bliver logget, og ændringer sker kun som godkendte kladder.
- **Flere brugere:** flere personer i husstanden kan bruge samme computer, og data kan knyttes til hvert familiemedlem.

Første version krypterer ikke arkivet. Brug diskkryptering (BitLocker), og placér ikke arkivet i en mappe, der synkroniseres til skyen, hvis du vil undgå, at data forlader maskinen. Se [arkitekturen](docs/ARKITEKTUR.md).

## Teknologi

Tauri med React/TypeScript, SQLite og en MCP-server i Node/TypeScript. Windows er det første styresystem, der understøttes.

Læs [projektbeskrivelsen](docs/PROJEKTBESKRIVELSE.md), [arkitekturen](docs/ARKITEKTUR.md) og [udviklingsplanen](docs/ROADMAP.md). Den normative [specifikation](docs/spec/README.md) beskriver datamodel, skærmbilleder, MCP-værktøjer og acceptkriterier. Kodeagenter og bidragydere følger [AGENTS.md](AGENTS.md).

## Kom i gang (udvikling)

Krav: Node 20+, pnpm 10, Rust (stable). På Windows kræves WebView2 (følger med Windows 10/11). På Linux kræves WebKitGTK 4.1 og GTK 3 (se CI-filen).

```
pnpm install
pnpm dev                                    # start desktop-appen
pnpm test                                   # alle TypeScript-tests
pnpm lint                                   # ESLint, typecheck, kontrol af migrationer
pnpm build                                  # release-build og installer (NSIS på Windows)
pnpm seed -- --archive ./local-data/demo    # demoarkiv med syntetiske data
```

Rust-tests køres med `cargo test` i `apps/desktop/src-tauri`.

E2E mod den rigtige app (Linux, release-build) bruger `tauri-driver` og `WebKitWebDriver` i Xvfb:

```
cargo install tauri-driver --locked          # og apt: webkit2gtk-driver xvfb openbox
pnpm build && pnpm seed -- --archive ./local-data/e2e
Xvfb :99 & DISPLAY=:99 openbox & DISPLAY=:99 tauri-driver &
DISPLAY=:99 node apps/desktop/e2e/phase2b.mjs ./local-data/e2e ./local-data/screens
DISPLAY=:99 node apps/desktop/e2e/phase3.mjs ./local-data/e2e3 ./local-data/screens   # nyt seed-arkiv
```

Scriptet skriver appens `config.json`, så arkivet åbnes ved start, og gemmer skærmbilleder i `local-data/screens`. Til et demoarkiv vælger du "Åbn eksisterende arkiv" og peger på `local-data/demo`. Brugerne er "Anna Eksempel" (uden PIN) og "Bo Eksempel" (PIN 1234).

| Mappe | Indhold |
| --- | --- |
| `packages/core` | Al forretningslogik: arkiv, migrationer, lås, entiteter, opgaver, dokumenter og backup |
| `apps/desktop` | Tauri-app: React-UI (`src`) og afgrænsede Rust-kommandoer (`src-tauri`) |
| `packages/mcp-server` | MCP-server over stdio, byggescript til selvstændig binær og `.mcpb` |
| `plugins/ppm`, `.claude-plugin` | Claude Code-plugin og marketplace |

## AI-forbindelse (MCP)

Installeren lægger den selvstændige `ppm-mcp` i installationsmappen og i din `PATH`. Uden `--archive` læser den arkivstien fra appens `config.json`. Opsætningen står også i appen under Indstillinger → AI-adgang.

- **Claude Desktop:** knappen *Installér i Claude Desktop* i appen, eller `ppm.mcpb` fra CI-artefaktet.
- **Claude Code:** plugin og marketplace ligger i dette repo:

  ```
  /plugin marketplace add sorenfroststaal/preventative-private-maintenance
  /plugin install ppm@ppm
  ```

  I nyere versioner af Claude Code kan det gøres i ét trin: `/plugin install ppm --marketplace sorenfroststaal/preventative-private-maintenance`.
- **Codex / ChatGPT desktop:** `codex mcp add ppm -- ppm-mcp` (ikke afprøvet, se docs/STATUS.md).

Under udvikling: `pnpm mcp -- --archive ./local-data/demo` starter serveren med `tsx`, og `pnpm build:mcp` bygger den selvstændige binær og `ppm.mcpb` i `packages/mcp-server/dist/`.

## Open source

Projektet udgives under [MIT-licensen](LICENSE). Personlige databaser, dokumenter, mailarkiver og adgangsoplysninger må aldrig lægges i repositoryet.

Forslag og bidrag er velkomne. Se [CONTRIBUTING.md](CONTRIBUTING.md). Projektnavnet er et arbejdsnavn.
