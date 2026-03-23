import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { executeTool, executeSparqlTool } from "../executor.js";
import { sanitizeSparqlUri, sanitizeSparqlString, executeSparql, compressSparqlResult } from "../sparql.js";
import { buildConceptProfileQueries, executeNamedQueries } from "../semantic-profiles.js";

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
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ keyword, limit, resource_type, ontology_filter, prefer_core }) => {
    const safeKeyword = sanitizeSparqlString(keyword);

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
        FILTER(REGEX(STR(?label), "${safeKeyword}", "i"))
        ${ontologyFilterClause}
      }
      ${orderClause}
      LIMIT ${limit}
    `;
    return executeSparqlTool("search_concepts", { keyword, limit, resource_type, ontology_filter, prefer_core }, query);
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
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ uri, mode }) => {
    const safeUri = sanitizeSparqlUri(uri);
    const queries = buildConceptProfileQueries(safeUri, mode);

    return executeTool("inspect_concept", { uri, mode }, async () => {
      const { results, totalRows } = await executeNamedQueries(
        queries,
        async (query) => executeSparql(query)
      );

      return {
        success: true,
        data: {
          mode,
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

**Returns:**
- Direct connections (single predicate)
- 1-hop paths (source -> intermediate -> target)`,
    inputSchema: {
      sourceUri: z.string().describe("URI of the source concept"),
      targetUri: z.string().describe("URI of the target concept"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ sourceUri, targetUri }) => {
    const safeSource = sanitizeSparqlUri(sourceUri);
    const safeTarget = sanitizeSparqlUri(targetUri);
    const query = `
      SELECT ?p1 ?mid ?p2
      WHERE {
        {
          <${safeSource}> ?p1 <${safeTarget}> .
          BIND("DIRECT" AS ?mid)
          BIND("NONE" AS ?p2)
        }
        UNION
        {
          <${safeSource}> ?p1 ?mid .
          ?mid ?p2 <${safeTarget}> .
        }
      }
      LIMIT 10
    `;
    return executeSparqlTool("find_relations", { sourceUri, targetUri }, query);
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

    return executeTool("suggest_improvements", { limit }, async () => {
      const [lonely, cycles] = await Promise.all([
        executeSparql(lonelyQuery),
        executeSparql(cycleQuery),
      ]);

      return {
        success: true,
        data: {
          possible_cycles: compressSparqlResult(cycles),
          unused_classes: compressSparqlResult(lonely),
        },
        rowCount: (lonely.results?.bindings?.length ?? 0) +
          (cycles.results?.bindings?.length ?? 0),
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
