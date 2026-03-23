import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGroupA } from "./tools/group-a.js";
import { registerGroupB } from "./tools/group-b.js";
import { registerGroupC } from "./tools/group-c.js";
import { registerGroupD } from "./tools/group-d.js";
import { registerGroupE } from "./tools/group-e.js";
import { registerGroupF } from "./tools/group-f.js";
import { registerGroupG } from "./tools/group-g.js";
import { registerGroupH } from "./tools/group-h.js";
import { registerGroupI } from "./tools/group-i.js";
import { registerGroupJ } from "./tools/group-j.js";
import { registerGroupK } from "./tools/group-k.js";
import { registerGroupM } from "./tools/group-m.js";

/**
 * Create and configure a new MCP server instance with all tools registered.
 * For SSE mode, call this for each new connection.
 * For stdio mode, call this once at startup.
 */
export function createAndConfigureServer(): McpServer {
  const server = new McpServer({
    name: "schema-gov-it",
    version: "1.0.0",
  });

  registerGroupA(server);
  registerGroupB(server);
  registerGroupC(server);
  registerGroupD(server);
  registerGroupE(server);
  registerGroupF(server);
  registerGroupG(server);
  registerGroupH(server);
  registerGroupI(server);
  registerGroupJ(server);
  registerGroupK(server);
  registerGroupM(server);

  return server;
}
