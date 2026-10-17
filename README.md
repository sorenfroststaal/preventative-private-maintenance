# Preventative Private Maintenance

Et open source-system, der gør hverdagens vedligeholdelse, frister og praktiske ansvar lettere at overskue.

Projektet er inspireret af vedligeholdelsessystemer som Sertica, men rettet mod privatpersoner, familier og mindre selvstændige i Danmark. Det er et selvstændigt projekt uden tilknytning til Sertica.

**Status: Idé og projektgrundlag. Der er endnu ingen fungerende applikation.**

## Vision

Man skal ikke selv kende alle de opgaver, der følger med at have bolig, børn, bil eller virksomhed. Systemet skal hjælpe med at opdage relevante opgaver, samle dokumentationen og vise, hvad man skal tage stilling til næste gang.

Brugeren opretter en konto og bliver guidet gennem overskuelige spørgsmål om sin livssituation. Svarene danner et personligt udgangspunkt med relevante områder, foreslåede opgaver og gentagelser. Brugeren gennemgår forslagene og tilføjer de konkrete datoer og forhold, som systemet ikke kan kende.

Ambitionen er et næsten færdigt udgangspunkt efter introduktionen – uden at foregive, at alle individuelle eller lovbestemte frister kan udledes af få svar.

## Eksempel på brugerrejse

1. Opret en konto eller vælg den planlagte lokale tilstand uden konto.
2. Besvar spørgsmål i små trin: bolig, installationer, familie, transport og eventuel virksomhed. Spørgsmål kan springes over, og svar kan ændres senere.
3. Gennemgå en foreslået plan. Hvert forslag forklarer, hvorfor det vises, og hvilke oplysninger der mangler.
4. Tilføj eksisterende servicedatoer, aftaler og relevante frister.
5. Importér kvitteringer, rapporter, mails og andre bilag til det lokale arkiv.
6. Se næste handling på forsiden og eventuelt i en valgt kalender.
7. Markér opgaver som udført; historikken bevares, og en ny forekomst beregnes efter den valgte regel.

## Områder

| Område | Eksempler på indhold |
| --- | --- |
| Bolig og installationer | Skorstensrensning, kloakcheck, tagrender, varmepumpe og servicehistorik |
| Økonomi og aftaler | Budget, forsikringstjek, pensionsgennemgang og påmindelse om forskudsopgørelse |
| Familie og livsbegivenheder | Skole, børnehave, konfirmation, flytning og relevante tilmeldinger |
| Transport og udstyr | Bilservice, eftersyn og vedligeholdelse af udstyr |
| Selvstændig virksomhed | Overblik over regnskabsopgaver, momsfrister og bilag |
| Egne områder | Brugerdefinerede opgaver, gentagelser, noter og dokumenter |

Eksemplerne beskriver ønsket funktionalitet. De er ikke en fortegnelse over gældende pligter eller frister. Første version er en opgave- og dokumentoversigt; et egentligt bogføringssystem ligger uden for dens omfang.

## Centrale funktioner

- Personlig opsætning gennem et forgrenet spørgeforløb.
- Dashboard med forfaldne opgaver, kommende frister og manglende oplysninger.
- Opgaver med status, ansvarlig, dato, gentagelse, historik og bilag.
- Lokalt dokumentarkiv til PDF, billeder og importerede mails.
- Søgning på tværs af opgaver, områder og dokumentoplysninger.
- Kalenderoversigt og eksport; senere valgfri integration med eksterne kalendere.
- Backup, gendannelse og eksport i dokumenterede formater.
- På sigt deling af udvalgte opgaver i en husstand med tydelige rettigheder.
- Fælles, versionsstyrede skabeloner, som andre kan bidrage til.

## Privatliv og ejerskab

Udgangspunktet er lokal behandling og lagring af private oplysninger. En onlinekonto er adskilt fra det lokale arkiv: en konto betyder ikke automatisk, at dokumenter uploades eller synkroniseres.

Import betyder som udgangspunkt, at filen kopieres ind i brugerens lokale arkiv. Automatisk mailadgang, ekstern dokumentanalyse og kalendersynkronisering kræver særskilte valg. En ekstern kalender modtager de felter, brugeren vælger at dele. Derfor kan løsningen kun love, at alt forbliver lokalt, når eksterne integrationer er slået fra.

Den lokale tilstand skal kunne fungere uden konto, når programmet er tilgængeligt offline. Onlinekonto, deling og synkronisering udvides senere uden at være en forudsætning for at læse og eksportere egne data.

Læs [projektbeskrivelsen](docs/PROJEKTBESKRIVELSE.md), [arkitekturprincipperne](docs/ARKITEKTUR.md) og [udviklingsplanen](docs/ROADMAP.md).

## Open source

Projektet udgives under [MIT-licensen](LICENSE). Kode og generiske skabeloner kan deles offentligt. Personlige databaser, dokumenter, mailarkiver og adgangsoplysninger må aldrig lægges i repositoryet.

Forslag og bidrag er velkomne: se [CONTRIBUTING.md](CONTRIBUTING.md). Projektnavnet er et arbejdsnavn.
