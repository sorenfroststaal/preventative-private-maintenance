# 04 Moduler og brugerflade

## Opstart og brugere

1. Første opstart: velkomst, opret eller åbn et arkiv, opret den første bruger (admin) og dens person.
2. Senere opstarter: vælg bruger (med PIN, hvis der er en). Den sidst valgte bruger er forvalgt.
3. Admin kan oprette brugere og personer under Indstillinger.

## Navigation

En venstremenu med disse punkter i denne rækkefølge, hvert med sit ikon (se "Visuel stil"): **Overblik, Opgaver, Kalender, Bolig og inventar, Arbejdsordrer, Bil, Økonomi, Madplan, Forsikring, Helbred, Dokumenter, AI-indbakke (med antal), Lister, Indstillinger.**

Global søgning åbnes med `Ctrl+K`. Den søger i `search_index` og viser resultater grupperet pr. modul. Hele appen SKAL kunne betjenes med tastatur og have synlig fokus.

Hver modulskærm består af en liste (med søgefelt, filtre og sortering) og en detaljevisning med fanerne *Oplysninger, Historik, Bilag og Opgaver*, hvor fanen giver mening. Alle formularer validerer med Zod og viser fejl på dansk ved feltet.

## Overblik (dashboard)

Rækkefølgen er fast:

1. **Forfaldne:** åbne forekomster med `due_date < i dag`.
2. **Næste 30 dage:** åbne forekomster inden for `dashboard.horizon_days`.
3. **Udløber snart:** de automatiske opgaver (garanti, reklamationsret, police, binding og recept) fra 30 dage tilbage til 60 dage frem, uanset `reminder_days`. Automatiske opgaver vises kun her og ikke også i sektion 1–2. Ældre udløbne frister skjules.
4. **Mangler oplysninger:**
   - genstande med pris, men uden kvittering
   - aktive opgaver, hvor den åbne forekomst mangler `due_date`
   - policer uden `renewal_date`
   - biler uden registreret km-stand de sidste 12 måneder.
5. **AI-indbakke:** antal kladder, der venter.
6. **Økonomi denne måned:** budget og faktisk forbrug pr. hovedkategori samt antal transaktioner uden kategori.
7. **Backup:** en advarsel, hvis der er gået mere end 30 dage siden sidste backup.

Hver linje har en hurtighandling: *Udført, Udskyd* (vælg en dato) og *Åbn*.

## Opgaver og gentagelse

`task.recurrence_json` har én af disse to former:

```json
{ "kind": "fixed", "unit": "year", "every": 1, "month": 10, "day": 1 }
{ "kind": "interval", "unit": "month", "every": 6 }
```

- `unit`: `day`, `week`, `month` eller `year`. I `fixed` bruges `month` (1–12) og `day` (1–31) kun ved `year`. Ved `month` bruges kun `day`.
- **fixed:** udførelsesdatoen er ligegyldig. Næste forfaldsdato findes sådan:
  - Ligger den forrige forfaldsdato på mønsteret (dagen klemt til månedens længde), flyttes den `every` perioder frem, og mønsterets dag bruges igen.
  - Ligger den forrige forfaldsdato uden for mønsteret, bruges den første dato strengt efter den, som passer. Derefter gælder reglen ovenfor.
  - Ved `day` og `week` regnes der fra den forrige forfaldsdato.
  - Mangler den forrige forfaldsdato, bruges udførelsesdatoen som base.
- **interval:** næste forfaldsdato er udførelsesdatoen plus `every × unit`. Ved spring over regnes der fra den forrige forfaldsdato. Mangler den, regnes der fra datoen for overspringet.
- **Første forfaldsdato:** brugeren kan angive den. Gør brugeren det ikke, gælder:
  - `fixed` med `year` eller `month`: datoen bliver den første dato på mønsteret samme dag som oprettelsen eller senere.
  - `interval` og engangsopgaver: datoen gemmes som manglende (`NULL`) og vises under "Mangler oplysninger". Den gættes aldrig.
