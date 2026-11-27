# 05 Import, rapporter og eksport

## Import af dokumenter

Følgende filtyper understøttes: `pdf`, `jpg/jpeg`, `png`, `heic` (gemmes, men vises måske ikke), `eml` og `msg`. Filer over 100 MB afvises med en besked.

Fremgangsmåde (fælles for træk og slip, indbakke og godkendte AI-kladder):

1. Beregn SHA-256. Findes hashen allerede, genbruges dokumentet.
2. Kopiér filen til `bilag/<sha[0:2]>/<sha>.<ext>`, og skriv derefter `document`.
3. Udtræk tekst: tekstlaget i PDF-filer (`pdfjs-dist`), og fra `eml` emnet, afsenderen, datoen og den rene tekstdel. Ved `msg` gemmes kun filen (tekstudtræk KAN komme senere). Der udføres ingen OCR i v1.
4. `title` sættes som standard til filnavnet uden endelse eller til mailens emne. `doc_date` sættes til mailens dato eller til PDF'ens oprettelsesdato.
5. Vis en dialog, hvor dokumentet kobles til en post og får en rolle. Brugeren kan springe over, og så ligger det i importkøen.

Mail-HTML vises aldrig som HTML. Kun tekstdelen vises.

## Overvåget indbakke

- Appen overvåger `<arkiv>/indbakke/` (ikke undermapper), så længe den kører, og scanner mappen, når den starter. Overvågningen kan ske med filsystem-events eller ved at scanne mappen med højst 2 sekunders mellemrum (polling), som også virker på netværksdrev.
- En fil importeres, når dens størrelse har været uændret i 2 sekunder. Derefter flyttes den til `indbakke/importeret/YYYY-MM/`.
- Filer, der ikke er understøttet, bliver liggende og vises med en advarsel i importkøen.

## Bank-CSV

### Fælles

- Kodning: UTF-8, også med BOM. Er filen ikke gyldig UTF-8, bruges Windows-1252 som fallback.
- Den rå CSV-fil gemmes som et `document` med `source='bank_import'` og kobles til `import_batch`.
- Beløb: dansk format (`-1.234,56`) laves om til heltal i øre. Datoer: `DD-MM-YYYY` eller `DD.MM.YYYY`.
- `dedupe_hash` = SHA-256 af `account_id|booking_date|text|amount_minor|balance_minor|n`. Her er `n` det løbenummer, rækken har blandt identiske rækker i samme fil (0, 1, 2 …). Rækker, hvis hash allerede findes, tælles som dubletter og springes over.
- Når rækkerne er importeret, kategoriseres de med `category_rule` (laveste `priority` vinder, og ved lighed den ældste regel).
- Brugeren ser en forhåndsvisning (de første 20 rækker og en optælling af nye og dubletter), før importen gennemføres.

### Profil `sparkron` (Sparekassen Kronjylland)

Filen har præcis tre kolonner: **Dato**, **Posteringstekst** og **Beløb**. Der er ingen saldo.

| Kolonne | Felt | Format |
| --- | --- | --- |
| `Dato` | `booking_date` | `DD-MM-YYYY` eller `DD.MM.YYYY` |
| `Posteringstekst` | `text` | Fri tekst. Mellemrum i starten og slutningen fjernes |
| `Beløb` | `amount_minor` | Dansk talformat (`-1.234,56`). Negativ betyder udgift |

- Profilen genkender filen på, at overskriftsrækken (uden forskel på store og små bogstaver, og uden mellemrum i kanterne) er `Dato`, `Posteringstekst` og `Beløb` i den rækkefølge.
- Skilletegnet registreres automatisk som `;` eller `,`. Det tegn, der giver tre kolonner i overskriftsrækken, vinder. Felter i anførselstegn understøttes (RFC 4180).
- Tomme rækker springes over. En række med ugyldig dato eller ugyldigt beløb afviser **hele** importen. Fejlen vises med rækkenummer, og intet bliver importeret.
- `balance_minor` er altid `NULL`. I `dedupe_hash` indgår saldo som en tom streng.
- En syntetisk testfil ligger i `fixtures/bank/sparkron-eksempel.csv`.

### Profil `generic`

Brugeren vælger skilletegn, om der er en overskriftsrække, datoformat og kolonner for dato, tekst og beløb (eventuelt saldo). Opsætningen kan gemmes under et navn og genbruges, og den gemmes i `setting` under `import.profiles`.

## Forsikringsrapport (PDF)

Rapporten åbnes fra Forsikring eller fra Bolig og inventar. Der kan filtreres på bolig, lokation og/eller police, og den kan medtage arkiverede genstande.

Indhold:

1. **Forside:** titel, dato, filtre, husstandens navn (personerne), adresse og eventuelt police og policenummer.
2. **Oversigt:** antal genstande og samlet købspris, opdelt pr. lokation.
3. **Genstande:** én blok pr. genstand med navn, mærke, model, serienummer, lokation, købsdato, købspris, forhandler, om der er kvittering (ja/nej) og op til 2 fotominiaturer.
4. **Bilag (valgfrit):** kvitteringerne vedlagt som sider. Billeder indlejres, og PDF-sider flettes ind med `pdf-lib`.

