# 02 Arkiv og lagring

## Appens konfiguration

`%APPDATA%\ppm\config.json` (på andre styresystemer bruges Tauris `appConfigDir`):

```json
{ "archivePath": "C:\\Users\\…\\Documents\\PPM-arkiv", "lastUserId": "…" }
```

Første gang appen starter, vælger brugeren at **oprette et nyt arkiv** eller **åbne et eksisterende**.

## Arkivmappe

```
<arkiv>/
  manifest.json
  arkiv.sqlite
  bilag/<sha[0:2]>/<sha256>.<ext>
  indbakke/                 overvåget mappe til import
  indbakke/importeret/      filer, der er importeret, flyttes hertil
  indbakke/ai/              filer, som MCP-serveren har lagt ind og som afventer godkendelse
  eksport/                  rapporter og eksport (standardplacering)
  .lock                     instanslås
```

`manifest.json`:

```json
{
  "format": "ppm-archive",
  "formatVersion": 1,
  "schemaVersion": 1,
  "createdAt": "2026-11-24T18:10:00Z",
  "appVersion": "0.1.0"
}
```

## Regler

- SQLite SKAL åbnes med `journal_mode=WAL`, `foreign_keys=ON` og `busy_timeout=5000`.
- Når appen starter, køres migrationer i én transaktion. `schemaVersion` i manifestet opdateres, når den er gennemført. Er databasens version nyere end appens, åbner appen arkivet skrivebeskyttet og viser en advarsel.
- **Lås:** appen opretter `.lock` atomisk (opret kun, hvis filen ikke findes) med `{ "pid", "hostname", "at" }`. Findes der en lås fra en proces, som stadig kører, nægter appen at åbne arkivet for skrivning. En lås er forældet, hvis den har samme hostname, og processen ikke længere kører. En lås fra en anden maskine betragtes aldrig som forældet. En forældet lås kan fjernes, efter brugeren har bekræftet det. Når appen afsluttes normalt (også når vinduet lukkes), SKAL den fjerne sin egen lås. MCP-serveren tager ingen lås.
- **Bilag:** gemmes med SHA-256 af indholdet som navn. Importeres en fil, der allerede findes, genbruges den eksisterende `document`-række. Bilagsfiler ændres aldrig, når de først er skrevet.
- Hvis arkivstien ligger under OneDrive, Dropbox, Google Drive eller iCloud Drive (genkendt på stinavnet og miljøvariablen `OneDrive`), SKAL appen advare om, at data synkroniseres til skyen.

## Backup

Backup skrives som en zip-fil `ppm-backup-YYYYMMDD-HHMM.zip` med:

- `arkiv.sqlite`, lavet som snapshot via `VACUUM INTO` (aldrig en direkte kopi af en åben fil)
- `bilag/**`
- `manifest.json`, udvidet med `"files": [{ "path": "...", "sha256": "...", "size": 123 }]`.

Indbakken kommer ikke med i backuppen.

Backup og gendannelse SKAL streame filerne. Hukommelsesforbruget må ikke vokse med arkivets størrelse, så hele zip-filen eller alle bilag må aldrig holdes i hukommelsen på én gang. `backup.last_at` skrives, efter snapshottet er taget.

## Gendannelse

1. Pak ud til en midlertidig mappe ved siden af målet.
2. Kontrollér alle checksummer i manifestet, og kør `PRAGMA integrity_check`.
3. Hvis alt er i orden: omdøb målmappen til `<mål>.old-<tidsstempel>`, og omdøb den midlertidige mappe til målet.
4. Fejler noget, er målmappen uændret, og brugeren får vist præcis hvilke filer der fejlede.

Er målet en tom mappe, fjernes den i stedet for at blive flyttet til `.old-*`. Har målet en lås, som ikke er forældet, afvises gendannelsen. Zip-navne med `..`, absolutte stier, drevbogstaver eller `\` afvises (zip slip).

Appen påminder om backup, hvis der er gået mere end 30 dage siden sidste backup (gemt i `setting`).