- Eksempler (alle SKAL være dækket af tests):

  | Regel | Forrige forfaldsdato | Udført | Næste |
  | --- | --- | --- | --- |
  | fixed, år, 01.10, every 1 | 2026-10-01 | 2026-11-20 | 2027-10-01 |
  | fixed, år, 01.10, every 1 | 2026-09-15 | 2026-09-15 | 2026-10-01 |
  | fixed, år, 01.10, every 2 | 2026-11-15 | 2026-11-15 | 2027-10-01 og derefter 2029-10-01 |
  | fixed, måned, dag 31 | 2026-01-31 | 2026-01-31 | 2026-02-28 og derefter 2026-03-31 |
  | fixed, år, 29.02 | 2028-02-29 | 2028-02-29 | 2029-02-28 |
  | interval, 6 måneder | 2026-03-01 | 2026-03-15 | 2026-09-15 |
  | interval, 3 måneder, sprunget over | 2026-01-10 | 2026-02-20 | 2026-04-10 |
  | interval, 1 måned | 2026-01-31 | 2026-01-31 | 2026-02-28 |
- Månedsenden klemmes: 31. januar plus 1 måned giver 28. eller 29. februar. Der regnes altid i kalenderdatoer, ikke i tidszoner.
- Når en forekomst markeres `done` eller `skipped`, oprettes den næste åbne forekomst i samme transaktion. Der må højst være én åben forekomst pr. opgave (det håndhæves af et indeks).
- Opgaven kan knyttes til en arbejdsordre. Med knappen *Udført, opret arbejdsordre* oprettes en arbejdsordre med status `done`, og den kobles til forekomsten.

Opgavelisten kan filtreres på modul, ansvarlig, status og periode. Den kan også vises som en kalender for en måned.

## Bolig og inventar

- Træstruktur: bolig, så lokationer (rum), så genstande. Bygningsdele vises under boligen.
- Felter for genstande følger `item`. Fotos er dokumenter med rollen `photo`. Det første foto vises som miniature i listen.
- Fanen *Reservedele* (`item_part`).
- Fanen *Forsikring* viser de policer, der dækker genstanden, direkte eller via dens bolig.
- Policevisningen sammenligner `coverage_sum_minor` med summen af `purchase_price_minor` for de dækkede genstande og advarer, hvis summen er større.

## Arbejdsordrer

- Listen kan filtreres på status, type, mål og år.
- Statusskift skriver en række i `work_order_event`. Detaljevisningen har en tidslinje med statusskift og noter.
- Bilag har roller: tilbud, faktura og fotos før og efter.
- Er type `damage`, kan der oprettes en skadesag (`claim`) mod en police.
- Når en arbejdsordre på en bil gemmes med `odometer_km`, oprettes en `odometer_reading` med `source='work_order'`.
- Historikfanen på genstande, bygningsdele og biler viser de tilknyttede arbejdsordrer og udførte opgaveforekomster i én kronologisk liste.

## Bil

- Servicebogen er arbejdsordrer på bilen. Desuden km-stand over tid og frister i form af opgaver.
- Når en bil oprettes, tilbydes disse forslag fra skabeloner: dækskifte forår og efterår, service samt syn (brugeren angiver selv datoen).
- Total for driftsomkostninger pr. år: summen af `cost_minor` på arbejdsordrer plus transaktioner koblet til bilen.

## Økonomi

