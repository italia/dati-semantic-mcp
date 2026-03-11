import { appendFile } from "fs/promises";
import { join } from "path";
import type { ToolResult, McpToolResponse } from "./types.js";
import { CHARACTER_LIMIT } from "./constants.js";
import { executeSparql, compressSparqlResult } from "./sparql.js";

const LOG_DIR = join(process.cwd(), "logs");
const LOG_FILE = join(LOG_DIR, "usage_log.jsonl");

// =============================================================================
// LOGGING
// =============================================================================

/** Log tool usage to JSONL file */
export async function logUsage(
  toolName: string,
  args: Record<string, unknown>,
  resultSummary: string
): Promise<void> {
  const entry = {
    timestamp: new Date().toISOString(),
    tool: toolName,
    args,
    summary: resultSummary,
  };
  try {
    await appendFile(LOG_FILE, JSON.stringify(entry) + "\n");
  } catch (err) {
    console.error("Failed to log usage:", err);
  }
}

// =============================================================================
// TOOL EXECUTION HELPERS
// =============================================================================

/** Extract error message from unknown error */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/** Truncate text to CHARACTER_LIMIT with indicator */
export function truncateResult(text: string): { text: string; truncated: boolean } {
  if (text.length <= CHARACTER_LIMIT) {
    return { text, truncated: false };
  }
  const truncated = text.slice(0, CHARACTER_LIMIT);
  return { text: truncated, truncated: true };
}

/**
 * Central helper for executing tools with consistent error handling, logging, and truncation.
 * @param toolName - Name of the tool for logging
 * @param args - Tool arguments for logging
 * @param handler - Async function that performs the tool operation
 */
export async function executeTool<T>(
  toolName: string,
  args: Record<string, unknown>,
  handler: () => Promise<ToolResult<T>>
): Promise<McpToolResponse> {
  console.error(`[Tool] Executing: ${toolName}`, args);
  try {
    const result = await handler();
    console.error(`[Tool] ${toolName} completed: ${result.success ? 'SUCCESS' : 'FAILURE'}`);

    if (!result.success) {
      await logUsage(toolName, args, `Error: ${result.error}`);
      let errorText = `Error: ${result.error}`;
      if (result.suggestion) {
        errorText += `\nSuggestion: ${result.suggestion}`;
      }
      return {
        content: [{ type: "text", text: errorText }],
        isError: true,
      };
    }

    const jsonText = JSON.stringify(result.data);
    const { text, truncated } = truncateResult(jsonText);

    const rowInfo = result.rowCount !== undefined ? `, ${result.rowCount} rows` : "";
    await logUsage(toolName, args, `Success${rowInfo}${truncated ? " (truncated)" : ""}`);

    if (truncated) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            _truncated: true,
            _message: `Result exceeded ${CHARACTER_LIMIT} characters and was truncated`,
            data: JSON.parse(text.slice(0, text.lastIndexOf("}") + 1) || "null")
          })
        }],
      };
    }

    return {
      content: [{ type: "text", text }],
    };
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    console.error(`[Tool] ${toolName} error:`, message);
    await logUsage(toolName, args, `Error: ${message}`);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
}

/**
 * Specialized helper for SPARQL-based tools.
 * Handles query execution, compression, and standard response formatting.
 */
export async function executeSparqlTool(
  toolName: string,
  args: Record<string, unknown>,
  query: string
): Promise<McpToolResponse> {
  return executeTool(toolName, args, async () => {
    const result = await executeSparql(query);
    const rowCount = result.results?.bindings?.length ?? 0;
    const compressed = compressSparqlResult(result);
    return { success: true, data: compressed, rowCount };
  });
}
