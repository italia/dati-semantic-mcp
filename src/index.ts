#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { appendFile, readFile, stat } from "fs/promises";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";
import { Store as OxStore } from "oxigraph";
import type { Term as OxTerm } from "oxigraph";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { randomUUID } from "crypto";

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/** SPARQL binding value with type information */
interface SparqlBindingValue {
  type: string;
  value: string;
  datatype?: string;
  "xml:lang"?: string;
}

/** SPARQL result binding row */
interface SparqlBinding {
  [key: string]: SparqlBindingValue;
}

/** Full SPARQL query result structure */
interface SparqlResult {
  head: { vars: string[] };
  results: { bindings: SparqlBinding[] };
}

/** Compressed result format for large datasets */
interface CompressedTabular {
  headers: string[];
  rows: (string | null)[][];
}

/** Compressed result format for small datasets */
type CompressedSimple = Record<string, string>[];

/** Union type for compressed SPARQL results */
type CompressedResult = CompressedTabular | CompressedSimple | [];

/** Successful tool result */
interface ToolSuccess<T = unknown> {
  success: true;
  data: T;
  rowCount?: number;
}

/** Error tool result */
interface ToolError {
  success: false;
  error: string;
  suggestion?: string;
}

/** Union type for tool results */
type ToolResult<T = unknown> = ToolSuccess<T> | ToolError;

/** MCP tool response format with index signature for SDK compatibility */
interface McpToolResponse {
  [x: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

interface RecommendedExternalEndpoint {
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

// =============================================================================
// CONSTANTS
// =============================================================================

/** Maximum character limit for tool responses to prevent excessive output */
const CHARACTER_LIMIT = 50_000;

const LOG_DIR = join(process.cwd(), "logs");
const LOG_FILE = join(LOG_DIR, "usage_log.jsonl");
const BROWSER_LIKE_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

// =============================================================================
// UPLOADED STORE REGISTRY (module-level, shared between HTTP handler and tools)
// =============================================================================

/** Temporary ontology store created via HTTP POST /upload, keyed by UUID */
interface UploadedStoreEntry {
  store: OxStore;
  format: string;
  tripleCount: number;
  created: number;
}

const uploadedStores = new Map<string, UploadedStoreEntry>();
const MAX_UPLOAD_SIZE = 1_000_000; // 1 MB hard limit for HTTP uploads
const UPLOAD_TTL_MS = 3_600_000;   // Evict stores after 1 hour

/** Read raw HTTP body up to maxBytes; rejects with RangeError if exceeded. */
function readRawBodyWithLimit(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        reject(new RangeError(`Body exceeds ${maxBytes} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Remove uploaded stores older than UPLOAD_TTL_MS */
function evictExpiredUploads(): void {
  const cutoff = Date.now() - UPLOAD_TTL_MS;
  for (const [id, entry] of uploadedStores) {
    if (entry.created < cutoff) uploadedStores.delete(id);
  }
}

/**
 * Create and configure a new MCP server instance with all tools registered.
 * For SSE mode, call this for each new connection.
 * For stdio mode, call this once at startup.
 */
function createAndConfigureServer(): McpServer {
  const server = new McpServer({
    name: "schema-gov-it",
    version: "1.0.0",
  });

// =============================================================================
// LOGGING
// =============================================================================

/** Log tool usage to JSONL file */
async function logUsage(
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

// SPARQL Endpoint
const ENDPOINT = "https://schema.gov.it/sparql";

// Sanitize string literals for safe SPARQL interpolation
function sanitizeSparqlString(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

// Sanitize URIs for safe SPARQL interpolation (only allow valid URI characters)
function sanitizeSparqlUri(input: string): string {
  if (!/^https?:\/\/[^\s<>"{}|\\^`]+$/.test(input)) {
    throw new Error(`Invalid URI: ${input}`);
  }
  return input;
}

const PREFIXES = `
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX dct: <http://purl.org/dc/terms/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX dcat: <http://www.w3.org/ns/dcat#>
PREFIX foaf: <http://xmlns.com/foaf/0.1/>
PREFIX clv: <https://w3id.org/italia/onto/CLV/>
PREFIX cpv: <https://w3id.org/italia/onto/CPV/>
PREFIX l0: <https://w3id.org/italia/onto/l0/>
PREFIX sm: <https://w3id.org/italia/onto/SM/>
`;

const RECOMMENDED_EXTERNAL_ENDPOINTS: RecommendedExternalEndpoint[] = [
  {
    id: "lod-dati-gov-it",
    name: "lod.dati.gov.it SPARQL",
    endpointUrl: "https://lod.dati.gov.it/sparql",
    category: "italian-pa",
    whySuggested: "National linked open data endpoint for Italian public datasets and metadata, useful as a natural extension of schema.gov.it exploration.",
    bestFor: ["dataset metadata", "catalog linking", "DCAT exploration", "public sector discovery"],
    relatedTo: ["dati.gov.it", "catalogo nazionale open data", "DCAT-AP_IT"],
    exampleQueryIdea: "Start from concepts or vocabularies in schema.gov.it, then inspect linked dataset metadata and distributions in the national catalog.",
    status: "curated",
  },
  {
    id: "dati-cultura",
    name: "dati.cultura.gov.it SPARQL",
    endpointUrl: "https://dati.cultura.gov.it/sparql",
    category: "italian-pa",
    whySuggested: "Italian culture domain endpoint for heritage, institutions, and cultural linked data modeled with national semantics.",
    bestFor: ["cultural heritage", "museums", "archives", "domain-specific linked data"],
    relatedTo: ["MiC", "beni culturali", "knowledge graphs della cultura"],
    exampleQueryIdea: "Reuse shared concepts from schema.gov.it to explore cultural entities, places, and heritage datasets.",
    status: "curated",
  },
  {
    id: "dati-camera",
    name: "dati.camera.it SPARQL",
    endpointUrl: "https://dati.camera.it/sparql",
    category: "italian-pa",
    whySuggested: "Rich institutional linked open data from the Italian Chamber of Deputies, useful for public sector entity linking.",
    bestFor: ["institutional data", "persons", "organizations", "legislative references"],
    relatedTo: ["dati.camera.it", "open data PA", "entity reconciliation"],
    exampleQueryIdea: "Link people, organizations, or roles found in schema.gov.it against parliamentary resources.",
    status: "curated",
  },
  {
    id: "dati-senato",
    name: "dati.senato.it SPARQL",
    endpointUrl: "https://dati.senato.it/sparql",
    category: "italian-pa",
    whySuggested: "Institutional RDF endpoint complementary to Camera data for cross-checking public administration actors and legislative entities.",
    bestFor: ["institutional data", "senate acts", "persons", "cross-checking"],
    relatedTo: ["dati.senato.it", "open data PA", "interoperability"],
    exampleQueryIdea: "Compare entities or legal references across multiple Italian institutional datasets.",
    status: "curated",
  },
  {
    id: "eu-publications",
    name: "EU Publications Office SPARQL",
    endpointUrl: "https://publications.europa.eu/webapi/rdf/sparql",
    category: "eu",
    whySuggested: "Reference endpoint for EU vocabularies, legal resources, and interoperability artifacts often linked from Italian public data.",
    bestFor: ["EU vocabularies", "legal metadata", "authority tables", "cross-border mappings"],
    relatedTo: ["EUR-Lex ecosystem", "DCAT-AP", "European interoperability"],
    exampleQueryIdea: "Resolve controlled vocabularies or legal concepts connected to Italian datasets and metadata profiles.",
    status: "curated",
  },
  {
    id: "wikidata",
    name: "Wikidata Query Service",
    endpointUrl: "https://query.wikidata.org/sparql",
    category: "knowledge-graph",
    whySuggested: "Broad public knowledge graph useful for enrichment and entity linking after you identify concepts in schema.gov.it.",
    bestFor: ["entity enrichment", "place data", "cross-dataset identifiers", "background knowledge"],
    relatedTo: ["Wikidata", "entity linking", "semantic enrichment"],
    exampleQueryIdea: "Enrich municipalities, organizations, or concepts discovered in schema.gov.it with external identifiers.",
    status: "curated",
  },
  {
    id: "dbpedia",
    name: "DBpedia SPARQL",
    endpointUrl: "https://dbpedia.org/sparql",
    category: "knowledge-graph",
    whySuggested: "General-purpose linked data endpoint still useful for simple lookups and alignment experiments.",
    bestFor: ["quick lookups", "sameAs checks", "exploratory linking"],
    relatedTo: ["DBpedia", "linked open data", "alignment testing"],
    exampleQueryIdea: "Test owl:sameAs or skos mappings from Italian concepts toward well-known public resources.",
    status: "curated",
  },
];

async function executeSparql(
  query: string,
  endpoint: string = ENDPOINT,
  injectPrefixes: boolean = true,
  timeoutMs: number = 30000
): Promise<SparqlResult> {
  const fullQuery = injectPrefixes ? PREFIXES + "\n" + query : query;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const isExternalEndpoint = endpoint !== ENDPOINT;
  const baseHeaders: Record<string, string> = {
    "Accept": "application/sparql-results+json",
  };

  if (isExternalEndpoint) {
    baseHeaders["User-Agent"] = BROWSER_LIKE_USER_AGENT;
    baseHeaders["Accept-Language"] = "it-IT,it;q=0.9,en;q=0.8";
  }

  try {
    const postResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        ...baseHeaders,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ query: fullQuery }),
      signal: controller.signal,
    });

    if (postResponse.ok) {
      return postResponse.json() as Promise<SparqlResult>;
    }

    // Some public endpoints behind proxies/WAFs reject POST from API clients
    // but accept browser-like GET requests for the same SPARQL query.
    if (isExternalEndpoint && postResponse.status === 403) {
      const getUrl = new URL(endpoint);
      getUrl.searchParams.set("query", fullQuery);

      const getResponse = await fetch(getUrl.toString(), {
        method: "GET",
        headers: baseHeaders,
        signal: controller.signal,
      });

      if (getResponse.ok) {
        return getResponse.json() as Promise<SparqlResult>;
      }

      const getErrBody = await getResponse.text().catch(() => "");
      throw new Error(buildSparqlDiagnosticMessage(getResponse.status, getResponse.statusText, getErrBody));
    }