- **Konti:** opret en konto, og importér CSV (se 05).
- **Transaktioner:** liste med kategori, som kan ændres direkte i listen. Når brugeren kategoriserer manuelt, tilbydes *"Brug altid for tekster der indeholder …"*, og der oprettes en `category_rule` med `created_from='learned'`.
- **Budget:** et årsbudget med linjer pr. kategori. Visningen sammenligner budget og faktisk forbrug pr. måned og hele året.
- **Overblik:** indtægter og udgifter pr. måned (6, 12 eller 24 måneder) som kurve med gennemsnit. Overførsler tælles ikke med; posteringer uden kategori tælles efter fortegn. **Madbudget:** forbruget i "Mad og dagligvarer" med underkategorier pr. måned mod budgettet; madbudgettet sættes i ét trin og gemmes som en budgetlinje uden måned i årets budget. **Historik pr. kategori:** alle kategorier med posteringer i perioden med minikurve og gennemsnit; valgt kategori vises som kurve.
- **Budget** forklarer, at "faktisk" kommer fra kategoriserede posteringer, viser antal posteringer i året og hvor mange der mangler kategori, og kan hente månedlige linjer fra de faste udgifter (kun kategorier uden linje).
- **Faste udgifter:** liste med den beregnede månedlige gennemsnitsudgift og summen pr. måned. Hver udgift har en valgfri prioritet 1–5 (5 obligatorisk, 4 vigtig, 3 nyttig, 2 rart at have, 1 kan undværes), listen kan sorteres efter den, og summen af prioritet 1–2 vises pr. måned og år. En udgift arkiveres fra listen (opsagt). En udgift kan kobles til en bolig eller en bil, have en slutdato (derefter vises den som ophørt og tælles ikke med) og markeres som variabel, så beløbet vises som et skøn ("ca.").
- **Lån:** liste med type, långiver, restgæld pr. dato, rente, ydelse omregnet til pr. måned og sidste ydelse, med summer for restgæld og ydelse. Detaljen har bilag. Appen beregner ikke afdrag; brugeren retter restgælden ud fra årsopgørelsen. Bilens driftsomkostninger viser bilens faste udgifter og lån.
- Standardkategorier (seed): Bolig, Forsyning, Mad og dagligvarer, Transport, Forsikring, Børn, Sundhed, Fritid, Abonnementer, Opsparing, Indtægt, Overførsel, Andet.

## Forsikring

- Policelisten viser i kolonnen *Dækker* dækkede personer som runde initialer og andre dækninger som ikoner. Personer til- og fravælges med ét klik på fanen *Dækning*.
- Liste over policer med årlig præmie (normaliseret fra perioden), fornyelse og selvrisiko.
- Detaljevisning med dækning (genstande, biler, personer og bolig), skadesager og policedokumenter.
- Knappen *Forsikringsrapport* (se 05).

## Helbred

- Vælg først en person. Visningen respekterer `health_private_user_id`.
- Fanerne er: *Besøg, Screeninger, Vaccinationer, Medicin, Allergier og Målinger*.
- Målinger vises som en tabel og en simpel linjegraf pr. type.
- En fast tekst øverst i modulet: *"Dine egne noter og påmindelser. Erstatter ikke journal eller rådgivning fra sundhedspersonale."*

## Dokumenter

- Alle dokumenter med filtre (rolle, kilde, uden kobling) og forhåndsvisning af PDF og billeder.
- **Importkø:** filer fra indbakken, som endnu ikke er koblet til noget. Træk og slip er muligt overalt i appen.
- Ét dokument kan kobles til flere poster.

## AI-indbakke

Hver kladde viser værktøjet, begrundelsen og en forhåndsvisning. Ved `create` vises en formular, der er udfyldt og kan redigeres. Ved `update` vises felterne før og efter. Knapperne er *Godkend, Redigér og godkend* og *Afvis*. Se 06.

## Indstillinger

Brugere og personer, arkivplacering, backup og gendannelse, AI-adgang pr. modul samt hvilken bruger AI agerer som, log over AI-adgang, MCP-opsætningsvejledning (med en kopiérbar konfiguration), importprofiler, kategorier og regler samt skabeloner.

## Madplan

Modulet har fanerne **Uge, Opskrifter og Indkøbsliste**.

### Uge

