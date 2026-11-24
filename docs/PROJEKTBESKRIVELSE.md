# Projektbeskrivelse

## Problem og formål

Hjemmets ansvar og dokumentation er fordelt mellem skuffer, mails, kalendere, offentlige portaler, leverandører og egen hukommelse. Opgaver gentages med forskellige intervaller. Når noget går i stykker, når forsikringen skal bruges, eller når man taler med lægen, er dokumentationen svær at finde.

Formålet er et lokalt, personligt arkiv, der svarer på: Hvad ejer vi? Hvad er gjort? Hvad skal gøres, og hvornår? Hvad koster det? Hvor ligger dokumentationen? Arkivet kan også bruges af en AI-assistent, som brugeren selv vælger.

## Målgruppe

Boligejere, lejere og børnefamilier i Danmark. Skabeloner og tekster struktureres, så der senere er plads til andre lande og sprog.

## Moduler

### Bolig og inventar

En genstand har navn, kategori, placering (rum eller område), fotos, model og serienummer. Den har også købsdato, pris, forhandler, kvittering, garanti- og reklamationsfrist med påmindelse, manual samt reservedele og forbrugsdele (filtre, pærer og lignende). Genstanden kan knyttes til den forsikringspolice, der dækker den, så den samlede værdi kan sammenlignes med policens dækningssum.

Bygningsdele (tag, brønd, kloak, skorsten, varmepumpe og lignende) får gentagne opgaver og egen historik.

### Vedligehold og arbejdsordrer

Hver reparation, service eller skade er en arbejdsordre med status: registreret, tilbud indhentet, bestilt, udført, faktureret og afsluttet. Den har beskrivelse, fotos før og efter, håndværker, tilbud, faktura og omkostning. Arbejdsordren knyttes til en genstand, en bygningsdel eller en bil og kan kobles til en skadesag hos forsikringen.

Gentagne opgaver skelner mellem en fast kalenderdato og et interval fra seneste udførelse. Når en opgave er udført, kan den blive til en historikpost eller arbejdsordre med bilag.

### Bil

Køretøj med nummerplade, stelnummer og model. Servicebog og reparationer håndteres som arbejdsordrer med km-stand. Frister for syn, dækskifte, afgifter, forsikring og vejhjælp er opgaver.

### Økonomi og budget

Familiebudget pr. kategori og måned, faste udgifter og abonnementer med fornyelsesdatoer. Kontoudtog importeres som CSV-filer fra banken. Rækker, der allerede er importeret, genkendes, og kategoriseringsregler kan læres af brugerens rettelser. Transaktioner kan knyttes til kvitteringer og arbejdsordrer, så man for eksempel kan se de samlede driftsomkostninger for bilen eller huset.

### Madplan

Ugeplan med opskrifter eller frie titler pr. dag, en opskriftsbank med ingredienser og en indkøbsliste, der samles automatisk fra ugens retter. Retter med noget, et familiemedlem er allergisk over for (fra Helbred), markeres. Ugens anslåede pris holdes op mod budgettet for mad. AI kan foreslå en madplan som kladde. Opskrifter kan importeres fra og eksporteres til projektet Open Planner, så madplanen kan blive til udprintede kort på en fysisk tavle.

### Forsikring

Policer med selskab, policenummer, type, præmie, fornyelse, selvrisiko, dækningssummer, kontakt og policedokument. De er koblet til de genstande, biler og personer, de dækker. Skadesager registreres med kobling til arbejdsordrer og bilag.

### Helbred

For hvert familiemedlem: besøg hos læge, tandlæge, speciallæge og hospital med noter og henvisninger. Desuden screeninger og vaccinationer med påmindelser, aktiv og tidligere medicin med fornyelse af recept, allergier og målinger over tid (blodtryk, vægt, blodprøvesvar).

Programmet er ens egne notater og påmindelser. Det er ikke en patientjournal og giver ikke medicinsk rådgivning. Anbefalede screeninger og vaccinationer i skabeloner skal have en officiel kilde.

## AI-assistance

Med en lokal MCP-server kan en AI-klient:

- søge og læse på tværs af de moduler, brugeren har givet adgang til
- læse bilag som kvitteringer og policer
- foreslå nye genstande, opgaver, arbejdsordrer og udgifter, for eksempel ud fra en kvittering i chatten.

Forslagene lander i appens AI-indbakke og skrives først, når brugeren godkender dem. Brugeren styrer AI-adgangen for hvert modul. Helbred er slået fra som standard. Al AI-adgang bliver logget. Med en lokal model forlader ingen data maskinen. Med Claude eller OpenAI sendes de data, værktøjerne returnerer, til udbyderen, og det forklares tydeligt i appen.

## Brugere og husstand

Flere lokale brugere kan bruge samme computer. Personer (for eksempel børn) kan registreres uden eget login. Adskillelse mellem brugere er en praktisk adskillelse og ingen sikkerhedsgrænse, så længe arkivet ikke er krypteret.

## Import af bilag

- Træk og slip PDF-filer, billeder og mailfiler i appen.
- En overvåget indbakkemappe, for eksempel til scannede eller downloadede kvitteringer.
- Via AI-chat, hvor assistenten foreslår registreringen.

Lokal OCR og billeder af kvitteringer taget med mobilen er senere udvidelser.

## Dansk indhold

Skabeloner skelner mellem brugerens egne intervaller, generelle anbefalinger og frister fastsat af myndigheder. Indhold om frister og pligter skal have kilde, anvendelsesområde og dato for seneste kontrol. Skabelonopdateringer overskriver aldrig brugerens egne rettelser.

## Succeskriterier for første brugbare version

- En genstand kan oprettes med kvittering og garanti og findes igen.
- En reparation kan registreres som arbejdsordre med bilag og ses i genstandens historik.
- Gentagne opgaver (for eksempel at rense brønden) vises på dashboardet og beregner næste forekomst.
- Et kontoudtog kan importeres og holdes op mod budgettet.
- Policer, bil og helbredspåmindelser kan registreres og ses på dashboardet.
- Claude kan svare på spørgsmål ud fra arkivet og foreslå en registrering, som brugeren godkender.
- Hele arkivet kan sikkerhedskopieres og gendannes uden datatab.

## Afgrænsning

Ingen onlinekonto, fuld bogføring, skatteberegning, automatisk indberetning, adgang til Digital Post eller sundhed.dk, bank-API eller medicinsk rådgivning.
