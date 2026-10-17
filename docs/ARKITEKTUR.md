# Arkitekturprincipper og åbne beslutninger

Dette dokument beskriver en foreslået retning, ikke implementeret funktionalitet.

## Tre adskilte lag

1. Offentlig programkode og generiske indholdspakker: webbrugerflade, onboarding og opgaveskabeloner.
2. Lokalt privat arkiv: profil, opgaver, historik, dokumenter og lokale præferencer.
3. Valgfrie onlinetjenester: konto, kalenderforbindelser og eventuel krypteret synkronisering eller husstandsdeling.

Kontotjenesten skal kun modtage nødvendige kontooplysninger. Private onboarding-svar og dokumenter ligger i det lokale lag som standard. Kontoens login og en eventuel nøgle til krypterede data er forskellige sikkerhedsmekanismer; mistet nøgle og gendannelse skal afklares før krypteret synkronisering implementeres.

## Lokal lagring

En teknisk prototype skal afprøve en browserapp med offlineunderstøttelse, SQLite eller tilsvarende struktureret lagring og et dokumentarkiv. Direkte skrivning til en selvvalgt fil afhænger af browser og tilladelser. Browserintern lagring er en anden model og må ikke præsenteres som en synlig databasefil, brugeren allerede har backup af.

Afklar før valg af løsning: browserunderstøttelse, filstørrelser, låsning ved flere faner, atomisk gemning, schemaopgraderinger, genåbning og gendannelse ved afbrudt skrivning. Store bilag kan kræve en mappe eller samlet arkivpakke frem for én databasefil. Eksport skal omfatte både database og bilag samt manifest, formatversion og integritetskontrol.

Lagring i en OneDrive- eller anden synkroniseret mappe kan sende filer til skyen uafhængigt af appen. Brugerfladen skal forklare forskellen mellem lokal placering og cloudsynkronisering.

## Foreslået datamodel

- Profile og ProfileAnswer: lokale svar og opsætningsstatus.
- Area og Asset: eksempelvis bolig, familie, virksomhed og varmepumpe.
- TaskTemplate og Rule: versionsstyrede forslag og deres betingelser.
- Task og TaskOccurrence: brugerens opgave og de enkelte udførelser/frister.
- Document og DocumentLink: bilag, metadata og relationer.
- CalendarMapping: eksport- eller integrationsidentitet uden hemmeligheder i opgavedata.
- ChangeLog: ændringer, der hjælper med fejlfinding og konflikter.

Penge repræsenteres med valuta og præcise beløb. Heldagsfrister adskilles fra klokkeslæt, og tidszoner håndteres eksplicit. Tekniske regler for gentagelse skal være adskilt fra faglige regler om frister.

## Privatliv og sikkerhed

Ingen telemetri eller ekstern dokumentanalyse som standard. Ingen private filer eller hemmeligheder i Git. Importeret HTML og mailindhold behandles som ubetroet indhold og må ikke køre scripts eller automatisk hente fjernbilleder. Bilag åbnes med passende begrænsninger.

En internetleveret app kan ændre kode ved opdateringer. Lokal lagring alene garanterer derfor ikke, at data aldrig kan sendes ud. Offlineudgave, selvhosting, dokumenterede netværkskald og kontrollerbare releases indgår i tillidsmodellen. Kryptering på disk og kryptering under deling kræver særskilte beslutninger og test.

## Integrationer og drift

ICS-eksport kommer før direkte kalenderadgang. Eventuelle OAuth-tokens opbevares særskilt og med mindst mulige rettigheder. Login, baggrundspåmindelser og ekstern synkronisering får egen drifts- og sikkerhedsmodel. Ingen automatisk myndighedsindberetning i første version.

## Beslutninger før implementering

- Primære browsere og eventuelt behov for en desktopudgave.
- Synlig lokal fil, arkivmappe eller browserlager med eksport.
- Kryptering og nøgle-/backupgendannelse.
- Kontoudbyder eller selvhostet login samt nødvendige kontodata.
- Første afgrænsede indholdspakke og ansvar for kildekontrol.
- Kalenderretning, konflikter og opdateringsstrategi.
