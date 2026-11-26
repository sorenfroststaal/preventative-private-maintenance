// E2E for the finance overview, food budget, recurring priority and insured persons (feedback 25.11.2026).
// Plain WebDriver over HTTP, no extra dependencies. Only synthetic data (pnpm seed).
//
//   pnpm build && pnpm seed -- --archive ./local-data/e2e
//   Xvfb :99 & DISPLAY=:99 openbox & DISPLAY=:99 tauri-driver &
//   DISPLAY=:99 node apps/desktop/e2e/finance.mjs ./local-data/e2e ./local-data/screens
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
  await sleep(1500);
  if (await has("Fjern låsen og åbn")) await click("//button[normalize-space()='Fjern låsen og åbn']");
  await click("//label[contains(., 'Anna Eksempel')]");
  await click("//button[normalize-space()='Fortsæt']");
  step("Login", await waitText("Overblik"));

  await click("//nav//a[contains(., 'Økonomi')]");
  step("Økonomi åbner på Overblik", await waitText("Indtægter og udgifter"));
  await waitText("Madbudget");
  await sleep(800);
  const flow = await js("const s = document.querySelector('svg[aria-label^=\"Indtægter og udgifter\"]'); return s && s.getAttribute('aria-label')");
  step("Kurve med indtægter og udgifter", /Indtægter: .*Udgifter: /.test(String(flow)), String(flow).slice(0, 120));
  step("Madbudget", await has("Madbudget"));
  await type("//input[@inputmode='decimal' and contains(@class,'short')]", "6000");
  await click("//button[normalize-space()='Gem']");
  step("Madbudget gemt", await waitText("Madbudgettet er gemt"));
  step("Historik pr. kategori", await has("Historik pr. kategori"));
  await shot("okonomi-overblik");
  await js("window.scrollTo(0, document.body.scrollHeight)");
  await sleep(300);
  await shot("okonomi-overblik-historik");

  await click("//button[@role='tab' and normalize-space()='Budget']");
  step("Budget forklaring", await waitText("Sådan virker budgettet"));
  await shot("okonomi-budget");

  await click("//button[@role='tab' and normalize-space()='Faste udgifter']");
  await find("//table//th[normalize-space()='Prioritet']");
  const firstRow = await js("return document.querySelector('table.list tbody tr td')?.textContent");
  await click("//table[.//th[normalize-space()='Prioritet']]//tbody/tr[1]/td[1]");
  const sel = await find("//div[@role='dialog']//select[option[normalize-space()='1 – Kan undværes']]");
  await wd("POST", S(`/element/${sel}/click`), {});
  await click("//div[@role='dialog']//option[normalize-space()='1 – Kan undværes']");
  await click("//div[@role='dialog']//button[@type='submit']");
  step("Prioritet sat", await waitText("Kan undværes"), String(firstRow));
  step("Arkivér-knap på rækken", Boolean(await js("return document.querySelector('button[aria-label^=\"Arkivér \"]')")));
  await shot("faste-udgifter");

  await click("//button[@role='tab' and normalize-space()='Lån']");
  await click("//button[normalize-space()='Nyt lån']");
  await find("//div[@role='dialog']//label[contains(., 'Restgæld')]");
  await type("//div[@role='dialog']//label[starts-with(normalize-space(.), 'Navn')]/following-sibling::input", "Billån");
  await click("//div[@role='dialog']//button[@type='submit']");
  await sleep(800);
  step("Lån oprettet med standardværdier og vist", Boolean(await find("//table//td[contains(., 'Billån')]")));
  await shot("laan");
  await click("//nav//a[contains(., 'Lister')]");
  await sleep(800);
  await click("//button[@role='tab' and normalize-space()='Kontakter']");
  await sleep(800);
  await click("//table//tbody/tr[1]/td[1]");
  step("Bilag på kontakter", Boolean(await find("//aside//button[@role='tab' and normalize-space()='Bilag']")));
  await click("//nav//a[contains(., 'Forsikring')]");
  await click("//table//tbody/tr[1]/td[1]");
  await find("//div[@role='group' and @aria-label='Dækkede personer']");
  await click("//div[@role='group' and @aria-label='Dækkede personer']//button[1]");
  await sleep(800);
  const av = await js("return [...document.querySelectorAll('table.list tbody tr:first-child .avatar')].map(a => a.textContent)");
  step("Initialer på policens række", av.length > 0, av.join(","));
  await shot("forsikring-personer");

  await click("//nav//a[contains(., 'Dokumenter')]");
  await find("//select[@aria-label='Kategori']");
  const first = await js("return document.querySelector('select[aria-label=Kategori] option')?.textContent");
  step("Filter: Alle kategorier", first === "Alle kategorier", String(first));
} catch (e) {
  step("Uventet fejl", false, e.message);
  await shot("fejl").catch(() => undefined);
} finally {
  await wd("DELETE", S("")).catch(() => undefined);
}
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} trin OK`);
process.exit(failed.length ? 1 : 0);
