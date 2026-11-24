# Afvigelser og fortolkninger (branch `claude/app`)

Listen dækker de steder, hvor implementeringen afviger fra specifikationen eller vælger en fortolkning, som specifikationen ikke selv fastlægger. Efter PR #2 er flere tidligere afvigelser blevet en del af specifikationen. Dem er fjernet herfra (se nederst).

## Afvigelser

| # | Spec | Afvigelse | Begrundelse |
| --- | --- | --- | --- |
| A1 | 01 Første platform: Windows | `bundle.targets` er `["nsis", "deb"]`, så `pnpm build` også giver en pakke på Linux (bruges i udvikling og i CI). Windows-installeren bygges i CI på `windows-latest`. | Gør det muligt at verificere builden uden Windows. |
| A2 | 05 Overvåget indbakke | Indbakken scannes hvert 2. sekund (polling) i stedet for at bruge filsystem-events. | Virker ens på alle platforme og netværksdrev. Kravet om 2 sekunders stabil størrelse kræver alligevel en gentagen kontrol. |

## Fortolkninger

| # | Spec | Fortolkning |
| --- | --- | --- |
| F1 | schema `app_user.pin_hash` | PIN skal være 4–8 cifre. PBKDF2-SHA256 med 210.000 iterationer. |
| F2 | 04 Opstart | Er den valgte mappe til et nyt arkiv ikke tom, oprettes undermappen `PPM-arkiv` i den. Appen advarer om skymapper, når arkivet oprettes. |
| F3 | 02 Konfiguration | På Linux og macOS ligger `config.json` i `<OS config dir>/ppm/`. |
| F4 | 04 Overblik 1–3 | Automatiske opgaver (`source = 'system'`) vises kun under "Udløber snart" og ikke også under "Forfaldne" og "Næste 30 dage", så de ikke står to gange. "Udløber snart" viser frister fra 30 dage tilbage til 60 dage frem. Ældre udløbne frister, fx en reklamationsret fra 2024, kan man ikke længere handle på, og de skjules. |
| F5 | 04 Overblik og 03 privat helbred | Helbredsopgaver for en person, hvis helbredsdata er private for en anden bruger, vises ikke på den anden brugers overblik. |
| F6 | 04 Overblik 4 | "Pris, men ingen kvittering" betyder, at der ikke er et dokument med rollen `receipt` koblet til genstanden. |
| F7 | 05 Import trin 3 | Tekst udtrækkes fra højst 50 sider og gemmes med højst 200.000 tegn. Der laves intet tekstudtræk fra `.msg`, som specifikationen tillader. En beskadiget PDF importeres uden tekst. |
| F8 | 04 Dokumenter | Forhåndsvisningen viser de første 5 sider af en PDF. Mails vises kun som den udtrukne rene tekst. |
| F9 | 05 Eksport, CSV | Skilletegnet er semikolon, og filen gemmes i UTF-8 med BOM, så den åbner korrekt i dansk Excel. FTS-tabellerne kommer ikke med i eksporten. |
| F10 | 05 ICS | Begivenhederne markeres `TRANSP:TRANSPARENT` (de blokerer ikke tid i kalenderen). Kun opgaver med en åben forekomst med dato kommer med. |
| F11 | 04 Økonomi, lærte regler | Det foreslåede mønster er de to første ord i posteringsteksten uden tal til sidst. Brugeren kan rette det, før reglen gemmes. |
| F12 | 04 Bil | Driftsomkostningerne tæller ikke annullerede arbejdsordrer med. Posteringer koblet til bilen regnes som udgift med omvendt fortegn. |
| F13 | 03 Afledte regler | Automatiske opgaver får `reminder_days = 60`. Er en automatisk opgave markeret som udført, og ændres datoen bagefter, oprettes en ny åben forekomst. |
| F14 | 07 nr. 15 | Hukommelsesforbruget måles både ad Rust-vejen, som appen bruger (zip og udpakning), og gennem core i Node (backup og gendannelse). Se `docs/STATUS.md`. |

## Fjernet efter PR #2 (nu en del af specifikationen)

Egne Rust-kommandoer i stedet for plugin-sql og plugin-fs, `executeScript` i `DbAdapter`, `pnpm mcp` før fase 3, gentagelsesreglerne, låsens format og frigivelse, at en tom målmappe fjernes ved gendannelse, `backup.last_at` efter snapshot, søgeindekset ved arkivering, og at `pin_hash` aldrig står i auditloggen.

## Forslag til præciseringer af specifikationen

1. Spec 04 Overblik: angiv, om automatiske opgaver også skal stå i sektion 1–2, og hvor langt tilbage udløbne frister skal vises (se F4).
2. Spec 05: tillad polling som alternativ til filsystem-events for indbakken (A2).
3. Spec 05 CSV-eksport: fastlæg skilletegn og kodning (F9).
