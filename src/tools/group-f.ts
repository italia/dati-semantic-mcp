import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { executeTool, executeSparqlTool } from "../executor.js";
import { sanitizeSparqlUri, sanitizeSparqlString, executeSparql, compressSparqlResult } from "../sparql.js";
import type { CompressedResult } from "../types.js";

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

**Use when:** You don't know the exact URI of a concept. Use resource_type and ontology_filter to reduce noise.`,
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
    description: `Get a comprehensive profile of a concept, including full inherited property chain.

**Args:**
- uri: URI of the concept to inspect

**Returns:**
- definition: Literal properties of the concept
- hierarchy: Type, direct parents (superclasses/broader), and children (subclasses/narrower)
- usage: Instance count
- own_properties: Properties whose rdfs:domain is exactly this class (schema-level, declared directly on this class)
- inherited_properties: Properties inherited from ancestor classes via rdfs:subClassOf+/skos:broader+, each annotated with the ancestor it comes from
- incoming: Properties pointing to instances of this type (data-level)
- outgoing: Properties used by instances of this type (data-level)

**Note:** own_properties + inherited_properties give the full effective property set of the class.
All queries run in parallel for performance.`,
    inputSchema: {
      uri: z.string().describe("The URI of the concept to inspect"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ uri }) => {
    const safeUri = sanitizeSparqlUri(uri);
    const queries: Record<string, string> = {
      definition: `
        SELECT ?p ?o WHERE { <${safeUri}> ?p ?o . FILTER(ISLITERAL(?o)) }
      `,
      hierarchy: `
        SELECT ?type ?parent ?parentLabel ?child ?childLabel WHERE {
          { <${safeUri}> a ?type }
          UNION
          { <${safeUri}> rdfs:subClassOf|skos:broader ?parent .
            OPTIONAL { ?parent rdfs:label|skos:prefLabel ?parentLabel . FILTER(LANG(?parentLabel) = "it" || LANG(?parentLabel) = "") }
          }
          UNION
          { ?child rdfs:subClassOf|skos:broader <${safeUri}> .
            OPTIONAL { ?child rdfs:label|skos:prefLabel ?childLabel . FILTER(LANG(?childLabel) = "it" || LANG(?childLabel) = "") }
          }
        } LIMIT 50
      `,
      usage: `
        SELECT (COUNT(?s) as ?instanceCount) WHERE { ?s a <${safeUri}> }
      `,
      own_properties: `
        SELECT DISTINCT ?prop ?propType ?propLabel ?range ?rangeLabel WHERE {
          ?prop rdfs:domain <${safeUri}> .
          OPTIONAL { ?prop a ?propType . VALUES ?propType { owl:ObjectProperty owl:DatatypeProperty owl:AnnotationProperty } }
          OPTIONAL { ?prop rdfs:label ?propLabel . FILTER(LANG(?propLabel) = "it" || LANG(?propLabel) = "") }
          OPTIONAL { ?prop rdfs:range ?range }
          OPTIONAL { ?range rdfs:label|skos:prefLabel ?rangeLabel . FILTER(LANG(?rangeLabel) = "it" || LANG(?rangeLabel) = "") }
        }
        ORDER BY ?prop
        LIMIT 50
      `,
      inherited_properties: `
        SELECT DISTINCT ?ancestor ?ancestorLabel ?prop ?propType ?propLabel ?range ?rangeLabel WHERE {
          <${safeUri}> rdfs:subClassOf+|skos:broader+ ?ancestor .
          FILTER(isIRI(?ancestor))
          ?prop rdfs:domain ?ancestor .
          OPTIONAL { ?prop a ?propType . VALUES ?propType { owl:ObjectProperty owl:DatatypeProperty owl:AnnotationProperty } }
          OPTIONAL { ?prop rdfs:label ?propLabel . FILTER(LANG(?propLabel) = "it" || LANG(?propLabel) = "") }
          OPTIONAL { ?prop rdfs:range ?range }
          OPTIONAL { ?range rdfs:label|skos:prefLabel ?rangeLabel . FILTER(LANG(?rangeLabel) = "it" || LANG(?rangeLabel) = "") }
          OPTIONAL { ?ancestor rdfs:label|skos:prefLabel ?ancestorLabel . FILTER(LANG(?ancestorLabel) = "it" || LANG(?ancestorLabel) = "") }
        }
        ORDER BY ?ancestor ?prop
        LIMIT 100
      `,
      incoming: `
        SELECT DISTINCT ?p ?sType WHERE {
          ?s ?p ?o .
          ?o a <${safeUri}> .
          OPTIONAL { ?s a ?sType }
        } LIMIT 20
      `,
      outgoing: `
        SELECT DISTINCT ?p ?oType WHERE {
          ?s a <${safeUri}> .
          ?s ?p ?o .
          OPTIONAL { ?o a ?oType }
        } LIMIT 20
      `,
    };

    return executeTool("inspect_concept", { uri }, async () => {
      const entries = Object.entries(queries);
      const sparqlResults = await Promise.all(
        entries.map(([, q]) => executeSparql(q))
      );

      const results: Record<string, CompressedResult> = {};
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const sparqlResult = sparqlResults[i];
        if (entry && sparqlResult) {
          results[entry[0]] = compressSparqlResult(sparqlResult);
        }
      }

      const totalRows = sparqlResults.reduce(
        (sum, r) => sum + (r?.results?.bindings?.length ?? 0),
        0
      );

      return { success: true, data: results, rowCount: totalRows };
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
