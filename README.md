# Preventative Private Maintenance

Et open source-desktopprogram, der samler hjemmets dokumentation, tilbagevendende vedligeholdelse og praktiske ansvar i et lokalt arkiv. Arkivet kan også bruges sammen med AI.

Projektet er inspireret af vedligeholdelsessystemer som Sertica, men henvender sig til privatpersoner og familier i Danmark. Det har ingen tilknytning til Sertica.

**Status: Idé og projektgrundlag. Der findes endnu ikke en fungerende applikation.**

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

## Open source

Projektet udgives under [MIT-licensen](LICENSE). Personlige databaser, dokumenter, mailarkiver og adgangsoplysninger må aldrig lægges i repositoryet.

Forslag og bidrag er velkomne. Se [CONTRIBUTING.md](CONTRIBUTING.md). Projektnavnet er et arbejdsnavn.
