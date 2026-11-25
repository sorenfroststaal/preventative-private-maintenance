// Smoke test of an installed or built ppm-mcp binary over stdio (used in CI on Windows).
//   node packages/mcp-server/scripts/smoke.mjs <ppm-mcp-binær> <arkiv>
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [bin, archive] = process.argv.slice(2);
if (!bin || !archive) {
  console.error("Brug: node smoke.mjs <ppm-mcp> <arkiv>");
  process.exit(2);
}
const client = new Client({ name: "ppm-smoke", version: "1" });
await client.connect(new StdioClientTransport({ command: bin, args: ["--archive", archive] }));
const fail = (m) => {
  console.error(`FEJL: ${m}`);
  process.exit(1);
};
const ins = client.getInstructions() ?? "";
if (ins.length === 0 || ins.length >= 700) fail(`instructions har ${ins.length} tegn`);
const tools = await client.listTools();
if (tools.tools.length !== 14) fail(`${tools.tools.length} værktøjer`);
const size = JSON.stringify(tools).length;
if (size >= 10000) fail(`tools/list er ${size} tegn`);
const ov = await client.callTool({ name: "overview", arguments: {} });
const text = ov.content[0].text;
if (ov.isError) fail(text);
if (text.length >= 1500) fail(`overview er ${text.length} tegn`);
const r = await client.callTool({ name: "recipes", arguments: { q: "kødsovs" } });
if (r.isError || !r.content[0].text.includes("Pasta med kødsovs")) fail("recipes fandt ikke Pasta med kødsovs");
console.log(`OK: ${tools.tools.length} værktøjer, tools/list ${size} tegn, overview ${text.length} tegn, instructions ${ins.length} tegn`);
await client.close();
