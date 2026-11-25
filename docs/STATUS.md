# Status (branch `claude/app`)

Opdateret: 25.11.2026 (fase 3). Aktuel fase: **Fase 3 – AI og MCP er bygget.** CI er grøn (kørsel 45568056010). Kanalerne Claude Desktop og Codex er ikke afprøvet med en rigtig klient (se kriterium 9). Fase 1, 2 og 2b er færdige. Præciseringer af specifikationen efter fase 2b ligger på branchen `claude/spec-fase-2b-praeciseringer` (ingen PR oprettet).

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

## Fase 3: kriterier

| # | Kriterium | Status | Bevis |
| --- | --- | --- | --- |
| 1 | `ppm-mcp` starter og svarer med `instructions` | Opfyldt | Instruktionerne er 379 tegn (`server.test.ts`). `ppm-mcp --archive <sti>`, eller uden `--archive` med stien fra appens `config.json`. Serveren tager ingen lås og kører ingen migrationer. |
| 2 | Alle værktøjer korrekte mod seed-arkivet **[T]** | Opfyldt | Alle 14 værktøjer er testet mod seed-arkivet, også `overview`, `meal_plan` og `recipes` (`ai.test.ts`) |
| 3 | Filtrering af moduler og privat helbred **[T]** | Opfyldt | Moduler, der er slået fra, giver fejlteksten fra spec 06. `search`, `get`, `list`, `document`, `health` og allergi-advarslerne i `meal_plan` filtreres. Advarslerne vises kun, når `health` er delt, og private personer maskeres. Et dokument kræver `documents` og et delt modul blandt koblingerne. |
| 4 | Hvert kald logges **[T]** | Opfyldt | `ai_access_log` med værktøj, argumenter, returnerede `{type,id}`, klientens navn fra `initialize`, `as_user_id` og `denied_reason` (også ved ukendte værktøjer og ugyldige argumenter, fordi valideringen sker i core) |
| 5 | `propose` **[T]** | Opfyldt | Én kladdegruppe pr. kald. Ugyldige data afvises med operationens indeks, og intet gemmes. `$n`-referencer virker (opskrift og planlægning, genstand og kvittering). `file_path` uden for de tilladte mapper og `..` afvises. |
| 6 | MCP skriver ikke til andre tabeller **[T]** | Opfyldt | En test sammenligner alle tabeller undtagen `ai_draft` og `ai_access_log` og filerne i `bilag/` før og efter 9 læsekald og et `propose` med fil. Kun `indbakke/ai/<gruppe>-<n>.pdf` er ny. |
| 7 | AI-indbakken **[T]** | Opfyldt | Godkend alle (via `ai_draft` i audit), godkend valgte, redigér (valideres med samme skema), afvis alle (filer i `indbakke/ai/` slettes), advarsel om konflikt med bekræftelse, og fuld tilbagerulning med `failed` og fejltekst. `attach_document` importerer filen ved godkendelse. Desuden en renderet UI-test, der godkender via knappen. |
| 8 | Få tokens **[T]** | Opfyldt | 14 værktøjer, beskrivelser på højst 160 tegn, ingen `description` på felter, `tools/list` på 4.311 tegn, `overview` på 1.125 tegn for seed-arkivet, ingen `null`/tomme felter i svar og `ref` på 8 tegn i alle værktøjer (`ai.test.ts`, `server.test.ts`) |
| 9 | Færdigpakket | Delvist | `ppm.mcpb` bygges i CI (artefakt `ppm-mcpb`). Claude Code-plugin og marketplace ligger i repoet. Indstillingssiden viser knap og kommandoer for de tre kanaler og datoen for seneste verifikation. **Claude Code: afprøvet** med en rigtig klient (`claude plugin validate .` bestod; `marketplace add` og `plugin install ppm@ppm` i en ren profil; `claude mcp list` viser `plugin:ppm:ppm: ppm-mcp – ✓ Connected`). **Claude Desktop: afprøvet af brugeren på Windows 25.11.2026** (forbindelse og værktøjskald virker). Formatet er kontrolleret mod MCPB `MANIFEST.md` (version 0.3), og E2E viser, at knappen bygger en gyldig `ppm.mcpb`. **Codex: ikke afprøvet og ikke verificeret.** OpenAIs dokumentation kunne ikke hentes fra dette miljø, og installation af Codex-CLI'en blev afvist. |
| 10 | `ppm-mcp.exe` uden Node og i `PATH` | Opfyldt | CI-kørsel 45568056010: Windows-installeren er installeret lydløst. `ppm-mcp.exe` ligger i `%LOCALAPPDATA%\PPM\resources\mcp`, og den mappe står i brugerens `PATH`. `ppm-mcp.exe --version` virker, og MCP-røgtesten mod et seed-arkiv giver 14 værktøjer, `tools/list` på 4.311 tegn og `overview` på 1.125 tegn. Efter lydløs afinstallation er mappen fjernet fra `PATH`. Binæren er en Node SEA og bruger ikke en installeret Node. På Linux er den testet uden Node i `PATH`. |

