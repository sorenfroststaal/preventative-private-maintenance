# Afvigelser og fortolkninger (branch `Cherry`)

Listen dækker de steder, hvor implementeringen afviger fra specifikationen eller vælger en fortolkning, som specifikationen ikke selv fastlægger. Forslag til rettelser af specifikationen står til sidst.

## Afvigelser

| # | Spec | Afvigelse | Begrundelse |
| --- | --- | --- | --- |
| A1 | 01 Stak: `@tauri-apps/plugin-sql` | Database-adgangen i appen går gennem egne Rust-kommandoer bygget på `rusqlite` (bundled SQLite med FTS5). Der er ét connection pr. handle. | plugin-sql bruger en connection-pool. Så er `BEGIN` og `COMMIT` over flere IPC-kald ikke garanteret at ramme samme forbindelse, og transaktionerne i core ville ikke være pålidelige. Med egne kommandoer kan `ATTACH` også spærres (`SQLITE_LIMIT_ATTACHED = 0`), og `VACUUM INTO` begrænses til arkivmappen. |
| A2 | 01 Stak: `@tauri-apps/plugin-fs` | Filadgang går gennem egne Rust-kommandoer med et scope, som kun kan udvides fra Rust-siden: mapper valgt i en dialog, filer valgt eller sluppet i vinduet og stien fra config ved opstart. | Følger kravet i 01 om "tilladelser så snævert som muligt" mere præcist end en dynamisk fs-plugin-scope. Webviewet har kun `core:default`. Dialog-pluginet kaldes kun fra Rust. |
| A3 | 01 `DbAdapter` | Interfacet har også `executeScript(sql)`. | Migrationer indeholder flere sætninger. Interfacet i spec er et minimum. |
| A4 | 01 Kommandoer: `pnpm mcp` | Kommandoen findes, men skriver en status og afslutter med kode 2 indtil fase 3. | MCP-serveren hører til fase 3. |
| A5 | 01 Første platform: Windows | `bundle.targets` er `["nsis", "deb"]`, så `pnpm build` også giver en pakke på Linux (bruges i udvikling og i CI). Windows-installeren bygges i CI på `windows-latest`. | Gør det muligt at verificere builden uden Windows. |

## Fortolkninger

| # | Spec | Fortolkning |
| --- | --- | --- |
| F1 | 04 Gentagelse, fixed | Ligger den forrige forfaldsdato på mønsteret, flyttes den `every` perioder frem, og mønsterets dag bruges igen. Det betyder, at månedsenden klemmes hver gang (31 → 28.02 → 31.03). Ligger den forrige forfaldsdato uden for mønsteret, bruges første dato *efter* den, som passer. Ved `day` og `week` regnes der fra den forrige forfaldsdato. Mangler forfaldsdatoen, bruges udførelsesdatoen som base. |
| F2 | 04 Gentagelse, interval | Springes der over, og mangler forfaldsdatoen, regnes der fra datoen for overspringet. |
| F3 | 04 / projektbeskrivelse "gæt ikke datoer" | En ny opgave uden dato får ved `fixed` (år og måned) den første dato på mønsteret samme dag eller senere, fordi mønsteret selv definerer datoen. Ved `interval` og engangsopgaver markeres datoen som manglende. |
| F4 | 02 Lås | Låsefilen indeholder også `hostname`. En lås fra en anden maskine betragtes aldrig som forældet. Når appen afsluttes normalt, fjerner Rust låsen, men kun hvis PID og hostname er appens egne. |
| F5 | 02 Gendannelse | Er målmappen en tom mappe (fx nyoprettet i dialogen), fjernes den i stedet for at blive flyttet til `.old-*`. En åben (ikke forældet) lås på målet afviser gendannelsen. |
| F6 | 02 Backup | `backup.last_at` skrives efter snapshot. Backuppen indeholder derfor tidspunktet for den forrige backup. |
| F7 | 03 Søgeindeks | Arkiverede poster fjernes fra `search_index` og indsættes igen ved gendannelse. Søgeord matches som præfiks (`"ord"*`). |
| F8 | schema `app_user.pin_hash` | PIN skal være 4–8 cifre. PBKDF2-SHA256 med 600.000 iterationer (OWASP 2023). Ved login afvises hashes med over 2.000.000 iterationer, så en manipuleret værdi ikke kan låse login-skærmen. Eksisterende hashes med 210.000 iterationer virker stadig, fordi antallet står i selve hashen. |
| F9 | 04 Opstart | Er den valgte mappe til et nyt arkiv ikke tom, oprettes undermappen `PPM-arkiv` i den i stedet for at afvise valget. Appen advarer også om skymapper, når arkivet oprettes. |
| F10 | 05 Import trin 3 | Tekstudtræk fra PDF og mail kommer i fase 2. I fase 1 gemmes, hashes og dubletkontrolleres filerne, og titlen sættes. Filen kopieres først til `*.part` og verificeres, før den får sit endelige navn. |
| F11 | 02 Konfiguration | På Linux og macOS ligger `config.json` i `<OS config dir>/ppm/` (fx `~/.config/ppm`). |
| F12 | 03 audit_log `diff_json` | `pin_hash` skrives aldrig i auditloggen. Der står kun `"[skjult]"` (eller `null`), så det kan ses, at PIN er sat, ændret eller fjernet. Ideen kommer fra `codex/app`. |
| F13 | 04 Opstart og brugere, punkt 3 | Reglen "admin opretter brugere og personer" håndhæves i core (`createUser` og `createPerson`), ikke kun i UI. Den første bruger i et tomt arkiv bliver altid admin. Ideen kommer fra `codex/app`. |
| F14 | 02 Regler, skrivebeskyttet åbning | Er databasen nyere end appen, sættes `PRAGMA query_only = ON`, så SQLite selv afviser skrivninger. Manifestet ændres ikke. Det er et ekstra lag og ingen sikkerhedsgrænse. |
| F15 | 02 Backup og gendannelse | Backup afvises, hvis et bilags indhold ikke længere passer med dets hash-navn. Ved gendannelse afvises filer, der ikke står i manifestet, stier, der hverken er `arkiv.sqlite` eller `bilag/<xx>/<sha256>.<ext>`, dubletter i manifestet og `document`-rækker uden en bilagsfil i backuppen. Ideen kommer fra `codex/app`. |

## Forslag til rettelser af specifikationen

1. Spec 01: Erstat `@tauri-apps/plugin-sql` og `plugin-fs` med "egne snævre Tauri-kommandoer (eller tilsvarende) med én forbindelse og et scope, der kun kan udvides fra Rust". Begrundelsen er A1/A2.
2. Spec 01: Tilføj `executeScript` til `DbAdapter`.
3. Spec 04: Præcisér F1–F3 (forfaldsdato uden for mønsteret, spring over uden dato og første dato ved fast mønster).
4. Spec 02: Nævn, at låsen fjernes ved normal afslutning, og at hostname indgår i låsen.
5. Spec 07, fase 1 punkt 1: Angiv, at `pnpm mcp` først skal virke i fase 3. Forslaget kommer fra `codex/app`.
6. Spec 03: Afgræns pr. tabel, hvilke felter der indekseres i `search_index`, og hvilke felter der aldrig må stå i `audit_log` (fx `pin_hash`). Forslaget kommer fra `codex/app`.
7. Spec 07: Angiv en målemetode for opstartstid. Forslaget kommer fra `codex/app`.
