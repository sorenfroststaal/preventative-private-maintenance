// E2E: components and the item tree in the real app (migration 0012). Only synthetic data (pnpm seed).
//   DISPLAY=:99 node apps/desktop/e2e/components.mjs ./local-data/e2e ./local-data/screens
import { resolve } from "node:path";
import { startApp } from "./lib.mjs";

const archive = resolve(process.argv[2] ?? "./local-data/e2e");
const shots = resolve(process.argv[3] ?? "./local-data/screens");
const { wd, S, click, js, shot, has, waitText, step, sleep, finish } = await startApp({ archive, shots });

try {
  await wd("POST", S("/window/rect"), { width: 1440, height: 1000 }).catch(() => undefined);
  await sleep(1500);
  if (await has("Fjern låsen og åbn")) await click("//button[normalize-space()='Fjern låsen og åbn']");
  await click("//label[contains(., 'Anna Eksempel')]");
  await click("//button[normalize-space()='Fortsæt']");
  step("Login", await waitText("Overblik"));
  await click("//nav//a[contains(., 'Bolig og inventar')]");
  await waitText("Genstande");
  step("Listen viser antal dele", await waitText("1 del"));
  await click("//button[normalize-space()='Træ']");
  await sleep(600);
  await click("//button[normalize-space()='Fold alt ud']");
  await sleep(600);
  const text = String(await js("return document.querySelector('[role=tree]')?.innerText ?? ''"));
  step("Træ efter placering med komponenter", text.includes("Køkken") && text.includes("Emhætte") && text.includes("Kulfilter"), text.split("\n").slice(0, 6).join(" / "));
  await shot("traeet-placering");
  await js("const s = [...document.querySelectorAll('select')].find((x) => x.closest('label')?.textContent?.includes('Gruppér')); s.value = 'category'; s.dispatchEvent(new Event('change', { bubbles: true }));");
  await sleep(600);
  step("Træ efter kategori", (await has("Uden kategori")));
  await click("//button[normalize-space()='Liste']");
  await sleep(400);
  await click("//td//span[normalize-space()='Emhætte']");
  await click("//aside//button[@role='tab' and normalize-space()='Komponenter']");
  step("Komponenter på genstanden", await waitText("Reservedele"));
  await shot("komponenter");
  await click("//aside//button[normalize-space()='Brug …']");
  await sleep(400);
  await click("//button[normalize-space()='Registrér som brugt']");
  step("Reservedel brugt", await waitText("er registreret som brugt"));
} catch (e) {
  step("Uventet fejl", false, e.message);
  await shot("fejl").catch(() => undefined);
} finally {
  await finish();
}
