/**
 * MCP server for PPM (spec 06). A thin protocol layer: tool logic, access control and
 * logging live in @ppm/core (runTool). The server writes only ai_draft, ai_access_log and
 * files in indbakke/ai/ – through core's propose and log functions.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { runTool, SERVER_INSTRUCTIONS, TOOL_DESCRIPTIONS, TOOL_INPUTS, TOOL_NAMES, type ToolDeps } from "@ppm/core";

export const SERVER_VERSION = "0.1.0";

/** JSON Schema without noise ($schema, additionalProperties, defaults) to keep tools/list small. */
function inputSchema(shape: z.ZodRawShape): Record<string, unknown> {
  const json = zodToJsonSchema(z.object(shape), { $refStrategy: "none", target: "jsonSchema7" }) as Record<string, unknown>;
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === "object") {
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) {
        if (k === "$schema" || k === "additionalProperties" || k === "default") continue;
        o[k] = strip(x);
      }
      return o;
    }
    return v;
  };
  const out = strip(json) as Record<string, unknown>;
  out.type = "object";
  return out;
}

export function toolList() {
  return TOOL_NAMES.map((name) => ({
    name,
    description: TOOL_DESCRIPTIONS[name],
    inputSchema: inputSchema(TOOL_INPUTS[name] as z.ZodRawShape),
  }));
}

export function createPpmServer(deps: Omit<ToolDeps, "clientName">): Server {
  const server = new Server({ name: "ppm", version: SERVER_VERSION }, { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS });
  const tools = toolList();
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const clientName = server.getClientVersion()?.name ?? null;
    const r = await runTool({ ...deps, clientName }, req.params.name, req.params.arguments ?? {});
    return r as never;
  });
  return server;
}
