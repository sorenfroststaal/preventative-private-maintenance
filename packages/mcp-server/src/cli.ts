#!/usr/bin/env node
/**
 * ppm-mcp: MCP server over stdio (spec 06).
 *   ppm-mcp [--archive <sti>]   Without --archive the path is read from the app's config.json.
 *   ppm-mcp --version
 *   ppm-mcp serve [--archive <sti>] [--port 4730] [--static <mappe>] [--tls-dir <mappe>]
 *     Mobile web app on the local network (iPhone). Prints one JSON line with addresses when ready.
 * Nothing but MCP messages is written to stdout; messages for humans go to stderr.
 */
import { existsSync, promises as fsp, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { APP_SCHEMA_VERSION, openArchiveForAi } from "@ppm/core";
import { nodeEnv, setSqliteNativeBinding } from "@ppm/core/node";
import { createPpmServer, SERVER_VERSION } from "./server";

/** The app's config.json (spec 02): %APPDATA%\ppm on Windows, the OS config dir elsewhere. */
export function appConfigPath(): string {
  if (process.platform === "win32") return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "ppm", "config.json");
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "ppm", "config.json");
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "ppm", "config.json");
}

function fail(msg: string, code = 1): never {
  process.stderr.write(`ppm-mcp: ${msg}\n`);
  process.exit(code);
}

/** In the self-contained binary (Node SEA) the SQLite addon lies next to the executable. */
async function loadSeaAddon(): Promise<void> {
  let sea = false;
  try {
    sea = (await import("node:sea")).isSea();
  } catch {
    return;
  }
  if (!sea) return;
  const addon = join(dirname(process.execPath), "better_sqlite3.node");
  if (!existsSync(addon)) fail(`better_sqlite3.node mangler ved siden af ${process.execPath}.`);
  const mod = { exports: {} as object };
  process.dlopen(mod as never, addon);
  setSqliteNativeBinding(mod.exports);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--version") || argv.includes("-v")) {
    process.stdout.write(`ppm-mcp ${SERVER_VERSION} (schemaVersion ${APP_SCHEMA_VERSION})\n`);
    return;
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write("Brug: ppm-mcp [--archive <sti>]\nUden --archive læses arkivstien fra appens config.json.\n");
    return;
  }
  const serve = argv[0] === "serve";
  const opt = (name: string) => {
    const k = argv.indexOf(name);
    return k >= 0 ? argv[k + 1] : undefined;
  };
  const i = argv.indexOf("--archive");
  let archivePath = i >= 0 ? argv[i + 1] : undefined;
  if (i >= 0 && !archivePath) fail("--archive kræver en sti.");
  if (!archivePath) {
    const cfg = appConfigPath();
    try {
      archivePath = (JSON.parse(readFileSync(cfg, "utf8")) as { archivePath?: string }).archivePath;
    } catch {
      fail(`Intet arkiv angivet, og ${cfg} kunne ikke læses. Åbn arkivet i PPM-appen først, eller brug --archive <sti>.`);
    }
    if (!archivePath) fail(`${cfg} indeholder ingen archivePath. Åbn arkivet i PPM-appen først.`);
  }
  await loadSeaAddon();
  const env = nodeEnv();
  const archive = await openArchiveForAi(env, resolve(archivePath)).catch((e: Error) => fail(e.message));
  if (serve) {
    const { startMobileServer } = await import("./mobile/server");
    const port = Number(opt("--port") ?? 4730);
    const staticDir = opt("--static") ?? join(dirname(process.execPath), "..", "mobile");
    const tlsDir = opt("--tls-dir") ?? join(dirname(appConfigPath()), "mobile");
    const s = await startMobileServer({ env, archive, staticDir, tlsDir, port }).catch((e: Error) => fail(`Mobilserveren kunne ikke starte: ${e.message}`));
    process.stdout.write(`${JSON.stringify({ ready: true, addresses: s.addresses, httpsPort: s.httpsPort, httpPort: s.httpPort, caFingerprint: s.caFingerprint, caRenewed: s.caRenewed })}\n`);
    const stop = async () => {
      await s.close().catch(() => undefined);
      await archive.close().catch(() => undefined);
      process.exit(0);
    };
    // The desktop app stops the server by closing stdin (or killing it).
    process.stdin.on("end", stop);
    process.stdin.resume();
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    return;
  }
  const server = createPpmServer({ env, archive, homeDir: homedir(), realpath: (p) => fsp.realpath(p), sep });
  await server.connect(new StdioServerTransport());
  const close = async () => {
    await archive.close().catch(() => undefined);
    process.exit(0);
  };
  process.stdin.on("end", close);
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
