# Afvigelser

| Ref. | Specifikation | Fortolkning eller afvigelse |
| --- | --- | --- |
| A1 | 01, Stak, database-adapter og kommandoer | Desktop bruger React/TypeScript i Tauri og en lokal Node-proces over stdin/stdout. Processen genbruger core og better-sqlite3, så alle operationer i en transaktion kører på én forbindelse. Tauri SQL- og fs-plugin, React Router og TanStack Query er ikke taget i brug. Windows-bundlen er konfigureret til at medtage Node 24 og SQLite-biblioteket. Lokal dev kræver Node 24 med de fastlåste værktøjsversioner. |
| A2 | 01, Kommandoer og CI. 07, fase 1 nr. 1 | `pnpm build` bygger frontend og arkivproces på Linux. Windows-kørslen fortsætter med `tauri build` og NSIS. MCP-kommandoen hører til fase 3 og er endnu ikke aktiveret. Windows-builden er verificeret i CI. Installation, native brugerforløb og opstartstid er ikke afprøvet på en Windows-computer. |
| A3 | 02, Regler | En database fra en nyere version åbnes med SQLite i skrivebeskyttet tilstand. Brugerfladen viser versionsadvarslen og afventer en opdatering, før den læser tabeller fra det nyere skema. |
| A4 | 03, Fælles regler for skrivning. 07, fase 1 nr. 8 | Audit og søgeindeks opdateres i samme transaktion for de implementerede søgbare typer. Logins, personer, indstillinger og opgaveforekomster auditeres ved oprettelse eller ændring af deres poster, mens kun typer med søgefelter iht. 03 indekseres. Tidsstempler gemmes på de kolonner, som schema.sql definerer. PIN-hash udelades af auditloggen. |
| A5 | 04, Opgaver og gentagelse | For månedlige og årlige faste mønstre vælges først en matchende dato senere i den aktuelle periode. Hvis ingen findes, rykkes `every` perioder frem. En gentagen opgave kræver en første forfaldsdato. Faste daglige og ugentlige regler regnes fra den foregående forfaldsdato. |
| A6 | 05, Import af dokumenter. 07, fase 1 nr. 6 | Fundamentet gemmer bilag med hash og genbruger dubletter. Tekstudtræk, tilknytningsdialog, forhåndsvisning og overvåget indbakke er udestående. |
| A7 | 01, Tilladelser, og 02, Backup | Arkivprocessen har brugerens filrettigheder. Kald går gennem en liste over understøttede lokale handlinger, og brugerfladen vælger arkiv-, bilags- og backupstier i native dialoger. Der er ingen separat OS-sandbox omkring arkivprocessen. Backup og gendannelse håndterer zip i hukommelsen. Store arkiver er ikke belastningstestet. |

## Forslag til præcisering på main

- Angiv under fase 1 nr. 1, hvornår MCP-kommandoen skal være tilgængelig. Den overlapper fase 3 nr. 1.
- Afgræns audit, søgeindeks og tidsstempler pr. tabel. 03 beskriver en generel pligt, mens flere tabeller mangler `updated_at` eller en definition af søgefelter.
- Angiv en målemetode for opstartstid, og definér, hvordan en første forfaldsdato uden for et fast mønster påvirker `every > 1`.
