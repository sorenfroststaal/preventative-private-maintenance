import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, promises as fsp, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { localDate, openArchiveForAi, type Archive } from "@ppm/core";
import { nodeEnv } from "@ppm/core/node";
import { createDemoArchive } from "../../core/scripts/seed";
import { createPpmServer, toolList } from "../src/server";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const f of cleanup.splice(0)) await f();
});

async function connect() {
  const now = new Date("2026-11-24T10:00:00.000Z");
  const env = nodeEnv({ clock: { nowIso: () => now.toISOString(), today: () => localDate(now), now: () => new Date(now) } });
  const dir = mkdtempSync(join(tmpdir(), "ppm-mcp-"));
  const info = await createDemoArchive(env, join(dir, "arkiv"));
  const archive: Archive = await openArchiveForAi(env, info.root);
  const server = createPpmServer({ env, archive, homeDir: dir, realpath: async (p) => realpathSync(p), sep });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "testklient", version: "1.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  cleanup.push(async () => {
    await client.close();
    await archive.close();
    await fsp.rm(dir, { recursive: true, force: true });
  });
  return { client, archive };
}

describe("phase 3.1 / 3.8 – MCP protocol and few tokens", () => {
  it("initialize returns Danish instructions under 700 characters", async () => {
    const { client } = await connect();
    const ins = client.getInstructions() ?? "";
    expect(ins.length).toBeGreaterThan(100);
    expect(ins.length).toBeLessThan(700);
    expect(ins).toMatch(/AI-indbakke/);
    expect(client.getServerVersion()?.name).toBe("ppm");
  });

  it("at most 14 tools, descriptions ≤ 160 characters, tools/list under 10 000 characters, no field descriptions", async () => {
    const { client } = await connect();
    const list = await client.listTools();
    expect(list.tools.length).toBeLessThanOrEqual(14);
    expect(list.tools.map((t) => t.name).sort()).toEqual(
      ["document", "draft_status", "finance", "get", "health", "history", "inbox", "list", "meal_plan", "overview", "propose", "recipes", "search", "tasks"].sort(),
    );
    expect(JSON.stringify(list).length).toBeLessThan(10_000);
    for (const t of list.tools) {
      expect((t.description ?? "").length, t.name).toBeLessThanOrEqual(160);
      expect(JSON.stringify(t.inputSchema), t.name).not.toMatch(/"description"/);
      expect(JSON.stringify(t.inputSchema), t.name).not.toMatch(/\$schema|additionalProperties/);
    }
    expect(toolList()).toHaveLength(list.tools.length);
  });

  it("tool calls over the protocol are compact, accept 8-char refs and are logged with the client's name", async () => {
    const { client, archive } = await connect();
    const r = await client.callTool({ name: "recipes", arguments: { q: "kødsovs" } });
    const text = (r.content as { type: string; text: string }[])[0]!.text;
    expect(text).not.toMatch(/null|\s{2}|"":/);
    const ref = JSON.parse(text).items[0].ref as string;
    expect(ref).toMatch(/^[0-9a-f]{8}$/);
    const g = await client.callTool({ name: "get", arguments: { ref } });
    expect(JSON.parse((g.content as { text: string }[])[0]!.text)).toMatchObject({ type: "recipe", name: "Pasta med kødsovs" });
    const bad = await client.callTool({ name: "health", arguments: { person: ref } });
    expect(bad.isError).toBe(true);
    const log = await archive.db.select<{ tool: string; client_name: string }>("SELECT tool, client_name FROM ai_access_log ORDER BY rowid");
    expect(log).toEqual([
      { tool: "recipes", client_name: "testklient" },
      { tool: "get", client_name: "testklient" },
      { tool: "health", client_name: "testklient" },
    ]);
  });

  it("returns the version error when the archive does not match the server", async () => {
    const { client, archive } = await connect();
    await archive.db.execute("INSERT INTO schema_migrations (version, applied_at) VALUES (99, 'x')");
    const r = await client.callTool({ name: "overview", arguments: {} });
    expect(r.isError).toBe(true);
    expect((r.content as { text: string }[])[0]!.text).toMatch(/Arkivets version \(99\) passer ikke til MCP-serveren \(2\)/);
  });
});
