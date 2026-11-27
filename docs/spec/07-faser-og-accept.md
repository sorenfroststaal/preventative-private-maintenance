# 07 Faser og acceptkriterier

En fase er færdig, når alle kriterierne er opfyldt, `pnpm lint` og `pnpm test` er grønne, og `pnpm build` giver en Windows-installer. Kriterier markeret **[T]** SKAL dækkes af automatiske tests.

## Fase 1: Fundament

1. Monorepoet er sat op efter [01](01-teknologi-og-struktur.md), og alle kommandoer virker. `pnpm mcp` behøver kun opføre sig som beskrevet for tiden før fase 3 (se 01).
2. Et arkiv kan oprettes og åbnes. `manifest.json`, mapperne og migration 0001 bliver lavet. **[T]**
3. Migrationerne fører et tomt arkiv til `schemaVersion 1`. En anden kørsel ændrer ingenting. **[T]**
4. `.lock` forhindrer to instanser i at skrive. En forældet lås kan fjernes. **[T]**
5. Brugere og personer kan oprettes. Der er brugervalg ved opstart med valgfri PIN.
6. Dokumentimport (træk og slip) gemmer bilaget ved dets hash og genkender dubletter. **[T]**
7. Opgaver med gentagelse af typen `fixed` og `interval`, inklusive klemning ved månedsenden og spring over. **[T]** Testcases: 31.01 plus 1 måned giver 28.02 eller 29.02. Interval på 6 måneder udført 15.03 giver 15.09. `fixed` årlig 01.10, udført 20.11, giver 01.10 året efter.
8. Hver skrivning laver en række i `audit_log` og opdaterer `search_index` efter reglerne i [03](03-datamodel.md). Det gælder oprettelse, ændring, arkivering, gendannelse og sletning af koblinger. `pin_hash` står ikke i auditloggen. **[T]**
9. Backup og gendannelse: en round-trip med et arkiv med 3 bilag giver identiske data og checksummer. En backup med en ødelagt fil afvises, og målet er uændret. **[T]**
10. `pnpm seed` laver et demoarkiv med syntetiske data for alle moduler.

## Fase 2: Alle moduler i en tynd udgave

1. **Bolig og inventar:** CRUD for bolig, lokation, genstand, reservedel og bygningsdel. Fotos og kvittering på genstande. Forslag til reklamationsret. Automatiske opgaver for garanti og reklamationsret. **[T]** for de afledte regler.
2. **Arbejdsordrer:** CRUD, statusflow med tidslinje, bilag med roller og historikfane på målet. Km-stand oprettes fra arbejdsordrer på biler. **[T]**
3. **Bil:** CRUD, km-stand, skabelonforslag og driftsomkostninger pr. år. **[T]** for beregningen.
4. **Økonomi:** konti, CSV-import (`sparkron` og `generic`) med forhåndsvisning og dubletkontrol, regler og lærte regler, budget mod faktisk forbrug og faste udgifter. **[T]** Import af samme fil to gange giver 0 nye rækker. Danske beløb og Windows-1252 parses korrekt.
5. **Forsikring:** policer, dækning, skadesager, advarsel om underforsikring og automatisk opgave ved fornyelse. **[T]**
6. **Forsikringsrapport:** PDF med forside, oversigt, genstande og valgfrit bilag. **[T]** Rapporten for seed-arkivet har det forventede antal genstande og den forventede totalsum.
7. **Helbred:** alle seks faner, privat synlighed pr. person og automatiske opgaver for screeninger, vaccinationer og recepter. **[T]** for synlighedsfilteret.
8. **Dokumenter:** liste, forhåndsvisning, importkø og overvåget indbakke. **[T]** for indbakkelogikken med et simuleret filsystem.
9. **Overblik:** alle sektioner fra [04](04-moduler-og-ui.md). **[T]** for forespørgslerne bag hver sektion.
10. **Global søgning** (`Ctrl+K`) på tværs af moduler.
11. **Eksport:** CSV, JSON og ICS. **[T]** ICS indeholder ikke noter, og helbredstitler er neutrale som standard.
12. Kerneforløbene kan gennemføres alene med tastaturet.

## Fase 2b: Madplan og visuel stil

