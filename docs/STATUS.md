# Status (branch `claude/app`)

Opdateret: 25.11.2026. Aktuel fase: **Fase 2b – Madplan og visuel stil er færdig**, bortset fra punkterne under "Ikke verificeret". Fase 1 og 2 er færdige. `main` med PR #3 (madplan, visuel stil og tokeneffektiv AI-forbindelse) er merget ind. Fase 3 er ikke påbegyndt.

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

## Fase 2b: kriterier

| # | Kriterium | Status | Bevis |
| --- | --- | --- | --- |
| 1 | Migration 0002 **[T]** | Opfyldt | `0002_meal_plan.sql` er en uændret kopi af `docs/spec/schema-0002.sql`. `pnpm gen:check` sammenligner nu både 0001 og 0002 med specifikationen. Et arkiv på `schemaVersion 1` med `ai.modules` uden `food` opgraderes til 2, og `food` sættes. En anden kørsel ændrer intet. Nye arkiver får `food.meals` og `food.default_servings` (`food.test.ts`, `archive.test.ts`). |
| 2 | Opskrifter **[T]** | Opfyldt | CRUD med ingredienstabel, tags, pris, foto og allergener. Arkivering i stedet for sletning. Ingredienslisten erstattes i én transaktion, og hver sletning og indsættelse af en ingrediensrække får sin egen auditlinje. En fejl ruller hele ændringen tilbage. Søgning finder opskriften på ingrediensnavne efter udskiftningen. |
| 3 | Ingrediens-parser **[T]** | Opfyldt | Alle 7 eksempler fra spec 05 samt hele enhedstabellen, brøker (`1/2`, `½`, `1½`), `500g` og noter efter komma |
| 4 | Uge **[T]** | Opfyldt | ISO-uger (også uge 53 og årsskifte), retter og frie titler, flyt, *Kopiér sidste uge* (uden dubletter), anslået pris (`pris × portioner / servings`, retter uden pris tælles for sig) og budget for ugen (månedsbudget for "Mad og dagligvarer" og underkategorier / dage × 7, også når ugen går over to måneder) og faktisk forbrug |
| 5 | Allergi-advarsler **[T]** | Opfyldt | Markerede og udledte allergener matches mod `health_allergy` uden forskel på store og små bogstaver. Privat helbred vises som "Allergi hos et husstandsmedlem (privat)" uden navn, stof og allergen-nøgle. Ejeren af de private data ser navn og stof. |
| 6 | Indkøbsliste **[T]** | Opfyldt | Skalering, g/kg og ml/dl/l lægges sammen (vises som kg/l fra 1000), varer uden mængde ("salt og peber (3 retter)"), ny generering bevarer manuelle varer, afkrydsning og en afdeling, brugeren har valgt. Gruppering i afdelinger, sletning med audit og kopiér som tekst. |
| 7 | Open Planner **[T]** | Opfyldt | Import af `fixtures/open-planner/v1.json` (ingredienser som liste og tekst, ret uden ingredienser, relativ billedsti afvist med besked) og `v2.json` (indlejret PNG som `document`, opdatering via `source_ref`, ændrede retter kan vælges fra). Eksport af version 2 med indlejrede fotos, som kan importeres igen uden ændringer. Ugyldige filer, mere end 200 retter og over 50 MB afvises. |
| 8 | Startkatalog **[T]** | Opfyldt | "Tilføj startkatalog" opretter de 40 retter fra `templates/da/retter.json` én gang (`source = 'template'`). Tilbuddet kan afvises. En senere Open Planner-import udfylder de samme opskrifter i stedet for at lave dubletter. |
| 9 | Visuel stil **[T]** | Opfyldt | `lucide-react` 0.468 (ISC). Ikoner i menu, sidehoveder, lister (opgaver på overblikket, dokumenter med filtypeikon), søgeresultater og status-badges (forfalden, i dag, mangler, allergi med ikon og tekst). Farvetokens pr. modul i lyst og mørkt tema. Nøgletalskort, der fører til sektionen, vandrette søjler for budget og forbrug (rød og med teksten "over budget"), graf over 6 måneders forbrug og tomme tilstande med ikon, sætning og primær handling. Tests: kontrast ≥ 4,5:1 for alle tekstpar og modultokens i begge temaer (`contrast.test.ts`). Alle 12 sider renderes med et rigtigt arkiv, og hver knap uden tekst skal have `aria-label` og `title`, og grafer skal have en tekstlig opsummering (`rendered.test.tsx`). Testen fejler, hvis `aria-label` fjernes fra ikonknapperne (afprøvet). |
| 10 | Søgning og overblik | Opfyldt | Ctrl+K finder opskrifter (gruppen "Madplan") og åbner dem. Overblikket viser dagens og morgendagens ret med allergi-advarsel (E2E og `rendered.test.tsx`). |

