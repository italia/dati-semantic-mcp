import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { executeTool, executeSparqlTool } from "../executor.js";
import { sanitizeSparqlString, executeSparql, compressSparqlResult } from "../sparql.js";

// -----------------------------------------------------------------------------
// GROUP A: Foundation Tools
// -----------------------------------------------------------------------------

export function registerGroupA(server: McpServer): void {

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

}