1. Migration 0002 er identisk med `docs/spec/schema-0002.sql`. Et arkiv på `schemaVersion 1` opgraderes til 2, og `ai.modules.food` sættes. **[T]**
2. **Opskrifter:** CRUD med ingredienstabel, tags, pris, foto og allergener. Ingredienslisten erstattes i én transaktion med audit. **[T]**
3. **Ingrediens-parser:** alle eksempler i spec 05 består. **[T]**
4. **Uge:** retter og frie titler pr. dag, flyt, *Kopiér sidste uge*, anslået pris og budget for ugen (04). **[T]** for beregningerne.
5. **Allergi-advarsler:** markerede og udledte allergener matches mod `health_allergy`. Privat helbred vises uden navn og stof for andre brugere. **[T]**
6. **Indkøbsliste:** skalering, sammenlægning af g/kg og ml/dl/l, varer uden mængde, ny generering, der bevarer manuelle varer og afkrydsning, gruppering i afdelinger og kopiér som tekst. **[T]**
7. **Open Planner:** import af version 1 og 2 (inklusive indlejrede fotos og opdatering via `source_ref`) og eksport af version 2. **[T]** med syntetiske testfiler i `fixtures/open-planner/`.
8. **Startkatalog:** "Tilføj startkatalog" opretter de 40 retter fra `templates/da/retter.json` én gang. **[T]**
9. **Visuel stil:** ikoner i menu, sidehoveder, lister, søgeresultater og status-badges som i tabellen i spec 04. Nøgletalskort og graf over 6 måneders forbrug på overblikket. Illustrerede tomme tilstande. Kontrast mindst 4,5:1 i lyst og mørkt tema. **[T]** Alle knapper med kun et ikon har `aria-label` (test, der gennemgår de renderede komponenter).
10. Søgning (Ctrl+K) finder opskrifter, og overblikket viser dagens og morgendagens ret.

## Fase 3: AI og MCP

1. `ppm-mcp` starter mod seed-arkivet og svarer på `initialize` med `instructions` (under 700 tegn).
2. Alle værktøjer i spec 06 giver korrekte resultater mod seed-arkivet, også `overview`, `meal_plan` og `recipes`. **[T]**
3. Moduler, der er slået fra, og privat helbredsdata filtreres i alle værktøjer, også i `search`, `document` og allergi-advarslerne i `meal_plan`. **[T]**
4. Hvert kald logges i `ai_access_log`. **[T]**
5. `propose` opretter kun én kladdegruppe. Ugyldige data afvises med operationens indeks. `$n`-referencer virker. `file_path` uden for de tilladte mapper afvises. **[T]**
6. MCP-serveren kan ikke skrive til andre tabeller. Det testes ved, at en test sammenligner indholdet af alle andre tabeller før og efter en række kald. **[T]**
7. AI-indbakken: godkend alle, godkend valgte, redigér, afvis, advarsel om en konflikt og fuld tilbagerulning, hvis én operation fejler. **[T]**
8. **Få tokens:** højst 14 værktøjer, `tools/list` under 10.000 tegn, `overview` under 1.500 tegn for seed-arkivet, ingen `null`-felter i svar, og `ref` på 8 tegn virker i alle værktøjer. **[T]**
9. **Færdigpakket:** `ppm.mcpb` bygges i CI. Claude Code-plugin og marketplace ligger i repoet. Indstillingssiden viser kommandoer og knapper for de tre kanaler. Hver kanal er afprøvet manuelt med en rigtig klient, og resultatet noteres i STATUS. Kanaler, der ikke kunne afprøves, markeres sådan.
10. Installeren indeholder `ppm-mcp.exe`, som virker uden at Node er installeret, og lægger den i brugerens `PATH`.

## Fase 4: Uddybning

