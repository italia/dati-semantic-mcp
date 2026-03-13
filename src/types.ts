// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/** SPARQL binding value with type information */
export interface SparqlBindingValue {
  type: string;
  value: string;
  datatype?: string;
  "xml:lang"?: string;
}

/** SPARQL result binding row */
export interface SparqlBinding {
  [key: string]: SparqlBindingValue;
}

/** Full SPARQL query result structure */
export interface SparqlResult {
  head: { vars: string[] };
  results: { bindings: SparqlBinding[] };
}

/** Compressed result format for large datasets */
export interface CompressedTabular {
  headers: string[];
  rows: (string | null)[][];
}

/** Compressed result format for small datasets */
export type CompressedSimple = Record<string, string>[];

/** Union type for compressed SPARQL results */
export type CompressedResult = CompressedTabular | CompressedSimple | [];

/** Successful tool result */
export interface ToolSuccess<T = unknown> {
  success: true;
  data: T;
  rowCount?: number;
  sourceData?: unknown;
}

/** Error tool result */
export interface ToolError {
  success: false;
  error: string;
  suggestion?: string;
}

/** Union type for tool results */
export type ToolResult<T = unknown> = ToolSuccess<T> | ToolError;

/** MCP tool response format with index signature for SDK compatibility */
export interface McpToolResponse {
  [x: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export interface RecommendedExternalEndpoint {
  id: string;
  name: string;
  endpointUrl: string;
  category: "italian-pa" | "eu" | "knowledge-graph";
  whySuggested: string;
  bestFor: string[];
  relatedTo: string[];
  exampleQueryIdea: string;
  status: "curated";
}
