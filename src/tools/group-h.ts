import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { executeTool } from "../executor.js";
import type { ToolResult } from "../types.js";

const LOG_DIR = join(process.cwd(), "logs");
const LOG_FILE = join(LOG_DIR, "usage_log.jsonl");

// -----------------------------------------------------------------------------
// GROUP H: Meta Tools
// -----------------------------------------------------------------------------

/** Log entry type for parsing usage logs */
interface LogEntry {
  timestamp?: string;
  tool?: string;
  args?: { query?: string };
  summary?: string;
}

export function registerGroupH(server: McpServer): void {

server.registerTool(
  "suggest_new_tools",
  {
    title: "Suggest New Tools",
    description: `Analyze usage logs to suggest new specialized tools.

**Args:** None

**Returns:**
- List of recommendations based on frequently queried types in raw SPARQL

**Note:** Requires at least 2 queries for the same type to suggest a tool.`,
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async () => {
    return executeTool<unknown>("suggest_new_tools", {}, async (): Promise<ToolResult<unknown>> => {
      if (!existsSync(LOG_FILE)) {
        return { success: true, data: { message: "No usage logs found yet." } };
      }

      const data = await readFile(LOG_FILE, "utf-8");
      const lines = data.trim().split("\n");

      const rawQueries: string[] = [];
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as LogEntry;
          if (entry.tool === "query_sparql" && entry.args?.query) {
            rawQueries.push(entry.args.query);
          }
        } catch {
          // Skip malformed lines
        }
      }

      const typeCounts: Record<string, number> = {};
      const regexType = /\ba\s+<([^>]+)>/g;

      for (const q of rawQueries) {
        let match;
        while ((match = regexType.exec(q)) !== null) {
          const typeUri = match[1];
          if (typeUri) {
            typeCounts[typeUri] = (typeCounts[typeUri] || 0) + 1;
          }
        }
      }

      const suggestions = Object.entries(typeCounts)
        .filter(([, count]) => count >= 2)
        .map(([uri, count]) => ({
          type: "New Tool Recommendation",
          reason: `You frequently query for instances of <${uri}> (${count} times).`,
          suggestion: `Consider adding a specialized tool: list_${uri.split("/").pop()?.toLowerCase()}`,
        }));

      if (suggestions.length === 0) {
        return {
          success: true,
          data: { message: "No clear patterns found in RAW queries yet to suggest new tools." },
        };
      }

      return { success: true, data: suggestions };
    });
  }
);

server.registerTool(
  "analyze_usage",
  {
    title: "Analyze Usage",
    description: `Analyze the server's own usage logs for patterns and errors.

**Args:** None

**Returns:**
- total_calls: Total number of tool invocations
- tool_breakdown: Calls per tool
- recent_errors: Last 5 distinct errors
- last_activity: Most recent timestamp`,
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async () => {
    return executeTool<unknown>("analyze_usage", {}, async (): Promise<ToolResult<unknown>> => {
      if (!existsSync(LOG_FILE)) {
        return { success: true, data: { message: "No usage logs found yet." } };
      }

      const data = await readFile(LOG_FILE, "utf-8");
      const lines = data.trim().split("\n");

      let totalCalls = 0;
      const toolUsage: Record<string, number> = {};
      const errors: string[] = [];
      const recentTimestamps: string[] = [];

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as LogEntry;
          totalCalls++;

          if (entry.tool) {
            toolUsage[entry.tool] = (toolUsage[entry.tool] || 0) + 1;
          }

          if (entry.summary?.startsWith("Error")) {
            errors.push(`[${entry.tool}] ${entry.summary}`);
          }

          if (entry.timestamp) {
            recentTimestamps.push(entry.timestamp);
          }
        } catch {
          // Skip malformed lines
        }
      }

      const distinctErrors = [...new Set(errors)].slice(0, 5);
      const lastActivity = recentTimestamps.slice(-5).pop();

      return {
        success: true,
        data: {
          total_calls: totalCalls,
          tool_breakdown: toolUsage,
          recent_errors: distinctErrors,
          last_activity: lastActivity,
        },
      };
    });
  }
);

}