### E2E for fase 2b i den rigtige app (tauri-driver og WebKitWebDriver i Xvfb)

`apps/desktop/e2e/phase2b.mjs` mod release-builden og et nyt seed-arkiv. Alle 19 trin bestod: login, menu med ikoner (Madplan mellem Økonomi og Forsikring), 4 nøgletalskort, graf over 6 måneders forbrug, madplankort på overblikket, nøgletalskort flytter fokus til sektionen, ugevisning, allergi-advarsel ved rejer, anslået pris, budget for ugen, fri titel via dialog, *Kopiér sidste uge*, indkøbsliste, varer uden mængde, opskrift med ingredienstabel, Ctrl+K finder en opskrift, søgeresultatet åbner opskriften og 0 ikonknapper uden `aria-label`/`title` på den levende side. Skærmbilleder af Overblik, Madplan (uge, opskrifter og indkøbsliste) og søgning er gennemset.

Fundet og rettet under E2E:

- Faner skiftede ikke, når URL'en ændrede sig på en side, der allerede var åben (fx "Lav indkøbsliste" eller et søgeresultat). `Tabs` kan nu styres udefra.
- Opskriftsfotos stod i Dokumenter som "uden kobling" og lå i importkøen for evigt, fordi `document_link` ikke kan pege på `recipe`. Et foto, som en opskrift bruger, tæller nu som en kobling (F17).
- "Grøntsagsbouillon" blev gættet som Frugt og grønt. Nu Kolonial.
- Allergi-badgen løb ud over retkortet.

## Tests

| Suite | Antal | Resultat |
| --- | --- | --- |
| core (Vitest) | 122 (heraf 29 for madplan i `food.test.ts`) | Grøn |
| desktop (Vitest) | 27 (heraf 18 nye: kontrast og renderede sider) | Grøn |
| Rust (`cargo test`) | 10 (+1 ignoreret måletest) | Grøn |
| **I alt** | **159** | **Grøn** |

ESLint, `tsc -b`, `cargo fmt --check` og `cargo clippy -D warnings` er rene.

### E2E i den rigtige app, fase 2 (tauri-driver og WebKitWebDriver i Xvfb)

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
| Installerstørrelse, Windows (NSIS) | 2,92 MiB (`PPM_0.1.0_x64-setup.exe`) | CI-kørsel 45497726521 (commit 384d135), jobbet `build-windows`. Tauri-bundlerens log viser størrelsen på selve exe-filen. Artefaktets zip er 3.046.919 byte. |
| Opstartstid til login-skærm | ca. 0,95 s (fase 1-måling) | Median af 3, release-build, Linux i Xvfb |
| Linux-pakke (`.deb`) efter fase 2b | 3,34 MiB | `pnpm build` lokalt (release) |
| Frontend-bundle efter fase 2b | 1,30 MB JavaScript (minificeret, før komprimering) | `vite build`. Kun de brugte Lucide-ikoner kommer med (tree-shaking). |
| Installerstørrelse, Windows efter fase 2b | Måles i CI på denne commit | `*-setup.exe` (spec 07, målemetoder) |

## Manuel test på Windows (spec 07)

**Ikke gennemført.** Det kræver en fysisk Windows-maskine. Installeren bygges i CI-jobbet `build-windows`.

## Ikke verificeret

- Det manuelle testforløb på Windows (se ovenfor).
- De native dialoger (vælg mappe og filer) lod sig ikke automatisere i Xvfb. Det gælder også bank-import via filvælgeren, men parsing og import er dækket af core-tests.
- En fuld automatiseret test af tastaturbetjeningen (fase 2 nr. 12).
- Filvælgeren i Open Planner-importen og ved valg af opskriftsfoto (native dialoger kan ikke automatiseres i Xvfb). Import og fotos er dækket af core-tests med fixtures.
- Mørkt tema er kun kontrolleret ved beregning af kontrast (tests), ikke med skærmbilleder.
