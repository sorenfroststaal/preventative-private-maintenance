// E2E: '+ Ny rum…' in an item's location field creates and selects the room (bug report 26.11.2026).
// Plain WebDriver over HTTP, no extra dependencies. Only synthetic data (pnpm seed).
//
//   pnpm build && pnpm seed -- --archive ./local-data/e2e
//   Xvfb :99 & DISPLAY=:99 openbox & DISPLAY=:99 tauri-driver &
//   DISPLAY=:99 node apps/desktop/e2e/vendor.mjs ./local-data/e2e ./local-data/screens
//
// The script writes the app's config.json so the archive opens at start, logs in as the
// seed user without PIN and walks through the meal plan and the dashboard.

import { resolve } from "node:path";
import { startApp } from "./lib.mjs";

const archive = resolve(process.argv[2] ?? "./local-data/e2e");
const shots = resolve(process.argv[3] ?? "./local-data/screens");
const { wd, S, find, click, type, js, shot, has, waitText, step, sleep, finish } = await startApp({ archive, shots });

try {
  await wd("POST", S("/window/rect"), { width: 1440, height: 1000 }).catch(() => undefined);
  await sleep(1500);
  if (await has("Fjern låsen og åbn")) await click("//button[normalize-space()='Fjern låsen og åbn']");
  await click("//label[contains(., 'Anna Eksempel')]");
  await click("//button[normalize-space()='Fortsæt']");
  step("Login", await waitText("Overblik"));
  await click("//nav//a[contains(., 'Bolig og inventar')]");
  await click("//table//td[contains(., 'Sofa')]");
  const sel = "//aside[@aria-label='Genstand']//label[normalize-space()='Placering']/following-sibling::select";
  await find(sel);
  await js("const s = document.evaluate(arguments[0], document, null, 9, null).singleNodeValue; const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(s, '__new__'); s.dispatchEvent(new Event('change', { bubbles: true }));", sel);
  await find("//div[@role='dialog']");
  await type("//div[@role='dialog']//label[starts-with(normalize-space(.), 'Navn')]/following-sibling::input", "Bryggers E2E");
  // Bolig: choose the first property.
  await js("const s = document.evaluate(\"//div[@role='dialog']//label[starts-with(normalize-space(.), 'Bolig')]/following-sibling::select\", document, null, 9, null).singleNodeValue; const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(s, s.options[1].value); s.dispatchEvent(new Event('change', { bubbles: true }));");
  await shot("rum-dialog");
  await click("//div[@role='dialog']//button[@type='submit']");
  await sleep(800);
  const err = await js("return [...document.querySelectorAll('[role=alert], .error')].map(e => e.textContent).join(' | ')");
  if (err) console.log("fejltekst:", err);
  await sleep(1500);
  const chosen = await js("const s = document.evaluate(arguments[0], document, null, 9, null).singleNodeValue; return s.options[s.selectedIndex].textContent", sel);
  step("Nyt rum valgt i Placering", chosen === "Bryggers E2E", String(chosen));
  await shot("forhandler");
} catch (e) {
  step("Uventet fejl", false, e.message);
  await shot("fejl").catch(() => undefined);
} finally {
  await finish();
}
