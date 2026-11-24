// E2E for phase 2b against the real app (release build) via tauri-driver + WebKitWebDriver.
// Plain WebDriver over HTTP, no extra dependencies. Only synthetic data (pnpm seed).
//
//   pnpm build && pnpm seed -- --archive ./local-data/e2e
//   Xvfb :99 & DISPLAY=:99 openbox & DISPLAY=:99 tauri-driver &
//   DISPLAY=:99 node apps/desktop/e2e/phase2b.mjs ./local-data/e2e ./local-data/screens
//
// The script writes the app's config.json so the archive opens at start, logs in as the
// seed user without PIN and walks through the meal plan and the dashboard.
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const archive = resolve(process.argv[2] ?? "./local-data/e2e");
const shots = resolve(process.argv[3] ?? "./local-data/screens");
const app = resolve("apps/desktop/src-tauri/target/release/ppm-desktop");
const base = "http://127.0.0.1:4444";
mkdirSync(shots, { recursive: true });
const configDir = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "ppm");
mkdirSync(configDir, { recursive: true });
writeFileSync(join(configDir, "config.json"), JSON.stringify({ archivePath: archive }));

async function wd(method, path, body) {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (j.value && j.value.error) throw new Error(`${method} ${path}: ${j.value.error} ${j.value.message}`);
  return j.value;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function step(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "OK  " : "FEJL"} ${name}${detail ? ` – ${detail}` : ""}`);
}

const session = await wd("POST", "/session", { capabilities: { alwaysMatch: { "tauri:options": { application: app } } } });
const sid = session.sessionId;
const S = (p) => `/session/${sid}${p}`;
const ELEM = "element-6066-11e4-a52e-4f466cb85b84";

async function find(xpath, timeout = 8000) {
  const end = Date.now() + timeout;
  for (;;) {
    try {
      const e = await wd("POST", S("/element"), { using: "xpath", value: xpath });
      const id = e[ELEM] ?? Object.values(e)[0];
      if (!id) throw new Error("tom reference");
      return id;
    } catch (err) {
      if (Date.now() > end) throw new Error(`Ikke fundet: ${xpath} (${err.message})`);
      await sleep(200);
    }
  }
}
const click = async (xpath) => wd("POST", S(`/element/${await find(xpath)}/click`), {});
const type = async (xpath, text) => wd("POST", S(`/element/${await find(xpath)}/value`), { text });
const bodyText = async () => wd("POST", S("/execute/sync"), { script: "return document.body.innerText", args: [] });
const js = (script, ...args) => wd("POST", S("/execute/sync"), { script, args });
async function shot(name) {
  const png = await wd("GET", S("/screenshot"));
  writeFileSync(join(shots, `${name}.png`), Buffer.from(png, "base64"));
}
const has = async (text) => (await bodyText()).includes(text);
async function waitText(text, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await has(text)) return true;
    await sleep(200);
  }
  return false;
}

try {
  await wd("POST", S("/window/rect"), { width: 1440, height: 1000 }).catch(() => undefined);
  // A previous run killed by WebDriver leaves a stale lock; the app offers to remove it.
  await sleep(1500);
  if (await has("Fjern låsen og åbn")) await click("//button[normalize-space()='Fjern låsen og åbn']");
  // Login as the admin seed user (no PIN).
  await click("//label[contains(., 'Anna Eksempel')]");
  await click("//button[normalize-space()='Fortsæt']");
  step("Login", await waitText("Overblik"));

  // Menu order with Madplan between Økonomi and Forsikring, each with an icon.
  const menu = await js("return [...document.querySelectorAll('nav[aria-label=Hovedmenu] a')].map(a => [a.textContent.trim(), !!a.querySelector('.module-icon svg')])");
  const labels = menu.map((m) => m[0]);
  step("Menu med ikoner", labels.indexOf("Madplan") === labels.indexOf("Økonomi") + 1 && menu.every((m) => m[1]), labels.join(", "));

  // Dashboard: key figures, 6-month chart and today's/tomorrow's dish.
  await waitText("Se ugens madplan");
  const kpis = await js("return [...document.querySelectorAll('a.kpi')].map(a => a.getAttribute('aria-label'))");
  step("Nøgletalskort", kpis.length === 4, kpis.join(" | "));
  const chart = await js("const s = document.querySelector('svg[aria-label^=\"Forbrug de seneste 6 måneder\"]'); return s && s.getAttribute('aria-label')");
  step("Graf over 6 måneders forbrug", Boolean(chart), chart ?? "");
  step("Madplan-kort på overblikket", (await has("I dag")) && (await has("I morgen")) && (await has("Se ugens madplan")));
  await shot("overblik");
  await click("//a[contains(@aria-label, 'Mangler oplysninger')]");
  await sleep(600);
  const focused = await js("return document.activeElement && document.activeElement.id");
  step("Nøgletalskort fører til sektionen", focused === "mangler", String(focused));

  // Meal plan week.
  await click("//nav//a[contains(., 'Madplan')]");
  step("Madplan: uge", await waitText("Anslået pris"));
  step("Allergi-advarsel ved rejer", await waitText("Rejer (Ida Eksempel)"));
  const priceText = await js("return document.querySelector('.week-summary .panel strong')?.textContent");
  step("Anslået pris for ugen", /kr\./.test(String(priceText)), String(priceText));
  step("Budget for ugen", await has("Mad og dagligvarer"));
  await shot("madplan-uge");

  // Plan a free title via the dialog on Sunday.
  step("Søndag er tom før", !(await has("Pizza fra pizzeriaet")));
  await click("//button[@aria-label='Tilføj aftensmad søndag']");
  await find("//div[@role='dialog']//ul[@aria-label='Opskrifter']/li");
  await sleep(300);
  await click("//input[@placeholder='Fx Rester']");
  await type("//input[@placeholder='Fx Rester']", "Pizza fra pizzeriaet");
  await click("//div[@role='dialog']//button[normalize-space()='Planlæg']");
  step("Fri titel på søndag", await waitText("Pizza fra pizzeriaet"));

  // Next week empty → copy last week.
  await click("//button[@aria-label='Næste uge']");
  await sleep(500);
  await click("//button[contains(., 'Kopiér sidste uge')]");
  step("Kopiér sidste uge", await waitText("retter er kopieret fra sidste uge"));
  await click("//button[normalize-space()='Denne uge']");
  await sleep(400);

  // Shopping list.
  await click("//button[contains(., 'Lav indkøbsliste for ugen')]");
  step("Indkøbsliste genereret", await waitText("Kød og fisk"));
  step("Varer uden mængde tælles", await has("salt og peber (3 retter)"));
  await shot("madplan-indkob");

  // Recipes tab: list with allergens and a recipe detail.
  await click("//button[@role='tab' and normalize-space()='Opskrifter']");
  await click("//td[contains(., 'Indbagte rejer med ris')]");
  step("Opskrift med ingrediensliste", await waitText("Gem ingredienser"));
  await shot("madplan-opskrifter");

  // Ctrl+K finds recipes.
  await js("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))");
  await type("//input[@aria-label='Søg i hele arkivet']", "kødsovs");
  step("Ctrl+K finder opskrifter", await waitText("Pasta med kødsovs") && (await has("Madplan")));
  await shot("soeg-opskrift");
  await click("//h3[contains(., 'Madplan')]/following-sibling::ul[1]//button[contains(@class, 'search-hit') and contains(., 'Pasta med kødsovs')]");
  step("Søgeresultat åbner opskriften", await waitText("Gem ingredienser"));
  await shot("opskrift-fra-soegning");

  // Icon-only buttons on the live page have aria-label and title.
  const unlabeled = await js(
    "return [...document.querySelectorAll('button')].filter(b => !b.textContent.trim() && !(b.getAttribute('aria-label') && b.getAttribute('title'))).length",
  );
  step("Ikonknapper har aria-label og tooltip", unlabeled === 0, `${unlabeled} uden`);
} catch (e) {
  step("Uventet fejl", false, e.message);
  await shot("fejl").catch(() => undefined);
} finally {
  await wd("DELETE", S("")).catch(() => undefined);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} trin bestod`);
process.exit(failed.length ? 1 : 0);
