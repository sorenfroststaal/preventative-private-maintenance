---
description: Arbejdsgange med brugerens lokale PPM-husstandsarkiv (kvitteringer, opgaver, madplan, budget). Brug, når brugeren spørger om noget i hjemmet, eller beder om at registrere eller planlægge noget.
---

# PPM-arkivet

Du har adgang til brugerens lokale arkiv via MCP-serveren `ppm`. Du kan kun læse og foreslå. Alle ændringer samles i ét `propose`-kald, og brugeren godkender dem i appen under **AI-indbakke**.

Generelt:

- Start med `overview` eller `search`. Hent kun de felter, du har brug for (`get` med `fields`).
- Poster har en kort `ref` på 8 tegn. Brug den i andre værktøjer.
- Gæt ikke datoer eller beløb. Spørg hellere.
- Helbredsoplysninger er følsomme. Gentag kun det nødvendige.

## Registrér en kvittering

1. Find genstanden med `search` (fx "opvaskemaskine"). Findes den ikke, så foreslå den med `create` på `item`.
2. Ligger kvitteringen som fil i `Overførsler`/`Downloads` eller arkivets `indbakke`, så brug `attach_document` med `file_path`, `target` (ref eller `$1`) og `role: "receipt"`.
3. Ligger den allerede i arkivet, så find den med `inbox` og brug `document` (ref) i stedet for `file_path`.
4. Udfyld `purchase_date` og `purchase_price_minor` (øre) på genstanden, hvis de står på kvitteringen.
5. Kald `propose` én gang med alle operationer og en kort `rationale`. Fortæl brugeren, at forslaget venter i AI-indbakken.

## Lav ugens madplan

1. Kald `meal_plan` (evt. med `week` = mandag) og `recipes` for at se, hvad der findes. Overhold allergi-advarsler.
2. Foreslå retter med `create` på `meal_plan_entry` (`plan_date`, `recipe_id` eller `title`, `servings`).
3. Nye opskrifter oprettes med `create` på `recipe` og `ingredients` som tekstlinjer ("500 g hakket oksekød"). Planlæg dem i samme kald med `recipe_id: "$1"`.
4. Kald `propose` én gang for hele ugen. Brugeren laver indkøbslisten i appen.

## Opgaver og vedligehold

- `tasks` med `status: "overdue"` eller `"upcoming"` viser, hvad der skal gøres.
- Er en opgave udført, så foreslå `complete_task` med opgavens eller forekomstens ref og `completed_date`.