- Viser én uge ad gangen, mandag til søndag, med ugenummer (ISO 8601) og knapper til forrige, denne og næste uge.
- Hver dag har pladser til aftensmad som standard. Morgenmad, frokost og mellemmåltid kan slås til i indstillingerne (`food.meals`, standard `["dinner"]`).
- En plads udfyldes med en opskrift (søgbar vælger) eller en fri tekst, fx "Rester". Antal portioner er som standard husstandens størrelse (`food.default_servings`, standard 4).
- En ret kan flyttes til en anden dag. Knappen *Kopiér sidste uge* kopierer alle pladser 7 dage frem.
- Ugekortet viser:
  - **Anslået pris** for ugen: summen af `estimated_cost_minor × portioner / servings` for de retter, der har en pris. Antal retter uden pris vises separat. Det er planlagte opskrifter uden pris. Frie titler som "Rester" tælles ikke. Portioner er pladsens `servings` og ellers opskriftens.
  - **Budget:** månedens budget for kategorien "Mad og dagligvarer" (og underkategorier) delt med antal dage i måneden og ganget med 7. Beregningen sker pr. dag, så en uge over et månedsskifte bruger begge måneders budget. Desuden det faktiske forbrug i ugen fra posteringer i samme kategorier.
  - **Allergi-advarsler** (se nedenfor) ved hver ret.

### Opskrifter

- Liste med søgning, filter på tags, ikon for allergener og miniaturefoto.
- Felterne er navn, beskrivelse, portioner, tid, tags, anslået pris, foto og fremgangsmåde. Ingredienserne redigeres som en tabel med mængde, enhed, vare og note. Man kan også indsætte tekstlinjer, som fortolkes med ingrediens-parseren (05).
- **Allergener:** brugeren kan markere allergener på opskriften (`allergens_json`). Desuden udledes allergener automatisk af ingrediensnavnene ud fra nøgleordslisten nedenfor.
- Knapperne er *Planlæg* (vælg dag) og *Arkivér*.

### Allergi-advarsler (kostbehov fra Helbred)

- En ret får en advarsel, hvis et af dens allergener (markeret eller udledt) matcher en registrering i `health_allergy` for en person i husstanden. Advarslen viser stoffet og personen.
- Er personens helbredsdata private for en anden bruger (`health_private_user_id`), vises kun "Allergi hos et husstandsmedlem (privat)" uden navn og stof.
- Allergener udledes kun af ingrediensnavnene, ikke af rettens navn. Nøgleord matches som delstreng (fx giver "kokosmælk" Mælk). Det giver hellere en advarsel for meget end en for lidt.
- Matching sker uden forskel på store og små bogstaver og med denne nøgleordsliste (core SKAL indeholde den, og den KAN udvides):

| Nøgle | Visningsnavn | Nøgleord i ingrediens eller allergi |
| --- | --- | --- |
| gluten | Gluten | hvede, mel, rug, byg, spelt, pasta, brød, rasp, couscous, bulgur, gluten |
| milk | Mælk | mælk, fløde, smør, ost, yoghurt, skyr, creme fraiche, laktose |
| egg | Æg | æg, mayonnaise |
| nuts | Nødder | nød, nødder, mandel, hasselnød, valnød, cashew, pistacie, pekan |
| peanut | Jordnødder | jordnød, peanut |
| fish | Fisk | fisk, laks, torsk, tun, sild, makrel, rødspætte |
| shellfish | Skaldyr | rejer, reje, krabbe, hummer, muslinger, skaldyr |
| soy | Soja | soja, tofu, edamame |
| sesame | Sesam | sesam, tahin |
| celery | Selleri | selleri |
| mustard | Sennep | sennep |

En allergi-registrering matcher en nøgle, hvis `substance` indeholder visningsnavnet eller et af nøgleordene.

### Indkøbsliste

