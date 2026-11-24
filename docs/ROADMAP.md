# Udviklingsplan

Planen er prioriteret efter afhængigheder. Der er ikke lovet nogen datoer. Acceptkriterierne for hver fase står i [specifikationen](spec/07-faser-og-accept.md).

## 0. Projektgrundlag

- Vision, privatlivsprincipper og afgrænsning.
- Valg af arkitektur: lokal Tauri-desktop-app, SQLite og bilagsmappe, MCP-server og ingen konto.

## 1. Teknisk fundament

- Tauri-skelet til Windows med React/TypeScript.
- Arkivmappe med SQLite (WAL), migrationer, bilag gemt ved deres indholdshash og et manifest.
- Backup og gendannelse af hele arkivet, inklusive en test af afbrudt skrivning.
- Lokale brugere og personer (familiemedlemmer).
- Fælles byggesten: dokumenter, opgaver med gentagelse, noter, tags og ændringslog.

Fasen er færdig, når et testarkiv med bilag kan gemmes, genåbnes og gendannes uden netværk og uden datatab.

## 2. Alle moduler i en tynd udgave

Hvert modul får de få vigtigste felter, så helheden kan afprøves tidligt:

- **Bolig og inventar:** genstande med placering, fotos, kvittering, garanti- og reklamationsfrist, manual og forsikringskobling. Bygningsdele med gentagne opgaver (rense brønd, tagrender og lignende).
- **Arbejdsordrer:** reparationer og skader med status, håndværker, tilbud, faktura og fotos før og efter.
- **Bil:** køretøj, servicehistorik som arbejdsordrer, km-stand, syn, dækskifte og forsikringsfrister.
- **Økonomi:** budget pr. kategori, faste udgifter og abonnementer, CSV-import fra Sparekassen Kronjylland og via generisk kolonnemapping samt kategoriseringsregler.
- **Forsikring:** policer med præmie, fornyelse, selvrisiko og dækning, koblet til genstande, biler og personer. Forsikringsrapport som PDF.
- **Helbred:** besøg, screeninger, vaccinationer, medicin, allergier og målinger pr. person, med påmindelser.
- Dashboard med forfaldne opgaver, kommende frister og manglende oplysninger.
- Import med træk og slip samt en overvåget indbakkemappe.
- Fritekstsøgning på tværs af alle moduler.
- Eksport som CSV, JSON og ICS.

## 2b. Madplan og visuel stil

- Madplan med uge, opskrifter, indkøbsliste, allergi-advarsler og pris mod budget.
- Import og eksport af Open Planner-databaser og et startkatalog med 40 retter.
- Ikoner, farver pr. modul, nøgletalskort og små grafer, der supplerer teksten.

## 3. AI-integration

- MCP-server (stdio) med læse- og søgeværktøjer og adgang til bilag.
- Kladdeværktøjer og en AI-indbakke i appen, hvor forslag godkendes.
- Indstillinger for AI-adgang pr. modul (helbred er slået fra som standard) og en log over AI-adgang.
- Færdigpakket til Claude Desktop (`.mcpb`), som Claude Code-plugin og til Codex/ChatGPT desktop. Vejledning til en lokal model.
- Få værktøjer og kompakte svar, så AI-arbejdet kræver få tokens. Ændringer samles i kladdegrupper, som godkendes samlet.

## 4. Uddybning

- Flere bankprofiler og bedre automatisk kategorisering.
- Lokal OCR af kvitteringer med forslag til beløb og datoer.
- Skabeloner til danske vedligeholdelsesopgaver med kilder og dato for seneste kontrol.
- Onboarding med spørgsmål, der foreslår opgaver.
- Installation til macOS og Linux.

## 5. Senere

- En mobilapp eller -side, der tager billeder af kvitteringer og sender dem til desktop-arkivet.
- Kryptering af arkivet.
- Synkronisering mellem enheder i husstanden.

## Uden for planen

Onlinekonto, fuld bogføring, skatteberegning, automatisk indberetning, adgang til Digital Post eller sundhed.dk og bankintegration via API.
