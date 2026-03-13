import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { executeTool } from "../executor.js";
import { sanitizeSparqlUri, executeSparql } from "../sparql.js";
import { OKG_CATEGORIES } from "../constants.js";
import type { ToolResult } from "../types.js";

// =============================================================================
// GROUP M: Open Knowledge Graphs (OKG) Integration
// https://api.openknowledgegraphs.com — CC0, no auth required
// =============================================================================

const OKG_BASE_URL = "https://api.openknowledgegraphs.com";
const OKG_TIMEOUT_MS = 10000;

interface OkgResource {
  title: string;
  wikidataId?: string;
  description?: string;
  types?: string[];
  category?: string;
  homepage?: string;
  creators?: unknown[];
  licenses?: unknown[];
  partOf?: string;
  score?: number;
  latestVersion?: string;
  releaseDate?: string;
}

interface OkgSearchResponse {
  query?: string;
  category?: string;
  total?: number;
  results?: OkgResource[];
}

async function fetchOkg(
  path: string,
  params: Record<string, string | number | undefined>
): Promise<OkgSearchResponse> {
  const url = new URL(`${OKG_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OKG_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), { signal: controller.signal });
    if (!response.ok) {
      throw new Error(
        `OKG API returned HTTP ${response.status}: ${await response.text()}`
      );
    }
    return (await response.json()) as OkgSearchResponse;
  } finally {
    clearTimeout(timer);
  }
}

export function registerGroupM(server: McpServer): void {

  server.registerTool(
    "search_okg_resources",
    {
      title: "Search Open Knowledge Graphs Resources",
      description: `Search the Open Knowledge Graphs (OKG) catalog for ontologies, vocabularies, and taxonomies.

OKG indexes 1800+ semantic resources with metadata sourced from Wikidata. All data is CC0.

**Args:**
- query: Search term (required)
- category: Optional thematic category filter
- type: Optional resource type filter ("Ontology", "ControlledVocabulary", "Taxonomy")
- limit: Maximum results (default: 20)

**Returns:**
- List of resources with title, wikidataId, description, category, homepage, licenses, types

**Available categories:**
Government & Public Sector, Geospatial, Life Sciences & Healthcare, International Development,
Finance & Business, Library & Cultural Heritage, Technology & Web, Environment & Agriculture,
General / Cross-domain

**Use when:** Discovering international ontologies and vocabularies in a domain before aligning
with schema.gov.it resources. Pair with find_okg_alignments or compare_coverage_with_okg.`,
      inputSchema: {
        query: z.string().describe("Search term"),
        category: z
          .enum(OKG_CATEGORIES)
          .optional()
          .describe("Optional thematic category filter"),
        type: z
          .enum(["Ontology", "ControlledVocabulary", "Taxonomy"])
          .optional()
          .describe("Optional resource type filter"),
        limit: z
          .number()
          .optional()
          .default(20)
          .describe("Maximum number of results (default: 20)"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ query, category, type, limit }) => {
      return executeTool(
        "search_okg_resources",
        { query, category, type, limit },
        async () => {
          const data = await fetchOkg("/search", {
            q: query,
            category,
            type,
            limit: limit ?? 20,
          });

          const results = data.results ?? [];
          return {
            success: true,
            data: {
              query,
              category: category ?? null,
              type: type ?? null,
              total: data.total ?? results.length,
              returned: results.length,
              source: "openknowledgegraphs.com (CC0)",
              results,
            },
            rowCount: results.length,
            sourceData: data,
          };
        }
      );
    }
  );

  server.registerTool(
    "find_okg_alignments",
    {
      title: "Find OKG Alignments for a schema.gov.it Resource",
      description: `Given a schema.gov.it URI, find related resources in the Open Knowledge Graphs catalog.

**How it works (3 steps):**
1. Queries schema.gov.it for the resource's label and any Wikidata alignments (owl:sameAs, skos:exactMatch)
2. Searches OKG using the resource label
3. Cross-references OKG results: those whose wikidataId matches a known alignment are "confirmed matches";
   the rest are "candidates" (label-based, need manual review)

**Args:**
- uri: URI of a schema.gov.it concept, class, or vocabulary

**Returns:**
- label: The label used for OKG search
- wikidata_alignments: Wikidata URIs already present in schema.gov.it for this resource
- okg_matches: OKG resources with a confirmed Wikidata alignment (high confidence)
- okg_candidates: OKG resources found by label search only (lower confidence)

**Use when:** Discovering international equivalents of a local ontology or vocabulary, or checking
whether a schema.gov.it concept is represented in global semantic standards.`,
      inputSchema: {
        uri: z.string().describe("URI of a schema.gov.it resource"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ uri }) => {
      return executeTool("find_okg_alignments", { uri }, async () => {
        const safeUri = sanitizeSparqlUri(uri);

        // Step 1: get label and Wikidata alignments from schema.gov.it
        const sparqlQuery = `
          SELECT DISTINCT ?label ?target
          WHERE {
            OPTIONAL {
              {
                <${safeUri}> rdfs:label ?label .
              } UNION {
                <${safeUri}> skos:prefLabel ?label .
              }
              FILTER(LANG(?label) = "it" || LANG(?label) = "en" || LANG(?label) = "")
            }
            OPTIONAL {
              {
                <${safeUri}> owl:sameAs ?target .
              } UNION {
                <${safeUri}> skos:exactMatch ?target .
              }
              FILTER(
                isIRI(?target) &&
                (CONTAINS(STR(?target), "wikidata.org") || CONTAINS(STR(?target), "wikidata.entity"))
              )
            }
          }
          LIMIT 20
        `;

        const sparqlResult = await executeSparql(sparqlQuery);
        const bindings = sparqlResult.results?.bindings ?? [];

        const labels = new Set<string>();
        const wikidataUris = new Set<string>();

        for (const b of bindings) {
          if (b.label?.value) labels.add(b.label.value);
          if (b.target?.value) wikidataUris.add(b.target.value);
        }

        // Prefer English label for OKG search (OKG is English-centric)
        const labelList = [...labels];
        const searchLabel =
          labelList.find((l) => /^[a-zA-Z]/.test(l)) ?? labelList[0];

        if (!searchLabel) {
          return {
            success: false,
            error: `No label found for <${uri}>. Make sure the URI exists in schema.gov.it.`,
            suggestion:
              "Use describe_resource or inspect_concept to verify the URI first.",
          };
        }

        // Step 2: search OKG by label
        const okgData = await fetchOkg("/search", {
          q: searchLabel,
          limit: 20,
        });
        const okgResults = okgData.results ?? [];

        // Step 3: cross-reference wikidataId
        const wikidataUriList = [...wikidataUris];

        const okgMatches = okgResults.filter(
          (r) =>
            r.wikidataId &&
            wikidataUriList.some(
              (w) =>
                w === r.wikidataId ||
                w.endsWith(`/${r.wikidataId!.split("/").pop()}`)
            )
        );

        const okgCandidates = okgResults.filter(
          (r) => !okgMatches.includes(r)
        );

        return {
          success: true,
          data: {
            uri,
            label: searchLabel,
            wikidata_alignments: wikidataUriList,
            okg_matches: okgMatches,
            okg_candidates: okgCandidates,
            note:
              okgMatches.length > 0
                ? "okg_matches have a confirmed Wikidata alignment. okg_candidates are label-based suggestions only."
                : "No confirmed Wikidata-based matches found. Review okg_candidates manually.",
          },
          rowCount: okgMatches.length + okgCandidates.length,
          sourceData: { sparqlResult, okgData },
        };
      });
    }
  );

  server.registerTool(
    "find_semantic_software",
    {
      title: "Find Semantic Software Tools (OKG)",
      description: `Search the Open Knowledge Graphs catalog for semantic web software tools.

OKG indexes semantic tools such as ontology editors, SPARQL engines, vocabulary managers,
RDF converters, and reasoning engines — with version and release metadata. Data is CC0.

**Args:**
- query: Search term (e.g. "SPARQL", "ontology editor", "SKOS", "RDF converter", "reasoner")
- limit: Maximum results (default: 10)

**Returns:**
- List of tools with title, description, latestVersion, releaseDate, homepage, licenses

**Use when:** Looking for open-source tools to validate ontologies, work with SKOS/OWL/RDF data,
or build semantic applications on top of schema.gov.it content.`,
      inputSchema: {
        query: z.string().describe("Search term for semantic software tools"),
        limit: z
          .number()
          .optional()
          .default(10)
          .describe("Maximum number of results (default: 10)"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ query, limit }) => {
      return executeTool(
        "find_semantic_software",
        { query, limit },
        async () => {
          const data = await fetchOkg("/software", {
            q: query,
            limit: limit ?? 10,
          });

          const results = data.results ?? [];
          return {
            success: true,
            data: {
              query,
              total: data.total ?? results.length,
              returned: results.length,
              source: "openknowledgegraphs.com (CC0)",
              tools: results,
            },
            rowCount: results.length,
            sourceData: data,
          };
        }
      );
    }
  );

  server.registerTool(
    "compare_coverage_with_okg",
    {
      title: "Compare schema.gov.it Coverage with OKG",
      description: `Gap analysis: compare schema.gov.it semantic resources against the international OKG catalog for a given domain.

**How it works:**
1. Fetches OKG resources for the given category
2. For resources that have a Wikidata ID, queries schema.gov.it for matching owl:sameAs / skos:exactMatch links
3. Classifies each OKG resource as "covered" (linked in schema.gov.it) or "gap" (not linked)

**Args:**
- category: OKG thematic category to analyze
- limit: Max OKG resources to fetch (default: 50)

**Returns:**
- summary: total, covered count, gap count, coverage percentage
- covered: OKG resources already linked in schema.gov.it (with local URI and relation type)
- gaps: OKG resources with no corresponding link in schema.gov.it
- without_wikidata: OKG resources without a Wikidata ID (cannot be cross-referenced automatically)

**Available categories:**
Government & Public Sector, Geospatial, Life Sciences & Healthcare, International Development,
Finance & Business, Library & Cultural Heritage, Technology & Web, Environment & Agriculture,
General / Cross-domain

**Use when:** Assessing which international standards are missing in schema.gov.it for a specific
domain, or prioritizing new ontology and vocabulary contributions.`,
      inputSchema: {
        category: z
          .enum(OKG_CATEGORIES)
          .describe("OKG thematic category to analyze"),
        limit: z
          .number()
          .optional()
          .default(50)
          .describe("Max OKG resources to fetch (default: 50)"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ category, limit }) => {
      return executeTool(
        "compare_coverage_with_okg",
        { category, limit },
        async (): Promise<ToolResult> => {
          // Step 1: fetch OKG resources for the category
          const okgData = await fetchOkg("/search", {
            q: category,
            category,
            limit: limit ?? 50,
          });

          const okgResults = okgData.results ?? [];

          const withWikidata = okgResults.filter((r) => r.wikidataId);
          const withoutWikidata = okgResults.filter((r) => !r.wikidataId);

          if (withWikidata.length === 0) {
            return {
              success: true,
              data: {
                category,
                summary: {
                  total_okg: okgResults.length,
                  with_wikidata_id: 0,
                  without_wikidata_id: withoutWikidata.length,
                  covered: 0,
                  gaps: 0,
                  coverage_percent: 0,
                },
                covered: [] as unknown[],
                gaps: [] as unknown[],
                without_wikidata: withoutWikidata.map((r) => ({
                  title: r.title,
                  types: r.types,
                  homepage: r.homepage,
                  description: r.description,
                })),
                note: "None of the OKG resources in this category have a Wikidata ID. Automatic cross-referencing is not possible.",
              },
              rowCount: okgResults.length,
              sourceData: okgData,
            };
          }

          // Step 2: batch SPARQL to check which Wikidata URIs are already linked in schema.gov.it
          const wikidataUriValues = withWikidata
            .map((r) => `<${r.wikidataId}>`)
            .join("\n              ");

          const sparqlQuery = `
            SELECT DISTINCT ?wikidataUri ?localResource ?relation
            WHERE {
              VALUES ?wikidataUri { ${wikidataUriValues} }
              {
                ?localResource owl:sameAs ?wikidataUri .
                BIND("owl:sameAs" AS ?relation)
              } UNION {
                ?localResource skos:exactMatch ?wikidataUri .
                BIND("skos:exactMatch" AS ?relation)
              }
            }
          `;

          const sparqlResult = await executeSparql(sparqlQuery);
          const bindings = sparqlResult.results?.bindings ?? [];

          // Build lookup: wikidataUri → { localResource, relation }
          const coveredMap = new Map<
            string,
            { localResource: string; relation: string }
          >();
          for (const b of bindings) {
            if (b.wikidataUri?.value && b.localResource?.value) {
              coveredMap.set(b.wikidataUri.value, {
                localResource: b.localResource.value,
                relation: b.relation?.value ?? "",
              });
            }
          }

          // Step 3: classify
          const covered: unknown[] = [];
          const gaps: unknown[] = [];

          for (const r of withWikidata) {
            const match = coveredMap.get(r.wikidataId!);
            if (match) {
              covered.push({
                title: r.title,
                wikidataId: r.wikidataId,
                types: r.types,
                homepage: r.homepage,
                local_resource: match.localResource,
                relation: match.relation,
              });
            } else {
              gaps.push({
                title: r.title,
                wikidataId: r.wikidataId,
                types: r.types,
                homepage: r.homepage,
                description: r.description,
                licenses: r.licenses,
              });
            }
          }

          const coveragePercent =
            withWikidata.length > 0
              ? Math.round((covered.length / withWikidata.length) * 100)
              : 0;

          return {
            success: true,
            data: {
              category,
              summary: {
                total_okg: okgResults.length,
                with_wikidata_id: withWikidata.length,
                without_wikidata_id: withoutWikidata.length,
                covered: covered.length,
                gaps: gaps.length,
                coverage_percent: coveragePercent,
              },
              covered,
              gaps,
              without_wikidata: withoutWikidata.map((r) => ({
                title: r.title,
                types: r.types,
                homepage: r.homepage,
              })),
            },
            rowCount: okgResults.length,
            sourceData: { okgData, sparqlResult },
          };
        }
      );
    }
  );

}
