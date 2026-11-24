# Afvigelser

| Ref. | Specifikation | Fortolkning eller afvigelse |
| --- | --- | --- |
| A1 | 01, stak | Tauri bruger en lokal Node-proces med better-sqlite3, som er tilladt efter PR #2. React bruger komponentvisning og lokal state. React Router, TanStack Query og Testing Library er udestående. |
| A2 | 02, arkiv og gendannelse | Ældre låse uden hostname behandles som låse med ukendt ophav. Gendannelse erstatter ikke et arkiv med en forældet lås, før den er håndteret med eksplicit bekræftelse ved åbning. Nyere databaseversioner får en skrivebeskyttet forbindelse og en versionsadvarsel, mens deres tabeller skjules i brugerfladen. Backup medtager registrerede bilag fra snapshottet. Løse filer uden dokumentrække i bilagsmappen medtages ikke. |
| A3 | 03 og 04, arkivering | Poster med et arkivfelt kan arkiveres og gendannes. Arbejdsordrer kan afsluttes eller annulleres. Reservedele, skadesager og arbejdsordrer har ikke et arkivfelt, så brugerfladen tilbyder ingen fysisk sletning for dem. Direkte koblingsrækker kan fjernes. |
| A4 | 04, modulvisninger | Modulerne bruger en fælles liste og formular med modulernes egne handlinger. Den fulde boligtrævisning, integreret historik for alle posttyper, dokumentminiaturer i inventarlisten og oprettelse af arbejdsordre ved afslutning af en opgave mangler. |
| A5 | 04 og 05, økonomi | Begge CSV-profiler kan forhåndsvises og importeres. Generiske bankprofiler kan gemmes og genbruges. Regler af typen `contains`, `starts_with` og `regex` understøttes. Budgetvisningen sammenligner budget og faktiske DKK-posteringer. |
| A6 | 04 og 05, dokumenter og eksport | Indbakken scannes hvert sekund og stabiliseres i mindst to sekunder. EML-tekst, PDF-tekstlag og PDF-oprettelsesdato udtrækkes lokalt. PDF-tekstudtræk bruger PDF.js via unpdf og er afgrænset til 500 sider og 250.000 tegn. Billeder og PDF får en webview-forhåndsvisning op til 10 MB. For at beskytte helbredsoplysninger vises bilag med person-, helbreds- eller opgaveforekomstkoblinger ikke i den fælles dokumentliste. Kobling foretages fra målets detaljevisning. CSV og JSON pr. tabel er tilgængelig for modultabeller og dokumenter. Samlet JSON kræver administratoradgang til alle personers helbredsdata og udelader PIN-hashes. |
| A7 | 07, manuel Windows-test | Tastaturforløb, tiden til første interaktive skærm og fjernelse af låsen ved lukning af det installerede vindue er ikke efterprøvet på en Windows 10/11-maskine. Den pakkede arkivproces blev startet lokalt, og låsen blev fjernet ved normal afslutning via stdin. |
| A8 | 04, overblik | Opgavegenvejen Åbn går til opgavelisten. Månedsvisningen sammenligner DKK-poster og budgetlinjer for udgiftskategorier. Sammenrulning af underkategorier og budgetafstemning i flere valutaer er udestående. |

## Forslag til præcisering på main

- Angiv livscyklussen for poster uden arkivfelt, hvor fase 2 kræver CRUD. Det gælder især arbejdsordrer, reservedele og skadesager.
- Angiv om samlet JSON skal være en teknisk databaseeksport eller en brugerafgrænset eksport. Beskriv særskilt, hvordan PIN-hashes, audit og private helbredsdata skal håndteres.
- Præcisér håndteringen af eksisterende låse fra versioner uden hostname og tidspunktet for bekræftelse ved gendannelse med en forældet lås.
