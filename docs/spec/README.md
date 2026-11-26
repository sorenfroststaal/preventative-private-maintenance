# Specifikation

Specifikationen er **normativ**. Implementeringer (for eksempel branchene `claude/app` og `codex/app`) skal følge den. Hvis en implementering afviger, skal afvigelsen beskrives i `docs/AFVIGELSER.md` på den pågældende branch. Ændringer af selve specifikationen sker kun via en pull request til `main`.

Nøgleordene **SKAL**, **BØR** og **KAN** bruges som i RFC 2119.

| Fil | Indhold |
| --- | --- |
| [01-teknologi-og-struktur.md](01-teknologi-og-struktur.md) | Teknologistak, mappestruktur, kommandoer og konventioner |
| [02-arkiv-og-lagring.md](02-arkiv-og-lagring.md) | Arkivmappe, database, bilag, backup og gendannelse |
| [03-datamodel.md](03-datamodel.md) | Forklaring af datamodellen. Selve skemaet ligger i [schema.sql](schema.sql) og migrationerne [schema-0002.sql](schema-0002.sql) (madplan) [schema-0003.sql](schema-0003.sql) (bilag på reservedele) [schema-0004.sql](schema-0004.sql) (husdyr) [schema-0005.sql](schema-0005.sql) (prioritet på faste udgifter) [schema-0006.sql](schema-0006.sql) (lån, flere bilag og felter) [schema-0007.sql](schema-0007.sql) (udlån og serienumre) [schema-0008.sql](schema-0008.sql) (faste udgifter pr. person) [schema-0009.sql](schema-0009.sql) (ejer af en genstand) [schema-0010.sql](schema-0010.sql) (flere personer pr. post) og [schema-0011.sql](schema-0011.sql) (personer uden for husstanden og gaver) |
| [04-moduler-og-ui.md](04-moduler-og-ui.md) | Skærmbilleder, felter, dashboard, gentagelsesregler, madplan og visuel stil |
| [05-import-og-rapporter.md](05-import-og-rapporter.md) | Import af bilag, bank-CSV, forsikringsrapport og eksport |
| [06-ai-mcp.md](06-ai-mcp.md) | MCP-server, værktøjer, adgangsstyring og kladder |
| [07-faser-og-accept.md](07-faser-og-accept.md) | Faser og acceptkriterier, som kan testes |
| [08-mobil.md](08-mobil.md) | Mobiladgang fra iPhone på det lokale netværk: server, HTTPS med egen CA, parring og mobilappens indhold |

## Fælles konventioner

- **Sprog:** brugerfladen og dokumentationen er på dansk. Kode, identifikatorer, commitbeskeder og kodekommentarer er på engelsk.
- **Datoer:** heldagsdatoer gemmes som `YYYY-MM-DD`. Tidspunkter gemmes som ISO 8601 i UTC (`2026-11-24T18:10:00Z`). I brugerfladen vises datoer som `24.11.2026`, og tidspunkter vises i lokal tid (Europe/Copenhagen).
- **Beløb:** gemmes som heltal i mindste enhed (`*_minor`, øre) med en valutakode (`DKK` som standard). Brug aldrig kommatal til penge. Beløb vises som `1.234,50 kr.`
- **Id'er:** UUID v4 som tekst (`crypto.randomUUID()`).
- **Sletning:** primære poster arkiveres (`archived_at`) i stedet for at blive slettet. Det er kun koblinger, kladder og madplanens underrækker (`recipe_ingredient`, `meal_plan_entry` og `shopping_item`, som ikke har `archived_at`), der slettes fysisk. Sletningen auditeres som for koblinger.
- **Testdata:** kun syntetiske data i `fixtures/`. Brug aldrig rigtige personer, CPR-numre eller kontonumre.
