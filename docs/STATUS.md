# Status (branch `Cherry`)

Opdateret: 24.11.2026. Aktuel fase: **Fase 1 – Fundament er færdig**, bortset fra punkterne under "Ikke verificeret".

## Oprindelse

`Cherry` er en sammenfletning af de to implementeringer af fase 1.

**Grundlag: `claude/app`.** Den er klart mest komplet: 62 tests mod 16, snævre Rust-kommandoer med scope i stedet for en indbygget Node-proces, en installer på ca. 2,4 MB mod 25,4 MB, fuld UI til fase 1 og E2E-verifikation. Arkitekturen fra `codex/app` (Node-proces via stdio, samt A1 og A7 der) blev fravalgt, fordi den kræver Node i installeren og giver webviewet brugerens fulde filrettigheder.

**Hentet fra `codex/app`:**

| Idé fra `codex/app` | Hvor i `Cherry` | Test |
| --- | --- | --- |
| PIN-hash udelades af `audit_log` | `repo/entities.ts` (`redact`) | `repo.test.ts`: "never writes the PIN hash to audit_log" |
| Kun admin opretter brugere og personer, håndhævet i core | `repo/users.ts` (`assertAdminOrFirstUser`, `createPerson`). UI og seed bruger dem. | `repo.test.ts`: "makes the first user admin …" |
| En nyere database åbnes skrivebeskyttet *i SQLite* | `archive/archive.ts` (`PRAGMA query_only`) | `archive.test.ts`: "opens a newer database read-only" |
| Bilagets hash kontrolleres, før det kommer med i backuppen | `backup/backup.ts` (`BackupError`) | `backup.test.ts`: "refuses to back up an attachment …" |
| Gendannelse: tilladte stier, filer uden for manifestet og manglende bilag for `document`-rækker | `backup/backup.ts` (`verifyBackup`) | `backup.test.ts`: "rejects files that are not listed …" |
| PBKDF2 med 600.000 iterationer og en øvre grænse ved verificering | `repo/users.ts` | Dækket af de eksisterende login-tests |
| En anden migreringskørsel skriver 0 rækker (`total_changes()`) | – | `archive.test.ts` |
| Testcase: fast månedlig, forfald før mønsterdagen | – | `recurrence.test.ts` |
| Forslag til rettelser af spec (MCP i fase 1, audit pr. tabel, målemetode for opstart) | `docs/AFVIGELSER.md` 5–7 | – |

Jeg har kontrolleret, at hver ny test fejler, når den tilhørende ændring i `src/` fjernes.

## Fase 1: kriterier

| # | Kriterium | Status | Bemærkning |
| --- | --- | --- | --- |
| 1 | Monorepo og kommandoer | Opfyldt | `pnpm install/lint/test/build/seed` er kørt og grønne, også i CI (Ubuntu og Windows). `pnpm mcp` er en stub indtil fase 3 (AFVIGELSER A4). `pnpm dev` er ikke kørt interaktivt i containeren. |
| 2 | Opret og åbn arkiv **[T]** | Opfyldt | `archive.test.ts` |
| 3 | Migrationer er idempotente **[T]** | Opfyldt | Også test af rollback og skrivebeskyttet åbning af en nyere database. Lint tjekker, at `0001_init.sql` er identisk med `docs/spec/schema.sql`. |
| 4 | Instanslås **[T]** | Opfyldt | Låst, forældet, frigivelse og "fjern kun forældet". Rust frigiver låsen ved normal afslutning (verificeret manuelt). |
| 5 | Brugere, personer, brugervalg og PIN | Opfyldt | Core-tests (også admin-reglen og auditlog uden PIN-hash) og E2E i den rigtige app fra `claude/app` (forkert PIN afvises, login virker). |
| 6 | Dokumentimport, hash og dubletter **[T]** | Opfyldt | `repo.test.ts`. Træk og slip i appen går via et Rust-event. Selve slip-handlingen er ikke automatiseret. |
| 7 | Gentagelse **[T]** | Opfyldt | De tre testcases fra specifikationen og 10 ekstra. Fortolkninger i AFVIGELSER F1–F3. |
| 8 | audit_log og search_index **[T]** | Opfyldt | Create, update, archive og restore, rollback ved fejl samt sletning af links. |
| 9 | Backup og gendannelse **[T]** | Opfyldt | Round-trip med 3 bilag, beskadiget bilag, beskadiget database, zip slip, åbent arkiv, beskadiget kildebilag, filer uden for manifestet og manglende bilag. `VACUUM INTO` og zip via Rust er testet i Rust og i E2E. |
| 10 | `pnpm seed` | Opfyldt | Syntetiske data i alle moduler. CI kører et røgtest. |

## Tests

| Suite | Antal | Resultat |
| --- | --- | --- |
| core (Vitest) | 56 | Grøn |
| desktop (Vitest, jsdom) | 5 | Grøn |
| Rust (`cargo test`) | 5 | Grøn |
| **I alt** | **66** | **Grøn** |

Desuden er `cargo clippy -D warnings`, `cargo fmt --check`, ESLint og `tsc -b` rene.

### Manuel E2E (den rigtige app, tauri-driver og WebKitWebDriver i Xvfb, kørt på `claude/app`)

Ændringerne på `Cherry` ligger i core og er dækket af automatiske tests. E2E er ikke kørt igen.

- Login: forkert PIN afvises, korrekt bruger logges ind.
- Overblik: viser forfaldne opgaver, næste 30 dage og opgaver, der mangler dato, ud fra seed-arkivet.
- Opgaver: en ny opgave med interval på 2 måneder udføres 24.11.2026, og næste forfaldsdato bliver 24.01.2027. Historikken vises.
- Dokumenter og indstillinger vises med seed-data.
- Rust-scope gennem rigtig IPC:
  - Tilladt: læsning og skrivning i arkivet, `VACUUM INTO` i arkivet, zip og sha256.
  - Afvist: læsning uden for scope, `../`-traversal, `VACUUM INTO` uden for scope, `ATTACH`, at åbne en database uden for scope, sletning af rodmappen og at skrive config med en arkivsti, der ikke er valgt.
- En forældet lås efter et nedbrud viser skærmen "Arkivet er låst" med knappen "Fjern låsen og åbn".
- Lukkes vinduet normalt, fjernes `.lock`.

Fundne og rettede fejl under E2E: `ATTACH`-spærren blokerede `VACUUM INTO` (backup). Låsen blev ikke frigivet ved normal lukning. Feltet "Udskyd" beholdt datoen fra den forrige opgave.

## Målinger

| Måling | Værdi | Note |
| --- | --- | --- |
| Installer, Linux (.deb) | 2,7 MB | Release-build med LTO |
| Binær (Linux) | 6,2 MB | |
| Installer, Windows (NSIS) | ca. 2,4 MB | Bygget af CI-jobbet `build-windows` på windows-latest (artefakt `ppm-windows-installer`, zip-størrelse 2.384.009 byte) |
| Opstartstid til login-skærm | ca. 0,95 s | Median af 3, release-build, Linux i Xvfb uden GPU |

## Ikke verificeret

- Windows-installeren bygges grønt i CI, men den er ikke installeret og startet på en rigtig Windows-maskine.
- De native dialoger (opret og åbn arkiv, vælg backupmappe og -fil) lod sig ikke automatisere i Xvfb. De kalder samme kode, som er testet på andre måder.
- Gendannelse via brugerfladen er kun testet i core og ikke klikket igennem i appen.
