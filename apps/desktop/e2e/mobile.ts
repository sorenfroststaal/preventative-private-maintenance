// E2E for the iPhone web app: real `ppm-mcp serve` against a demo archive, Chromium with an iPhone
// viewport (WebKit is not installed here). Pairs with a code made through core, then walks the tabs.
//   pnpm mobile:build && tsx apps/desktop/e2e/mobile.ts ./local-data/mobile ./local-data/screens-mobile
import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { createPairingCode, makeCtx, openArchiveForAi } from "../../../packages/core/src";
import { nodeEnv } from "../../../packages/core/src/node";
import { createDemoArchive } from "../../../packages/core/scripts/seed";

const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");
const dir = resolve(process.argv[2] ?? "./local-data/mobile");
const shots = resolve(process.argv[3] ?? "./local-data/screens-mobile");
rmSync(dir, { recursive: true, force: true });
mkdirSync(shots, { recursive: true });
const results: [string, boolean, string][] = [];
const step = (n: string, ok: boolean, d = "") => (results.push([n, ok, d]), console.log(`${ok ? "OK  " : "FEJL"} ${n}${d ? ` – ${d}` : ""}`));

const env = nodeEnv();
const info = await createDemoArchive(env, join(dir, "arkiv"));
const port = 47811;
const server = spawn(process.execPath, [require.resolve("tsx/cli"), "packages/mcp-server/src/cli.ts", "serve", "--archive", info.root, "--port", String(port), "--static", "apps/desktop/src-tauri/resources/mobile", "--tls-dir", join(dir, "tls")], { stdio: ["pipe", "pipe", "inherit"] });
const ready = await new Promise<{ addresses: string[]; caFingerprint: string }>((ok, fail) => {
  server.stdout.on("data", (b: Buffer) => {
    const line = b.toString().split("\n").find((l) => l.startsWith("{"));
    if (line) ok(JSON.parse(line));
  });
  server.on("exit", (c) => fail(new Error(`server exit ${c}`)));
});
step("Server klar", true, ready.addresses.join(", "));
const archive = await openArchiveForAi(env, info.root);
const { code } = await createPairingCode(makeCtx(env, archive.db, info.annaUserId, "ui"));

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ ...devices["iPhone 13"], ignoreHTTPSErrors: true, locale: "da-DK" });
  const page = await ctx.newPage();
  await page.goto(`https://127.0.0.1:${port}/`);
  await page.getByText("PPM på iPhone").waitFor();
  step("Parringsskærm med vejledning", await page.getByText("Læg PPM på hjemmeskærmen først").isVisible());
  await page.screenshot({ path: join(shots, "1-parring.png") });
  await page.getByLabel("Parringskode").fill(code);
  await page.getByRole("button", { name: "Parr telefonen" }).click();
  await page.getByRole("heading", { name: "Overblik" }).waitFor();
  await page.waitForTimeout(600);
  step("Parret og overblik vist", await page.getByText("Forfaldne").isVisible());
  await page.screenshot({ path: join(shots, "2-overblik.png") });
  const before = await page.locator(".check").count();
  await page.locator(".check").first().click();
  await page.waitForTimeout(800);
  step("Opgave markeret udført", (await page.locator(".check").count()) < before, `${before} → ${await page.locator(".check").count()}`);
  await page.getByRole("button", { name: "Kalender" }).click();
  await page.getByRole("heading", { name: "Kalender" }).waitFor();
  await page.waitForTimeout(500);
  step("Kalender", (await page.locator(".ev").count()) > 0);
  await page.screenshot({ path: join(shots, "3-kalender.png") });
  await page.getByRole("button", { name: "Mad", exact: true }).click();
  await page.getByText("Indkøbsliste").waitFor();
  await page.waitForTimeout(500);
  const box = page.locator(".shop-item input").first();
  if (await box.count()) {
    const was = await box.isChecked();
    await page.locator(".shop-item span").first().click();
    await page.waitForTimeout(600);
    step("Vare krydset af", (await box.isChecked()) !== was, `${was} → ${await box.isChecked()}`);
  }
  step("Madplan og indkøbsliste", (await page.locator(".shop-item").count()) > 0);
  await page.screenshot({ path: join(shots, "4-mad.png") });
  await page.getByRole("button", { name: "Ting" }).click();
  await page.getByText("Opvaskemaskine").click();
  await page.getByText("Serienummer").waitFor();
  await page.waitForTimeout(800);
  step("Genstand med fakta og foto", await page.locator("img.photo").count() > 0);
  await page.screenshot({ path: join(shots, "5-genstand.png") });
  await page.getByRole("button", { name: "Søg" }).click();
  await page.getByPlaceholder("Søg i alt").fill("kvittering");
  await page.waitForTimeout(900);
  step("Søgning", (await page.locator(".link-row").count()) > 0);
  await page.screenshot({ path: join(shots, "6-soeg.png") });
  // Dark mode.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByRole("button", { name: "Overblik" }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(shots, "7-overblik-moerk.png") });
} catch (e) {
  step("Uventet fejl", false, (e as Error).message);
} finally {
  await browser.close();
  server.stdin.end();
  await archive.close();
}
const failed = results.filter((r) => !r[1]);
console.log(`${results.length - failed.length}/${results.length} trin OK`);
process.exit(failed.length ? 1 : 0);
