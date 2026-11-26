// E2E: the detail panel stays in view when a row far down the list is selected.
// Plain WebDriver over HTTP, no extra dependencies. Only synthetic data (pnpm seed).
//
//   pnpm build && pnpm seed -- --archive ./local-data/e2e
//   Xvfb :99 & DISPLAY=:99 openbox & DISPLAY=:99 tauri-driver &
//   DISPLAY=:99 node apps/desktop/e2e/sticky.mjs ./local-data/e2e ./local-data/screens
//
// The script writes the app's config.json so the archive opens at start, logs in as the
// seed user without PIN and walks through the meal plan and the dashboard.

import { resolve } from "node:path";
import { startApp } from "./lib.mjs";

const archive = resolve(process.argv[2] ?? "./local-data/e2e");
const shots = resolve(process.argv[3] ?? "./local-data/screens");
const { wd, S, click, js, shot, has, waitText, step, sleep, finish } = await startApp({ archive, shots });

try {
  await wd("POST", S("/window/rect"), { width: 1440, height: 700 }).catch(() => undefined);
  await sleep(1500);
  if (await has("Fjern låsen og åbn")) await click("//button[normalize-space()='Fjern låsen og åbn']");
  await click("//label[contains(., 'Anna Eksempel')]");
  await click("//button[normalize-space()='Fortsæt']");
  step("Login", await waitText("Overblik"));
  await click("//nav//a[contains(., 'Dokumenter')]");
  await sleep(1000);
  // Scroll to the bottom of the list and select the last row.
  await js("for (const c of [document.querySelector('.content'), document.scrollingElement]) c.scrollTop = c.scrollHeight;");
  await sleep(300);
  const before = await js("return [document.querySelector('.content').scrollTop, document.scrollingElement.scrollTop]");
  await js("const rows = document.querySelectorAll('table.list tbody tr'); rows[rows.length - 1].click();");
  await sleep(800);
  const after = await js("return [document.querySelector('.content').scrollTop, document.scrollingElement.scrollTop]");
  step("Indholdet scroller, menuen står fast", before[0] > 0 && before[1] === 0, JSON.stringify([before, after]));
  const r = await js("const a = document.querySelector('.split > .detail'); const b = a.getBoundingClientRect(); return [Math.round(b.top), Math.round(b.bottom), window.innerHeight];");
  step("Detaljepanelet er synligt efter scroll", r[0] >= 0 && r[0] < r[2] - 100, JSON.stringify(r));
  await shot("sticky-detail");
} catch (e) {
  step("Uventet fejl", false, e.message);
  await shot("fejl").catch(() => undefined);
} finally {
  await finish();
}
