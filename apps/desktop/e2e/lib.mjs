// Shared WebDriver helpers for the E2E scripts against the real app (tauri-driver).
// Linux: tauri-driver + WebKitWebDriver in Xvfb. Windows: tauri-driver + msedgedriver (WebView2).
// Plain WebDriver over HTTP, no extra dependencies. Only synthetic data (pnpm seed).
//
//   PPM_APP=<path to ppm-desktop>   default: the release build for this platform
//   PPM_WEBDRIVER=<url>             default: http://127.0.0.1:4444
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Where the desktop app reads config.json (same rule as the app and ppm-mcp). */
export function appConfigDir() {
  if (process.platform === "win32") return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "ppm");
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "ppm");
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "ppm");
}

export const appPath = () => resolve(process.env.PPM_APP ?? `apps/desktop/src-tauri/target/release/ppm-desktop${process.platform === "win32" ? ".exe" : ""}`);
export const ELEM = "element-6066-11e4-a52e-4f466cb85b84";

/**
 * Points the app at `archive`, starts it through WebDriver and returns the helpers.
 * Call `finish()` at the end: it closes the app, prints the summary and exits (1 on any failed step).
 */
export async function startApp({ archive, shots }) {
  const base = process.env.PPM_WEBDRIVER ?? "http://127.0.0.1:4444";
  mkdirSync(shots, { recursive: true });
  const configDir = appConfigDir();
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
  const session = await wd("POST", "/session", { capabilities: { alwaysMatch: { "tauri:options": { application: appPath() } } } });
  const sid = session.sessionId;
  const S = (p) => `/session/${sid}${p}`;
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
  const js = (script, ...args) => wd("POST", S("/execute/sync"), { script, args });
  const bodyText = async () => js("return document.body.innerText");
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
  async function finish() {
    await wd("DELETE", S("")).catch(() => undefined);
    const failed = results.filter((r) => !r.ok);
    console.log(`${results.length - failed.length}/${results.length} trin OK`);
    process.exit(failed.length ? 1 : 0);
  }
  return { wd, S, find, click, type, js, bodyText, shot, has, waitText, step, sleep, results, configDir, finish };
}
