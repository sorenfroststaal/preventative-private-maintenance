// E2E: Indstillinger → Mobil (iPhone) starts ppm-mcp serve from the real app; a phone pairs over HTTPS.
// Plain WebDriver over HTTP, no extra dependencies. Only synthetic data (pnpm seed).
//
//   pnpm build && pnpm seed -- --archive ./local-data/e2e
//   Xvfb :99 & DISPLAY=:99 openbox & DISPLAY=:99 tauri-driver &
//   DISPLAY=:99 node apps/desktop/e2e/mobile-desktop.mjs ./local-data/e2e ./local-data/screens
//
// The script writes the app's config.json so the archive opens at start, logs in as the
// seed user without PIN and walks through the meal plan and the dashboard.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:https";
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
  await click("//nav//a[contains(., 'Indstillinger')]");
  await js("document.getElementById('mobil').scrollIntoView()");
  await click("//button[normalize-space()='Slå mobiladgang til']");
  step("Mobilserveren startet af appen", await waitText("Mobiladgang er slået til", 40000));
  await sleep(500);
  await js("document.getElementById('mobil').scrollIntoView()");
  await shot("mobil-indstillinger");
  // Pair a "phone" over HTTPS with the computer's own CA (the app's config dir holds it).
  const { code } = await (async () => {
    // The pairing button is only shown with a LAN address; create the code through the UI when possible.
    const btn = await js("return !!document.evaluate(\"//button[normalize-space()='Parr en telefon']\", document, null, 9, null).singleNodeValue");
    if (btn) {
      await click("//button[normalize-space()='Parr en telefon']");
      await sleep(500);
      return { code: String(await js("return document.querySelector('.pair-code').textContent")).replace(/\s/g, "") };
    }
    return { code: null };
  })();
  const ca = readFileSync(join(configDir, "mobile", "ca.crt"), "utf8");
  const call = (method, path, body, token) =>
    new Promise((ok, fail) => {
      const data = body ? Buffer.from(JSON.stringify(body)) : null;
      const req = request({ host: "127.0.0.1", port: 4730, path, method, ca, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(data ? { "content-type": "application/json", "content-length": data.length } : {}) } }, (res) => {
        let t = "";
        res.on("data", (c) => (t += c));
        res.on("end", () => ok({ status: res.statusCode, body: t.startsWith("{") || t.startsWith("[") ? JSON.parse(t) : t }));
      });
      req.on("error", fail);
      if (data) req.write(data);
      req.end();
    });
  step("HTTPS med PPM's egen CA", (await call("GET", "/")).status === 200);
  step("API kræver parring", (await call("GET", "/api/overview")).status === 401);
  if (code) {
    const p = await call("POST", "/api/pair", { code, name: "Test-iPhone" });
    step("Telefon parret med koden fra appen", p.status === 200, code);
    const ov = await call("GET", "/api/overview", null, p.body.token);
    step("Overblik på telefonen", ov.status === 200 && Array.isArray(ov.body.overdue));
    await sleep(11000);
    step("Telefonen står i listen i appen", await waitText("Test-iPhone", 15000));
    await shot("mobil-parret");
  } else {
    step("Ingen LAN-adresse i containeren: parring testet i servertesten", true);
  }
  await click("//button[normalize-space()='Slå fra']");
  await sleep(1500);
  step("Slået fra igen", await waitText("Slå mobiladgang til", 10000));
} catch (e) {
  step("Uventet fejl", false, e.message);
  await shot("fejl").catch(() => undefined);
} finally {
  await wd("DELETE", S("")).catch(() => undefined);
}
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} trin OK`);
process.exit(failed.length ? 1 : 0);
