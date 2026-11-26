// E2E for phase 4 against the real app: local OCR of an image in the inbox (4.3).
// Plain WebDriver over HTTP, no extra dependencies. Only synthetic data (pnpm seed).
//
//   pnpm build && pnpm seed -- --archive ./local-data/e2e
//   Xvfb :99 & DISPLAY=:99 openbox & DISPLAY=:99 tauri-driver &
//   DISPLAY=:99 node apps/desktop/e2e/phase4.mjs ./local-data/e2e ./local-data/screens
//
// The script writes the app's config.json so the archive opens at start, logs in as the
// seed user without PIN and walks through the meal plan and the dashboard.
import { copyFileSync, mkdirSync } from "node:fs";

import { join, resolve } from "node:path";
import { startApp } from "./lib.mjs";

const archive = resolve(process.argv[2] ?? "./local-data/e2e");
const shots = resolve(process.argv[3] ?? "./local-data/screens");
const { wd, S, click, type, js, shot, has, waitText, step, sleep, finish } = await startApp({ archive, shots });
// A synthetic receipt photo in the watched inbox; the app imports it and runs OCR in the background.
mkdirSync(join(archive, "indbakke"), { recursive: true });
copyFileSync(resolve("fixtures/ocr/kvittering-syntetisk.png"), join(archive, "indbakke", "kvittering-foto.png"));

try {
  await wd("POST", S("/window/rect"), { width: 1440, height: 1000 }).catch(() => undefined);
  await sleep(1500);
  if (await has("Fjern låsen og åbn")) await click("//button[normalize-space()='Fjern låsen og åbn']");
  await click("//label[contains(., 'Anna Eksempel')]");
  await click("//button[normalize-space()='Fortsæt']");
  step("Login", await waitText("Overblik"));
  step("Billedet i indbakken importeres", await waitText("kvittering-foto.png er importeret", 15000));
  await click("//nav//a[contains(., 'Dokumenter')]");
  await type("//input[@placeholder='Søg i titel og tekst']", "elektrolageret");
  let found = false;
  const end = Date.now() + 60000;
  while (!found && Date.now() < end) {
    found = Boolean(await js("return [...document.querySelectorAll('table.list tbody td')].some(td => td.textContent.includes('kvittering-foto'))"));
    if (!found) await sleep(1000);
  }
  step("OCR-teksten kan søges (lokalt, uden netværk)", found);
  await shot("ocr-soegning");
} catch (e) {
  step("Uventet fejl", false, e.message);
  await shot("fejl").catch(() => undefined);
} finally {
  await finish();
}
