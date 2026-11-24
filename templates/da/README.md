# Opgaveskabeloner (dansk)

Hver fil er et JSON-array med skabeloner i dette format:

```json
{
  "id": "home.gutters.clean",
  "version": 1,
  "title": "Rens tagrender",
  "description": "Fjern blade og skidt, og kontrollér nedløb.",
  "module": "maintenance",
  "applies_to": "property",
  "recurrence": { "kind": "fixed", "unit": "year", "every": 1, "month": 11, "day": 1 },
  "basis": "suggestion",
  "source": null
}
```

- `applies_to`: `property`, `building_part`, `item`, `vehicle` eller `person`. Den bestemmer, hvor forslaget vises.
- `basis` angiver, hvad skabelonen bygger på:
  - `suggestion` er et praktisk forslag, som brugeren selv justerer.
  - `recommendation` er en anbefaling fra en anerkendt kilde, og `source` er påkrævet.
  - `requirement` er et krav fastsat af en myndighed. Her er `source` påkrævet med `url`, `scope` og `checked_date`.
- Når en skabelon bruges, gemmes `template_id` og `template_version` på opgaven. En ny version af skabelonen overskriver aldrig opgaver, der allerede findes. Brugeren får en ændring tilbudt.
- Skabeloner med `basis` sat til `recommendation` eller `requirement` kræver kildekontrol (se CONTRIBUTING.md).

Skabelonerne i `basis.json` er alle `suggestion`. De er praktiske standardintervaller og påstår ingen lovkrav.