Filen gemmes i `eksport/forsikringsrapport-YYYYMMDD.pdf` eller et sted, brugeren vælger. Rapporten laves helt lokalt.

## Eksport

- **CSV eller JSON pr. tabel** samt en samlet JSON med alle tabeller (`ppm-export.json` med `schemaVersion`). CSV bruger semikolon som skilletegn og gemmes i UTF-8 med BOM, så filen åbner korrekt i dansk Excel. Søgeindekset (FTS) eksporteres ikke.
- **ICS:** valgte opgaver og deres åbne forekomster som heldags-`VEVENT`. Som standard bruges en neutral titel (opgavens titel) uden noter, bilag og helbredsdetaljer. Helbredsopgaver får titlen "Helbred: påmindelse", medmindre brugeren aktivt vælger at bruge den fulde titel.

## Madplan: ingredienser og Open Planner

### Ingrediens-parser

Ingredienser på tekstform (indsat eller importeret) fortolkes linje for linje. Den oprindelige linje gemmes altid i `raw_text`.

- Formatet er `[mængde] [enhed] vare[, note]`. Mængden kan være heltal, decimal med komma (`1,5`), brøk (`1/2`, `½`) eller et interval (`2-3`, hvor den største værdi bruges).
- Enheder genkendes uden forskel på store og små bogstaver og normaliseres:

| Skrevet | Gemmes som |
| --- | --- |
| g, gram | g |
| kg, kilo | kg |
| ml | ml |
| dl | dl |
| l, liter | l |
| stk, stk. | stk |
| spsk, spsk. | spsk |
| tsk, tsk. | tsk |
| fed | fed |
| dåse, dåser | dåse |
| pk, pakke, pakker | pk |
| bdt, bundt | bundt |

- En mængde uden enhed ("2 løg") gemmes med enheden `stk`. En linje uden mængde ("salt og peber") gemmes med `amount = NULL` og `unit = NULL`.
- Varenavnet gemmes med små bogstaver og trimmet. Tekst efter det første komma bliver til `note`.
- Eksempler, som SKAL være dækket af tests:

| Linje | amount | unit | name | note |
| --- | --- | --- | --- | --- |
| `500 g hakket oksekød` | 500 | g | hakket oksekød | |
| `2 dl fløde` | 2 | dl | fløde | |
| `1,5 kg kartofler, skrællede` | 1.5 | kg | kartofler | skrællede |
| `½ tsk salt` | 0.5 | tsk | salt | |
| `2 løg` | 2 | stk | løg | |
| `2-3 fed hvidløg` | 3 | fed | hvidløg | |
| `Salt og peber` | NULL | NULL | salt og peber | |

### Import fra Open Planner

PPM SKAL kunne importere en Open Planner-database (JSON, version 1 eller 2) fra projektet `open-planner`:

- Formatet er `{ "version": 1|2, "format"?: "...", "sprog": "da", "retter": [{ "id", "navn", "billede"?, "ingredienser": [tekst] | tekst, "fremgangsmaade"?, "opskrift"? }] }`. Højst 200 retter og højst 50 MB.
- Hver ret bliver til en `recipe` med `source = 'import'` og `source_ref = 'open-planner:<id>'`. Findes `source_ref` allerede, opdateres opskriften. Brugerens egne ændringer af en importeret opskrift overskrives dog ikke uden bekræftelse: importdialogen viser "N nye, M ændrede, K uændrede", og ændrede kan vælges fra. Tomme felter i filen tæller ikke som en ændring og overskriver ikke det, brugeren har udfyldt.
- `ingredienser` fortolkes med ingrediens-parseren. `fremgangsmaade` (eller `opskrift`) bliver til `instructions`.
- `billede` som indlejret `data:image/png|jpeg;base64,...` (version 2) importeres som et `document` (kilde `drop`) og kobles via `photo_document_id`. Relative stier (version 1) ignoreres med en besked, fordi filen ikke findes i JSON-filen.

### Eksport til Open Planner

Appen BØR kunne eksportere valgte opskrifter, eller ugens retter, som en Open Planner-database version 2 med indlejrede fotos. Så kan ugens madplan printes som madkort i Open Planner. Feltet `id` er opskriftens `source_ref` uden præfiks, hvis den findes, ellers en slug af navnet.

### Startkatalog

`templates/da/retter.json` indeholder 40 almindelige danske retter (kun navne, ingen fotos og ingen opskrifter) fra Open Planners katalog. Ved første besøg i Madplan tilbydes "Tilføj startkatalog", som opretter dem som opskrifter med `source = 'template'` og `source_ref = 'open-planner:<id>'`. Ingredienser og priser tilføjes af brugeren eller foreslås af AI.
