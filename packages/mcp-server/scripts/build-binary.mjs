// Builds the self-contained ppm-mcp binary (Node Single Executable Application) and the
// Claude Desktop bundle ppm.mcpb, and copies both into the Tauri resources (spec 06
// "Færdigpakkede forbindelser"). The binary needs no Node installation: it is the Node
// runtime with the bundled server injected. The better-sqlite3 addon is shipped next to it.
//
//   pnpm build:mcp
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { copyFileSync, chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, "..");
const dist = join(pkg, "dist");
const resources = resolve(pkg, "../../apps/desktop/src-tauri/resources/mcp");
const win = process.platform === "win32";
const exeName = win ? "ppm-mcp.exe" : "ppm-mcp";

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

// 1. One CommonJS file. pdf.js is never used by the server and stays out of the bundle.
await build({
  entryPoints: [join(pkg, "src/cli.ts")],
  outfile: join(dist, "ppm-mcp.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["pdfjs-dist", "pdfjs-dist/*"],
  logLevel: "warning",
  legalComments: "none",
});

// 2. SEA blob.
writeFileSync(
  join(dist, "sea-config.json"),
  JSON.stringify({ main: join(dist, "ppm-mcp.cjs"), output: join(dist, "sea-prep.blob"), disableExperimentalSEAWarning: true, useCodeCache: false }),
);
execFileSync(process.execPath, ["--experimental-sea-config", join(dist, "sea-config.json")], { stdio: "inherit" });

// 3. Copy the running Node binary and inject the blob.
const exe = join(dist, exeName);
copyFileSync(process.execPath, exe);
chmodSync(exe, 0o755);
if (process.platform === "darwin") execFileSync("codesign", ["--remove-signature", exe]);
const { inject } = await import("postject");
await inject(exe, "NODE_SEA_BLOB", readFileSync(join(dist, "sea-prep.blob")), {
  sentinelFuse: "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  ...(process.platform === "darwin" ? { machoSegmentName: "NODE_SEA" } : {}),
});
if (process.platform === "darwin") execFileSync("codesign", ["--sign", "-", exe]);

// 4. The native SQLite addon built for this Node version.
const require = createRequire(join(pkg, "../core/package.json"));
const addon = join(dirname(require.resolve("better-sqlite3/package.json")), "build", "Release", "better_sqlite3.node");
copyFileSync(addon, join(dist, "better_sqlite3.node"));

// 5. MCP Bundle (manifest_version 0.3, server.type "binary"), verified against
//    github.com/modelcontextprotocol/mcpb MANIFEST.md on 25.11.2026.
const version = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")).version;
const { TOOL_DESCRIPTIONS } = await import("@ppm/core");
const manifest = {
  manifest_version: "0.3",
  name: "ppm",
  display_name: "PPM – husstandsarkiv",
  version,
  description: "Lokal adgang til dit PPM-arkiv: opgaver, inventar, økonomi, madplan og dokumenter. Ændringer kræver godkendelse i appen.",
  author: { name: "PPM open source" },
  license: "MIT",
  server: {
    type: "binary",
    entry_point: `server/${exeName}`,
    mcp_config: { command: `\${__dirname}/server/${exeName}`, args: [], env: {} },
  },
  tools: Object.entries(TOOL_DESCRIPTIONS).map(([name, description]) => ({ name, description })),
  compatibility: { platforms: [process.platform] },
};
const bundle = zipSync({
  "manifest.json": new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
  [`server/${exeName}`]: [readFileSync(exe), { level: 6 }],
  "server/better_sqlite3.node": [readFileSync(join(dist, "better_sqlite3.node")), { level: 6 }],
});
writeFileSync(join(dist, "ppm.mcpb"), bundle);
// The installer ships the binary once; the app builds ppm.mcpb from it and this manifest
// when the user clicks "Installér i Claude Desktop" (docs/AFVIGELSER.md A5).
writeFileSync(join(dist, "mcpb-manifest.json"), JSON.stringify(manifest, null, 2));

// 6. Into the Tauri resources.
mkdirSync(resources, { recursive: true });
rmSync(join(resources, "ppm.mcpb"), { force: true });
for (const f of [exeName, "better_sqlite3.node", "mcpb-manifest.json"]) copyFileSync(join(dist, f), join(resources, f));
console.log(`ppm-mcp: ${exe} og ${join(dist, "ppm.mcpb")} er bygget. Binær og manifest er kopieret til ${resources}`);
