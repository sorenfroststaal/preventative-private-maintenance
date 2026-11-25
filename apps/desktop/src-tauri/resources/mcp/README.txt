ppm-mcp – MCP-server til PPM (lokal AI-adgang til arkivet)

Mappen indeholder:
  ppm-mcp(.exe)        selvstændig binær (Node.js Single Executable Application)
  better_sqlite3.node  SQLite-modulet, som binæren indlæser
  ppm.mcpb             MCP Bundle til Claude Desktop

Brug: ppm-mcp [--archive <sti>]. Uden --archive læses arkivstien fra appens config.json.
Opsætning til Claude Desktop, Claude Code og Codex: se Indstillinger → AI-adgang i appen.

Tredjepart: binæren indeholder Node.js (MIT-licens, https://nodejs.org/en/about/previous-releases)
og better-sqlite3 (MIT). Licenserne følger de respektive projekter.
