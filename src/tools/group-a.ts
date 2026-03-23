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

**When to use this vs X:**
- vs \`query_local_ontology\`: use this for the default remote catalog \`schema.gov.it\`; use \`query_local_ontology\` for a file/store loaded locally or via \`upload_id\`
- vs \`query_external_endpoint\`: use this for the built-in \`schema.gov.it\` endpoint; use \`query_external_endpoint\` only for another HTTPS SPARQL endpoint
- vs specialized tools: use this only when no dedicated tool already covers the task

**Do not use this if:**
- you need a concept profile → use \`inspect_concept\`
- you need property semantics → use \`get_property_details\`
- you need to search by keyword without a known URI → use \`search_concepts\`
- you need to browse a vocabulary or dataset → use the dedicated vocabulary/dataset tools

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

**When to use this vs X:**
- use this for a quick structural overview of the endpoint
- use \`list_ontologies\` or \`list_vocabularies\` when you want richer, more task-oriented views of ontologies or vocabularies

**Note:** This tool returns TWO lists in one call (named graphs + ontology/vocabulary resources). Both queries run in parallel for performance.`,
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
