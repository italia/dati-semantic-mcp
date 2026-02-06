#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { appendFile, readFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

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

// =============================================================================
// CONSTANTS
// =============================================================================

/** Maximum character limit for tool responses to prevent excessive output */
const CHARACTER_LIMIT = 50_000;

const server = new McpServer({
  name: "schema-gov-it",
  version: "1.0.0",
});

const LOG_FILE = join(process.cwd(), "usage_log.jsonl");

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

async function executeSparql(query: string): Promise<SparqlResult> {
  const fullQuery = PREFIXES + "\n" + query;
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/sparql-results+json",
    },
    body: new URLSearchParams({ query: fullQuery }),
  });

  if (!response.ok) {
    throw new Error(`SPARQL request failed: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<SparqlResult>;
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
  try {
    const result = await handler();

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

**Returns:**
- Matching subjects with type and label

**Use when:** You don't know the exact URI of a concept.`,
    inputSchema: {
      keyword: z.string().describe("The search term (e.g. 'amministrazione')"),
      limit: z.number().optional().default(10),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ keyword, limit }) => {
    const safeKeyword = sanitizeSparqlString(keyword);
    const query = `
      SELECT DISTINCT ?subject ?type ?label
      WHERE {
        VALUES ?type { owl:Class owl:ObjectProperty owl:DatatypeProperty skos:Concept }
        ?subject a ?type .
        ?subject rdfs:label|skos:prefLabel|dct:title ?label .
        FILTER(REGEX(STR(?label), "${safeKeyword}", "i"))
      }
      LIMIT ${limit}
    `;
    return executeSparqlTool("search_concepts", { keyword, limit }, query);
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


async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Schema.gov.it MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