### E2E for fase 3 i den rigtige app

`apps/desktop/e2e/phase3.mjs`: alle 12 trin bestod. Appen kører med arkivet åbent, mens en rigtig MCP-klient bruger den byggede binær (`overview` og `propose` med genstand, kvittering fra `Downloads` via `$1`, opskrift og planlægning via `$3`). AI-indbakken viser gruppen, og menuen viser antallet. Operationer kan foldes ud, og *Godkend alle* opretter genstanden og retten. Loggen viser klientens kald, og *Installér i Claude Desktop* bygger `ppm.mcpb`.

Fundet og rettet under E2E: typenavne stod på engelsk i AI-indbakken ("item", "recipe"). Nu på dansk, og ingredienser vises som korte linjer.

## Fejl fundet ved brugerens test på Windows (25.11.2026)

**Et nyt arkiv kunne ikke oprettes i den rigtige app.** Fejlen var "VACUUM/ATTACH er ikke tilladt i scripts". Rust-kommandoen `db_execute_script` afviste ethvert script, hvis tekst indeholdt "ATTACH", og skemaet indeholder værdien `'attach_document'` i en CHECK-regel. Fejlen har været der siden fase 1. Ingen test opdagede den, fordi E2E altid åbnede et seed-arkiv (oprettet i Node), og den manuelle test på Windows ikke var gennemført. Nu tjekkes kun hele nøgleord uden for strenge, citerede navne og kommentarer. Rust-tests kører begge migrationer gennem `execute_script` (regressionstest) og afviser stadig `ATTACH` og `VACUUM` som nøgleord.

**Installerens danske tekster manglede.** Siden "allerede installeret" viste radioknapper uden tekst, valget om skrivebordsgenvej var tomt, og boksen "PPM kører" havde ingen tekst. Tauri leverer NSIS-tekster til 23 sprog, men ikke dansk. Nu ligger `windows/Danish.nsh` med alle 28 nøgler fra Tauris engelske fil og er sat som `customLanguageFiles`. Filen er kompileret med `makensis -WX`.

**Claude Desktop-knappen (fundet ved brugerens test):** Windows viste "Vælg en app for at åbne denne .mcpb fil", fordi filtypen ikke var knyttet til Claude Desktop. Stierne havde desuden Windows' præfiks `\\?\` (fra Tauris ressourcemappe), også i den kopierbare konfiguration. Nu fjernes præfikset (Rust-test). Knappen hedder *Lav ppm.mcpb til Claude Desktop* og viser filen markeret i Stifinder, så den kan trækkes ind i Claude Desktop. Siden forklarer begge veje (udvidelse eller `claude_desktop_config.json`). Claude Desktop er stadig ikke afprøvet med en rigtig klient.

**Claude Desktop gjort let (brugerens ønske):** Indstillinger → AI-adgang har nu *Tilføj PPM til Claude Desktop*. Knappen skriver `mcpServers.ppm` ind i `claude_desktop_config.json` (`%APPDATA%\Claude`, og på Windows også Microsoft Store-versionens pakkemappe, hvis den findes). Andre indstillinger og servere bevares, og den tidligere fil gemmes som `.ppm-backup`. *Test forbindelsen* starter `ppm-mcp` som en MCP-klient og gennemfører `initialize` og `tools/list`. Rust-tests: sammenfletning af konfigurationen, afvisning af ødelagt JSON og selvtest mod den byggede binær (fejl uden arkiv, håndtryk med 14 værktøjer med arkiv). E2E i den rigtige app (`phase3.mjs`, 14/14): selvtesten svarer med 14 værktøjer, og konfigurationsfilen er skrevet med de eksisterende poster bevaret. Om Claude Desktop selv indlæser serveren, er ikke afprøvet herfra.

