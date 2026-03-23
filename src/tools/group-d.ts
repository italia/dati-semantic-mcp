import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { executeTool, executeSparqlTool } from "../executor.js";
import { sanitizeSparqlUri, sanitizeSparqlString, executeSparql, compressSparqlResult } from "../sparql.js";

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

**When to use this vs X:**
- vs \`search_in_vocabulary\`: this is the preferred default for exploring a known ConceptScheme because it supports pagination and optional \`keyword\`
- use \`search_in_vocabulary\` only for a lightweight keyword lookup when pagination is not needed

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
