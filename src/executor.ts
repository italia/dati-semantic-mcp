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
  resultSummary: string,
  options?: {
    sourceData?: unknown;
    aiData?: unknown;
  }
): Promise<void> {
  const entry = {
    timestamp: new Date().toISOString(),
    tool: toolName,
    args,
    summary: resultSummary,
    source_data_metrics: buildDataMetrics(options?.sourceData),
    ai_data_metrics: buildDataMetrics(options?.aiData),
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

function buildDataMetrics(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined;
  }

  try {
    const json = JSON.stringify(value);
    const metrics: Record<string, unknown> = {
      chars: json.length,
    };

    if (Array.isArray(value)) {
      metrics.kind = "array";
      metrics.items = value.length;
    } else if (value && typeof value === "object") {
      metrics.kind = "object";
      metrics.keys = Object.keys(value as Record<string, unknown>).length;

      const sparqlLike = value as {
        head?: { vars?: unknown[] };
        results?: { bindings?: unknown[] };
      };
      if (Array.isArray(sparqlLike.head?.vars)) {
        metrics.vars = sparqlLike.head.vars.length;
      }
      if (Array.isArray(sparqlLike.results?.bindings)) {
        metrics.rows = sparqlLike.results.bindings.length;
      }
    } else {
      metrics.kind = typeof value;
    }

    return metrics;
  } catch (error: unknown) {
    return {
      _serialization_error: getErrorMessage(error),
    };
  }
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
      let errorText = `Error: ${result.error}`;
      if (result.suggestion) {
        errorText += `\nSuggestion: ${result.suggestion}`;
      }
      await logUsage(toolName, args, `Error: ${result.error}`, {
        aiData: { error: result.error, suggestion: result.suggestion },
      });
      return {
        content: [{ type: "text", text: errorText }],
        isError: true,
      };
    }

    const jsonText = JSON.stringify(result.data);
    const { text, truncated } = truncateResult(jsonText);

    const rowInfo = result.rowCount !== undefined ? `, ${result.rowCount} rows` : "";
    const aiData = truncated
      ? {
          _truncated: true,
          _message: `Result exceeded ${CHARACTER_LIMIT} characters and was truncated`,
          chars_before_truncation: jsonText.length,
          chars_sent_to_ai: text.length,
        }
      : {
          chars_sent_to_ai: text.length,
          payload: result.data,
        };

    await logUsage(toolName, args, `Success${rowInfo}${truncated ? " (truncated)" : ""}`, {
      sourceData: result.sourceData,
      aiData,
    });

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
    await logUsage(toolName, args, `Error: ${message}`, {
      aiData: { error: message },
    });
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
    return { success: true, data: compressed, rowCount, sourceData: result };
  });
}
