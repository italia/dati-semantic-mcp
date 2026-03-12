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
- normalize_trailing_slash: If true, merge ontology IRIs that differ only by a final "/" (default: true)
- include_variants: If true and normalization is enabled, include raw URI variants to expose catalog inconsistencies

**Returns:**
- List of ontology URIs with labels/titles, ordered alphabetically

**Note:** Some ontologies are duplicated in the catalog with and without a trailing slash. By default this tool normalizes them, but you can inspect the raw variants when cleaning the catalog.`,
    inputSchema: {
      limit: z.number().optional().default(50),
      normalize_trailing_slash: z.boolean().optional().default(true),
      include_variants: z.boolean().optional().default(false),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ limit, normalize_trailing_slash, include_variants }) => {
    const query = normalize_trailing_slash
      ? `
        SELECT ?ont (SAMPLE(?labelRaw) AS ?label) (COUNT(DISTINCT ?rawOnt) AS ?variantCount) ${include_variants ? '(GROUP_CONCAT(DISTINCT STR(?rawOnt); separator=" | ") AS ?variants)' : ""}
        WHERE {
          ?rawOnt a owl:Ontology .
          OPTIONAL { ?rawOnt rdfs:label|dct:title ?labelRaw }
          BIND(IRI(REPLACE(STR(?rawOnt), "/$", "")) AS ?ont)
        }
        GROUP BY ?ont
        ORDER BY ?label ?ont
        LIMIT ${limit}
      `
      : `
        SELECT DISTINCT ?ont ?label
        WHERE {
          ?ont a owl:Ontology .
          OPTIONAL { ?ont rdfs:label|dct:title ?label }
        }
        ORDER BY ?label ?ont
        LIMIT ${limit}
      `;
    return executeSparqlTool("list_ontologies", { limit, normalize_trailing_slash, include_variants }, query);
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
