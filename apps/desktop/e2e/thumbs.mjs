// E2E: thumbnails on list rows and links in Dokumenter (screenshots for review).
// Plain WebDriver over HTTP, no extra dependencies. Only synthetic data (pnpm seed).
//
//   pnpm build && pnpm seed -- --archive ./local-data/e2e
//   Xvfb :99 & DISPLAY=:99 openbox & DISPLAY=:99 tauri-driver &
//   DISPLAY=:99 node apps/desktop/e2e/thumbs.mjs ./local-data/e2e ./local-data/screens
//
// The script writes the app's config.json so the archive opens at start, logs in as the
// seed user without PIN and walks through the meal plan and the dashboard.
import { copyFileSync, mkdirSync } from "node:fs";

import { join, resolve } from "node:path";
import { startApp } from "./lib.mjs";

const archive = resolve(process.argv[2] ?? "./local-data/e2e");
const shots = resolve(process.argv[3] ?? "./local-data/screens");
const { wd, S, click, js, shot, has, waitText, step, sleep, finish } = await startApp({ archive, shots });
mkdirSync(join(archive, "indbakke"), { recursive: true });
copyFileSync(resolve("fixtures/ocr/kvittering-syntetisk.png"), join(archive, "indbakke", "kvittering-foto.png"));

try {
  await wd("POST", S("/window/rect"), { width: 1440, height: 1000 }).catch(() => undefined);
  await sleep(1500);
  if (await has("Fjern låsen og åbn")) await click("//button[normalize-space()='Fjern låsen og åbn']");
  await click("//label[contains(., 'Anna Eksempel')]");
  await click("//button[normalize-space()='Fortsæt']");
  step("Login", await waitText("Overblik"));
  await click("//nav//a[contains(., 'Bolig og inventar')]");
  await sleep(1500);
  const n = await js("return document.querySelectorAll('.row-thumb.has-img').length");
  step("Billeder på rækker", n >= 1, `${n}`);
  await shot("genstande-billeder");
  await click("//nav//a[contains(., 'Dokumenter')]");
  await sleep(1500);
  const chips = await js("return [...document.querySelectorAll('.link-chip')].map(c => c.textContent).slice(0, 4)");
  step("Koblinger med navne", chips.length > 0, chips.join(" | "));
  await shot("dokumenter-koblinger");
} catch (e) {
  step("Uventet fejl", false, e.message);
  await shot("fejl").catch(() => undefined);
} finally {
  await finish();
}