- *Lav indkøbsliste for ugen* opretter eller opdaterer listen for ugen (`week_start` = mandag):
  - Ingredienser fra ugens retter skaleres med `portioner / servings` og lægges sammen efter normaliseret varenavn og enhed. g og kg lægges sammen i g (vises som kg fra 1000 g). ml, dl og l lægges sammen i ml (vises som l fra 1000 ml). Andre enheder lægges kun sammen med samme enhed.
  - Varer uden mængde vises én gang med antallet af retter, de indgår i, fx "salt (3 retter)". De gemmes med `amount` = antal retter og `unit = 'retter'`, så navn og enhed er stabile, når listen genereres igen.
  - Når listen genereres igen, erstattes de genererede varer (`source = 'plan'`). Manuelle varer bevares. Afkrydsning bevares for varer med samme navn og enhed.
- Varer grupperes efter butiksafdeling (`category`), og afdelingen gættes ud fra varenavnet med en simpel liste: Frugt og grønt, Kød og fisk, Mejeri, Brød, Kolonial, Frost, Andet. Brugeren kan ændre den.
- Varer kan afkrydses, tilføjes manuelt, slettes og kopieres som tekst (én vare pr. linje, grupperet efter afdeling), fx til en besked. Afkrydsede varer kommer kun med, hvis brugeren vælger det.

## Husdyr

Under **Bolig og inventar** har fanen **Husdyr** en liste (navn, art og race, chipnummer, dyrlæge) og en detaljevisning med fotos, oplysninger, bilag og de policer, der dækker dyret. Felterne er navn, art (hund, kat, hest, kanin, fugl, andet), race, køn, fødselsdato, chipnummer, ejer (person), dyrlæge (kontakt) og noter. Under Forsikring kan dækning tilføjes for et husdyr.

## Kalender og tidslinje

- Menupunktet **Kalender** (ikon `calendar-days`, farvetoken `--c-calendar`) har fanerne *Månedsvisning* og *Tidslinje*. Begge viser de samme begivenheder, og brugeren vælger, hvilke typer der vises: opgaver, arbejdsordrer, køb, garanti og reklamationsret, udlån, forsikringer, faste udgifter og bindinger, lån, madplan, helbred og dokumenter. Valget huskes pr. bruger. Helbredsbegivenheder for personer med private helbredsdata vises kun for den valgte bruger.
- **Månedsvisning:** mandag først, ugenumre, i dag fremhævet, op til tre begivenheder pr. dag og et dagspanel med alle dagens begivenheder, der hver fører til posten. Perioder vises på første og sidste dag; igangværende perioder kun på første. Piletasterne flytter mellem dagene.
- **Tidslinje:** en bane pr. type, perioder som bjælker og datoer som punkter, "I dag"-linje, zoom med rullehjul, +/− og forvalg (uge, måned, kvartal, år, 5 år), flyt ved at trække eller med piletasterne. Aksen skifter mellem dage, uger, måneder, kvartaler og år efter zoom. Forfaldne begivenheder har rød kant, udførte er nedtonede. Hver begivenhed kan nås med tastaturet og har en tekst til skærmlæsere, og *Vis som liste* viser de samme begivenheder som tekst.

## Udlån

- Bolig og inventar har fanen **Udlån**. En ting (genstand eller fri tekst) lånes ud til en person, en kontakt eller et frit navn med udlånsdato og eventuel afleveringsdato. En genstand kan kun være udlånt én gang ad gangen. Overskredne udlån markeres. *Markér afleveret* sætter `returned_date`; afleverede udlån kan vises som historik. Genstandens detalje viser "Udlånt til …" eller *Lån ud…*.

## Lister og rullelister

