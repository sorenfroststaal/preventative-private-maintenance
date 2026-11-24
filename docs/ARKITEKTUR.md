# Arkitektur og beslutninger

Dokumentet beskriver den valgte retning og begrundelserne for den. Detaljerne står i den normative [specifikation](spec/README.md), og hvis de to dokumenter er uenige, gælder specifikationen. Intet af det er implementeret endnu.

## Overblik

```
┌──────────────────────────┐        ┌─────────────────────────────┐
│ Desktop-app (Tauri)      │        │ AI-klient                   │
│ React/TypeScript-UI      │        │ Claude Desktop, OpenAI-     │
│ Rust-kerne: filer, låse, │        │ klienter, lokal model       │
│ backup, mappeovervågning │        │ (fx via Ollama)             │
└────────────┬─────────────┘        └──────────────┬──────────────┘
             │                                     │ MCP (stdio, lokalt)
             │                       ┌─────────────┴──────────────┐
             │                       │ MCP-server (Node/TS)       │
             │                       │ læser data, skriver kun    │
             │                       │ kladder til godkendelse    │
             │                       └─────────────┬──────────────┘
             ▼                                     ▼
      ┌───────────────────────────────────────────────────────┐
      │ Lokalt arkiv (en mappe brugeren vælger)               │
      │   arkiv.sqlite   – struktureret data                  │
      │   bilag/         – PDF, fotos, mails (hash-navngivet) │
      │   indbakke/      – overvåget importmappe              │
      │   manifest.json  – formatversion og integritet        │
      └───────────────────────────────────────────────────────┘
```

## Trufne beslutninger

| Emne | Beslutning | Begrundelse |
| --- | --- | --- |
| Platform | Desktop-app med Tauri og TypeScript/React | En lille installationsfil og direkte adgang til filer. Det udbredte TypeScript gør det lettere at bidrage. |
| Første styresystem | Windows | Det er mest udbredt i private hjem. macOS og Linux bliver ikke udelukket af valgene. |
| Mobil | Senere. Telefonen bruges først og fremmest til at tage billeder af kvitteringer og sende dem til arkivet | Det kræver synkronisering, som skal designes separat. |
| Lagring | SQLite-fil og en bilagsmappe i en synlig arkivmappe | Brugeren kan se arkivet, tage backup af det og flytte det. |
| Konto | Ingen onlinekonto. Programmet er 100 % lokalt | Det giver en enklere tillidsmodel, og der er ingen drift af servere. |
| Brugere | Flere lokale brugere på samme maskine | For eksempel to forældre. Data kan knyttes til hvert familiemedlem. |
| Kryptering | Ingen kryptering af arkivet i første omgang. Diskkryptering (BitLocker) anbefales | Det er enklest at starte sådan. Se begrænsningerne nedenfor. |
| AI | Lokal MCP-server med læse- og søgeværktøjer og adgang til bilag. Ændringer bliver lavet som kladder, der skal godkendes i appen | AI kan foreslå, men kan ikke ændre data uden at brugeren godkender det. |
| Import | Træk og slip, en overvåget indbakkemappe og import via AI-chat | Lokal OCR kommer senere. |
| Bank | CSV-import fra Sparekassen Kronjylland og en generisk kolonnemapping | Formatet er tre kolonner: Dato, Posteringstekst og Beløb. |
| Dashboard | Frister og opgaver øverst, økonomi nedenunder | Det er fristerne, der er grunden til at åbne appen. |
| Forsikringsrapport | PDF med genstande, fotos, priser og kvitteringer | Bruges efter indbrud eller brand. |

### Konsekvenser af at der ikke er kryptering

- Alle med adgang til Windows-brugeren eller disken kan læse `arkiv.sqlite` og bilagene.
- Adskillelse mellem lokale brugere i appen er en praktisk adskillelse og ingen sikkerhedsgrænse. Det skal stå tydeligt i brugerfladen, især for helbredsdata.
- Placeres arkivet i en OneDrive- eller Dropbox-mappe, bliver det sendt til skyen. Appen advarer, hvis den finder en kendt synkroniseret mappe.
- Datamodellen og arkivformatet skal kunne udvides med kryptering senere (for eksempel SQLCipher og krypterede bilag) uden at data skal migreres manuelt.

## AI-integration (MCP)

Model Context Protocol er en åben standard, som Claude Desktop og flere andre klienter understøtter. Projektet leverer én MCP-server. Brugeren registrerer den i sin AI-klient, og den starter lokalt over stdio.

### Værktøjer

- **Læsning:** søgning på tværs af moduler, opslag, opgaver, historik, inventar, biler, policer, transaktioner, budget og helbredsoverblik.
- **Bilag:** `get_document` returnerer PDF-filer og billeder, så AI-klienten selv kan læse kvitteringer og policer.
- **Kladder:** `propose_create`, `propose_update`, `propose_complete_task` og `propose_attach_document`. Forslagene lander i appens *AI-indbakke* og skrives først, når brugeren godkender dem.

Den præcise liste over værktøjer står i [spec 06](spec/06-ai-mcp.md).

### Adgang pr. modul

Når et værktøj kaldes, sendes data til AI-udbyderen, medmindre der bruges en lokal model. Derfor:

- I indstillingerne vælger brugeren for hvert modul, om AI må læse det. **Helbred er slået fra som standard** og skal slås til aktivt.
- Hver lokal bruger kan begrænse AI-adgangen til egne data og data om sine børn.
- Alle værktøjskald logges lokalt (værktøj, tidspunkt og hvilke poster der blev returneret), så brugeren kan se, hvad der er blevet delt.

### Klienter

