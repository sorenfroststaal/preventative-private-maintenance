# 04 Moduler og brugerflade

## Opstart og brugere

1. Første opstart: velkomst, opret eller åbn et arkiv, opret den første bruger (admin) og dens person.
2. Senere opstarter: vælg bruger (med PIN, hvis der er en). Den sidst valgte bruger er forvalgt.
3. Admin kan oprette brugere og personer under Indstillinger.

## Navigation

En venstremenu med disse punkter i denne rækkefølge: **Overblik, Opgaver, Bolig og inventar, Arbejdsordrer, Bil, Økonomi, Forsikring, Helbred, Dokumenter, AI-indbakke (med antal), Indstillinger.**

Global søgning åbnes med `Ctrl+K`. Den søger i `search_index` og viser resultater grupperet pr. modul. Hele appen SKAL kunne betjenes med tastatur og have synlig fokus.

Hver modulskærm består af en liste (med søgefelt, filtre og sortering) og en detaljevisning med fanerne *Oplysninger, Historik, Bilag og Opgaver*, hvor fanen giver mening. Alle formularer validerer med Zod og viser fejl på dansk ved feltet.

## Overblik (dashboard)

Rækkefølgen er fast:

1. **Forfaldne:** åbne forekomster med `due_date < i dag`.
2. **Næste 30 dage:** åbne forekomster inden for `dashboard.horizon_days`.
3. **Udløber snart:** de automatiske opgaver (garanti, reklamationsret, police, binding og recept) inden for 60 dage, uanset `reminder_days`.
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
- **Faste udgifter:** liste med den beregnede månedlige gennemsnitsudgift og summen pr. måned.
- Standardkategorier (seed): Bolig, Forsyning, Mad og dagligvarer, Transport, Forsikring, Børn, Sundhed, Fritid, Abonnementer, Opsparing, Indtægt, Overførsel, Andet.

## Forsikring

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
