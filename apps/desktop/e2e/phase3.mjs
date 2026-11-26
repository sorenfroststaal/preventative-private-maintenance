// E2E for phase 3 against the real app (release build) via tauri-driver + WebKitWebDriver,
// with a real MCP client talking to the built ppm-mcp binary while the app is open.
//
//   pnpm build && pnpm seed -- --archive ./local-data/e2e3
//   Xvfb :99 & DISPLAY=:99 openbox & DISPLAY=:99 tauri-driver &
//   DISPLAY=:99 node apps/desktop/e2e/phase3.mjs ./local-data/e2e3 ./local-data/screens
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { startApp } from "./lib.mjs";

const archive = resolve(process.argv[2] ?? "./local-data/e2e3");
const shots = resolve(process.argv[3] ?? "./local-data/screens");
const { wd, S, click, js, shot, has, waitText, step, sleep, finish } = await startApp({ archive, shots });
const mcpBin = resolve("apps/desktop/src-tauri/target/release/resources/mcp/ppm-mcp");
const sdk = createRequire(resolve("packages/mcp-server/package.json"));
const { Client } = await import(sdk.resolve("@modelcontextprotocol/sdk/client/index.js"));
const { StdioClientTransport } = await import(sdk.resolve("@modelcontextprotocol/sdk/client/stdio.js"));

try {
  await wd("POST", S("/window/rect"), { width: 1440, height: 1000 }).catch(() => undefined);
  await sleep(1500);
  if (await has("Fjern låsen og åbn")) await click("//button[normalize-space()='Fjern låsen og åbn']");
  await click("//label[contains(., 'Anna Eksempel')]");
  await click("//button[normalize-space()='Fortsæt']");
  step("Login", await waitText("Se ugens madplan"));

  // A real MCP client uses the built binary while the app has the archive open.
  const downloads = join(homedir(), "Downloads");
  mkdirSync(downloads, { recursive: true });
  const receipt = join(downloads, "kvittering-robotstoevsuger.pdf");
  writeFileSync(receipt, "%PDF-1.4\n% syntetisk kvittering til E2E\n");
  const client = new Client({ name: "e2e-klient", version: "1" });
  await client.connect(new StdioClientTransport({ command: mcpBin, args: ["--archive", archive] }));
  const ov = await client.callTool({ name: "overview", arguments: {} });
  step("MCP: overview mens appen kører", !ov.isError && ov.content[0].text.length < 1500, `${ov.content[0].text.length} tegn`);
  const p = await client.callTool({
    name: "propose",
    arguments: {
      rationale: "Robotstøvsuger med kvittering og en ny ret",
      ops: [
        { op: "create", type: "item", data: { name: "Robotstøvsuger", purchase_date: "2026-11-20", purchase_price_minor: 249900 } },
        { op: "attach_document", data: { file_path: receipt, target: "$1", role: "receipt" } },
        { op: "create", type: "recipe", data: { name: "Kyllingesalat", servings: 4, ingredients: ["400 g kyllingebryst", "1 salathoved", "2 dl yoghurt"] } },
        { op: "create", type: "meal_plan_entry", data: { plan_date: "2026-11-29", recipe_id: "$3", servings: 4 } },
      ],
    },
  });
  const group = JSON.parse(p.content[0].text);
  step("MCP: propose opretter én kladdegruppe", !p.isError && group.n === 4 && group.status === "pending", p.content[0].text);
  await client.close();

  await click("//nav//a[contains(., 'AI-indbakke')]");
  step("AI-indbakke viser gruppen", await waitText("Robotstøvsuger med kvittering og en ny ret"));
  let badge = null;
  for (let i = 0; i < 30 && badge !== "1"; i++) {
    badge = await js("return document.querySelector('nav a[href$=\"/ai\"] .badge')?.textContent ?? null");
    if (badge !== "1") await sleep(250);
  }
  step("Menuen viser antal ventende", badge === "1", String(badge));
  await click("//button[@aria-label='Vis detaljer for operation 3']");
  step("Operation kan foldes ud", await waitText("kyllingebryst"));
  await shot("ai-indbakke");
  await click("//button[contains(., 'Godkend alle')]");
  step("Godkend alle", await waitText("4 ændringer er godkendt"));
  await sleep(500);

  await click("//nav//a[contains(., 'Bolig og inventar')]");
  await click("//td[contains(., 'Robotstøvsuger')]");
  step("Genstanden er oprettet", await waitText("Robotstøvsuger"));
  await click("//nav//a[contains(., 'Madplan')]");
  step("Retten står på søndag", await waitText("Kyllingesalat"));

  await click("//nav//a[contains(., 'Indstillinger')]");
  step("AI-adgang i indstillinger", await waitText("Forbind en AI-klient"));
  step("Log over AI-adgang viser MCP-kald", (await waitText("e2e-klient")) && (await has("propose")));
  await js("document.querySelector('h2') && [...document.querySelectorAll('h2')].find(h => h.textContent === 'AI-adgang')?.scrollIntoView()");
  await sleep(300);
  await shot("indstillinger-ai");
  // Claude Desktop: self-test and writing claude_desktop_config.json (existing entries kept).
  const claudeDir = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "Claude");
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(join(claudeDir, "claude_desktop_config.json"), JSON.stringify({ globalShortcut: "Ctrl+Space", mcpServers: { andet: { command: "x" } } }));
  await click("//button[normalize-space()='Test forbindelsen']");
  step("Test forbindelsen", await waitText("Forbindelsen virker: serveren \"ppm\" svarer med 14 værktøjer", 25000));
  await click("//button[normalize-space()='Tilføj PPM til Claude Desktop']");
  await waitText("PPM er tilføjet");
  const cfg = JSON.parse(readFileSync(join(claudeDir, "claude_desktop_config.json"), "utf8"));
  step(
    "Tilføj PPM til Claude Desktop",
    cfg.globalShortcut === "Ctrl+Space" && cfg.mcpServers.andet.command === "x" && cfg.mcpServers.ppm.command.endsWith("ppm-mcp") && existsSync(join(claudeDir, "claude_desktop_config.json.ppm-backup")),
    cfg.mcpServers.ppm.command,
  );
  await shot("indstillinger-claude");
  await click("//summary[contains(., 'Andre måder')]"); await click("//button[normalize-space()='Lav ppm.mcpb til Claude Desktop']");
  await sleep(1500);
  const cache = join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "dk.ppm.desktop", "ppm.mcpb");
  const ok = existsSync(cache) && readFileSync(cache).subarray(0, 2).toString() === "PK";
  step("Lav ppm.mcpb til Claude Desktop bygger filen", ok, cache);
} catch (e) {
  step("Uventet fejl", false, e.message);
  await shot("fejl3").catch(() => undefined);
} finally {
  await finish();
}
