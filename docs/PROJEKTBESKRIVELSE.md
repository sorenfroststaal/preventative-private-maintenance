# Projektbeskrivelse

## Problem og formål

Hverdagens ansvar er fordelt mellem breve, mails, kalendere, offentlige portaler, leverandører og egen hukommelse. Opgaver opstår ved livsbegivenheder, gentages med forskellige intervaller og kræver ofte dokumentation, som er svær at finde igen.

Formålet er at samle et personligt handlingsorienteret overblik: Hvad er relevant for mig? Hvad skal jeg gøre? Hvornår? Hvorfor? Hvor ligger dokumentationen?

## Målgrupper

Privatpersoner med mange praktiske forpligtelser, boligejere, lejere, børnefamilier og mindre selvstændige. Danmark er første indholdsmarked; systemets struktur skal give plads til andre lande og sprog gennem separate indholdspakker.

## Spørgeforløb og anbefalinger

Opsætningen spørger først bredt og følger kun op på relevante områder. Eksempler: ejer eller lejer du din bolig, findes der en skorsten, har du børn, bil eller selvstændig virksomhed? Følsomme og unødvendige oplysninger skal undgås. Aldersgruppe kan eksempelvis være tilstrækkelig frem for et barns fulde fødselsdato.

Svar kobles til gennemskuelige regler og skabeloner. Et forslag har begrundelse, kilde når relevant, skabelonversion, usikkerhed og eventuelle manglende oplysninger. Brugeren accepterer, ændrer eller afviser det. Ukendte datoer markeres som manglende frem for at blive gættet.

Ændrede svar udløser en forhåndsvisning af nye og ændrede forslag. Eksisterende historik og egne rettelser overskrives ikke. Ophørte opgaver kan arkiveres.

## Opgaver og dokumentation

En opgave har titel, område, ansvarlig, status, forfaldsdato eller datointerval, påmindelser og gentagelsesregel. Gentagelse skelner mellem fast kalenderdato og interval fra faktisk udførelse. En afsluttet forekomst får egen historik og bilag.

Bilag kan være kvittering, serviceaftale, foto, rapport eller en importeret mail. Samme bilag kan knyttes til flere opgaver. Import af mails starter med manuel filimport; løbende postkasseadgang er en senere, frivillig integration.

OCR og automatisk forslag til datoer er mulige udvidelser. Forslag skal godkendes, og lokal behandling prioriteres. Ingen dokumenter sendes til en ekstern AI-tjeneste som standard.

## Dansk indhold

Skabeloner skelner mellem brugerens egne intervaller, generelle anbefalinger og myndighedsbestemte frister. Relevante myndighedsoplysninger skal have kilde, anvendelsesområde og seneste kontroldato før offentliggørelse. Kommunale, personlige og virksomhedsspecifikke forhold kan kræve brugerens input.

Skat, moms, byggetilladelser og lignende skal i første omgang håndteres som opgaver med officielle kildehenvisninger og brugerbekræftede frister. Automatisk indberetning, myndighedsadgang og fuldstændig økonomisk rådgivning er ikke del af første version.

## Kalender og deling

Første trin er lokal kalendervisning og eksport af valgte opgaver til ICS. En importeret ICS-fil giver ikke automatisk løbende synkronisering. Senere integrationer skal definere retning, konflikthåndtering, sletning og hvilke felter der deles. Brugeren skal kunne vælge neutrale kalendertekster uden bilag og private noter.

Husstandsdeling kræver særskilt design for invitationer, læse- og skriverettigheder, tilbagekaldelse og konflikter. Det indebærer transport af data mellem enheder og kan ikke beskrives som rent lokal lagring.

## Succeskriterier for en første prototype

- En ny bruger kan danne og tilrette en relevant plan uden at starte med en tom opgaveliste.
- Brugeren kan se, hvorfor hver foreslået opgave er relevant.
- En opgave kan oprettes, afsluttes og genfindes med bilag og historik.
- Et lokalt arkiv kan sikkerhedskopieres og gendannes uden datatab.
- Egne ændringer bevares, når skabeloner opdateres.
- Valgte opgaver kan eksporteres til kalender uden utilsigtede private felter.
- Kerneforløbet kan betjenes med tastatur og forståelige danske tekster.

## Afgrænsning

Projektet starter som et åbent projektgrundlag, ikke et færdigt produkt. Der er endnu ikke valgt endelig teknologistak, hosting eller integrationsudbydere. En lille brugbar kerne prioriteres før landsdækkende regelsæt, konti og integrationer.
