# Testdata

Alt indhold i mappen er **syntetisk**. Der må aldrig ligge rigtige data her.

- `bank/sparkron-eksempel.csv` er en opdigtet fil i formatet for profilen `sparkron` (kolonnerne Dato, Posteringstekst og Beløb, UTF-8, semikolon og dansk talformat). Den indeholder to identiske rækker, så det kan testes, at løbenummeret i `dedupe_hash` skelner mellem dem.
- `open-planner/v1.json` og `open-planner/v2.json` er syntetiske Open Planner-databaser til tests af import og eksport (spec 05). Version 1 har en relativ billedsti, som ikke kan importeres, ingredienser som liste og som tekst samt en ret uden ingredienser. Version 2 har et indlejret 1×1-PNG, en ændret version af en ret fra version 1 og en ny ret med allergener (rejer, æg og hvedemel).
