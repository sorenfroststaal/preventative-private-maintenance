# Status (branch `claude/app`)

Opdateret: 24.11.2026. Aktuel fase: **Fase 2 – Alle moduler i en tynd udgave er færdig**, bortset fra punkterne under "Ikke verificeret". Fase 1 er bragt i overensstemmelse med præciseringerne i PR #2.

## Fase 1: kriterier

| # | Status | Bemærkning |
| --- | --- | --- |
| 1 | Opfyldt | Alle kommandoer virker lokalt og i CI. `pnpm mcp` afslutter med en forklaring og exit-kode 2 (spec 01). |
| 2–4 | Opfyldt **[T]** | Arkiv, migrationer og lås (`archive.test.ts`) |
| 5 | Opfyldt | Brugere, personer og PIN (core-tests og E2E) |
| 6 | Opfyldt **[T]** | Hash og dubletter (`repo.test.ts`) |
| 7 | Opfyldt **[T]** | Alle 8 eksempler i eksempeltabellen fra spec 04 og flere andre (`recurrence.test.ts`) |
| 8 | Opfyldt **[T]** | Audit og søgning ved oprettelse, ændring, arkivering, gendannelse og sletning af links. `pin_hash` står aldrig i auditloggen (`modules.test.ts`). |
| 9 | Opfyldt **[T]** | Backup og gendannelse (`backup.test.ts`) |
| 10 | Opfyldt | `pnpm seed` (CI-røgtest) |

## Fase 2: kriterier

| # | Kriterium | Status | Bevis |
| --- | --- | --- | --- |
| 1 | Bolig og inventar **[T]** | Opfyldt | CRUD (arkivering i stedet for sletning), fotos og kvittering, forslag til reklamationsret, automatiske opgaver (`modules.test.ts`). E2E: ny genstand med forslag. |
| 2 | Arbejdsordrer **[T]** | Opfyldt | Statusflow med tidslinje, noter (søgbare), bilag med roller, historik og km-stand fra arbejdsordre. Skadesag ved skade. |
| 3 | Bil **[T]** | Opfyldt | Km-stand, skabelonforslag og driftsomkostninger pr. år |
| 4 | Økonomi **[T]** | Opfyldt | `sparkron` og `generic` med forhåndsvisning. Anden import giver 0 nye rækker. Windows-1252 og danske beløb. Regler og lærte regler, budget mod faktisk forbrug og faste udgifter (`finance.test.ts`). |
| 5 | Forsikring **[T]** | Opfyldt | Dækning (også via bolig), advarsel om underforsikring, normaliseret præmie og automatisk opgave ved fornyelse |
| 6 | Forsikringsrapport **[T]** | Opfyldt | Antal og totalsum, filtre, fotos og kvitteringer som bilag (`documents2.test.ts`). E2E: rapporten gemmes i `eksport/`. |
| 7 | Helbred **[T]** | Opfyldt | Seks faner, graf over målinger, privat synlighed og automatiske opgaver |
| 8 | Dokumenter **[T]** | Opfyldt | Tekstudtræk (PDF og eml), liste med filtre, forhåndsvisning (pdf.js), importkø og kobling. Overvåget indbakke testet med falsk ur. E2E i den rigtige app. |
| 9 | Overblik **[T]** | Opfyldt | Alle 7 sektioner med hurtighandlinger. Fortolkning i AFVIGELSER F4–F6. |
| 10 | Global søgning | Opfyldt | Ctrl+K, grupperet pr. modul (E2E) |
| 11 | Eksport **[T]** | Opfyldt | CSV, JSON, alt som JSON og ICS uden noter og med neutrale helbredstitler |
| 12 | Tastatur | Delvist verificeret | Alle handlinger er knapper og felter. Tabelrækker kan fokuseres og vælges med Enter. Dialoger lukkes med Escape, og fokus vender tilbage. Der er ingen automatiseret test af hele forløbet kun med tastatur. |
| 13 | Filadgang **[T]** | Opfyldt | Rust-tests gennem samme funktioner som kommandoerne: uden for scope, `..`, `ATTACH`, `VACUUM INTO` uden for arkivet, database uden for scope og config-sti, der ikke er valgt i en dialog. Desuden E2E gennem rigtig IPC (fase 1). |
| 14 | Appens database-driver **[T]** | Opfyldt | Rust-tests: transaktion over flere kald (rollback og commit, isolation fra anden forbindelse), FTS5 med æøå, parametertyper og `VACUUM INTO` |
| 15 | Streaming backup | Opfyldt | 500 MB bilag, se målingerne nedenfor |
| 16 | Låsen fjernes ved lukning | Opfyldt | Verificeret i den rigtige app ved at lukke vinduet via en window manager (`wmctrl -c`). `.lock` er væk bagefter. |

## Tests

| Suite | Antal | Resultat |
| --- | --- | --- |
| core (Vitest) | 93 | Grøn |
| desktop (Vitest) | 9 | Grøn |
| Rust (`cargo test`) | 10 (+1 ignoreret måletest) | Grøn |
| **I alt** | **112** | **Grøn** |

ESLint, `tsc -b`, `cargo fmt --check` og `cargo clippy -D warnings` er rene.

### E2E i den rigtige app (tauri-driver og WebKitWebDriver i Xvfb)

Alle 11 trin bestod:

- overblikkets sektioner
- genstand med forhåndsvisning af PDF (pdf.js-worker under CSP)
- ny genstand med forslag til reklamationsret, som derefter står under "Mangler oplysninger"
- arbejdsordrens tidslinje
- bilens driftsomkostninger og skabeloner
- økonomifanerne
- forsikring med advarsel om underforsikring og rapport
- helbred
- overvåget indbakke, inklusive advarsel om en fil, der ikke understøttes
- Ctrl+K
- ICS-eksport med neutral helbredstitel.

Fundet og rettet under E2E: "Udløber snart" viste reklamationsret, der var udløbet for flere år siden (nu afgrænset, se F4).

## Målinger

| Måling | Værdi | Metode |
| --- | --- | --- |
| Backup og gendannelse via Rust (zip og udpakning), 500 MB | Højst 4,4 MB RSS, 4,8 s | `cargo test --release large_archive_zip_streams -- --ignored` med `/usr/bin/time -v` |
| Backup og gendannelse via core (Node), 500 MB | Højst 159 MB RSS (132 MB før backuppen). Backup 4,1 s, gendannelse 10,0 s. | `packages/core/scripts/bench-backup.ts 500` |
| Det samme, 100 MB | Højst 148 MB RSS (115 MB før backuppen) | Hukommelsen vokser ikke med arkivets størrelse |
| Installerstørrelse, Windows (NSIS) | Måles i CI på denne commit | `*-setup.exe` (spec 07, målemetoder) |
| Opstartstid til login-skærm | ca. 0,95 s (fase 1-måling) | Median af 3, release-build, Linux i Xvfb |

## Manuel test på Windows (spec 07)

**Ikke gennemført.** Det kræver en fysisk Windows-maskine. Installeren bygges i CI-jobbet `build-windows`.

## Ikke verificeret

- Det manuelle testforløb på Windows (se ovenfor).
- De native dialoger (vælg mappe og filer) lod sig ikke automatisere i Xvfb. Det gælder også bank-import via filvælgeren, men parsing og import er dækket af core-tests.
- En fuld automatiseret test af tastaturbetjeningen (fase 2 nr. 12).
