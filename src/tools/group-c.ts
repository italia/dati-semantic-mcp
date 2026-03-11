import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { executeSparqlTool } from "../executor.js";
import { sanitizeSparqlUri } from "../sparql.js";

// -----------------------------------------------------------------------------
// GROUP C: Ontology Tools
// -----------------------------------------------------------------------------

export function registerGroupC(server: McpServer): void {

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

}
