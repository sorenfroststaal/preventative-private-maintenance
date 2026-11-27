# Instruktioner til kodeagenter

Filen gælder alle AI-kodeagenter (Claude Code, Codex og andre) og menneskelige bidragydere.

## Før du skriver kode

1. Læs `docs/spec/README.md` og alle filerne i `docs/spec/`. Specifikationen er normativ.
2. Læs `docs/spec/07-faser-og-accept.md`, og find den fase, du arbejder på.
3. Læs `docs/STATUS.md` og `docs/AFVIGELSER.md` på din branch, hvis de findes.

## Branches

- Byg på din egen implementeringsbranch (`claude/app`, `codex/app` …), oprettet fra `main`.
- Ændr ikke `docs/spec/`, `AGENTS.md` eller `CLAUDE.md` på en implementeringsbranch. Er specifikationen uklar eller forkert, så vælg den mest konservative fortolkning. Skriv den i `docs/AFVIGELSER.md` med en henvisning til afsnittet, og foreslå rettelsen i din afsluttende rapport.
- Merge aldrig til `main`, og push aldrig direkte til `main`.

## Under arbejdet

- Arbejd én fase ad gangen og i den rækkefølge, faserne har. Begynd ikke på næste fase, før alle kriterierne i den nuværende er opfyldt, eller afvigelser er dokumenteret.
- Al forretningslogik hører til i `packages/core`. UI og MCP skriver aldrig SQL selv.
- Skemaet i `docs/spec/schema.sql` kopieres uændret til `packages/core/migrations/0001_init.sql`, `docs/spec/schema-0002.sql` kopieres uændret til `0002_meal_plan.sql`, `docs/spec/schema-0003.sql` kopieres uændret til `0003_item_part_documents.sql`, og `docs/spec/schema-0004.sql` kopieres uændret til `0004_pets.sql`. Senere ændringer kræver en ny migration og en ændring af specifikationen på `main`.
- Brug kun syntetiske data. Læg aldrig rigtige kvitteringer, CPR-numre, kontonumre, helbredsoplysninger eller adgangsoplysninger i repositoryet, i tests eller i logs.
- Tilføj ingen netværkskald, ingen telemetri og ingen analyseværktøjer.
- Nye afhængigheder skal være open source med en licens, der er forenelig med MIT. Undgå tunge rammeværker, som ikke er nævnt i specifikationen.
- Brugerfladens tekster er på dansk. Kode, kommentarer og commits er på engelsk (Conventional Commits).

## Definition af færdig (pr. fase)

- `pnpm lint`, `pnpm test` og `pnpm build` er grønne lokalt og i CI.
- Alle **[T]**-kriterier har tests, der fejler, hvis funktionen fjernes.
- `docs/STATUS.md` er opdateret som beskrevet i specifikationen (07).
- `README.md` på branchen beskriver, hvordan appen startes og testes.

## Kommandoer

```
pnpm install
pnpm dev
pnpm test
pnpm lint
pnpm build
pnpm seed -- --archive ./local-data/demo
pnpm mcp  -- --archive ./local-data/demo
```

`local-data/` er ignoreret af git og bruges til lokale testarkiver.
