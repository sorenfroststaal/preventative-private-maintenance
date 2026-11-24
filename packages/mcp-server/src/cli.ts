#!/usr/bin/env node
// The MCP server is implemented in phase 3 (docs/spec/07-faser-og-accept.md).
// Until then this entry point only reports its status so `pnpm mcp` exists.
import { APP_SCHEMA_VERSION } from "@ppm/core";

process.stderr.write(
  `ppm-mcp: MCP-serveren bygges i fase 3. Arkivformat understøttet: schemaVersion ${APP_SCHEMA_VERSION}.\n`,
);
process.exit(2);