**Claude Desktop virker (brugerens test 25.11.2026):** Claude Desktop forbandt til `ppm-mcp` og brugte værktøjerne. `propose` fejlede dog fem gange, fordi Claude ikke kunne se de gyldige feltnavne, og fordi husstand (`person`) og boliger (`property`) ikke kunne foreslås. Nu viser fejlen fra `propose` de gyldige felter, og `person` og `property` kan foreslås (A10). Tests i `ai.test.ts`.

**Ønsker fra brugerens test (bygget):**

- Fotos og kvittering kan vælges allerede i *Ny genstand*. Fotos kan vælges i *Ny bygningsdel*, *Ny bil* og *Tilføj reservedel*. Detaljevisningen viser fotos som miniaturer med *Flere fotos…*.
- **Fotos på reservedele** kræver migration 0003 (`document_link` genopbygget med `item_part`). Den er foreslået i specifikationen (`schema-0003.sql` på spec-branchen) og kopieret uændret hertil. Reservedele kan nu foldes ud med fotos og redigering.
- Genstandens **kategori** og bygningsdelens **type** vælges fra en redigerbar værdiliste med *+ Tilføj ny…*.
- Nyt menupunkt **Lister**: rum og placeringer, boliger, kontakter, personer, konti, økonomikategorier, genstandskategorier og bygningsdelstyper. Alle rullelister, der henviser til poster, har *+ Ny …*.
- Tests: migration 0003 (opgradering fra version 2 bevarer koblinger) og værdilister (`lists.test.ts`). Rullelister, *+ Ny rum…* og Lister i `rendered.test.tsx`.

CI laver nu også artefaktet `ppm-demo-backup` med syntetiske demodata, som kan gendannes i appen (Indstillinger → Backup).

## Tests

| Suite | Antal | Resultat |
| --- | --- | --- |
| core (Vitest) | 136 (heraf 29 for madplan og 14 for AI/MCP i `ai.test.ts`) | Grøn |
| mcp-server (Vitest) | 4 (protokol, `tools/list`, log og versionsfejl) | Grøn |
| desktop (Vitest) | 29 (kontrast, renderede sider, AI-indbakke og AI-adgang) | Grøn |
| Rust (`cargo test`) | 17 (+1 ignoreret måletest) | Grøn |
| **I alt** | **193** | **Grøn** |

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
| `ppm-mcp`, selvstændig binær (Linux) | 125,6 MB (`better_sqlite3.node` 2,1 MB ved siden af) | `pnpm build:mcp` (Node 22 SEA) |
| Linux-pakke (`.deb`) efter fase 3 | 46,75 MiB | `pnpm build` lokalt. Næsten hele væksten er Node-runtimen i `ppm-mcp`. |
| Installerstørrelse, Windows efter fase 3 | 25,31 MiB (26.541.138 byte, `PPM_0.1.0_x64-setup.exe`) | CI-kørsel 45568056010 (commit b19ef8a), trinnet "Installer size". Væksten fra 2,94 MiB er Node-runtimen i `ppm-mcp.exe`. `ppm.mcpb`-artefaktet er 34,9 MB som zip. |
| Installerstørrelse, Windows efter fase 2b | 2,94 MiB (`PPM_0.1.0_x64-setup.exe`, +0,02 MiB i forhold til fase 2) | CI-kørsel 45512953033 (commit ff6c794), jobbet `build-windows`. Både `lint-test` og `build-windows` er grønne. |

## Manuel test på Windows (spec 07)

**Ikke gennemført.** Det kræver en fysisk Windows-maskine. Installeren bygges i CI-jobbet `build-windows`.

## Ikke verificeret

- Det manuelle testforløb på Windows (se ovenfor).
- De native dialoger (vælg mappe og filer) lod sig ikke automatisere i Xvfb. Det gælder også bank-import via filvælgeren, men parsing og import er dækket af core-tests.
- En fuld automatiseret test af tastaturbetjeningen (fase 2 nr. 12).
- Filvælgeren i Open Planner-importen og ved valg af opskriftsfoto (native dialoger kan ikke automatiseres i Xvfb). Import og fotos er dækket af core-tests med fixtures.
- Mørkt tema er kun kontrolleret ved beregning af kontrast (tests), ikke med skærmbilleder.
- Fase 3: Claude Desktop og Codex med rigtige klienter (kriterium 9). Installation og `PATH` på Windows er verificeret i CI, ikke på en fysisk maskine.
