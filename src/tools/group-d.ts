import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { executeTool, executeSparqlTool } from "../executor.js";
import { sanitizeSparqlUri, sanitizeSparqlString, executeSparql, compressSparqlResult, buildLangFilter } from "../sparql.js";
import type { LabelLang } from "../sparql.js";

// -----------------------------------------------------------------------------
// GROUP D: Vocabulary Tools
// -----------------------------------------------------------------------------

export function registerGroupD(server: McpServer): void {

async function browseVocabularyInternal(
  schemeUri: string,
  limit: number,
  offset: number,
  keyword: string | undefined,
  lang: LabelLang
) {
  const safeSchemeUri = sanitizeSparqlUri(schemeUri);
  const labelFilter = buildLangFilter("?label", lang);
  const keywordFilter = keyword
    ? `FILTER(REGEX(STR(?label), "${sanitizeSparqlString(keyword)}", "i"))`
    : "";

  const dataQuery = `
    SELECT ?concept ?code ?label
    WHERE {
      ?concept skos:inScheme <${safeSchemeUri}> .
      ?concept a skos:Concept .
      OPTIONAL { ?concept skos:notation ?code }
      OPTIONAL { ?concept skos:prefLabel|rdfs:label ?label . ${labelFilter} }
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
        ${labelFilter}
        FILTER(REGEX(STR(?label), "${sanitizeSparqlString(keyword)}", "i"))
      ` : ""}
    }
  `;

  const [dataResult, countResult] = await Promise.all([
    executeSparql(dataQuery),
    executeSparql(countQuery),
  ]);

  const concepts = compressSparqlResult(dataResult);
  const count = dataResult.results?.bindings?.length ?? 0;
  const total = parseInt(countResult.results?.bindings?.[0]?.total?.value ?? "0", 10);

  return {
    success: true as const,
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
}

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
- lang: "it" | "en" | "any" (default: "any")

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
      lang: z.enum(["it", "en", "any"]).optional().default("any").describe('Preferred label language; "any" keeps all languages.'),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ schemeUri, limit, offset, keyword, lang }) => {
    return executeTool("browse_vocabulary", { schemeUri, limit, offset, keyword, lang }, async () =>
      browseVocabularyInternal(schemeUri, limit, offset, keyword, lang)
    );
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
- lang: "it" | "en" | "any" (default: "any")

**Returns:**
- Matching concepts with labels and optional notation codes

**When to use this vs X:**
- vs \`browse_vocabulary\`: use this only for a quick keyword search inside a scheme you already know
- \`browse_vocabulary\` is usually the better default because it supports pagination and already accepts \`keyword\`

**Deprecated:** Deprecated. Usa \`browse_vocabulary\` con il parametro \`keyword\`.`,
    inputSchema: {
      schemeUri: z.string().describe("The URI of the ConceptScheme (from list_vocabularies)"),
      keyword: z.string().describe("The search keyword"),
      limit: z.number().optional().default(20),
      lang: z.enum(["it", "en", "any"]).optional().default("any").describe('Preferred label language; "any" keeps all languages.'),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ schemeUri, keyword, limit, lang }) => {
    return executeTool("search_in_vocabulary", { schemeUri, keyword, limit, lang }, async () =>
      browseVocabularyInternal(schemeUri, limit, 0, keyword, lang)
    );
  }
);

server.registerTool(
  "navigate_skos_hierarchy",
  {
    title: "Navigate SKOS Hierarchy",
    description: `Navigate a SKOS hierarchy upward and/or downward from a concept.

**Args:**
- uri: Concept URI
- direction: "up" | "down" | "both"
- depth: 1..5

**Returns:**
- Flat list of related concepts with direction and depth

**Use when:** You want a dedicated SKOS navigation tool instead of writing custom query_sparql property paths.`,
    inputSchema: {
      uri: z.string().describe("URI of the starting concept"),
      direction: z.enum(["up", "down", "both"]).optional().default("both").describe('Traverse broader, narrower, or both directions'),
      depth: z.number().min(1).max(5).optional().default(1).describe("Traversal depth from 1 to 5"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ uri, direction, depth }) => {
    const safeUri = sanitizeSparqlUri(uri);
    const clauses: string[] = [];

    const makePath = (predicate: string, hops: number) => Array.from({ length: hops }, () => predicate).join("/");
    const addDirection = (dir: "up" | "down", predicate: "skos:broader" | "skos:narrower") => {
      for (let level = 1; level <= depth; level++) {
        const path = makePath(predicate, level);
        clauses.push(`
          {
            <${safeUri}> ${path} ?concept .
            OPTIONAL { ?concept skos:prefLabel|rdfs:label ?label . FILTER(LANG(?label) = "it" || LANG(?label) = "en" || LANG(?label) = "") }
            BIND("${dir}" AS ?direction)
            BIND(${level} AS ?depth)
          }
        `);
      }
    };

    if (direction === "up" || direction === "both") addDirection("up", "skos:broader");
    if (direction === "down" || direction === "both") addDirection("down", "skos:narrower");

    const query = `
      SELECT DISTINCT ?direction ?depth ?concept ?label
      WHERE {
        ${clauses.join("\nUNION\n")}
      }
      ORDER BY ?direction ?depth ?label ?concept
      LIMIT 200
    `;

    return executeSparqlTool("navigate_skos_hierarchy", { uri, direction, depth }, query);
  }
);

}
