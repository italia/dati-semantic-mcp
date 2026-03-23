import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { executeTool, executeSparqlTool } from "../executor.js";
import { sanitizeSparqlUri, executeSparql, compressSparqlResult } from "../sparql.js";
import { RECOMMENDED_EXTERNAL_ENDPOINTS } from "../constants.js";

// =============================================================================
// GROUP J: Linked SPARQL Endpoints
// =============================================================================

export function registerGroupJ(server: McpServer): void {

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
- Query EU Publications Office: endpointUrl="https://publications.europa.eu/webapi/rdf/sparql"

**When to use this vs X:**
- vs \`query_sparql\`: use this only for an external HTTPS endpoint; use \`query_sparql\` for the built-in \`schema.gov.it\` endpoint
- vs \`explore_external_endpoint\`: use this when you already know the query you want to run; use \`explore_external_endpoint\` first if you just need a structural overview

**Do not use this if:**
- you want to query \`schema.gov.it\` itself → use \`query_sparql\`
- you want a curated shortlist of endpoints → use \`recommend_external_endpoints\`
- you only need endpoints already linked in the catalog metadata → use \`list_linked_endpoints\``,
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
      return { success: true, data: compressed, rowCount, sourceData: result };
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
        sourceData: result,
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
      return { success: true, data: compressed, rowCount, sourceData: result };
    });
  }
);

}