- **Claude Desktop / Claude Code:** understøtter lokale MCP-servere over stdio. Det er den primære målklient.
- **OpenAI:** Kan klienten tale med lokale MCP-servere (for eksempel Codex CLI eller Agents SDK), bruges den samme server. ChatGPT's egne connectors forventer en server, der kan nås over internettet. Det strider mod den lokale model og skal vurderes særskilt. Dette er et åbent punkt.
- **Lokal AI:** Brug en MCP-kompatibel klient sammen med en lokal model (for eksempel Ollama). Så forlader ingen data maskinen. Projektet dokumenterer en anbefalet opsætning.

MCP-serveren åbner databasen i WAL-tilstand. Den læser direkte, men skriver kun til kladdetabellen, så den ikke konkurrerer med appen om skriveadgang.

## Datamodel (udkast)

Fælles:

- `User` (lokal bruger) og `Person` (familiemedlem, kan være uden login).
- `Document`: fil-hash, filtype, titel, dato, udtrukket tekst og kilde (træk og slip, indbakke, AI). Bilag knyttes via `DocumentLink` til en vilkårlig post.
- `Task` og `TaskOccurrence`: gentagelse med fast dato eller interval fra seneste udførelse. Opgaven kan knyttes til en genstand, en bygningsdel, en bil, en person eller en police.
- `AiDraft`: forslag fra AI med status (afventer, godkendt eller afvist).
- `AuditLog`: ændringer og AI-adgang.
- `Tag` og `Note`.

Moduler:

- **Bolig og inventar:** `Property`, `Location` (rum eller udendørs område), `Item` (genstand med model, serienummer, fotos, placering, købsdato, pris, forhandler, garanti- og reklamationsfrist, manual, reservedele og forbrugsdele), `BuildingPart` (tag, brønd, kloak, varmepumpe og lignende).
- **Arbejdsordrer:** `WorkOrder` med status (registreret, tilbud indhentet, bestilt, udført, faktureret og afsluttet), beskrivelse, fotos før og efter, håndværker (`Contact`), tilbud, faktura og en eventuel kobling til en forsikringsskade.
- **Bil:** `Vehicle` (nummerplade, stelnummer og model), servicebog som arbejdsordrer, km-stand, syn, dækskifte, afgifter, forsikring og vejhjælp som opgaver og frister.
- **Økonomi:** `Account`, `Transaction` (importeret fra en CSV-fil fra banken eller tastet ind), `Category`, `Budget` og `BudgetLine`, `Subscription` eller fast udgift samt kategoriseringsregler. Transaktioner kan knyttes til kvitteringer og arbejdsordrer.
- **Forsikring:** `Policy` (selskab, policenummer, type, præmie, fornyelse, selvrisiko, dækningssummer og kontakt), `PolicyCoverage` (hvilke genstande, biler og personer policen dækker), `Claim` (skadesag knyttet til en arbejdsordre).
- **Helbred:** `Visit` (læge, tandlæge, speciallæge eller hospital, med noter og henvisninger), `Screening`, `Vaccination`, `Medication` (aktiv eller ophørt, med dato for fornyelse af recept), `Allergy`, `Measurement` (type, værdi og enhed). Alle poster hører til en `Person`.

Regler for data:

- Beløb gemmes som heltal i mindste enhed (øre) sammen med valuta.
- Heldagsdatoer holdes adskilt fra tidspunkter, og tidszoner håndteres eksplicit.
- Faglige frister (for eksempel myndighedskrav) holdes adskilt fra tekniske regler for gentagelse.
- Bilag gemmes ved deres indholdshash, så den samme fil ikke bliver gemt to gange.

## Import

- **Træk og slip:** PDF, billeder, `.eml` og `.msg`. Filen kopieres ind i arkivet, og originalen bliver ikke rørt.
- **Overvåget mappe:** filer i `indbakke/` bliver importeret og vist i en importkø, hvor brugeren knytter dem til en post.
- **Via AI:** AI-klienten læser en kvittering og kalder `propose_expense` eller `propose_item` med de udtrukne felter. Brugeren godkender i appen.
- **Bank-CSV:** importprofiler til danske bankers eksportformater. Rækker, der allerede er importeret, genkendes og bliver ikke importeret igen. Kategoriseringsregler kan læres af brugerens rettelser.
- Importeret HTML og mailindhold behandles som ubetroet: der køres ingen scripts, og der hentes ingen billeder udefra.

## Backup og eksport

- En backup er en samlet arkivpakke (zip) med database, bilag og et manifest med formatversion og checksummer.
- Gendannelsen kontrolleres med checksummerne. Det skal testes, at en afbrudt skrivning ikke ødelægger arkivet.
- Hver tabel kan eksporteres som CSV eller JSON, så brugeren aldrig er låst til programmet.
- Opgaver og frister kan eksporteres til ICS.

## Privatliv

- Ingen telemetri og ingen netværkskald som standard. Opdateringstjek kræver samtykke.
- Programmet laver kun netværkskald, når brugeren aktivt slår en funktion til, og de er dokumenteret.
- Personlige data, databaser og bilag må aldrig lægges i repositoryet.

## Åbne beslutninger

- Hvordan OpenAI understøttes ud over lokale MCP-klienter. ChatGPT-connectors ligger uden for v1.
- Hvordan mobilen sender data til desktop (lokalt netværk, en delt mappe eller QR-parring).
- Hvornår og hvordan kryptering indføres, og hvordan en mistet nøgle håndteres.
- Valg af lokal OCR-motor (for eksempel Tesseract med dansk sprogdata).
- Kodesignering af Windows-installationen.
