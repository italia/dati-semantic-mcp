import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { executeTool, executeSparqlTool } from "../executor.js";
import { sanitizeSparqlUri, sanitizeSparqlString, executeSparql, compressSparqlResult, runLocalSparql, buildLangFilter } from "../sparql.js";
import { buildConceptProfileQueries, executeNamedQueries, executeNamedQueryResults } from "../semantic-profiles.js";
import { resolveSemanticContextStore } from "../semantic-context.js";
import type { SparqlBinding, SparqlResult } from "../types.js";
import type { LabelLang } from "../sparql.js";

function cloneSparqlResult(result: SparqlResult): SparqlResult {
  return {
    head: { vars: [...(result.head?.vars ?? [])] },
    results: {
      bindings: (result.results?.bindings ?? []).map((binding) => ({ ...binding })),
    },
  };
}

function mergeBindings(target: SparqlBinding[], incoming: SparqlBinding[]): SparqlBinding[] {
  const seen = new Set(target.map((binding) => JSON.stringify(binding)));
  for (const binding of incoming) {
    const key = JSON.stringify(binding);
    if (seen.has(key)) continue;
    seen.add(key);
    target.push({ ...binding });
  }
  return target;
}

async function fetchRemoteLabels(uris: string[], lang: LabelLang): Promise<Map<string, string>> {
  const unique = [...new Set(uris.filter((uri) => /^https?:\/\//.test(uri)))];
  if (unique.length === 0) return new Map();
  const labelFilter = buildLangFilter("?label", lang);

  const labelResult = await executeSparql(`
    SELECT ?uri ?label WHERE {
      VALUES ?uri { ${unique.map((uri) => `<${uri}>`).join(" ")} }
      ?uri rdfs:label|skos:prefLabel ?label .
      ${labelFilter}
    }
  `);

  const labelMap = new Map<string, string>();
  for (const binding of labelResult.results?.bindings ?? []) {
    const uri = binding.uri?.value ?? "";
    const label = binding.label?.value ?? "";
    if (uri && label && !labelMap.has(uri)) labelMap.set(uri, label);
  }
  return labelMap;
}

function enrichConceptLabels(results: Record<string, SparqlResult>, labelMap: Map<string, string>): void {
  const assignLabel = (binding: SparqlBinding, valueKey: string, labelKey: string) => {
    const uri = binding[valueKey]?.value ?? "";
    if (!uri || binding[labelKey]?.value || !labelMap.has(uri)) return;
    binding[labelKey] = { type: "literal", value: labelMap.get(uri)! };
  };

  for (const binding of results.hierarchy?.results?.bindings ?? []) {
    assignLabel(binding, "parent", "parentLabel");
    assignLabel(binding, "child", "childLabel");
  }

  for (const binding of results.own_properties?.results?.bindings ?? []) {
    assignLabel(binding, "prop", "propLabel");
    assignLabel(binding, "range", "rangeLabel");
  }

  for (const binding of results.inherited_properties?.results?.bindings ?? []) {
    assignLabel(binding, "ancestor", "ancestorLabel");
    assignLabel(binding, "prop", "propLabel");
    assignLabel(binding, "range", "rangeLabel");
  }
}

// -----------------------------------------------------------------------------
// GROUP F: Intelligent Tools
// -----------------------------------------------------------------------------

export function registerGroupF(server: McpServer): void {

server.registerTool(
  "search_concepts",
  {
    title: "Search Concepts",
    description: `Fuzzy search for concepts/classes/properties by keyword.

**Args:**
- keyword: Search term (e.g. 'amministrazione')
- limit: Maximum results (default: 10)
- resource_type: (optional) Filter by type: "class", "property", "concept"
- ontology_filter: (optional) URI prefix to restrict the search (e.g. 'https://w3id.org/italia/onto/COV/')
- prefer_core: (optional) If true, results from core ontologies (COV, CPV, CLV, l0) are ranked first
- lang: "it" | "en" | "any" (default: "any")

**Returns:**
- Matching subjects with type and label

**When to use this vs X:**
- use this when you do not know the exact URI yet
- vs \`search_in_vocabulary\`: use this to search across the whole catalog; use \`search_in_vocabulary\` or \`browse_vocabulary\` only when the ConceptScheme is already known

**Use when:** You don't know the exact URI of a concept. Use \`resource_type\` and \`ontology_filter\` to reduce noise.`,
    inputSchema: {
      keyword: z.string().describe("The search term (e.g. 'amministrazione')"),
      limit: z.number().optional().default(10),
      resource_type: z.enum(["class", "property", "concept"]).optional().describe('Filter by resource type: "class", "property", or "concept"'),
      ontology_filter: z.string().optional().describe("Restrict results to URIs starting with this prefix (e.g. 'https://w3id.org/italia/onto/COV/')"),
      prefer_core: z.boolean().optional().default(false).describe("If true, rank results from COV, CPV, CLV, l0 ontologies first"),
      lang: z.enum(["it", "en", "any"]).optional().default("any").describe('Preferred label language; "any" keeps all languages.'),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ keyword, limit, resource_type, ontology_filter, prefer_core, lang }) => {
    const safeKeyword = sanitizeSparqlString(keyword);
    const labelFilter = buildLangFilter("?label", lang);

    const typeValues = (() => {
      switch (resource_type) {
        case "class":    return "owl:Class rdfs:Class";
        case "property": return "owl:ObjectProperty owl:DatatypeProperty owl:AnnotationProperty";
        case "concept":  return "skos:Concept skos:ConceptScheme";
        default:         return "owl:Class owl:ObjectProperty owl:DatatypeProperty skos:Concept";
      }
    })();

    const ontologyFilterClause = ontology_filter
      ? `FILTER(STRSTARTS(STR(?subject), "${sanitizeSparqlString(ontology_filter)}"))`
      : "";

    const orderClause = prefer_core
      ? `ORDER BY IF(REGEX(STR(?subject), "italia/onto/(COV|CPV|CLV|l0)/"), 0, 1) ?label`
      : "";

    const query = `
      SELECT DISTINCT ?subject ?type ?label
      WHERE {
        VALUES ?type { ${typeValues} }
        ?subject a ?type .
        ?subject rdfs:label|skos:prefLabel|dct:title ?label .
        ${labelFilter}
        FILTER(REGEX(STR(?label), "${safeKeyword}", "i"))
        ${ontologyFilterClause}
      }
      ${orderClause}
      LIMIT ${limit}
    `;
    return executeSparqlTool("search_concepts", { keyword, limit, resource_type, ontology_filter, prefer_core, lang }, query);
  }
);

server.registerTool(
  "inspect_concept",
  {
    title: "Inspect Concept",
    description: `Get a comprehensive profile of a concept from schema.gov.it, with explicit raw vs effective views.

**Args:**
- uri: URI of the concept to inspect
- mode: "raw" | "effective" (default: "effective")
- source: "schema" | "local" | "hybrid" (default: "schema")
- file_path / content / upload_id: local context when source="local" or source="hybrid"
- lang: "it" | "en" | "any" (default: "any")

**Tip:** Use \`search_concepts\` first if you do not know the URI.

**mode: "raw"** — only explicitly asserted triples:
- definition: literal annotations (label, comment, definition…)
- hierarchy: direct type, parent classes (rdfs:subClassOf / skos:broader), child classes
- usage: instance count
- own_properties: properties with rdfs:domain exactly this class

**mode: "effective"** (default) — full OWL/RDFS-implied view, adds:
- inherited_properties: properties from ancestor classes via rdfs:subClassOf+/skos:broader+, each row annotated with the ancestor that declares domain (distinguishes asserted-on-this-class from inherited)
- incoming: properties pointing to instances of this type (data-level)
- outgoing: properties used by instances of this type (data-level)

**Interpreting own vs inherited:**
- own_properties = rdfs:domain written explicitly for this class → if missing, the property may still apply via inheritance
- inherited_properties = rdfs:domain written on an ancestor → redundant to re-assert on this class unless restricting range
- A property absent from both may still apply via owl:restriction, owl:equivalentClass, or owl:unionOf/intersectionOf (not shown — use query_sparql for those cases)

**Limitations of effective mode:**
- owl:equivalentClass: not expanded (equivalent classes share all properties but this tool shows only the rdfs:subClassOf chain)
- owl:unionOf / owl:intersectionOf: not traversed (anonymous class expressions)
- owl:imports: schema.gov.it resolves these server-side; the endpoint already includes imported triples

**Hybrid mode:**
- source="hybrid" uses the local/uploaded ontology as the base graph
- for effective mode it enriches missing inherited properties and labels from schema.gov.it when ancestor URIs are known locally
- it does not create a fully unified graph and does not resolve arbitrary owl:imports chains

**When to use this vs X:**
- vs \`inspect_local_concept\`: use this for concepts already in the remote \`schema.gov.it\` catalog; use \`inspect_local_concept\` for a local/uploaded ontology
- vs \`describe_resource\`: use this for a semantic profile (hierarchy, inherited properties, usage); use \`describe_resource\` for the raw RDF dump of a resource
- vs \`query_sparql\`: use this when you want the standard profile of one concept; use \`query_sparql\` only for custom questions not covered here

All queries run in parallel for performance.`,
    inputSchema: {
      uri: z.string().describe("The URI of the concept to inspect"),
      mode: z.enum(["raw", "effective"]).optional().default("effective").describe(
        '"raw": only asserted triples (own_properties, no ancestor traversal). ' +
        '"effective" (default): adds inherited_properties via rdfs:subClassOf+/skos:broader+ and data-level incoming/outgoing.'
      ),
      source: z.enum(["schema", "local", "hybrid"]).optional().default("schema").describe('Execution context: "schema" for schema.gov.it, "local" for a local/uploaded ontology, "hybrid" for local base + schema.gov.it enrichment.'),
      file_path: z.string().optional().describe("Absolute path to a local ontology file when source='local' or 'hybrid'"),
      content: z.string().optional().describe("Inline RDF content when source='local' or 'hybrid'"),
      format: z.string().optional().describe("RDF content type for inline content"),
      upload_id: z.string().optional().describe("Uploaded ontology store ID when source='local' or 'hybrid'"),
      lang: z.enum(["it", "en", "any"]).optional().default("any").describe('Preferred label language; "any" keeps all languages.'),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ uri, mode, source, file_path, content, format, upload_id, lang }) => {
    const safeUri = sanitizeSparqlUri(uri);
    const queries = buildConceptProfileQueries(safeUri, mode, lang);

    if (source === "schema") {
      return executeTool("inspect_concept", { uri, mode, source, lang }, async () => {
        const { results, totalRows } = await executeNamedQueries(
          queries,
          async (query) => executeSparql(query)
        );

        return {
          success: true,
          data: {
            source,
            mode,
            ...results,
          },
          rowCount: totalRows,
        };
      });
    }

    return executeTool("inspect_concept", { uri, mode, source, file_path, upload_id, format, lang }, async () => {
      const context = await resolveSemanticContextStore({ source, file_path, content, format, upload_id });
      const { results: rawResults, totalRows } = await executeNamedQueryResults(
        queries,
        async (query) => runLocalSparql(context.store, query, true)
      );
      const combinedResults = Object.fromEntries(
        Object.entries(rawResults).map(([name, result]) => [name, cloneSparqlResult(result)])
      ) as Record<string, SparqlResult>;

      const notes: string[] = [];

      if (source === "hybrid") {
        const ancestorUris = [
          ...(combinedResults.hierarchy?.results?.bindings ?? []).map((binding) => binding.parent?.value ?? ""),
          ...(combinedResults.inherited_properties?.results?.bindings ?? []).map((binding) => binding.ancestor?.value ?? ""),
        ].filter(Boolean);

        if (mode === "effective" && ancestorUris.length > 0) {
          const remoteInherited = await executeSparql(`
            SELECT DISTINCT ?ancestor ?ancestorLabel ?prop ?propType ?propLabel ?range ?rangeLabel WHERE {
              VALUES ?ancestor { ${[...new Set(ancestorUris)].map((value) => `<${value}>`).join(" ")} }
              ?prop rdfs:domain ?ancestor .
              OPTIONAL { ?prop a ?propType . VALUES ?propType { owl:ObjectProperty owl:DatatypeProperty owl:AnnotationProperty } }
              OPTIONAL { ?prop rdfs:label ?propLabel . FILTER(LANG(?propLabel) = "it" || LANG(?propLabel) = "" || LANG(?propLabel) = "en") }
              OPTIONAL { ?prop rdfs:range ?range }
              OPTIONAL { ?range rdfs:label|skos:prefLabel ?rangeLabel . FILTER(LANG(?rangeLabel) = "it" || LANG(?rangeLabel) = "" || LANG(?rangeLabel) = "en") }
              OPTIONAL { ?ancestor rdfs:label|skos:prefLabel ?ancestorLabel . FILTER(LANG(?ancestorLabel) = "it" || LANG(?ancestorLabel) = "" || LANG(?ancestorLabel) = "en") }
            }
            ORDER BY ?ancestor ?prop
            LIMIT 200
          `);

          if (!combinedResults.inherited_properties) {
            combinedResults.inherited_properties = { head: remoteInherited.head, results: { bindings: [] } };
          }
          mergeBindings(combinedResults.inherited_properties.results.bindings, remoteInherited.results.bindings);
          if ((remoteInherited.results?.bindings?.length ?? 0) > 0) {
            notes.push("Hybrid mode enriched inherited_properties with schema.gov.it data for ancestor classes known in the local store.");
          }
        }

        const iriPool = new Set<string>();
        for (const result of Object.values(combinedResults)) {
          for (const binding of result.results?.bindings ?? []) {
            for (const value of Object.values(binding)) {
              if (value?.type === "uri" && value.value) iriPool.add(value.value);
            }
          }
        }
        const labelMap = await fetchRemoteLabels([...iriPool], lang);
        enrichConceptLabels(combinedResults, labelMap);
        if (labelMap.size > 0) {
          notes.push("Hybrid mode filled missing labels from schema.gov.it where possible.");
        }
      }

      const results = Object.fromEntries(
        Object.entries(combinedResults).map(([name, result]) => [name, compressSparqlResult(result)])
      );

      return {
        success: true,
        data: {
          source,
          context: context.source,
          mode,
          ...(notes.length > 0 ? { notes } : {}),
          ...results,
        },
        rowCount: totalRows,
      };
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
- max_hops: 1 | 2 | 3 (default: 1)

**Returns:**
- Direct connections (single predicate)
- Multi-hop paths up to the configured depth`,
    inputSchema: {
      sourceUri: z.string().describe("URI of the source concept"),
      targetUri: z.string().describe("URI of the target concept"),
      max_hops: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().default(1).describe("Maximum number of intermediate nodes to traverse. 1 preserves the previous behaviour."),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ sourceUri, targetUri, max_hops }) => {
    const safeSource = sanitizeSparqlUri(sourceUri);
    const safeTarget = sanitizeSparqlUri(targetUri);
    const hopLimit = max_hops;
    const branches = [
      `
        {
          <${safeSource}> ?p1 <${safeTarget}> .
          BIND(0 AS ?hopCount)
        }
      `,
      `
        {
          <${safeSource}> ?p1 ?mid1 .
          ?mid1 ?p2 <${safeTarget}> .
          BIND(1 AS ?hopCount)
        }
      `,
    ];

    if (hopLimit >= 2) {
      branches.push(`
        {
          <${safeSource}> ?p1 ?mid1 .
          ?mid1 ?p2 ?mid2 .
          ?mid2 ?p3 <${safeTarget}> .
          FILTER(?mid2 != <${safeSource}> && ?mid2 != ?mid1)
          BIND(2 AS ?hopCount)
        }
      `);
    }

    if (hopLimit >= 3) {
      branches.push(`
        {
          <${safeSource}> ?p1 ?mid1 .
          ?mid1 ?p2 ?mid2 .
          ?mid2 ?p3 ?mid3 .
          ?mid3 ?p4 <${safeTarget}> .
          FILTER(?mid2 != <${safeSource}> && ?mid2 != ?mid1 && ?mid3 != <${safeSource}> && ?mid3 != ?mid1 && ?mid3 != ?mid2)
          BIND(3 AS ?hopCount)
        }
      `);
    }

    const query = `
      SELECT ?hopCount ?p1 ?mid1 ?p2 ?mid2 ?p3 ?mid3 ?p4
      WHERE {
        ${branches.join("\nUNION\n")}
      }
      ORDER BY ?hopCount ?p1 ?p2 ?p3 ?p4
      LIMIT 21
    `;

    return executeTool("find_relations", { sourceUri, targetUri, max_hops: hopLimit }, async () => {
      const result = await executeSparql(query);
      const bindings = result.results?.bindings ?? [];
      const truncated = bindings.length > 20;
      const sliced = truncated ? bindings.slice(0, 20) : bindings;

      return {
        success: true,
        data: {
          max_hops: hopLimit,
          paths_truncated: truncated,
          paths: compressSparqlResult({
            head: result.head,
            results: { bindings: sliced },
          }),
        },
        rowCount: sliced.length,
        sourceData: result,
      };
    });
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
- properties_missing_domain_or_range: Properties with incomplete domain/range declarations
- large_classes_without_scheme: Classes with >1000 instances and no evidence of skos:ConceptScheme membership

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

    const incompletePropertiesQuery = `
      SELECT ?prop ?type ?domain ?range
      WHERE {
        VALUES ?type { owl:ObjectProperty owl:DatatypeProperty }
        ?prop a ?type .
        OPTIONAL { ?prop rdfs:domain ?domain }
        OPTIONAL { ?prop rdfs:range ?range }
        FILTER(!BOUND(?domain) || !BOUND(?range))
      }
      ORDER BY ?prop
      LIMIT ${limit}
    `;

    const largeClassesWithoutSchemeQuery = `
      SELECT ?class ?instances
      WHERE {
        {
          SELECT ?class (COUNT(DISTINCT ?instance) AS ?instances)
          WHERE {
            ?instance a ?class .
          }
          GROUP BY ?class
          HAVING(COUNT(DISTINCT ?instance) > 1000)
        }
        FILTER NOT EXISTS {
          ?member a ?class ;
                  skos:inScheme ?scheme .
          ?scheme a skos:ConceptScheme .
        }
      }
      ORDER BY DESC(?instances)
      LIMIT ${limit}
    `;

    return executeTool("suggest_improvements", { limit }, async () => {
      const [lonely, cycles, incompleteProperties, largeClassesWithoutScheme] = await Promise.all([
        executeSparql(lonelyQuery),
        executeSparql(cycleQuery),
        executeSparql(incompletePropertiesQuery),
        executeSparql(largeClassesWithoutSchemeQuery),
      ]);

      return {
        success: true,
        data: {
          possible_cycles: compressSparqlResult(cycles),
          unused_classes: compressSparqlResult(lonely),
          properties_missing_domain_or_range: compressSparqlResult(incompleteProperties),
          large_classes_without_scheme: compressSparqlResult(largeClassesWithoutScheme),
        },
        rowCount: (lonely.results?.bindings?.length ?? 0) +
          (cycles.results?.bindings?.length ?? 0) +
          (incompleteProperties.results?.bindings?.length ?? 0) +
          (largeClassesWithoutScheme.results?.bindings?.length ?? 0),
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

**When to use this vs X:**
- vs \`inspect_concept\`: use this when you need the raw RDF description of a resource; use \`inspect_concept\` when you want a semantic profile with hierarchy, usage, and inherited properties
- vs \`query_sparql\`: use this for the standard CBD dump of one resource; use \`query_sparql\` only for custom graph patterns not covered here

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

}
