import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { executeSparqlTool } from "../executor.js";
import { sanitizeSparqlUri, sanitizeSparqlString } from "../sparql.js";

// -----------------------------------------------------------------------------
// GROUP D: Vocabulary Tools
// -----------------------------------------------------------------------------

export function registerGroupD(server: McpServer): void {

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
- Matching concepts with labels and optional notation codes

**When to use this vs X:**
- vs \`browse_vocabulary\`: use this only for a quick keyword search inside a scheme you already know
- \`browse_vocabulary\` is usually the better default because it supports pagination and already accepts \`keyword\`

**Deprecated:** Prefer \`browse_vocabulary\` with the \`keyword\` parameter.`,
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

}
