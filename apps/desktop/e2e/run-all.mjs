// Runs the E2E scripts one by one against the real app, each with a freshly seeded archive.
// Needs a release build, a running tauri-driver (and on Linux an X display).
//
//   node apps/desktop/e2e/run-all.mjs [--only a,b] [--skip a,b] [--out ./local-data/e2e-ci]
import { spawnSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const list = (v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : null);
const only = list(arg("--only"));
const skip = list(arg("--skip")) ?? [];
const out = resolve(arg("--out") ?? "./local-data/e2e-ci");
const tsx = createRequire(import.meta.url).resolve("tsx/cli");

const scripts = readdirSync(here)
  .filter((f) => f.endsWith(".mjs") && !["lib.mjs", "run-all.mjs"].includes(f))
  .map((f) => f.replace(/\.mjs$/, ""))
  .filter((n) => (!only || only.includes(n)) && !skip.includes(n))
  .sort();

const summary = [];
for (const name of scripts) {
  const archive = join(out, name, "arkiv");
  rmSync(join(out, name), { recursive: true, force: true });
  console.log(`\n=== ${name} ===`);
  const seed = spawnSync(process.execPath, [tsx, "packages/core/scripts/seed.ts", "--archive", archive], { stdio: "inherit" });
  if (seed.status !== 0) {
    summary.push([name, false, "seed fejlede"]);
    continue;
  }
  const r = spawnSync(process.execPath, [join(here, `${name}.mjs`), archive, join(out, name, "skaermbilleder")], { stdio: "inherit", timeout: 10 * 60_000 });
  summary.push([name, r.status === 0, r.status === null ? "timeout" : `exit ${r.status}`]);
}
console.log("\n=== Resultat ===");
for (const [n, ok, d] of summary) console.log(`${ok ? "OK  " : "FEJL"} ${n} (${d})`);
process.exit(summary.every((s) => s[1]) && summary.length > 0 ? 0 : 1);
