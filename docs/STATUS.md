# Implementeringsstatus på codex/app

Branchen indeholder merge af `main` efter PR #3. Migration 0001 er byteidentisk med det normative skema.

## Fase 1 · Fundament

| Nr. | Status | Verifikation |
| --- | --- | --- |
| 1 | Delvist | Workspace, lint, test, build, seed og den forklarende MCP-kommando er afprøvet. Arkitekturen for database og scope følger PR #2. Se A1 for afvigelser i UI-stakken. |
| 2–3 | Opfyldt | Arkiv oprettes og åbnes, og migrationen er idempotent og atomisk. |
| 4 | Opfyldt i core | Atomisk instanslås med PID, hostname og tidspunkt. Aktiv lås, fremmed hostname og bekræftelse ved forældet lås er testet. |
| 5 | Delvist verificeret | Brugere, personer og PIN er implementeret og testet i core og pakket arkivproces. Manuel afprøvning af den installerede Windows-app udestår. |
| 6 | Delvist verificeret | Duplikatkontrol og hashfiler er testet. Native træk og slip afventer manuel Windows-verifikation. |
| 7 | Opfyldt | Alle otte eksempler fra 04, skudår og manglende dato. |
| 8 | Opfyldt for implementerede skrivninger | Audit og FTS dækker oprettelse og ændring samt arkivering, gendannelse og sletning af koblinger. PIN-hashes redigeres til maskering i audit. |
| 9 | Opfyldt i core | Backup og restore streamer. Round-trip med tre bilag og afvisning af en beskadiget backup uden ændring af målet er testet. |
| 10 | Opfyldt | Syntetisk seed-arkiv med eksempler fra samtlige moduler. |

## Fase 2 · Moduler

| Nr. | Status | Verifikation og udestående |
| --- | --- | --- |
| 1 | Delvist | Bolig, rum, inventar, reservedele og bygningsdele kan oprettes og redigeres. Kvitteringer, fotos og reklamationsforslag. Automatiske opgaver og livscyklus er testet. Boligoversigten viser rum, underrum, genstande og bygningsdele. Livscyklusser uden arkivfelt er beskrevet i A3. |
| 2 | Delvist | Statusflow, tidslinje, bilag med roller, km-stand og historik på inventar, bygningsdele og biler. Statusflow og km-stand er testet. Se A3 og A4. |
| 3 | Implementeret | Biler, km-stand, historik og skabelonforslag. Årsopgørelsen pr. valuta er testet. Visningen bruger indeværende år. |
| 4 | Delvist | To CSV-profiler, forhåndsvisning, dubletter, råfil, genbrugelige profiler, kategorisering, lærte regler og månedligt og årligt budget. Dubletter, danske beløb og Windows-1252 er testet. Se A5 og A8. |
| 5 | Implementeret | Policer, dækning, skadesager, prisnormalisering og advarsel om underforsikring. Dækning og automatisk fornyelsesopgave er dækket af tests. |
| 6 | Implementeret | PDF-rapport med forside, oversigt, genstande og valgfrie bilag. Antal og sum er testet mod syntetisk inventar. |
| 7 | Implementeret | Seks helbredstyper, personfilter, visningsrettighed, graf og afledte opgaver. Privat synlighed er testet i lister, søgning og overblik. |
| 8 | Delvist | Importkø, filtre, billed- og PDF-forhåndsvisning, flytning af stabile filer og advarsler. Stabilisering er testet med simulerede filmetadata, og et syntetisk PDF-tekstlag er udtrukket og fundet via FTS. Se A6. |
| 9 | Delvist | Alle sektioner i overblikket vises. Forespørgsler om opgaver, manglende data, kladder og økonomi er testet. Se A8. |
| 10 | Implementeret | Ctrl+K, modulgrupper og FTS-præfiks. FTS og privat filtrering testes i core. |
| 11 | Delvist | CSV og JSON for modultabeller, samlet JSON og ICS for valgte opgaver. Tests dækker neutrale sundhedstitler, fravær af noter og fortrolighed ved samlet eksport. Administrator kan eksportere interne tabeller enkeltvis under samme adgangskontrol som samlet eksport. |
| 12 | Uverificeret | Formularer og handlinger bruger native felter, knapper, synlig fokus og dialoger. Ctrl+K og kerneformularer blev afprøvet med det byggede UI og en virkelig arkivproces i en simuleret DOM. Det samlede tastaturforløb er ikke verificeret på Windows. |
| 13 | Testet | Den Rust-kommando, webviewet kalder, kontrollerer scope før videresendelse. Native Rust-test dækker afvisning af uvalgte stier, traversal, scope-udvidelse og SQL-handlinger. Core tester også, at ATTACH og ekstern VACUUM INTO afvises. |
| 14 | Testet | App og core-tests bruger samme better-sqlite3-adapter. Tests dækker transaktioner, FTS5 og VACUUM INTO. |
| 15 | Opfyldt | Round-trip med 566.231.040 bytes (540 MiB) syntetiske bilag. Maksimal RSS 168.244 KiB (ca. 164 MiB) på Linux x64 med Node 24. Måling for hele processen med seks filer på 90 MiB via `node --import tsx scripts/measure-backup.ts`. |
| 16 | Delvist verificeret | Node-processen fjerner sin lås ved normal lukning, og Rust lukker dens stdin ved appens afslutning. Den pakkede proces er afprøvet, mens lukning af det installerede vindue på Windows afventer manuel verifikation. |

## Byg og manuel afprøvning

- **Lokalt på Linux**. `pnpm lint`, `pnpm test` og `pnpm build` bestod. **42 Vitest-tests**. Den pakkede arkivproces er desuden afprøvet med PIN, inventar, FTS, PDF, backup og frigivelse af låsen.
- **Fase 1 i CI**. Linux og Windows bestod med **29 Vitest-tests**, og Windows bestod **1 Rust-test**. Installeren er **26.673.571 bytes**. [CI-kørsel](https://github.com/sorenfroststaal/preventative-private-maintenance/actions/runs/45493196529)
- **Fase 2 i CI**. Linux bestod lint, test og build. Windows bestod **42 Vitest-tests** og **1 Rust-test**, og Tauri byggede NSIS-installeren. [CI-kørsel for e9369ec](https://github.com/sorenfroststaal/preventative-private-maintenance/actions/runs/45496642246)
- **Installerstørrelse**. `PPM_0.1.0_x64-setup.exe` er **27.418.476 bytes (26,15 MiB)**. [Windows x64-installer](https://github.com/sorenfroststaal/preventative-private-maintenance/actions/runs/45496642246/artifacts/14968972020)
- **Opstartstid**. Medianen af tre starter til første interaktive skærm er ikke målt. Linux-miljøet kan ikke gennemføre det angivne forløb med den installerede Windows-release.
- **Manuelt Windows-forløb**. Trin 1–7 i 07 er ikke gennemført.

Se [afvigelserne](AFVIGELSER.md) for begrundelser. Fase 3 er udestående.