1. **Bankprofiler:** ud over `sparkron` har appen indbyggede forudindstillinger for mindst fire andre danske banker. De genkendes ud fra kolonneoverskrifterne, og brugeren kan rette dem som en generisk profil. Profiler understøtter både én beløbskolonne og separate kolonner for ind og ud. En forudindstilling, der ikke er afprøvet med en rigtig eksportfil, markeres "ikke verificeret" i UI. **[T]** med syntetiske filer i `fixtures/bank/`.
2. **Kategoriforslag:** en postering uden kategori får et forslag ud fra tidligere kategoriserede posteringer med samme modtagernøgle. Nøglen er posteringsteksten med små bogstaver, hvor tal, datoer og kortnumre er fjernet. Forslaget er den hyppigste kategori blandt posteringer med samme fortegn. Det kræver mindst 2 forekomster, eller 1, hvis der ikke er andre kategorier for nøglen. Regler går forud for forslag. Brugeren godkender forslag enkeltvis eller samlet (`category_source = 'user'`) og kan gøre et forslag til en regel. **[T]**
3. **Lokal OCR:** billeder (`jpg`/`png`) får tekst ved import med Tesseract og dansk sprogdata, som er pakket med appen. Der er ingen netværkskald. Teksten gemmes i `extracted_text` og indgår i søgningen. OCR kører i baggrunden og må ikke blokere importen. **[T]** med et syntetisk billede af en kvittering i `fixtures/ocr/`.
4. **Forslag fra kvitteringer:** en parser foreslår totalbeløb, dato og forhandler ud fra teksten (OCR eller PDF-tekstlag). Forslagene vises, når en kvittering kobles til en genstand, og udfylder `purchase_price_minor`, `purchase_date` og `vendor_name`, når brugeren bekræfter. **[T]** med mindst 6 syntetiske kvitteringstekster (danske beløb, "I alt"/"Total", moms, datoformater).
5. **Skabeloner med kilder:** `templates/da/` har skabeloner med `basis` sat til `recommendation` eller `requirement` for mindst fire emner med en officiel kilde (`title`, `url`, `scope`, `checked_date`). UI viser kilden og datoen for kontrol ved forslaget. En test afviser skabeloner med `recommendation`/`requirement` uden komplet kilde, og en, hvor `checked_date` er mere end 12 måneder gammel i forhold til appens version. **[T]**
6. **Onboarding:** i et nyt arkiv uden opgaver og genstande tilbydes en guide med spørgsmål om bolig (type, ejer eller lejer, brændeovn, regnvandsbrønd, varmepumpe), bil og børn. Svarene giver forslag fra skabelonerne, som kan vælges til og fra. De valgte oprettes som opgaver med `template_id` og `template_version`, uden dubletter. Guiden kan springes over og åbnes igen fra Indstillinger. **[T]** for koblingen fra svar til skabeloner og for oprettelsen.
7. **macOS og Linux:** CI bygger en `.dmg` til macOS (signering er uden for v1) og en `.deb` og et AppImage til Linux, hver med `ppm-mcp` til platformen. `.deb` lægger `ppm-mcp` i `PATH` (`/usr/bin/ppm-mcp`). `ppm-mcp` røgtestes på hver platform. Pakkestørrelser og opstartstid noteres i STATUS.

## Tværgående krav (fra fase 2)

Kravene her blev præciseret efter fase 1. De SKAL være opfyldt, når fase 2 er færdig, og de gælder også for alle senere faser.

13. **Filadgang** er afgrænset som beskrevet i [01](01-teknologi-og-struktur.md). Følgende SKAL afvises gennem den rigtige vej fra brugerfladen: læsning uden for scope, `..`-traversal, `ATTACH`, `VACUUM INTO` uden for arkivet og udvidelse af scope ud fra en sti, som brugerfladen sender. **[T]**
14. **Appens database-driver** er testet som beskrevet i 01 (transaktioner, FTS5 og `VACUUM INTO`). **[T]**
15. **Backup og gendannelse streamer** (02). Det verificeres med et arkiv med bilag på i alt mindst 500 MB, og det målte maksimale hukommelsesforbrug noteres i `docs/STATUS.md`.
16. **Låsen fjernes** ved normal lukning af vinduet. Det er verificeret i den rigtige app.

## Manuel test på Windows

Efter hver fase installeres installeren på en Windows 10/11-maskine, og dette forløb gennemføres. Resultatet noteres i `docs/STATUS.md`:

1. Installér, og start appen.
2. Opret et nyt arkiv i en tom mappe.
3. Opret den første bruger med PIN. Luk appen, start den igen, og log ind med PIN (en forkert PIN afvises).
4. Opret en gentagen opgave, og markér den som udført. Kontrollér den næste dato.
5. Træk en PDF ind i vinduet. Træk den samme PDF ind igen, og kontrollér, at den genkendes som dublet.
6. Tag en backup. Gendan den, og kontrollér, at data er intakte.
7. Luk appen, og start den igen. Der må ikke vises en låse-advarsel.

## Målemetoder

- **Opstartstid:** fra processen startes til den første interaktive skærm (velkomst, lås eller login) er vist og kan betjenes. Angiv medianen af 3 starter, om det er en release-build, og platformen.
- **Installerstørrelse:** størrelsen på selve installationsfilen (fx `*-setup.exe`) i byte, ikke størrelsen på CI-artefaktets zip.

## Sammenligning af implementeringer

Når en fase er færdig, opdaterer hver implementeringsbranch `docs/STATUS.md` med:

- de opfyldte kriterier (nummer) og dem, der ikke er opfyldt, med en begrundelse
- afvigelser fra specifikationen (eller en henvisning til `docs/AFVIGELSER.md`)
- testresultat og antal tests
- størrelsen på installeren og den målte opstartstid.