- Menupunktet **Lister** (ikon `list-tree`, farvetoken `--c-lists`) viser de poster og værdier, som rullelisterne i formularerne henter fra, med en fane for hver: rum og placeringer, boliger, kontakter, personer, konti, økonomikategorier, genstandskategorier og bygningsdelstyper. Poster rettes med samme formular som andre steder og arkiveres i stedet for at blive slettet. Poster, der kan have bilag (boliger, rum, kontakter, personer og konti), har også fanen *Bilag*. Værdilister (03) kan få nye værdier, omdøbes og få ubrugte værdier slettet.
- Genstandens kategori og bygningsdelens type vælges fra en rulleliste med værdilisten og muligheden **+ Tilføj ny…**.
- Rullelister, der henviser til poster (fx placering, forhandler, bolig og kategori), har muligheden **+ Ny …**. Den åbner en lille formular for posttypen og vælger den nye post bagefter.
- Fotos og kvittering kan vælges, når en genstand oprettes, og fotos, når en bygningsdel, bil eller reservedel oprettes. Filerne importeres og kobles, når posten er gemt. Detaljevisningen viser fotos som miniaturer øverst.

## Visuel stil

Ikoner, farver og små grafer skal *supplere* teksten. De må aldrig være den eneste bærer af information (WCAG 1.4.1).

### Ikoner

- Ikonsættet er `lucide-react`. Ikoner, der står ved siden af tekst, er dekorative (`aria-hidden`). Knapper med kun et ikon SKAL have `aria-label` og tooltip.
- Modulernes ikoner (Lucide-navne):

| Modul | Ikon | Farvetoken |
| --- | --- | --- |
| Overblik | `layout-dashboard` | `--c-overview` |
| Opgaver | `list-checks` | `--c-tasks` |
| Bolig og inventar | `house` | `--c-home` |
| Arbejdsordrer | `wrench` | `--c-maintenance` |
| Bil | `car` | `--c-vehicle` |
| Økonomi | `wallet` | `--c-finance` |
| Madplan | `utensils` | `--c-food` |
| Forsikring | `shield-check` | `--c-insurance` |
| Helbred | `heart-pulse` | `--c-health` |
| Dokumenter | `file-text` | `--c-documents` |
| AI-indbakke | `sparkles` | `--c-ai` |
| Lister | `list-tree` | `--c-lists` |
| Indstillinger | `settings` | `--c-settings` |

- Ikonerne bruges i menuen, i sidehoveder, ved poster i lister og i søgeresultater (modulets ikon) og ved dokumenter (filtypeikon: `file-text` til PDF, `image` til billeder og `mail` til mail).
- Status vises som badge med ikon og tekst. Eksempler: forfalden (`triangle-alert`), i dag (`clock`), udført (`circle-check`), mangler (`circle-help`), privat (`lock`), allergi (`triangle-alert` i farven `--danger`).

### Farver

- Hvert modul har et farvetoken, som bruges til ikonets baggrund i menu og sidehoved og til en tynd kant på modulets kort på overblikket. Der er værdier til både lyst og mørkt tema. Tekst på farvede flader skal have en kontrast på mindst 4,5:1.
- De eksisterende tokens for advarsel, fare og accent bevares.

### Overblik

- Øverst kommer en række **nøgletalskort** før sektion 1: Forfaldne, Næste 30 dage, Udløber snart og Mangler oplysninger. Hvert kort har ikon, antal og tekst og fungerer som et link til sektionen. Den faste rækkefølge af sektioner nedenfor bevares.
- **Økonomi denne måned** viser vandrette søjler for budget og forbrug pr. kategori (rød ved overskridelse, også markeret med tekst) og en lille graf over forbruget de seneste 6 måneder.
- Har ugens madplan retter, vises et lille kort med i dag og i morgen.

### Tomme tilstande

En tom liste viser modulets ikon (stort, nedtonet), én sætning om hvad modulet bruges til og den primære handling som knap, fx "Opret din første genstand".

### Grafer

Egne SVG-komponenter: vandret søjle, sparkline og linjegraf. Hver graf har en tekstlig opsummering (`aria-label` eller synlig tekst) med de vigtigste tal.
