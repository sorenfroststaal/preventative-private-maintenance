/**
 * Builds a backup zip of the synthetic demo archive, which testers restore in the app
 * (Indstillinger → Backup → Gendan). Usage: pnpm demo-backup -- --out ./local-data/demo-backup
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createBackup, makeCtx, openArchive } from "../src";
import { nodeEnv } from "../src/node";
import { createDemoArchive } from "./seed";

const i = process.argv.indexOf("--out");
const out = resolve(i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : "./local-data/demo-backup");
const env = nodeEnv();
const info = await createDemoArchive(env, join(mkdtempSync(join(tmpdir(), "ppm-demo-")), "PPM-demo"));
const archive = await openArchive(env, info.root, { appVersion: "0.1.0-demo" });
const r = await createBackup(env, archive, makeCtx(env, archive.db, null, "system"), out);
await archive.close();
console.log(`Demo-backup: ${r.path}`);