    const postErrBody = await postResponse.text().catch(() => "");
    throw new Error(buildSparqlDiagnosticMessage(postResponse.status, postResponse.statusText, postErrBody));
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `SPARQL timeout after ${timeoutMs}ms${endpoint !== ENDPOINT ? ` (endpoint: ${endpoint})` : ""}. ` +
        `Suggestion: add LIMIT, simplify OPTIONAL/UNION blocks, or split into smaller queries.`
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

// =============================================================================
// RESULT COMPRESSION
// =============================================================================

/** Compress SPARQL results for token efficiency */
function compressSparqlResult(result: SparqlResult): CompressedResult {
  if (!result?.results?.bindings) return [];

  const bindings = result.results.bindings;
  if (bindings.length === 0) return [];

  // Optimization: For lists > 5 items, return tabular format to save tokens on repeated keys
  if (bindings.length > 5) {
    const firstBinding = bindings[0];
    const headers = result.head?.vars || (firstBinding ? Object.keys(firstBinding) : []);
    const rows = bindings.map((b: SparqlBinding) => {
      return headers.map((h: string) => b[h]?.value ?? null);
    });
    return { headers, rows };
  }

  // Standard compact format for small results
  const simplified: CompressedSimple = bindings.map((binding: SparqlBinding) => {
    const row: Record<string, string> = {};
    for (const key in binding) {
      if (Object.prototype.hasOwnProperty.call(binding, key)) {
        const bindingValue = binding[key];
        if (bindingValue) {
          row[key] = bindingValue.value;
        }
      }
    }
    return row;
  });

  return simplified;
}

// =============================================================================
// TOOL EXECUTION HELPERS
// =============================================================================

/** Extract error message from unknown error */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/** Build a diagnostic error message from a failed SPARQL HTTP response */
function buildSparqlDiagnosticMessage(
  status: number,
  statusText: string,
  body: string
): string {
  const preview = body.slice(0, 400).trim();

  if (/timeout|time.?limit|time limit exceeded/i.test(body)) {
    return `SPARQL endpoint timeout (HTTP ${status}). The query exceeded the server time limit. Suggestion: add LIMIT, simplify OPTIONAL/UNION blocks, or split into smaller queries.`;
  }
  if (/result.?set.?too.?large|too many results|maxRows/i.test(body)) {
    return `SPARQL result set too large (HTTP ${status}). Suggestion: add a LIMIT clause or narrow your filters.`;
  }
  if (/undefined.?prefix|unknown.?prefix|undefined.?namespace|QName/i.test(body)) {
    return `SPARQL prefix not defined (HTTP ${status}). Check that all namespace prefixes used in the query are declared.${preview ? ` Details: ${preview}` : ""}`;
  }
  if (/syntax.?error|parse.?error|lexical.?error|unexpected token/i.test(body)) {
    return `SPARQL syntax error (HTTP ${status}). Check query syntax.${preview ? ` Details: ${preview}` : ""}`;
  }
  if (status === 503 || /service.?unavailable|temporarily unavailable/i.test(body)) {
    return `SPARQL endpoint temporarily unavailable (HTTP ${status}). Retry later.`;
  }
  if (status === 500) {
    return `SPARQL internal server error (HTTP 500).${preview ? ` Details: ${preview}` : " No error details available from endpoint."}`;
  }

  return `SPARQL request failed: ${status} ${statusText}${preview ? `. Details: ${preview}` : ""}`;
}

/** Truncate text to CHARACTER_LIMIT with indicator */
function truncateResult(text: string): { text: string; truncated: boolean } {
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
async function executeTool<T>(
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
async function executeSparqlTool(
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

// =============================================================================
// LOCAL ONTOLOGY SUPPORT (oxigraph)
// =============================================================================

interface LocalStoreEntry {
  store: OxStore;
  mtime: number;
  format: string;
  tripleCount: number;
  etag?: string;
  lastModified?: string;
}

const localStoreCache = new Map<string, LocalStoreEntry>();

/** Max size for inline RDF content passed via the `content` parameter */
const MAX_INLINE_CONTENT_SIZE = 1_000_000; // ~1 MB

function detectFormatFromContentType(contentType: string): string | undefined {
  const ct = (contentType.split(";")[0] ?? "").trim().toLowerCase();
  if (ct === "text/turtle" || ct === "application/turtle") return "text/turtle";
  if (ct === "application/rdf+xml") return "application/rdf+xml";
  if (ct === "application/n-triples") return "application/n-triples";
  if (ct === "application/ld+json") return "application/ld+json";
  if (ct === "text/n3" || ct === "text/rdf+n3") return "text/n3";
  return undefined;
}

function detectRdfFormat(filePath: string): string {
  // Strip query string and fragment for URL detection
  const pathOnly = (filePath.split("?")[0] ?? "").split("#")[0] ?? "";
  const ext = pathOnly.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "ttl": return "text/turtle";
    case "n3":  return "text/n3";
    case "nt":  return "application/n-triples";
    case "jsonld":
    case "json": return "application/ld+json";
    case "owl":
    case "rdf":
    case "xml": return "application/rdf+xml";
    default:    return "text/turtle";
  }
}

async function getLocalStore(filePath: string): Promise<LocalStoreEntry> {
  const fileStat = await stat(filePath);
  const mtime = fileStat.mtimeMs;
  const cached = localStoreCache.get(filePath);
  if (cached && cached.mtime === mtime) return cached;

  const content = await readFile(filePath, "utf-8");
  const format = detectRdfFormat(filePath);
  const store = new OxStore();
  store.load(content, { format, lenient: true });

  const entry: LocalStoreEntry = { store, mtime, format, tripleCount: store.size };
  localStoreCache.set(filePath, entry);
  return entry;
}

/**
 * Resolve a local store from either a file path (cached) or inline content.
 * Exactly one of file_path or content must be provided.
 */
async function resolveLocalStore(
  filePath: string | undefined,
  content: string | undefined,
  format: string | undefined,
  uploadId?: string
): Promise<{ store: OxStore; tripleCount: number; format: string; source: string }> {
  const provided = [filePath, content, uploadId].filter(Boolean).length;
  if (provided > 1) {
    throw new Error("Provide exactly one of: file_path, content, or upload_id.");
  }
  if (provided === 0) {
    throw new Error("Provide one of: file_path (local server), content (remote server), or upload_id (HTTP upload).");
  }

  if (uploadId) {
    const entry = uploadedStores.get(uploadId);
    if (!entry) {
      throw new Error(`Upload store '${uploadId}' not found or expired. Upload a file first via POST /upload (stores expire after 1 hour).`);
    }
    return { store: entry.store, tripleCount: entry.tripleCount, format: entry.format, source: `upload:${uploadId}` };
  }

  if (filePath) {
    const entry = await getLocalStore(filePath);
    return { store: entry.store, tripleCount: entry.tripleCount, format: entry.format, source: filePath };
  }

  // Inline content path
  if (content!.length > MAX_INLINE_CONTENT_SIZE) {
    throw new Error(
      `Content length (${content!.length} chars) exceeds the ${MAX_INLINE_CONTENT_SIZE}-character limit. ` +
      `Use file_path instead for large ontologies.`
    );
  }
  const fmt = format ?? "text/turtle";
  const store = new OxStore();
  store.load(content!, { format: fmt, lenient: true });
  return { store, tripleCount: store.size, format: fmt, source: "inline" };
}

function oxTermToBindingValue(term: OxTerm): SparqlBindingValue {
  if (term.termType === "NamedNode") return { type: "uri", value: term.value };
  if (term.termType === "BlankNode") return { type: "bnode", value: term.value };
  if (term.termType === "Literal") {
    const bv: SparqlBindingValue = { type: "literal", value: term.value };
    if (term.language) bv["xml:lang"] = term.language;
    if (term.datatype) bv.datatype = term.datatype.value;
    return bv;
  }
  return { type: "literal", value: term.value };
}

function oxSelectToSparqlResult(rows: Map<string, OxTerm>[]): SparqlResult {
  const firstRow = rows[0];
  const vars = firstRow ? Array.from(firstRow.keys()) : [];
  const bindings: SparqlBinding[] = rows.map(row => {
    const b: SparqlBinding = {};
    for (const [k, v] of row.entries()) {
      if (v !== undefined) b[k] = oxTermToBindingValue(v);
    }
    return b;
  });
  return { head: { vars }, results: { bindings } };
}

function runLocalSparql(store: OxStore, query: string, injectPrefixes = true): SparqlResult {
  const fullQuery = injectPrefixes ? PREFIXES + "\n" + query : query;
  const raw = store.query(fullQuery, { use_default_graph_as_union: true });
  if (!Array.isArray(raw)) {
    return { head: { vars: [] }, results: { bindings: [] } };
  }
  return oxSelectToSparqlResult(raw as Map<string, OxTerm>[]);
}

// =============================================================================
// TOOL DEFINITIONS
// =============================================================================

// -----------------------------------------------------------------------------
// GROUP A: Foundation Tools
// -----------------------------------------------------------------------------

server.registerTool(
  "query_sparql",
  {
    title: "Execute SPARQL Query",
    description: `Execute a RAW SPARQL query against schema.gov.it.

**Args:**
- query: The SPARQL query to execute (prefixes are auto-injected)

**Returns:**
- Compressed JSON result (tabular for >5 rows, object array otherwise)

**Examples:**
- \`SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 10\`
- \`SELECT ?class (COUNT(?s) AS ?count) WHERE { ?s a ?class } GROUP BY ?class\`

**Note:** Use this for ad-hoc exploration. Prefer specialized tools for common operations.`,
    inputSchema: {
      query: z.string().describe("The SPARQL query to execute"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ query }) => executeSparqlTool("query_sparql", { query }, query)
);

server.registerTool(
  "explore_classes",
  {
    title: "Explore Classes",
    description: `List available classes in the ontology with instance counts.

**Args:**
- limit: Maximum number of classes to return (default: 50)
- filter: Optional regex filter for class URI (case-insensitive)

**Returns:**
- List of classes with instance counts, ordered by count descending

**Examples:**
- No args: Returns top 50 classes by instance count
- filter="Person": Returns classes containing "Person" in URI`,
    inputSchema: {
      limit: z.number().optional().default(50),
      filter: z.string().optional().describe("Optional text filter for class URI"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ limit, filter }) => {
    const safeFilter = filter ? sanitizeSparqlString(filter) : undefined;
    const query = `
      SELECT DISTINCT ?class (COUNT(?s) AS ?count)
      WHERE {
        ?s a ?class .
        ${safeFilter ? `FILTER(REGEX(STR(?class), "${safeFilter}", "i"))` : ""}
      }
      GROUP BY ?class
      ORDER BY DESC(?count)
      LIMIT ${limit}
    `;
    return executeSparqlTool("explore_classes", { limit, filter }, query);
  }
);


server.registerTool(
  "explore_catalog",
  {
    title: "Explore Catalog",
    description: `List named graphs and ontologies available in the endpoint.

**Args:** None

**Returns:**
- graphs: List of named graphs in the endpoint
- ontologies: List of owl:Ontology and skos:ConceptScheme resources

**Note:** Both queries run in parallel for performance.`,
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async () => {
    const graphsQuery = `
      SELECT DISTINCT ?g ?type
      WHERE {
        GRAPH ?g { ?s ?p ?o }
      }
      LIMIT 100
    `;
    const ontologiesQuery = `
      SELECT DISTINCT ?s ?type
      WHERE {
        VALUES ?type { owl:Ontology skos:ConceptScheme }
        ?s a ?type .
      }
      LIMIT 100
    `;

    return executeTool("explore_catalog", {}, async () => {
      // Execute both queries in parallel
      const [graphResult, ontResult] = await Promise.all([
        executeSparql(graphsQuery),
        executeSparql(ontologiesQuery),
      ]);

      return {
        success: true,
        data: {
          graphs: compressSparqlResult(graphResult),
          ontologies: compressSparqlResult(ontResult),
        },
        rowCount: (graphResult.results?.bindings?.length ?? 0) +
          (ontResult.results?.bindings?.length ?? 0),
      };
    });
  }
);

// -----------------------------------------------------------------------------
// GROUP B: Analytics Tools
// -----------------------------------------------------------------------------

server.registerTool(
  "check_coverage",
  {
    title: "Check Coverage",
    description: `Analyze usage coverage of a specific class or property, or get global stats.

**Args:**
- targetUri: (optional) URI of class or property to check

**Returns:**
- If targetUri provided: instance count and properties used
- If no targetUri: top 50 types by instance count

**Examples:**
- No args: Global coverage statistics
- targetUri="http://...#Person": Coverage for Person class`,
    inputSchema: {
      targetUri: z.string().optional().describe("URI of class or property to check coverage for"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ targetUri }) => {
    let query: string;
    if (targetUri) {
      const safeUri = sanitizeSparqlUri(targetUri);
      query = `
        SELECT (COUNT(DISTINCT ?s) AS ?instances) (COUNT(DISTINCT ?p) AS ?propertiesUsed)
        WHERE {
            { ?s a <${safeUri}> }
            UNION
            { ?s <${safeUri}> ?o }
            UNION
            { ?sub <${safeUri}> ?obj }
        }
      `;
    } else {
      query = `
        SELECT ?type (COUNT(?s) AS ?count)
        WHERE {
          ?s a ?type .
        }
        GROUP BY ?type
        ORDER BY DESC(?count)
        LIMIT 50
      `;
    }
    return executeSparqlTool("check_coverage", { targetUri }, query);
  }
);

server.registerTool(
  "check_quality",
  {
    title: "Check Quality",
    description: `Verify quality issues like missing labels or descriptions.

**Args:**
- limit: Maximum results to return (default: 50)

**Returns:**
- List of resources missing rdfs:label or skos:prefLabel

**Note:** Checks owl:Class, owl:ObjectProperty, owl:DatatypeProperty, and skos:Concept.`,
    inputSchema: {
      limit: z.number().optional().default(50),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ limit }) => {
    const query = `
      SELECT ?s ?type ?issue
      WHERE {
        VALUES ?type { owl:Class owl:ObjectProperty owl:DatatypeProperty skos:Concept }
        ?s a ?type .
        FILTER NOT EXISTS { ?s rdfs:label ?label }
        FILTER NOT EXISTS { ?s skos:prefLabel ?label }
        BIND("Missing Label" AS ?issue)
      }
      LIMIT ${limit}
    `;
    return executeSparqlTool("check_quality", { limit }, query);
  }
);

server.registerTool(
  "check_overlaps",
  {
    title: "Check Overlaps",
    description: `Identify potential overlaps (same labels) or explicit mappings.

**Args:**
- limit: Maximum results to return (default: 50)

**Returns:**
- List of potential overlaps with relation type:
  - owl:sameAs mappings
  - skos:exactMatch mappings
  - Same Label collisions`,
    inputSchema: {
      limit: z.number().optional().default(50),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ limit }) => {
    const query = `
      SELECT ?s1 ?s2 ?label ?relation
      WHERE {
        {
          ?s1 owl:sameAs ?s2 .
          BIND("owl:sameAs" AS ?relation)
        }
        UNION
        {
          ?s1 skos:exactMatch ?s2 .
          BIND("skos:exactMatch" AS ?relation)
        }
        UNION
        {
          ?s1 rdfs:label ?label .
          ?s2 rdfs:label ?label .
          FILTER (?s1 != ?s2)
          BIND("Same Label" AS ?relation)
        }
      }
      LIMIT ${limit}
    `;
    return executeSparqlTool("check_overlaps", { limit }, query);
  }
);


// -----------------------------------------------------------------------------
// GROUP C: Ontology Tools
// -----------------------------------------------------------------------------

server.registerTool(
  "list_ontologies",
  {
    title: "List Ontologies",
    description: `List available Ontologies (Data Models) and their titles.

**Args:**
- limit: Maximum number of ontologies to return (default: 50)

**Returns:**
- List of ontology URIs with labels/titles, ordered alphabetically`,
    inputSchema: {
      limit: z.number().optional().default(50),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ limit }) => {
    const query = `
      SELECT DISTINCT ?ont ?label
      WHERE {
        ?ont a owl:Ontology .
        OPTIONAL { ?ont rdfs:label|dct:title ?label }
      }
      ORDER BY ?label
      LIMIT ${limit}
    `;
    return executeSparqlTool("list_ontologies", { limit }, query);
  }
);

server.registerTool(
  "explore_ontology",
  {
    title: "Explore Ontology",
    description: `List Classes and Properties defined in a specific Ontology.

**Args:**
- ontologyUri: URI of the ontology (from list_ontologies)

**Returns:**
- List of classes and properties with labels, grouped by type

**Note:** Uses URI prefix heuristic - items whose URI starts with the ontology URI.`,
    inputSchema: {
      ontologyUri: z.string().describe("The URI of the Ontology (from list_ontologies)"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ ontologyUri }) => {
    const safeUri = sanitizeSparqlUri(ontologyUri);
    const query = `
      SELECT DISTINCT ?type ?item ?label
      WHERE {
        VALUES ?type { owl:Class owl:ObjectProperty owl:DatatypeProperty }
        ?item a ?type .
        OPTIONAL { ?item rdfs:label ?label }
        FILTER(STRSTARTS(STR(?item), "${safeUri}"))
      }
      ORDER BY ?type ?item
      LIMIT 200
    `;
    return executeSparqlTool("explore_ontology", { ontologyUri }, query);
  }
);


// -----------------------------------------------------------------------------
// GROUP D: Vocabulary Tools
// -----------------------------------------------------------------------------

server.registerTool(
  "list_vocabularies",
  {
    title: "List Vocabularies",
    description: `List available Controlled Vocabularies (ConceptSchemes) and their instance counts.

**Args:**
- limit: Maximum vocabularies to return (default: 20)

**Returns:**
- List of ConceptSchemes with labels and concept counts, ordered by count descending`,
    inputSchema: {
      limit: z.number().optional().default(20),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ limit }) => {
    const query = `
      SELECT DISTINCT ?scheme ?label (COUNT(?c) AS ?count)
      WHERE {
        ?scheme a skos:ConceptScheme .
        OPTIONAL { ?scheme rdfs:label|dct:title ?label }
        OPTIONAL { ?c skos:inScheme ?scheme }
      }
      GROUP BY ?scheme ?label
      ORDER BY DESC(?count)
      LIMIT ${limit}
    `;
    return executeSparqlTool("list_vocabularies", { limit }, query);
  }
);

server.registerTool(
  "search_in_vocabulary",
  {
    title: "Search in Vocabulary",
    description: `Search for concepts within a specific Controlled Vocabulary (ConceptScheme).

**Args:**
- schemeUri: URI of the ConceptScheme (from list_vocabularies)
- keyword: Search term for label matching (case-insensitive regex)
- limit: Maximum results (default: 20)

**Returns:**
- Matching concepts with labels and optional notation codes`,
    inputSchema: {
      schemeUri: z.string().describe("The URI of the ConceptScheme (from list_vocabularies)"),
      keyword: z.string().describe("The search keyword"),
      limit: z.number().optional().default(20),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ schemeUri, keyword, limit }) => {
    const safeSchemeUri = sanitizeSparqlUri(schemeUri);
    const safeKeyword = sanitizeSparqlString(keyword);
    const query = `
      SELECT DISTINCT ?concept ?label ?code
      WHERE {
        ?concept skos:inScheme <${safeSchemeUri}> .
        ?concept rdfs:label|skos:prefLabel ?label .
        OPTIONAL { ?concept skos:notation|dct:identifier ?code }
        FILTER(REGEX(STR(?label), "${safeKeyword}", "i"))
      }
      ORDER BY ?label
      LIMIT ${limit}
    `;
    return executeSparqlTool("search_in_vocabulary", { schemeUri, keyword, limit }, query);
  }
);

// -----------------------------------------------------------------------------
// GROUP E: Dataset Tools
// -----------------------------------------------------------------------------

server.registerTool(
  "list_datasets",
  {
    title: "List Datasets",
    description: `List available Datasets (dcatapit:Dataset) in the catalog.

**Args:**
- limit: Maximum datasets per page (default: 20)
- offset: Number of datasets to skip (default: 0)

**Returns:**
- items: List of datasets with labels
- pagination: Metadata with count, offset, has_more, next_offset`,
    inputSchema: {
      limit: z.number().optional().default(20),
      offset: z.number().optional().default(0),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ limit, offset }) => {
    const dataQuery = `
      SELECT DISTINCT ?dataset ?label
      WHERE {
        ?dataset a <http://dati.gov.it/onto/dcatapit#Dataset> .
        OPTIONAL { ?dataset dct:title ?label }
      }
      ORDER BY ?label
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    const countQuery = `
      SELECT (COUNT(DISTINCT ?dataset) AS ?total)
      WHERE {
        ?dataset a <http://dati.gov.it/onto/dcatapit#Dataset> .
      }
    `;

    return executeTool("list_datasets", { limit, offset }, async () => {
      const [dataResult, countResult] = await Promise.all([
        executeSparql(dataQuery),
        executeSparql(countQuery),
      ]);

      const items = compressSparqlResult(dataResult);
      const count = dataResult.results?.bindings?.length ?? 0;
      const total = parseInt(countResult.results?.bindings?.[0]?.total?.value ?? "0", 10);

      return {
        success: true,
        data: {
          items,
          pagination: {
            total,
            count,
            offset,
            has_more: offset + count < total,
            next_offset: offset + count < total ? offset + count : null,
          },
        },
        rowCount: count,
      };
    });
  }
);

server.registerTool(
  "explore_dataset",
  {
    title: "Explore Dataset",
    description: `Get details of a specific Dataset including metadata and distributions.

**Args:**
- datasetUri: URI of the dataset to explore

**Returns:**
- metadata: Dataset properties (literals and distribution references)
- distributions: List of distributions with format and download URLs

**Note:** Both queries run in parallel for performance.`,
    inputSchema: {
      datasetUri: z.string().describe("The URI of the Dataset"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ datasetUri }) => {
    const safeUri = sanitizeSparqlUri(datasetUri);
    const metadataQuery = `
      SELECT ?p ?o
      WHERE {
        <${safeUri}> ?p ?o .
        FILTER (ISLITERAL(?o) || (ISURI(?o) && EXISTS { ?o a <http://dati.gov.it/onto/dcatapit#Distribution> }))
      }
      LIMIT 100
    `;

    const distQuery = `
      SELECT ?dist ?format ?url
      WHERE {
        ?dist a <http://dati.gov.it/onto/dcatapit#Distribution> .
        { <${safeUri}> dcat:distribution ?dist } UNION { ?dist isDistributionOf <${safeUri}> } .
        OPTIONAL { ?dist dct:format ?format }
        OPTIONAL { ?dist dcat:downloadURL ?url }
      }
      LIMIT 20
    `;

    return executeTool("explore_dataset", { datasetUri }, async () => {
      const [details, distributions] = await Promise.all([
        executeSparql(metadataQuery),
        executeSparql(distQuery),
      ]);

      return {
        success: true,
        data: {
          metadata: compressSparqlResult(details),
          distributions: compressSparqlResult(distributions),
        },
        rowCount: (details.results?.bindings?.length ?? 0) +
          (distributions.results?.bindings?.length ?? 0),
      };
    });
  }
);

// -----------------------------------------------------------------------------
// GROUP F: Intelligent Tools
// -----------------------------------------------------------------------------

server.registerTool(
  "search_concepts",
  {
    title: "Search Concepts",
    description: `Fuzzy search for concepts/classes/properties by keyword.

**Args:**
- keyword: Search term (e.g. 'amministrazione')
- limit: Maximum results (default: 10)
- resource_type: (optional) Filter by type: "class", "property", "concept"
- ontology_filter: (optional) URI prefix to restrict the search (e.g. 'https://w3id.org/italia/onto/COV/')
- prefer_core: (optional) If true, results from core ontologies (COV, CPV, CLV, l0) are ranked first

**Returns:**
- Matching subjects with type and label

**Use when:** You don't know the exact URI of a concept. Use resource_type and ontology_filter to reduce noise.`,
    inputSchema: {
      keyword: z.string().describe("The search term (e.g. 'amministrazione')"),
      limit: z.number().optional().default(10),
      resource_type: z.enum(["class", "property", "concept"]).optional().describe('Filter by resource type: "class", "property", or "concept"'),
      ontology_filter: z.string().optional().describe("Restrict results to URIs starting with this prefix (e.g. 'https://w3id.org/italia/onto/COV/')"),
      prefer_core: z.boolean().optional().default(false).describe("If true, rank results from COV, CPV, CLV, l0 ontologies first"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ keyword, limit, resource_type, ontology_filter, prefer_core }) => {
    const safeKeyword = sanitizeSparqlString(keyword);

    const typeValues = (() => {
      switch (resource_type) {
        case "class":    return "owl:Class rdfs:Class";
        case "property": return "owl:ObjectProperty owl:DatatypeProperty owl:AnnotationProperty";
        case "concept":  return "skos:Concept skos:ConceptScheme";
        default:         return "owl:Class owl:ObjectProperty owl:DatatypeProperty skos:Concept";
      }
    })();

    const ontologyFilterClause = ontology_filter
      ? `FILTER(STRSTARTS(STR(?subject), "${sanitizeSparqlString(ontology_filter)}"))`
      : "";

    const orderClause = prefer_core
      ? `ORDER BY IF(REGEX(STR(?subject), "italia/onto/(COV|CPV|CLV|l0)/"), 0, 1) ?label`
      : "";

    const query = `
      SELECT DISTINCT ?subject ?type ?label
      WHERE {
        VALUES ?type { ${typeValues} }
        ?subject a ?type .
        ?subject rdfs:label|skos:prefLabel|dct:title ?label .
        FILTER(REGEX(STR(?label), "${safeKeyword}", "i"))
        ${ontologyFilterClause}
      }
      ${orderClause}
      LIMIT ${limit}
    `;
    return executeSparqlTool("search_concepts", { keyword, limit, resource_type, ontology_filter, prefer_core }, query);
  }
);

server.registerTool(
  "inspect_concept",
  {
    title: "Inspect Concept",
    description: `Get a comprehensive profile of a concept.

**Args:**
- uri: URI of the concept to inspect

**Returns:**
- definition: Literal properties of the concept
- hierarchy: Type, parents (superclasses), and children (subclasses)
- usage: Instance count
- incoming: Properties pointing to instances of this type
- outgoing: Properties used by instances of this type

**Note:** All 5 queries run in parallel for performance.`,
    inputSchema: {
      uri: z.string().describe("The URI of the concept to inspect"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ uri }) => {
    const safeUri = sanitizeSparqlUri(uri);
    const queries: Record<string, string> = {
      definition: `
        SELECT ?p ?o WHERE { <${safeUri}> ?p ?o . FILTER(ISLITERAL(?o)) }
      `,
      hierarchy: `
        SELECT ?type ?parent ?child WHERE {
          { <${safeUri}> a ?type }
          UNION
          { <${safeUri}> rdfs:subClassOf|skos:broader ?parent }
          UNION
          { ?child rdfs:subClassOf|skos:broader <${safeUri}> }
        } LIMIT 50
      `,
      usage: `
        SELECT (COUNT(?s) as ?instanceCount) WHERE { ?s a <${safeUri}> }
      `,
      incoming: `
        SELECT DISTINCT ?p ?sType WHERE {
          ?s ?p ?o .
          ?o a <${safeUri}> .
          OPTIONAL { ?s a ?sType }
        } LIMIT 20
      `,
      outgoing: `
        SELECT DISTINCT ?p ?oType WHERE {
          ?s a <${safeUri}> .
          ?s ?p ?o .
          OPTIONAL { ?o a ?oType }
        } LIMIT 20
      `,
    };

    return executeTool("inspect_concept", { uri }, async () => {
      const entries = Object.entries(queries);
      const sparqlResults = await Promise.all(
        entries.map(([, q]) => executeSparql(q))
      );

      const results: Record<string, CompressedResult> = {};
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const sparqlResult = sparqlResults[i];
        if (entry && sparqlResult) {
          results[entry[0]] = compressSparqlResult(sparqlResult);
        }
      }

      const totalRows = sparqlResults.reduce(
        (sum, r) => sum + (r?.results?.bindings?.length ?? 0),
        0
      );

      return { success: true, data: results, rowCount: totalRows };
    });
  }
);

server.registerTool(
  "find_relations",
  {
    title: "Find Relations",
    description: `Find how two concepts are connected.

**Args:**
- sourceUri: URI of the source concept
- targetUri: URI of the target concept

**Returns:**
- Direct connections (single predicate)
- 1-hop paths (source -> intermediate -> target)`,
    inputSchema: {
      sourceUri: z.string().describe("URI of the source concept"),
      targetUri: z.string().describe("URI of the target concept"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ sourceUri, targetUri }) => {
    const safeSource = sanitizeSparqlUri(sourceUri);
    const safeTarget = sanitizeSparqlUri(targetUri);
    const query = `
      SELECT ?p1 ?mid ?p2
      WHERE {
        {
          <${safeSource}> ?p1 <${safeTarget}> .
          BIND("DIRECT" AS ?mid)
          BIND("NONE" AS ?p2)
        }
        UNION
        {
          <${safeSource}> ?p1 ?mid .
          ?mid ?p2 <${safeTarget}> .
        }
      }
      LIMIT 10
    `;
    return executeSparqlTool("find_relations", { sourceUri, targetUri }, query);
  }
);

server.registerTool(
  "suggest_improvements",
  {
    title: "Suggest Improvements",
    description: `Analyze the ontology for structural issues.

**Args:**
- limit: Maximum issues per category (default: 20)

**Returns:**
- possible_cycles: Classes with mutual rdfs:subClassOf
- unused_classes: Classes with no instances and no subclasses

**Note:** Both analyses run in parallel.`,
    inputSchema: {
      limit: z.number().optional().default(20),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ limit }) => {
    const lonelyQuery = `
      SELECT ?class (COUNT(?s) as ?instances)
      WHERE {
        ?class a owl:Class .
        FILTER NOT EXISTS { ?s a ?class }
        FILTER NOT EXISTS { ?sub rdfs:subClassOf ?class }
      }
      GROUP BY ?class
      LIMIT ${limit}
    `;

    const cycleQuery = `
      SELECT ?a ?b
      WHERE {
        ?a rdfs:subClassOf ?b .
        ?b rdfs:subClassOf ?a .
        FILTER (?a != ?b)
      }
      LIMIT ${limit}
    `;

    return executeTool("suggest_improvements", { limit }, async () => {
      const [lonely, cycles] = await Promise.all([
        executeSparql(lonelyQuery),
        executeSparql(cycleQuery),
      ]);

      return {
        success: true,
        data: {
          possible_cycles: compressSparqlResult(cycles),
          unused_classes: compressSparqlResult(lonely),
        },
        rowCount: (lonely.results?.bindings?.length ?? 0) +
          (cycles.results?.bindings?.length ?? 0),
      };
    });
  }
);




server.registerTool(
  "preview_distribution",
  {
    title: "Preview Distribution",
    description: `Download and preview the first rows of a distribution file.

**Args:**
- url: Download URL of the distribution (CSV or JSON)

**Returns:**
- Preview of first 10-15 rows/items of data

**Supported formats:** CSV, JSON (auto-detected by content-type or extension)
**Timeout:** 10 seconds`,
    inputSchema: {
      url: z.string().describe("The download URL of the distribution"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ url }) => {
    return executeTool("preview_distribution", { url }, async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) {
          return {
            success: false,
            error: `Failed to fetch distribution: ${response.status} ${response.statusText}`,
          };
        }

        const contentType = response.headers.get("content-type") || "";
        const text = await response.text();

        let preview = "";

        if (contentType.includes("json") || url.endsWith(".json")) {
          try {
            const json = JSON.parse(text) as unknown;
            const jsonObj = json as Record<string, unknown>;
            const array = Array.isArray(json) ? json : (jsonObj.results || jsonObj.data || [json]);
            preview = JSON.stringify((array as unknown[]).slice(0, 10), null, 2);
          } catch {
            preview = text.slice(0, 2000) + "\n... (truncated)";
          }
        } else {
          const lines = text.split("\n").slice(0, 15);
          preview = lines.join("\n");
        }

        return {
          success: true,
          data: `Preview of ${url}:\n\n${preview}`,
        };
      } finally {
        clearTimeout(timeoutId);
      }
    });
  }
);

// -----------------------------------------------------------------------------
// GROUP G: Property Tools (based on usage patterns)
// -----------------------------------------------------------------------------

server.registerTool(
  "list_properties",
  {
    title: "List Properties",
    description: `List ObjectProperty and DatatypeProperty defined in an ontology or globally.

**Args:**
- ontologyUri: (optional) URI of the ontology to filter by
- propertyType: (optional) "object", "datatype", or "both" (default: "both")
- limit: Maximum results (default: 50)

**Returns:**
- List of properties with domain, range, and label

**Examples:**
- No args: All properties (top 50)
- ontologyUri="https://w3id.org/italia/onto/CPV": Properties from CPV ontology`,
    inputSchema: {
      ontologyUri: z.string().optional().describe("URI of ontology to filter by"),
      propertyType: z.enum(["object", "datatype", "both"]).optional().default("both"),
      limit: z.number().optional().default(50),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ ontologyUri, propertyType, limit }) => {
    const typeFilter = propertyType === "object"
      ? "VALUES ?type { owl:ObjectProperty }"
      : propertyType === "datatype"
      ? "VALUES ?type { owl:DatatypeProperty }"
      : "VALUES ?type { owl:ObjectProperty owl:DatatypeProperty }";

    const uriFilter = ontologyUri
      ? `FILTER(STRSTARTS(STR(?prop), "${sanitizeSparqlUri(ontologyUri)}"))`
      : "";

    const query = `
      SELECT DISTINCT ?prop ?type ?label ?domain ?range
      WHERE {
        ${typeFilter}
        ?prop a ?type .
        OPTIONAL { ?prop rdfs:label ?label . FILTER(LANG(?label) = "it" || LANG(?label) = "") }
        OPTIONAL { ?prop rdfs:domain ?domain }
        OPTIONAL { ?prop rdfs:range ?range }
        ${uriFilter}
      }
      ORDER BY ?prop
      LIMIT ${limit}
    `;
    return executeSparqlTool("list_properties", { ontologyUri, propertyType, limit }, query);
  }
);

server.registerTool(
  "get_property_details",
  {
    title: "Get Property Details",
    description: `Get comprehensive details of a specific property.

**Args:**
- propertyUri: URI of the property

**Returns:**
- type: ObjectProperty or DatatypeProperty
- domain: Class(es) this property applies to
- range: Class or datatype of values
- label: Human-readable name
- comment: Description
- inverse: Inverse property if defined
- subPropertyOf: Parent property if defined
- functional: Whether it's a FunctionalProperty`,
    inputSchema: {
      propertyUri: z.string().describe("URI of the property to inspect"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ propertyUri }) => {
    const safeUri = sanitizeSparqlUri(propertyUri);
    const query = `
      SELECT ?p ?o
      WHERE {
        <${safeUri}> ?p ?o .
        FILTER(?p IN (
          rdf:type,
          rdfs:label,
          rdfs:comment,
          rdfs:domain,
          rdfs:range,
          rdfs:subPropertyOf,
          owl:inverseOf,
          owl:equivalentProperty
        ) || ?p = rdf:type && ?o IN (owl:FunctionalProperty, owl:InverseFunctionalProperty, owl:SymmetricProperty, owl:TransitiveProperty))
      }
    `;
    return executeSparqlTool("get_property_details", { propertyUri }, query);
  }
);

server.registerTool(
  "browse_vocabulary",
  {
    title: "Browse Vocabulary",
    description: `Browse concepts in a vocabulary with pagination support.

**Args:**
- schemeUri: URI of the ConceptScheme
- limit: Items per page (default: 50)
- offset: Items to skip (default: 0)
- keyword: (optional) Filter by label

**Returns:**
- concepts: List of concepts with code and label
- pagination: Total count, offset, has_more

**Use for:** Large vocabularies that need pagination (e.g., ICD codes, municipalities)`,
    inputSchema: {
      schemeUri: z.string().describe("URI of the ConceptScheme"),
      limit: z.number().optional().default(50),
      offset: z.number().optional().default(0),
      keyword: z.string().optional().describe("Optional keyword filter"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ schemeUri, limit, offset, keyword }) => {
    const safeSchemeUri = sanitizeSparqlUri(schemeUri);
    const keywordFilter = keyword
      ? `FILTER(REGEX(STR(?label), "${sanitizeSparqlString(keyword)}", "i"))`
      : "";

    const dataQuery = `
      SELECT ?concept ?code ?label
      WHERE {
        ?concept skos:inScheme <${safeSchemeUri}> .
        ?concept a skos:Concept .
        OPTIONAL { ?concept skos:notation ?code }
        OPTIONAL { ?concept skos:prefLabel|rdfs:label ?label . FILTER(LANG(?label) = "it" || LANG(?label) = "") }
        ${keywordFilter}
      }
      ORDER BY ?code ?label
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    const countQuery = `
      SELECT (COUNT(?concept) AS ?total)
      WHERE {
        ?concept skos:inScheme <${safeSchemeUri}> .
        ?concept a skos:Concept .
        ${keyword ? `
          ?concept skos:prefLabel|rdfs:label ?label .
          FILTER(REGEX(STR(?label), "${sanitizeSparqlString(keyword)}", "i"))
        ` : ""}
      }
    `;

    return executeTool("browse_vocabulary", { schemeUri, limit, offset, keyword }, async () => {
      const [dataResult, countResult] = await Promise.all([
        executeSparql(dataQuery),
        executeSparql(countQuery),
      ]);

      const concepts = compressSparqlResult(dataResult);
      const count = dataResult.results?.bindings?.length ?? 0;
      const total = parseInt(countResult.results?.bindings?.[0]?.total?.value ?? "0", 10);

      return {
        success: true,
        data: {
          concepts,
          pagination: {
            total,
            count,
            offset,
            has_more: offset + count < total,
            next_offset: offset + count < total ? offset + count : null,
          },
        },
        rowCount: count,
      };
    });
  }
);

server.registerTool(
  "list_instances_of_class",
  {
    title: "List Instances of Class",
    description: `List instances of a given class in the catalog.

**Args:**
- class_uri: URI of the class (e.g. 'https://w3id.org/italia/onto/COV/PublicOrganization')
- limit: Items per page (default: 20, max: 200)
- offset: Items to skip (default: 0)

**Returns:**
- instances: list of URIs with labels
- pagination: total count, offset, has_more

**Use when:** You found a class and want to know if it has real instances (i.e., whether it is used in the catalog, not just defined theoretically).`,
    inputSchema: {
      class_uri: z.string().describe("URI of the class to list instances of"),
      limit: z.number().optional().default(20).describe("Items per page (max 200)"),
      offset: z.number().optional().default(0).describe("Items to skip"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ class_uri, limit, offset }) => {
    const safeUri = sanitizeSparqlUri(class_uri);
    const safeLimit = Math.min(limit, 200);

    const dataQuery = `
      SELECT DISTINCT ?instance ?label
      WHERE {
        ?instance a <${safeUri}> .
        OPTIONAL {
          ?instance rdfs:label|l0:name|skos:prefLabel ?label .
          FILTER(LANG(?label) = "" || LANG(?label) = "it" || LANG(?label) = "en")
        }
      }
      ORDER BY ?label ?instance
      LIMIT ${safeLimit}
      OFFSET ${offset}
    `;
    const countQuery = `
      SELECT (COUNT(DISTINCT ?instance) AS ?total)
      WHERE { ?instance a <${safeUri}> }
    `;

    return executeTool("list_instances_of_class", { class_uri, limit: safeLimit, offset }, async () => {
      const [dataResult, countResult] = await Promise.all([
        executeSparql(dataQuery),
        executeSparql(countQuery),
      ]);

      const instances = compressSparqlResult(dataResult);
      const count = dataResult.results?.bindings?.length ?? 0;
      const total = parseInt(countResult.results?.bindings?.[0]?.total?.value ?? "0", 10);

      return {
        success: true,
        data: {
          instances,
          pagination: {
            total,
            count,
            offset,
            has_more: offset + safeLimit < total,
            next_offset: offset + safeLimit < total ? offset + safeLimit : null,
          },
        },
        rowCount: count,
      };
    });
  }
);

server.registerTool(
  "find_recommended_scheme_for_property",
  {
    title: "Find Recommended Scheme for Property",
    description: `Given a property URI, find its range class and any associated SKOS ConceptSchemes in the catalog.

**Args:**
- property_uri: URI of the property (e.g. 'https://w3id.org/italia/onto/COV/hasCategory')

**Returns:**
- range: the rdfs:range of the property (if declared)
- instance_count: number of instances of the range type in the catalog
- schemes: SKOS ConceptSchemes whose members are typed as the range class
- suggestion: actionable advice (use existing scheme, or create a local one)

**Use when:** You want to know what controlled vocabulary values to use for a property, or whether an official ConceptScheme exists.`,
    inputSchema: {
      property_uri: z.string().describe("URI of the property to analyze"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ property_uri }) => {
    const safePropUri = sanitizeSparqlUri(property_uri);

    return executeTool<unknown>("find_recommended_scheme_for_property", { property_uri }, async () => {
      // Step 1: Get the range of the property
      const rangeQuery = `
        SELECT ?range ?rangeLabel WHERE {
          <${safePropUri}> rdfs:range ?range .
          OPTIONAL { ?range rdfs:label|skos:prefLabel ?rangeLabel . FILTER(LANG(?rangeLabel) = "" || LANG(?rangeLabel) = "it") }
        }
        LIMIT 5
      `;
      const rangeResult = await executeSparql(rangeQuery);
      const rangeBindings = rangeResult.results?.bindings ?? [];

      if (rangeBindings.length === 0) {
        return {
          success: true,
          data: {
            property: safePropUri,
            range: null,
            instance_count: 0,
            schemes: [],
            suggestion: "No rdfs:range declared for this property. Inspect it with get_property_details for more context.",
          },
        };
      }

      const rangeUri = rangeBindings[0]?.range?.value ?? "";
      const rangeLabel = rangeBindings[0]?.rangeLabel?.value ?? "";
      let safeRangeUri: string;
      try {
        safeRangeUri = sanitizeSparqlUri(rangeUri);
      } catch {
        return {
          success: true,
          data: {
            property: safePropUri,
            range: { uri: rangeUri, label: rangeLabel },
            instance_count: 0,
            schemes: [],
            suggestion: `Range is a blank node or non-HTTP URI (${rangeUri}). Cannot look up ConceptSchemes automatically.`,
          },
        };
      }

      // Step 2 (parallel): count instances and find ConceptSchemes
      const countQuery = `
        SELECT (COUNT(DISTINCT ?instance) AS ?total)
        WHERE { ?instance a <${safeRangeUri}> }
      `;
      const schemesQuery = `
        SELECT DISTINCT ?scheme ?schemeLabel WHERE {
          ?concept a <${safeRangeUri}> ; skos:inScheme ?scheme .
          OPTIONAL { ?scheme rdfs:label|dct:title|skos:prefLabel ?schemeLabel . FILTER(LANG(?schemeLabel) = "" || LANG(?schemeLabel) = "it") }
        }
        LIMIT 10
      `;

      const [countResult, schemesResult] = await Promise.all([
        executeSparql(countQuery),
        executeSparql(schemesQuery),
      ]);

      const instanceCount = parseInt(countResult.results?.bindings?.[0]?.total?.value ?? "0", 10);
      const schemes = (schemesResult.results?.bindings ?? []).map(b => ({
        uri: b.scheme?.value ?? "",
        label: b.schemeLabel?.value ?? "",
      }));

      let suggestion: string;
      if (schemes.length > 0) {
        suggestion = `${schemes.length} ConceptScheme(s) found for range <${safeRangeUri}>. Use browse_vocabulary or search_in_vocabulary to explore them.`;
      } else if (instanceCount > 0) {
        suggestion = `${instanceCount} instance(s) of range <${safeRangeUri}> exist in the catalog but none belong to a formal ConceptScheme. You can use list_instances_of_class to inspect them directly.`;
      } else {
        suggestion = `No instances or ConceptSchemes found for range <${safeRangeUri}>. Consider defining a local SKOS ConceptScheme for this property.`;
      }

      return {
        success: true,
        data: {
          property: safePropUri,
          range: { uri: safeRangeUri, label: rangeLabel },
          instance_count: instanceCount,
          schemes,
          suggestion,
        },
      };
    });
  }
);

server.registerTool(
  "describe_resource",
  {
    title: "Describe Resource",
    description: `Get all triples for a resource (Concise Bounded Description).

**Args:**
- uri: URI of the resource
- depth: 1 for direct properties only, 2 to include linked resources (default: 1)

**Returns:**
- All properties and values of the resource

**Use when:** You need the complete RDF description of a specific resource.`,
    inputSchema: {
      uri: z.string().describe("URI of the resource"),
      depth: z.number().optional().default(1).describe("1 for direct, 2 for linked resources"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ uri, depth }) => {
    const safeUri = sanitizeSparqlUri(uri);

    let query: string;
    if (depth === 2) {
      query = `
        SELECT ?p ?o ?p2 ?o2
        WHERE {
          <${safeUri}> ?p ?o .
          OPTIONAL {
            FILTER(ISURI(?o))
            ?o ?p2 ?o2 .
          }
        }
        LIMIT 200
      `;
    } else {
      query = `
        SELECT ?p ?o
        WHERE {
          <${safeUri}> ?p ?o .
        }
        LIMIT 100
      `;
    }
    return executeSparqlTool("describe_resource", { uri, depth }, query);
  }
);

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


// -----------------------------------------------------------------------------
// GROUP I: OntoPiA Territorial Tools
// -----------------------------------------------------------------------------

server.registerTool(
  "list_municipalities",
  {
    title: "List Municipalities",
    description: `Browse Italian municipalities (comuni) with their codes.

**Args:**
- limit: Items per page (default: 50, max: 500)
- offset: Items to skip (default: 0)
- keyword: (optional) Filter by name (case-insensitive)
- withBelfiore: (optional) If true, include Belfiore/cadastral codes via URI extraction (slower)

**Returns:**
- municipalities: List of cities with ISTAT code, name, and optionally Belfiore code
- pagination: Total count, offset, has_more

**Note:** Uses BIND+REPLACE URI extraction for Belfiore codes to avoid Virtuoso timeout on identifierType joins.
Each ISTAT code may appear with multiple historical names; results are deduplicated by notation.`,
    inputSchema: {
      limit: z.number().optional().default(50).describe("Items per page (max 500)"),
      offset: z.number().optional().default(0).describe("Items to skip"),
      keyword: z.string().optional().describe("Filter by municipality name"),
      withBelfiore: z.boolean().optional().default(false).describe("Include Belfiore/cadastral codes"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ limit, offset, keyword, withBelfiore }) => {
    const safeLimit = Math.min(limit, 500);
    const keywordFilter = keyword
      ? `FILTER(REGEX(?name, "${sanitizeSparqlString(keyword)}", "i"))`
      : "";

    if (withBelfiore) {
      // Two parallel queries: names + Belfiore codes, joined client-side
      const namesQuery = `
        SELECT DISTINCT ?notation ?name
        WHERE {
          ?city a clv:City ;
                skos:notation ?notation ;
                l0:name ?name .
          ${keywordFilter}
        }
        ORDER BY ?notation
        LIMIT ${safeLimit}
        OFFSET ${offset}
      `;
      const belfioreQuery = `
        SELECT DISTINCT ?notation ?belfiore
        WHERE {
          ?city skos:notation ?notation ;
                clv:hasIdentifier ?id .
          BIND(REPLACE(STR(?id), ".*cadastral-code/", "") AS ?belfiore)
          FILTER(CONTAINS(STR(?id), "cadastral-code/"))
        }
        ORDER BY ?notation
        LIMIT ${safeLimit}
        OFFSET ${offset}
      `;
      const countQuery = `
        SELECT (COUNT(DISTINCT ?notation) AS ?total)
        WHERE {
          ?city a clv:City ; skos:notation ?notation .
          ${keyword ? `?city l0:name ?name . ${keywordFilter}` : ""}
        }
      `;

      return executeTool("list_municipalities", { limit: safeLimit, offset, keyword, withBelfiore }, async () => {
        const [namesResult, belfioreResult, countResult] = await Promise.all([
          executeSparql(namesQuery),
          executeSparql(belfioreQuery),
          executeSparql(countQuery),
        ]);

        // Build Belfiore lookup: notation -> belfiore
        const belfioreLookup: Record<string, string> = {};
        for (const b of belfioreResult.results?.bindings ?? []) {
          const notation = b.notation?.value;
          const belfiore = b.belfiore?.value;
          if (notation && belfiore) {
            belfioreLookup[notation] = belfiore;
          }
        }

        // Deduplicate names: pick longest name per notation
        const cityMap: Record<string, { notation: string; name: string; belfiore?: string }> = {};
        for (const row of namesResult.results?.bindings ?? []) {
          const notation = row.notation?.value;
          const name = row.name?.value;
          if (!notation || !name) continue;
          const existing = cityMap[notation];
          if (!existing || name.length > existing.name.length) {
            cityMap[notation] = {
              notation,
              name,
              ...(belfioreLookup[notation] ? { belfiore: belfioreLookup[notation] } : {}),
            };
          }
        }

        const municipalities = Object.values(cityMap).sort((a, b) => a.notation.localeCompare(b.notation));
        const total = parseInt(countResult.results?.bindings?.[0]?.total?.value ?? "0", 10);
        const count = municipalities.length;

        return {
          success: true,
          data: {
            municipalities: count > 5
              ? { headers: ["notation", "name", "belfiore"], rows: municipalities.map(m => [m.notation, m.name, m.belfiore ?? null]) }
              : municipalities,
            pagination: { total, count, offset, has_more: offset + safeLimit < total, next_offset: offset + safeLimit < total ? offset + safeLimit : null },
          },
          rowCount: count,
        };
      });
    }

    // Simple mode: just names and notations
    const dataQuery = `
      SELECT DISTINCT ?notation ?name
      WHERE {
        ?city a clv:City ;
              skos:notation ?notation ;
              l0:name ?name .
        ${keywordFilter}
      }
      ORDER BY ?notation
      LIMIT ${safeLimit}
      OFFSET ${offset}
    `;
    const countQuery = `
      SELECT (COUNT(DISTINCT ?notation) AS ?total)
      WHERE {
        ?city a clv:City ; skos:notation ?notation .
        ${keyword ? `?city l0:name ?name . ${keywordFilter}` : ""}
      }
    `;

    return executeTool("list_municipalities", { limit: safeLimit, offset, keyword, withBelfiore }, async () => {
      const [dataResult, countResult] = await Promise.all([
        executeSparql(dataQuery),
        executeSparql(countQuery),
      ]);

      const municipalities = compressSparqlResult(dataResult);
      const count = dataResult.results?.bindings?.length ?? 0;
      const total = parseInt(countResult.results?.bindings?.[0]?.total?.value ?? "0", 10);

      return {
        success: true,
        data: {
          municipalities,
          pagination: { total, count, offset, has_more: offset + count < total, next_offset: offset + count < total ? offset + count : null },
        },
        rowCount: count,
      };
    });
  }
);


server.registerTool(
  "list_provinces",
  {
    title: "List Provinces",
    description: `List Italian provinces with their codes (ISTAT, car plate, metropolitan city).

**Args:**
- keyword: (optional) Filter by province name (case-insensitive)

**Returns:**
- List of provinces with notation (ISTAT code), name, sigla (car plate), and metro code (if metropolitan city)

**Note:** Runs 3 parallel queries for names, car plates, and metro codes, then joins client-side.
There are ~107 provinces, 14 of which are metropolitan cities.`,
    inputSchema: {
      keyword: z.string().optional().describe("Filter by province name"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ keyword }) => {
    const keywordFilter = keyword
      ? `FILTER(REGEX(?name, "${sanitizeSparqlString(keyword)}", "i"))`
      : "";

    const namesQuery = `
      SELECT DISTINCT ?notation ?name
      WHERE {
        ?prov a clv:Province ;
              skos:notation ?notation ;
              l0:name ?name .
        ${keywordFilter}
      }
      ORDER BY ?notation
    `;
    const siglaQuery = `
      SELECT DISTINCT ?notation ?sigla
      WHERE {
        ?prov skos:notation ?notation ;
              clv:hasIdentifier ?id .
        BIND(REPLACE(STR(?id), ".*vehicle-code/", "") AS ?sigla)
        FILTER(CONTAINS(STR(?id), "vehicle-code/"))
      }
      ORDER BY ?notation
    `;
    const metroQuery = `
      SELECT DISTINCT ?notation ?metro
      WHERE {
        ?prov skos:notation ?notation ;
              clv:hasIdentifier ?id .
        BIND(REPLACE(STR(?id), ".*metropolitan-city-code/", "") AS ?metro)
        FILTER(CONTAINS(STR(?id), "metropolitan-city-code/"))
      }
      ORDER BY ?notation
    `;

    return executeTool("list_provinces", { keyword }, async () => {
      const [namesResult, siglaResult, metroResult] = await Promise.all([
        executeSparql(namesQuery),
        executeSparql(siglaQuery),
        executeSparql(metroQuery),
      ]);

      // Build lookups
      const siglaLookup: Record<string, string> = {};
      for (const b of siglaResult.results?.bindings ?? []) {
        const n = b.notation?.value;
        const s = b.sigla?.value;
        if (n && s) siglaLookup[n] = s;
      }

      const metroLookup: Record<string, string> = {};
      for (const b of metroResult.results?.bindings ?? []) {
        const n = b.notation?.value;
        const m = b.metro?.value;
        if (n && m) metroLookup[n] = m;
      }

      // Build province list, deduplicate names (pick longest)
      const provMap: Record<string, { notation: string; name: string; sigla: string | null; metro: string | null }> = {};
      for (const row of namesResult.results?.bindings ?? []) {
        const notation = row.notation?.value;
        const name = row.name?.value;
        if (!notation || !name) continue;
        const existing = provMap[notation];
        if (!existing || name.length > existing.name.length) {
          provMap[notation] = {
            notation,
            name,
            sigla: siglaLookup[notation] ?? null,
            metro: metroLookup[notation] ?? null,
          };
        }
      }

      const provinces = Object.values(provMap).sort((a, b) => a.notation.localeCompare(b.notation));
      const count = provinces.length;

      return {
        success: true,
        data: count > 5
          ? { headers: ["notation", "name", "sigla", "metro"], rows: provinces.map(p => [p.notation, p.name, p.sigla, p.metro]) }
          : provinces,
        rowCount: count,
      };
    });
  }
);


server.registerTool(
  "list_identifiers",
  {
    title: "List Identifiers",
    description: `List CLV Identifier resources by type, with counts and sample values.

**Args:**
- identifierType: (optional) Filter by identifier type string (e.g. "Codice Catastale", "Sigla Automobilistica")
- limit: Maximum results (default: 20)

**Returns:**
- If no identifierType: Summary of all identifier types with counts
- If identifierType provided: Sample identifiers of that type with their values and linked entities

**Use when:** Exploring the clv:Identifier resources and their identifierType values in the triplestore.`,
    inputSchema: {
      identifierType: z.string().optional().describe('Filter by type (e.g. "Codice Catastale")'),
      limit: z.number().optional().default(20).describe("Maximum results"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ identifierType, limit }) => {
    if (!identifierType) {
      // Summary mode: count by type
      const query = `
        SELECT ?type (COUNT(*) AS ?count)
        WHERE {
          ?id a clv:Identifier ;
              clv:identifierType ?type .
        }
        GROUP BY ?type
        ORDER BY DESC(?count)
      `;
      return executeSparqlTool("list_identifiers", { identifierType, limit }, query);
    }

    // Detail mode: sample identifiers of specific type
    const safeType = sanitizeSparqlString(identifierType);
    const query = `
      SELECT ?id ?value ?entity
      WHERE {
        ?id a clv:Identifier ;
            clv:identifierType "${safeType}" ;
            l0:identifier ?value .
        OPTIONAL { ?entity clv:hasIdentifier ?id }
      }
      LIMIT ${limit}
    `;
    return executeSparqlTool("list_identifiers", { identifierType, limit }, query);
  }
);

server.registerTool(
  "resolve_territorial_uri",
  {
    title: "Resolve Territorial URI",
    description: `Resolve an Italian territorial code to its canonical CLV URI with labels and related URIs.

**Args:**
- code_type: Type of code: "istat-comune", "istat-provincia", "istat-regione", or "belfiore"
- code: The code value (e.g. "046030" for ISTAT comune, "F205" for Belfiore)
- date: (optional) ISO date string (e.g. "2022-08-12") — noted in output, full temporal filtering not yet implemented

**Returns:**
- uri: canonical CLV URI
- name: official name
- code_type and code
- related: connected territorial URIs (province for cities, region for provinces)
- date_note: reminder if date was provided

**Use when:** You have a raw territorial code (ISTAT or Belfiore) and need the official semantic URI to use in JSON-LD or RDF modeling.`,
    inputSchema: {
      code_type: z.enum(["istat-comune", "istat-provincia", "istat-regione", "belfiore"]).describe("Type of territorial code"),
      code: z.string().describe("The code value (e.g. '046030', 'F205', '001')"),
      date: z.string().optional().describe("Optional ISO date for temporal context (e.g. '2022-08-12')"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ code_type, code, date }) => {
    const safeCode = sanitizeSparqlString(code);

    return executeTool<unknown>("resolve_territorial_uri", { code_type, code, date }, async () => {
      let mainQuery: string;

      if (code_type === "istat-comune") {
        mainQuery = `
          SELECT DISTINCT ?uri ?name WHERE {
            ?uri a clv:City ;
                 skos:notation "${safeCode}" ;
                 l0:name ?name .
          }
          LIMIT 5
        `;
      } else if (code_type === "istat-provincia") {
        mainQuery = `
          SELECT DISTINCT ?uri ?name WHERE {
            ?uri a clv:Province ;
                 skos:notation "${safeCode}" ;
                 l0:name ?name .
          }
          LIMIT 5
        `;
      } else if (code_type === "istat-regione") {
        mainQuery = `
          SELECT DISTINCT ?uri ?name WHERE {
            ?uri a clv:Region ;
                 skos:notation "${safeCode}" ;
                 l0:name ?name .
          }
          LIMIT 5
        `;
      } else {
        // belfiore: search via hasIdentifier URI pattern
        mainQuery = `
          SELECT DISTINCT ?uri ?name WHERE {
            ?uri clv:hasIdentifier ?id .
            FILTER(CONTAINS(STR(?id), "/cadastral-code/${safeCode}"))
            OPTIONAL { ?uri l0:name ?name }
            OPTIONAL { ?uri rdfs:label ?name }
          }
          LIMIT 5
        `;
      }

      const mainResult = await executeSparql(mainQuery);
      const mainBindings = mainResult.results?.bindings ?? [];

      if (mainBindings.length === 0) {
        return {
          success: true,
          data: {
            found: false,
            code_type,
            code,
            message: `No result found for ${code_type} = "${code}". Check code format (e.g. ISTAT comune codes are 6 digits like "046030").`,
          },
        };
      }

      // Deduplicate: pick the binding with the longest name (historical names may repeat)
      const seen = new Map<string, string>();
      for (const b of mainBindings) {
        const uri = b.uri?.value ?? "";
        const name = b.name?.value ?? "";
        const existing = seen.get(uri);
        if (!existing || name.length > existing.length) seen.set(uri, name);
      }
      const primaryUri = seen.keys().next().value ?? "";
      const primaryName = seen.get(primaryUri) ?? "";

      // Query related territorial URIs (parent entities)
      let relatedQuery: string | null = null;
      if (code_type === "istat-comune") {
        relatedQuery = `
          SELECT DISTINCT ?related ?relatedName ?relatedCode ?relatedType WHERE {
            ?city a clv:City ; skos:notation "${safeCode}" .
            ?city ?p ?related .
            ?related a ?relatedType .
            VALUES ?relatedType { clv:Province clv:Region }
            OPTIONAL { ?related l0:name ?relatedName }
            OPTIONAL { ?related skos:notation ?relatedCode }
          }
          LIMIT 5
        `;
      } else if (code_type === "istat-provincia") {
        relatedQuery = `
          SELECT DISTINCT ?related ?relatedName ?relatedCode ?relatedType WHERE {
            ?prov a clv:Province ; skos:notation "${safeCode}" .
            ?prov ?p ?related .
            ?related a ?relatedType .
            VALUES ?relatedType { clv:Region }
            OPTIONAL { ?related l0:name ?relatedName }
            OPTIONAL { ?related skos:notation ?relatedCode }
          }
          LIMIT 3
        `;
      }

      const related: Array<{ uri: string; name: string; code: string; type: string }> = [];
      if (relatedQuery) {
        const relatedResult = await executeSparql(relatedQuery);
        for (const b of relatedResult.results?.bindings ?? []) {
          related.push({
            uri: b.related?.value ?? "",
            name: b.relatedName?.value ?? "",
            code: b.relatedCode?.value ?? "",
            type: (b.relatedType?.value ?? "").split("/").pop() ?? "",
          });
        }
      }

      return {
        success: true,
        data: {
          found: true,
          code_type,
          code,
          uri: primaryUri,
          name: primaryName,
          related,
          ...(date ? { date_note: `Date "${date}" was provided. Full temporal filtering is not yet implemented; results may include historical or future entities.` } : {}),
        },
      };
    });
  }
);

// =============================================================================
// GROUP J: Linked SPARQL Endpoints
// =============================================================================

server.registerTool(
  "recommend_external_endpoints",
  {
    title: "Recommend External SPARQL Endpoints",
    description: `Return a curated list of useful public SPARQL endpoints to pair with schema.gov.it.

**Args:**
- category: (optional) Filter by endpoint family: "italian-pa", "eu", or "knowledge-graph"
- limit: Maximum results (default: 10)

**Returns:**
- Curated endpoint recommendations with rationale, suggested use cases, and example query ideas

**Use when:** You want a high-signal shortlist of external endpoints before using query_external_endpoint or explore_external_endpoint.`,
    inputSchema: {
      category: z.enum(["italian-pa", "eu", "knowledge-graph"]).optional().describe('Optional category filter'),
      limit: z.number().optional().default(10).describe("Maximum number of endpoints to return"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ category, limit }) => {
    return executeTool("recommend_external_endpoints", { category, limit }, async () => {
      const filtered = category
        ? RECOMMENDED_EXTERNAL_ENDPOINTS.filter((endpoint) => endpoint.category === category)
        : RECOMMENDED_EXTERNAL_ENDPOINTS;
      const selected = filtered.slice(0, limit ?? 10);

      return {
        success: true,
        data: {
          totalAvailable: filtered.length,
          returned: selected.length,
          source: "curated-static-list",
          note: "Use list_linked_endpoints to discover endpoints published in schema.gov.it metadata, then use these curated suggestions for high-value external exploration.",
          endpoints: selected,
        },
        rowCount: selected.length,
      };
    });
  }
);

server.registerTool(
  "list_linked_endpoints",
  {
    title: "List Linked SPARQL Endpoints",
    description: `Discover SPARQL endpoints referenced in the schema.gov.it catalog via dcat:DataService.

**Args:** None

**Returns:**
- List of data services with endpoint URL, title, description, and conformsTo standard

**Use when:** Exploring what external SPARQL endpoints are connected to the Italian PA semantic catalog.`,
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async () => {
    const query = `
      SELECT ?service ?endpointURL ?title ?description ?conformsTo
      WHERE {
        ?service a dcat:DataService .
        ?service dcat:endpointURL ?endpointURL .
        OPTIONAL { ?service dct:title ?title }
        OPTIONAL { ?service dct:description ?description }
        OPTIONAL { ?service dct:conformsTo ?conformsTo }
      }
    `;
    return executeSparqlTool("list_linked_endpoints", {}, query);
  }
);

server.registerTool(
  "query_external_endpoint",
  {
    title: "Query External SPARQL Endpoint",
    description: `Execute a SPARQL query against any public HTTPS SPARQL endpoint.

**Args:**
- endpointUrl: URL of the target SPARQL endpoint (must be HTTPS)
- query: SPARQL query to execute
- injectPrefixes: Whether to inject schema.gov.it standard prefixes (default: false)

**Returns:**
- Compressed SPARQL results in the same format as internal tools

**Security:** Only HTTPS endpoints are allowed. Requests timeout after 15 seconds.

**Examples:**
- Query DBpedia: endpointUrl="https://dbpedia.org/sparql"
- Query EU Publications Office: endpointUrl="https://publications.europa.eu/webapi/rdf/sparql"`,
    inputSchema: {
      endpointUrl: z.string().describe("URL of the target SPARQL endpoint (HTTPS required)"),
      query: z.string().describe("SPARQL query to execute"),
      injectPrefixes: z.boolean().optional().default(false).describe("Whether to inject schema.gov.it standard prefixes (rdf, rdfs, owl, skos, dct...)"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ endpointUrl, query, injectPrefixes }) => {
    return executeTool("query_external_endpoint", { endpointUrl, query, injectPrefixes }, async () => {
      const safeEndpoint = sanitizeSparqlUri(endpointUrl);
      const result = await executeSparql(query, safeEndpoint, injectPrefixes ?? false, 15000);
      const rowCount = result.results?.bindings?.length ?? 0;
      const compressed = compressSparqlResult(result);
      return { success: true, data: compressed, rowCount };
    });
  }
);

server.registerTool(
  "find_external_alignments",
  {
    title: "Find External Alignments",
    description: `Find all alignment links from a concept in schema.gov.it toward external resources.

**Args:**
- uri: URI of the concept in schema.gov.it

**Returns:**
- concept: The queried URI
- alignments: List of external URIs with relation type and domain (base URL)

**Alignment types searched:**
- owl:sameAs (bidirectional)
- skos:exactMatch
- skos:closeMatch
- skos:broadMatch
- skos:narrowMatch

**Use when:** Understanding how a local concept maps to external systems (Eurostat, DBpedia, EU Publications Office, etc.)`,
    inputSchema: {
      uri: z.string().describe("URI of the concept in schema.gov.it"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ uri }) => {
    return executeTool("find_external_alignments", { uri }, async () => {
      const safeUri = sanitizeSparqlUri(uri);
      const query = `
        SELECT DISTINCT ?target ?relation
        WHERE {
          {
            <${safeUri}> owl:sameAs ?target .
            BIND("owl:sameAs" AS ?relation)
            FILTER(isIRI(?target))
          } UNION {
            ?target owl:sameAs <${safeUri}> .
            BIND("owl:sameAs" AS ?relation)
            FILTER(isIRI(?target))
          } UNION {
            <${safeUri}> skos:exactMatch ?target .
            BIND("skos:exactMatch" AS ?relation)
            FILTER(isIRI(?target))
          } UNION {
            <${safeUri}> skos:closeMatch ?target .
            BIND("skos:closeMatch" AS ?relation)
            FILTER(isIRI(?target))
          } UNION {
            <${safeUri}> skos:broadMatch ?target .
            BIND("skos:broadMatch" AS ?relation)
            FILTER(isIRI(?target))
          } UNION {
            <${safeUri}> skos:narrowMatch ?target .
            BIND("skos:narrowMatch" AS ?relation)
            FILTER(isIRI(?target))
          }
        }
      `;
      const result = await executeSparql(query);
      const bindings = result.results?.bindings ?? [];

      const alignments = bindings.map(b => {
        const targetUri = b.target?.value ?? "";
        let domain = "";
        try {
          domain = new URL(targetUri).origin;
        } catch {
          domain = targetUri;
        }
        return {
          uri: targetUri,
          relation: b.relation?.value ?? "",
          domain,
        };
      });

      return {
        success: true,
        data: { concept: uri, alignments },
        rowCount: alignments.length,
      };
    });
  }
);

server.registerTool(
  "explore_external_endpoint",
  {
    title: "Explore External SPARQL Endpoint",
    description: `Explore the structure of an external SPARQL endpoint: discover its main classes and instance counts.

**Args:**
- endpointUrl: URL of the SPARQL endpoint to explore (must be HTTPS)
- limit: Maximum number of classes to return (default: 20)

**Returns:**
- List of classes with instance counts, ordered by count descending

**Security:** Only HTTPS endpoints are allowed. Requests timeout after 15 seconds.

**Use when:** Getting a quick overview of what data an external endpoint contains before writing detailed queries.`,
    inputSchema: {
      endpointUrl: z.string().describe("URL of the SPARQL endpoint to explore (HTTPS required)"),
      limit: z.number().optional().default(20).describe("Maximum number of classes to return"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ endpointUrl, limit }) => {
    return executeTool("explore_external_endpoint", { endpointUrl, limit }, async () => {
      const safeEndpoint = sanitizeSparqlUri(endpointUrl);
      const query = `
        SELECT ?class (COUNT(?s) AS ?count)
        WHERE { ?s a ?class }
        GROUP BY ?class
        ORDER BY DESC(?count)
        LIMIT ${limit}
      `;
      const result = await executeSparql(query, safeEndpoint, false, 15000);
      const rowCount = result.results?.bindings?.length ?? 0;
      const compressed = compressSparqlResult(result);
      return { success: true, data: compressed, rowCount };
    });
  }
);

// =============================================================================
// GROUP K: Local Ontology Tools
// =============================================================================

server.registerTool(
  "inspect_local_ontology",
  {
    title: "Inspect Local Ontology",
    description: `Load and summarize a local RDF/OWL ontology file (TTL, OWL/RDF-XML, NT, JSON-LD).

**Input (provide exactly one):**
- file_path: Absolute path on the server filesystem — use when running locally or via Docker with a mounted volume
- content + format: Raw RDF text — use when the server is remote (HTTP mode); the client reads the file and sends its content inline (max 1 MB)
- upload_id: UUID returned by POST /upload — use when the file was already uploaded via HTTP

**format values:** "text/turtle" (default), "application/rdf+xml", "application/n-triples", "application/ld+json"

**Returns:**
- File info: format, triple count, source
- Classes: defined owl:Class / rdfs:Class with instance counts (top 20)
- Properties: count of object and datatype properties
- Namespaces used

**Efficiency:** file_path results are cached by mtime; repeated calls on unchanged files skip re-parsing.`,
    inputSchema: {
      file_path: z.string().optional().describe("Absolute path to the ontology file on the server filesystem"),
      content: z.string().optional().describe("Raw RDF content as string (for remote server use; max 1 MB)"),
      format: z.string().optional().describe('RDF format of content: "text/turtle" (default), "application/rdf+xml", "application/n-triples", "application/ld+json"'),
      upload_id: z.string().optional().describe("Upload UUID returned by POST /upload (HTTP mode)"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ file_path, content, format, upload_id }) => {
    return executeTool("inspect_local_ontology", { file_path, content: content ? `[${content.length} chars]` : undefined, format, upload_id }, async () => {
      const { store, format: fmt, tripleCount, source } = await resolveLocalStore(file_path, content, format, upload_id);

      const classesResult = runLocalSparql(store, `
        SELECT ?class (COUNT(DISTINCT ?inst) AS ?count)
        WHERE {
          { ?class a owl:Class } UNION { ?class a rdfs:Class }
          OPTIONAL { ?inst a ?class }
        }
        GROUP BY ?class ORDER BY DESC(?count) LIMIT 20
      `);

      const propsResult = runLocalSparql(store, `
        SELECT
          (COUNT(DISTINCT ?op) AS ?objectProps)
          (COUNT(DISTINCT ?dp) AS ?dataProps)
        WHERE {
          OPTIONAL { ?op a owl:ObjectProperty }
          OPTIONAL { ?dp a owl:DatatypeProperty }
        }
      `);

      const nsResult = runLocalSparql(store, `
        SELECT DISTINCT (REPLACE(STR(?s), "(#|/)[^#/]*$", "$1") AS ?ns)
        WHERE { ?s a ?t . FILTER(isIRI(?s)) }
        LIMIT 15
      `);

      const classes = compressSparqlResult(classesResult);
      const props = compressSparqlResult(propsResult);
      const namespaces = (nsResult.results.bindings.map(b => b.ns?.value)).filter(Boolean);

      return {
        success: true,
        data: {
          source,
          format: fmt,
          tripleCount,
          classes,
          properties: props,
          namespaces,
        },
      };
    });
  }
);

server.registerTool(
  "query_local_ontology",
  {
    title: "Query Local Ontology",
    description: `Execute a SPARQL SELECT query against a local RDF/OWL ontology file.

**Args (provide exactly one of file_path or upload_id):**
- file_path: Absolute path to the ontology file (local/Docker)
- upload_id: UUID returned by POST /upload (HTTP mode)
- query: SPARQL SELECT query
- inject_prefixes: Inject standard prefixes (rdf, rdfs, owl, skos, dct…) — default true

**Returns:**
- Compressed SPARQL results (tabular for >5 rows, compact for ≤5 rows)

**Supported formats:** .ttl (Turtle), .owl / .rdf (RDF/XML), .nt (N-Triples), .jsonld (JSON-LD)
**Efficiency:** File is cached after first load; repeated queries on the same unchanged file skip re-parsing.
**Note:** Standard prefixes (rdf, rdfs, owl, skos…) are injected automatically unless inject_prefixes=false.`,
    inputSchema: {
      file_path: z.string().optional().describe("Absolute path to the local ontology file (local/Docker)"),
      upload_id: z.string().optional().describe("Upload UUID returned by POST /upload (HTTP mode)"),
      query: z.string().describe("SPARQL SELECT query to execute"),
      inject_prefixes: z.boolean().optional().default(true).describe("Inject standard prefixes (default: true)"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ file_path, upload_id, query, inject_prefixes }) => {
    return executeTool("query_local_ontology", { file_path, upload_id, query, inject_prefixes }, async () => {
      const { store } = await resolveLocalStore(file_path, undefined, undefined, upload_id);
      const result = runLocalSparql(store, query, inject_prefixes ?? true);
      const rowCount = result.results.bindings.length;
      const compressed = compressSparqlResult(result);
      return { success: true, data: compressed, rowCount };
    });
  }
);

server.registerTool(
  "compare_local_with_remote",
  {
    title: "Compare Local Ontology with schema.gov.it",
    description: `Compare classes and/or properties defined in a local ontology file against schema.gov.it.

**Args (provide exactly one of file_path or upload_id):**
- file_path: Absolute path to the local ontology file (local/Docker)
- upload_id: UUID returned by POST /upload (HTTP mode)
- type: What to compare — "classes" | "properties" | "all" (default: "classes")
- limit: Max local items to check (default: 50)

**Returns:**
- matched: URIs found in both local file and schema.gov.it (with Italian label if available)
- local_only: URIs defined locally but absent from schema.gov.it
- summary counts

**Use when:** Starting to build an ontology — quickly discover which of your classes/properties already exist in schema.gov.it so you can reuse or align them.`,
    inputSchema: {
      file_path: z.string().optional().describe("Absolute path to the local ontology file (local/Docker)"),
      upload_id: z.string().optional().describe("Upload UUID returned by POST /upload (HTTP mode)"),
      type: z.enum(["classes", "properties", "all"]).optional().default("classes").describe("What to compare"),
      limit: z.number().optional().default(50).describe("Max local items to check remotely"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ file_path, upload_id, type, limit }) => {
    return executeTool("compare_local_with_remote", { file_path, upload_id, type, limit }, async () => {
      const { store } = await resolveLocalStore(file_path, undefined, undefined, upload_id);
      const safeLimit = Math.min(limit ?? 50, 100);

      // Collect local URIs
      const localUris: string[] = [];

      if (type === "classes" || type === "all") {
        const r = runLocalSparql(store, `
          SELECT DISTINCT ?c WHERE {
            { ?c a owl:Class } UNION { ?c a rdfs:Class }
            FILTER(isIRI(?c))
          } LIMIT ${safeLimit}
        `);
        for (const b of r.results.bindings) {
          if (b.c?.value) localUris.push(b.c.value);
        }
      }

      if (type === "properties" || type === "all") {
        const r = runLocalSparql(store, `
          SELECT DISTINCT ?p WHERE {
            { ?p a owl:ObjectProperty } UNION { ?p a owl:DatatypeProperty } UNION { ?p a rdf:Property }
            FILTER(isIRI(?p))
          } LIMIT ${safeLimit}
        `);
        for (const b of r.results.bindings) {
          if (b.p?.value) localUris.push(b.p.value);
        }
      }

      if (localUris.length === 0) {
        return { success: true, data: { matched: [], local_only: [], summary: { localCount: 0, matchedCount: 0, localOnlyCount: 0 } } };
      }

      // Check which URIs exist in schema.gov.it
      const valuesClause = localUris.map(u => `<${u}>`).join(" ");
      const remoteQuery = `
        SELECT DISTINCT ?uri ?label
        WHERE {
          VALUES ?uri { ${valuesClause} }
          ?uri ?p [] .
          OPTIONAL { ?uri rdfs:label ?label . FILTER(LANG(?label) = "it") }
        }
      `;
      const remoteResult = await executeSparql(remoteQuery);
      const remoteUris = new Set(remoteResult.results.bindings.map(b => b.uri?.value).filter(Boolean));
      const labelMap: Record<string, string> = {};
      for (const b of remoteResult.results.bindings) {
        if (b.uri?.value && b.label?.value) labelMap[b.uri.value] = b.label.value;
      }

      const matched = localUris
        .filter(u => remoteUris.has(u))
        .map(u => ({ uri: u, label: labelMap[u] ?? null }));
      const local_only = localUris.filter(u => !remoteUris.has(u));

      return {
        success: true,
        data: {
          matched,
          local_only,
          summary: {
            localCount: localUris.length,
            matchedCount: matched.length,
            localOnlyCount: local_only.length,
          },
        },
        rowCount: localUris.length,
      };
    });
  }
);

// =============================================================================
// GROUP L: Uploaded Store Tools (HTTP upload workflow)
// =============================================================================

server.registerTool(
  "query_uploaded_store",
  {
    title: "Query Uploaded Store",
    description: `Execute a SPARQL SELECT query against a temporary ontology store created via HTTP upload.

**Workflow (HTTP mode only):**
1. Upload a local RDF file: \`POST /upload\` with raw RDF body and correct Content-Type (max 1 MB)
2. Response: \`{"id": "<uuid>", "tripleCount": N, "endpoint": "/sparql/<uuid>"}\`
3. Use the \`id\` here to run SPARQL queries, OR pass it as \`upload_id\` to \`inspect_local_ontology\`, \`query_local_ontology\`, \`compare_local_with_remote\`

**Supported Content-Types for upload:** text/turtle, application/rdf+xml, application/n-triples, application/ld+json

**Notes:**
- Uploaded stores are kept for 1 hour then evicted
- Standard prefixes (rdf/rdfs/owl/skos/dct/xsd/dcat/foaf/clv/cpv/l0/sm) are auto-injected
- The same store is also queryable directly via \`GET /sparql/<id>?query=...\``,
    inputSchema: {
      id: z.string().describe("Upload UUID returned by POST /upload"),
      query: z.string().describe("SPARQL SELECT query to execute against the uploaded store"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ id, query }) => {
    return executeTool("query_uploaded_store", { id, query }, async () => {
      const entry = uploadedStores.get(id);
      if (!entry) {
        return {
          success: false,
          error: `Uploaded store '${id}' not found or expired.`,
          suggestion: "Upload a file first via POST /upload (raw RDF body, max 1 MB). Stores expire after 1 hour.",
        };
      }
      const result = runLocalSparql(entry.store, query, true);
      const rowCount = result.results.bindings.length;
      const compressed = compressSparqlResult(result);
      return { success: true, data: compressed, rowCount };
    });
  }
);

  return server;
}

async function main() {
  console.error("[Startup] Schema.gov.it MCP Server initializing...");
  console.error("[Startup] Node version:", process.version);
  console.error("[Startup] Working directory:", process.cwd());

  // Ensure log directory exists
  mkdirSync(LOG_DIR, { recursive: true });

  // Support both stdio (default) and HTTP/SSE modes
  const transportMode = process.env.MCP_TRANSPORT || 'stdio';
  console.error("[Startup] Transport mode:", transportMode);

  if (transportMode === 'sse' || transportMode === 'http') {
    // HTTP mode for Docker/remote access using StreamableHTTPServerTransport
    console.error("[Startup] Configuring Streamable HTTP server...");
    const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
    const HOST = process.env.HOST || '0.0.0.0';
    console.error(`[Startup] Will listen on ${HOST}:${PORT}`);

    // Session tracking: map session IDs to their transport + server
    const sessions = new Map<string, { server: McpServer; transport: StreamableHTTPServerTransport }>();

    /** Parse JSON body from an IncomingMessage */
    function parseBody(req: IncomingMessage): Promise<unknown> {
      return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          if (!raw) { resolve(undefined); return; }
          try { resolve(JSON.parse(raw)); }
          catch (e) { reject(e); }
        });
        req.on('error', reject);
      });
    }

    const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      console.error(`[HTTP] ${req.method} ${url.pathname} from ${req.socket.remoteAddress}`);

      // Health check endpoint
      if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', service: 'schema-gov-it-mcp', sessions: sessions.size, uploadedStores: uploadedStores.size }));
        return;
      }

      // POST /upload – upload an RDF file (max 1 MB), get back an id + SPARQL endpoint
      if (url.pathname === '/upload' && req.method === 'POST') {
        evictExpiredUploads();
        let bodyBuf: Buffer;
        try {
          bodyBuf = await readRawBodyWithLimit(req, MAX_UPLOAD_SIZE);
        } catch (e) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `File too large. Maximum size is ${MAX_UPLOAD_SIZE} bytes (1 MB).` }));
          return;
        }
        const contentType = req.headers['content-type'] ?? '';
        const formatParam = url.searchParams.get('format');
        const ctNorm = (contentType.split(';')[0] ?? '').trim().toLowerCase();
        const ctFormatMap: Record<string, string> = {
          'text/turtle': 'text/turtle', 'application/turtle': 'text/turtle',
          'application/rdf+xml': 'application/rdf+xml',
          'application/n-triples': 'application/n-triples',
          'application/ld+json': 'application/ld+json',
          'text/n3': 'text/n3', 'text/rdf+n3': 'text/n3',
        };
        const extFormatMap: Record<string, string> = {
          ttl: 'text/turtle', n3: 'text/n3', nt: 'application/n-triples',
          jsonld: 'application/ld+json', json: 'application/ld+json',
          xml: 'application/rdf+xml', rdf: 'application/rdf+xml', owl: 'application/rdf+xml',
        };
        const format =
          ctFormatMap[ctNorm] ??
          (formatParam ? extFormatMap[formatParam.toLowerCase()] : undefined) ??
          'text/turtle';
        const store = new OxStore();
        try {
          store.load(bodyBuf.toString('utf-8'), { format, lenient: true });
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Failed to parse RDF: ${String(e)}` }));
          return;
        }
        const id = randomUUID();
        uploadedStores.set(id, { store, format, tripleCount: store.size, created: Date.now() });
        console.error(`[Upload] Stored ontology id=${id} triples=${store.size} format=${format}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id, tripleCount: store.size, format, endpoint: `/sparql/${id}` }));
        return;
      }

      // GET|POST /sparql/{id} – SPARQL 1.1 Protocol endpoint for an uploaded store
      const sparqlMatch = /^\/sparql\/([0-9a-f-]{36})$/i.exec(url.pathname);
      if (sparqlMatch) {
        const id = sparqlMatch[1] ?? '';
        const entry = uploadedStores.get(id);
        if (!entry) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Store '${id}' not found or expired. Upload a file first via POST /upload.` }));
          return;
        }
        let sparqlQuery: string | undefined;
        if (req.method === 'GET') {
          sparqlQuery = url.searchParams.get('query') ?? undefined;
        } else if (req.method === 'POST') {
          const bodyBuf = await readRawBodyWithLimit(req, MAX_UPLOAD_SIZE);
          const body = bodyBuf.toString('utf-8');
          const ct = req.headers['content-type'] ?? '';
          if (ct.includes('application/sparql-query')) {
            sparqlQuery = body;
          } else if (ct.includes('application/x-www-form-urlencoded')) {
            sparqlQuery = new URLSearchParams(body).get('query') ?? undefined;
          } else {
            sparqlQuery = body; // fallback: treat body as raw SPARQL
          }
        }
        if (!sparqlQuery) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing SPARQL query. Use ?query= (GET) or POST body.' }));
          return;
        }
        try {
          const raw = entry.store.query(sparqlQuery, { use_default_graph_as_union: true });
          if (Array.isArray(raw)) {
            const rows = raw as Map<string, OxTerm>[];
            const vars = rows[0] ? Array.from(rows[0].keys()) : [];
            const bindings = rows.map(row => {
              const b: Record<string, unknown> = {};
              for (const [k, v] of row.entries()) {
                if (v.termType === "NamedNode") {
                  b[k] = { type: "uri", value: v.value };
                } else if (v.termType === "BlankNode") {
                  b[k] = { type: "bnode", value: v.value };
                } else if (v.termType === "Literal") {
                  const lit: Record<string, unknown> = { type: "literal", value: v.value };
                  if (v.language) lit["xml:lang"] = v.language;
                  if (v.datatype) lit["datatype"] = v.datatype.value;
                  b[k] = lit;
                }
              }
              return b;
            });
            res.writeHead(200, { 'Content-Type': 'application/sparql-results+json' });
            res.end(JSON.stringify({ head: { vars }, results: { bindings } }));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/sparql-results+json' });
            res.end(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }));
          }
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(e) }));
        }
        return;
      }

      // MCP endpoint – delegate everything to StreamableHTTPServerTransport
      if (url.pathname === '/mcp') {
        try {
          // Check for existing session
          const sessionId = req.headers['mcp-session-id'] as string | undefined;

          if (sessionId && sessions.has(sessionId)) {
            // Existing session: forward request to its transport
            const session = sessions.get(sessionId)!;
            const body = req.method === 'POST' ? await parseBody(req) : undefined;
            console.error(`[MCP] Existing session ${sessionId}, method=${req.method}`);
            await session.transport.handleRequest(req, res, body);
            return;
          }

          if (req.method === 'POST') {
            // New session: create server + transport, connect, then handle the initialize request
            console.error("[MCP] New session initializing...");
            const body = await parseBody(req);
            const serverInstance = createAndConfigureServer();
            const transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => randomUUID(),
            });

            // Clean up session when transport closes
            transport.onclose = () => {
              const sid = transport.sessionId;
              if (sid) {
                console.error(`[MCP] Session ${sid} closed, cleaning up`);
                sessions.delete(sid);
              }
            };

            // exactOptionalPropertyTypes requires onclose to be defined before connect
            await serverInstance.connect(transport as Parameters<typeof serverInstance.connect>[0]);

            // Handle the initialize request (this sets transport.sessionId)
            await transport.handleRequest(req, res, body);

            // Store session for future requests
            const sid = transport.sessionId;
            if (sid) {
              sessions.set(sid, { server: serverInstance, transport });
              console.error(`[MCP] Session ${sid} created (active sessions: ${sessions.size})`);
            }
            return;
          }

          // GET or DELETE without valid session
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'No valid session. Send an initialize POST first.' },
            id: null,
          }));
        } catch (error) {
          console.error("[MCP] Request error:", error);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: String(error) }));
          }
        }
        return;
      }

      // 404 for other paths
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found', hint: 'MCP endpoint is at /mcp' }));
    });

    httpServer.listen(PORT, HOST, () => {
      console.error(`[Startup] ✓ Schema.gov.it MCP Server running on http://${HOST}:${PORT}`);
      console.error(`[Startup] ✓ MCP endpoint: http://${HOST}:${PORT}/mcp`);
      console.error(`[Startup] ✓ Health check: http://${HOST}:${PORT}/health`);
      console.error("[Startup] Server ready to accept connections");
    });

    httpServer.on('error', (error) => {
      console.error("[Startup] HTTP Server error:", error);
    });
  } else {
    // Stdio mode for local process spawning (default)
    console.error("[Startup] Initializing stdio transport...");
    console.error("[Startup] Creating and configuring server instance...");
    const server = createAndConfigureServer();
    const transport = new StdioServerTransport();
    console.error("[Startup] Connecting server to transport...");
    await server.connect(transport);
    console.error("[Startup] Schema.gov.it MCP Server running on stdio");
    console.error("[Startup] Server ready to accept requests");
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
