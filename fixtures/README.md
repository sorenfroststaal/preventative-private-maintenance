# Testdata

Alt indhold i mappen er **syntetisk**. Der må aldrig ligge rigtige data her.

- `bank/sparkron-eksempel.csv` er en opdigtet fil i det format, profilen `sparkron` forventes at kunne læse (UTF-8, semikolon, dansk talformat). Den indeholder to identiske rækker, så det kan testes, at løbenummeret i `dedupe_hash` skelner mellem dem. Formatet skal verificeres mod en anonymiseret eksport fra rigtig netbank (se docs/spec/05).
