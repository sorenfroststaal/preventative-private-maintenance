// E2E for calendar, timeline and lending against the real app (screenshots for review).
// Plain WebDriver over HTTP, no extra dependencies. Only synthetic data (pnpm seed).
//
//   pnpm build && pnpm seed -- --archive ./local-data/e2e
//   Xvfb :99 & DISPLAY=:99 openbox & DISPLAY=:99 tauri-driver &
//   DISPLAY=:99 node apps/desktop/e2e/calendar.mjs ./local-data/e2e ./local-data/screens
//
// The script writes the app's config.json so the archive opens at start, logs in as the
// seed user without PIN and walks through the meal plan and the dashboard.

import { resolve } from "node:path";
import { ELEM, startApp } from "./lib.mjs";

const archive = resolve(process.argv[2] ?? "./local-data/e2e");
const shots = resolve(process.argv[3] ?? "./local-data/screens");
const { wd, S, find, click, js, shot, has, waitText, step, sleep, finish } = await startApp({ archive, shots });

try {
  await wd("POST", S("/window/rect"), { width: 1440, height: 1000 }).catch(() => undefined);
  await sleep(1500);
  if (await has("Fjern låsen og åbn")) await click("//button[normalize-space()='Fjern låsen og åbn']");
  await click("//label[contains(., 'Anna Eksempel')]");
  await click("//button[normalize-space()='Fortsæt']");
  step("Login", await waitText("Overblik"));
  await click("//nav//a[contains(., 'Kalender')]");
  step("Kalender: måned", await waitText("uge"));
  await sleep(800);
  await shot("kalender-maaned");
  await click("//button[@role='tab' and normalize-space()='Tidslinje']");
  await find("//*[contains(@class,'tl-lane-label')]");
  await sleep(800);
  const n = await js("return document.querySelectorAll('.tl-ev').length");
  step("Tidslinje med begivenheder", n > 3, `${n} begivenheder`);
  await shot("tidslinje-standard");
  await click("//div[@aria-label='Tidsrum']/button[normalize-space()='År']");
  await sleep(700);
  await shot("tidslinje-aar");
  await click("//div[@aria-label='Tidsrum']/button[normalize-space()='5 år']");
  await sleep(700);
  await shot("tidslinje-5aar");
  await click("//div[@aria-label='Tidsrum']/button[normalize-space()='Måned']");
  await sleep(700);
  // Hover the first event for the tooltip.
  const evEl = await wd("POST", S("/element"), { using: "css selector", value: ".tl-ev" });
  const ev = evEl[ELEM] ?? Object.values(evEl)[0];
  await wd("POST", S("/actions"), { actions: [{ type: "pointer", id: "m", parameters: { pointerType: "mouse" }, actions: [{ type: "pointerMove", origin: { [ELEM]: ev }, x: 0, y: 0 }, { type: "pause", duration: 300 }] }] }).catch(() => undefined);
  await sleep(400);
  await shot("tidslinje-maaned-tooltip");
  await click("//nav//a[contains(., 'Bolig og inventar')]");
  await click("//button[@role='tab' and normalize-space()='Udlån']");
  step("Udlån", await waitText("Naboen i nr. 3"));
  await shot("udlaan");
} catch (e) {
  step("Uventet fejl", false, e.message);
  await shot("fejl").catch(() => undefined);
} finally {
  await finish();
}
