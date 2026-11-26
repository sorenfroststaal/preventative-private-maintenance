// E2E: '+ Ny kontakt…' in an item's vendor field creates and selects the contact (bug report 26.11.2026).
// Plain WebDriver over HTTP, no extra dependencies. Only synthetic data (pnpm seed).
//
//   pnpm build && pnpm seed -- --archive ./local-data/e2e
//   Xvfb :99 & DISPLAY=:99 openbox & DISPLAY=:99 tauri-driver &
//   DISPLAY=:99 node apps/desktop/e2e/vendor.mjs ./local-data/e2e ./local-data/screens
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
  await click("//nav//a[contains(., 'Bolig og inventar')]");
  await click("//table//td[contains(., 'Sofa')]");
  const sel = "//aside[@aria-label='Genstand']//label[normalize-space()='Forhandler (kontakt)']/following-sibling::select";
  await find(sel);
  await js("const s = document.evaluate(arguments[0], document, null, 9, null).singleNodeValue; const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(s, '__new__'); s.dispatchEvent(new Event('change', { bubbles: true }));", sel);
  await find("//div[@role='dialog']");
  await type("//div[@role='dialog']//label[starts-with(normalize-space(.), 'Navn')]/following-sibling::input", "Netbutik E2E");
  await click("//div[@role='dialog']//button[@type='submit']");
  await sleep(1500);
  const chosen = await js("const s = document.evaluate(arguments[0], document, null, 9, null).singleNodeValue; return s.options[s.selectedIndex].textContent", sel);
  step("Ny kontakt valgt i Forhandler", chosen === "Netbutik E2E", String(chosen));
  await shot("forhandler");
} catch (e) {
  step("Uventet fejl", false, e.message);
  await shot("fejl").catch(() => undefined);
} finally {
  await wd("DELETE", S("")).catch(() => undefined);
}
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} trin OK`);
process.exit(failed.length ? 1 : 0);
