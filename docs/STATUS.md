# Implementeringsstatus på codex/app

## Fase 1 · Fundament

| Kriterium | Status | Resultat |
| --- | --- | --- |
| 1 | Delvist | Workspace, lokale kommandoer og CI-konfiguration. MCP er udestående. Windows-installer og native dev-flow afventer verificering. Se A1 og A2. |
| 2 | Opfyldt | Oprettelse og genåbning af arkiv, manifest, mapper og migration. Automatiseret test. |
| 3 | Opfyldt | Migration 0001 er en byteidentisk kopi af skemaet. Gentagen kørsel ændrer intet. En fejl ruller migrationen tilbage. Automatiserede tests. |
| 4 | Opfyldt | En aktiv PID afviser en ny skriver. Fjernelse af en forældet lås kræver bekræftelse. Automatiserede tests. |
| 5 | Implementeret, delvist verificeret | Bruger og person kan oprettes. Genåbning husker seneste bruger. PBKDF2-PIN og adminrettigheder er testet i core. Native brugerflow afventer manuel test. |
| 6 | Implementeret, delvist verificeret | Hash-lagring og dubletter er dækket af automatiseret test. Tauri træk og slip og filvælger afventer manuel test. Se A6. |
| 7 | Opfyldt | Faste og intervalbaserede gentagelser, klemning og spring over. Automatiserede tests. |
| 8 | Delvist | Audit og FTS er dækket for oprettelse af opgaver og dokumenter. Kolonner og søgbare typer følger schema.sql og 03. Se A4. |
| 9 | Opfyldt i core | Backup med tre bilag gendannes. Testen sammenligner dokumentrækker og bytes og bekræfter, at et beskadiget bilag afvises uden at ændre målet. Native brugerflow afventer manuel test. |
| 10 | Opfyldt | `pnpm seed -- --archive <sti>` opretter et syntetisk demoarkiv med eksempler fra alle moduler. Kommandoen er afprøvet lokalt. |

- **Afvigelser** fremgår af [AFVIGELSER.md](AFVIGELSER.md).
- **Lokalt, Linux med Node 24**. `pnpm lint` bestået. `pnpm test` bestået med 16 tests. `pnpm build` bestået for frontend og den pakkede arkivproces. Arkivprocessen er afprøvet over stdio med et syntetisk arkiv.
- **Installerstørrelse** er ikke målt. Linux-miljøet har ingen Rust/Tauri Windows-værktøjskæde. CI er sat op til at bygge og rapportere NSIS-filens størrelse.
- **Opstartstid** er ikke målt. Målingen kræver en kørbar Windows-installer og en almindelig opstart fra installeret app til første interaktive vindue.

## Fase 2 og 3

Afventer verifikation af fundamentet på Windows. Kriterierne 1–12 i fase 2 og 1–9 i fase 3 er åbne.
