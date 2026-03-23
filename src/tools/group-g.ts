import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { executeTool, executeSparqlTool } from "../executor.js";
import { sanitizeSparqlUri, sanitizeSparqlString, executeSparql, compressSparqlResult } from "../sparql.js";
import {
  buildPropertyDefinitionQuery,
  buildPropertySuperQuery,
  extractAssertedDomainRange,
  collectPropertySuperMap,
  buildPropertyInheritance,
  buildRedundancyAnalysis,
} from "../semantic-profiles.js";

// -----------------------------------------------------------------------------
// GROUP G: Properties & Instances
// -----------------------------------------------------------------------------

export function registerGroupG(server: McpServer): void {

server.registerTool(
  "list_properties",
  {
    title: "List Properties",
    description: `List ObjectProperty and DatatypeProperty defined in an ontology or globally.

**Args:**
- ontologyUri: (optional) URI of the ontology to filter by
- propertyType: (optional) "object", "datatype", or "both" (default: "both")
- limit: Maximum results (default: 50)

**Returns:**
- List of properties with domain, range, and label

**Examples:**
- No args: All properties (top 50)
- ontologyUri="https://w3id.org/italia/onto/CPV": Properties from CPV ontology`,
    inputSchema: {
      ontologyUri: z.string().optional().describe("URI of ontology to filter by"),
      propertyType: z.enum(["object", "datatype", "both"]).optional().default("both"),
      limit: z.number().optional().default(50),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ ontologyUri, propertyType, limit }) => {
    const typeFilter = propertyType === "object"
      ? "VALUES ?type { owl:ObjectProperty }"
      : propertyType === "datatype"
      ? "VALUES ?type { owl:DatatypeProperty }"
      : "VALUES ?type { owl:ObjectProperty owl:DatatypeProperty }";

    const uriFilter = ontologyUri
      ? `FILTER(STRSTARTS(STR(?prop), "${sanitizeSparqlUri(ontologyUri)}"))`
      : "";

    const query = `
      SELECT DISTINCT ?prop ?type ?label ?domain ?range
      WHERE {
        ${typeFilter}
        ?prop a ?type .
        OPTIONAL { ?prop rdfs:label ?label . FILTER(LANG(?label) = "it" || LANG(?label) = "") }
        OPTIONAL { ?prop rdfs:domain ?domain }
        OPTIONAL { ?prop rdfs:range ?range }
        ${uriFilter}
      }
      ORDER BY ?prop
      LIMIT ${limit}
    `;
    return executeSparqlTool("list_properties", { ontologyUri, propertyType, limit }, query);
  }
);

server.registerTool(
  "get_property_details",
  {
    title: "Get Property Details",
    description: `Get comprehensive details of a specific property from schema.gov.it, with explicit raw vs effective views.

**Args:**
- propertyUri: URI of the property
- mode: "raw" | "effective" (default: "effective")

**Tip:** Use \`search_concepts\` first if you do not know the URI.

**mode: "raw"** — only explicitly asserted triples:
- definition: type, label, comment, rdfs:domain, rdfs:range, rdfs:subPropertyOf, owl:inverseOf, functional flags

**mode: "effective"** (default) — full inherited view, adds:
- assertedDomain: rdfs:domain declared directly on this property
- assertedRange: rdfs:range declared directly on this property
- superproperties: ancestor chain via rdfs:subPropertyOf+, each with hasDomainLocally / hasRangeLocally flags
- inheritedDomain: domain values from super-properties, each annotated with ancestor URI and label
- inheritedRange: range values from super-properties, each annotated with ancestor URI and label
- effectiveDomain: deduplicated union of assertedDomain + inheritedDomain
- effectiveRange: deduplicated union of assertedRange + inheritedRange
- redundancy_analysis: diagnostic view of each asserted value:
  - "redundant": identical to an inherited value — the axiom can be dropped without semantic loss
  - "specialization": a rdfs:subClassOf of an inherited value — genuinely narrows the domain/range
  - "new": not present in any inherited value — adds information not implied by the super-property chain
  - summary counts per category for quick overview

**Interpreting the output:**
- If assertedDomain is empty but effectiveDomain is not → domain is inherited; no need to re-assert it on this property
- If assertedDomain equals effectiveDomain → the domain is fully explicit, not relying on inheritance
- Use redundancy_analysis.summary to immediately see if the local TTL has redundant axioms or genuine specializations
- owl:equivalentProperty and owl:equivalentClass expansions are not included (use query_sparql for those)

**When to use this vs X:**
- vs \`inspect_local_property\`: use this for a property already published in \`schema.gov.it\`; use \`inspect_local_property\` for a local/uploaded ontology
- vs \`query_sparql\`: use this for the standard semantic profile of one property; use \`query_sparql\` only for custom questions not covered here`,
    inputSchema: {
      propertyUri: z.string().describe("URI of the property to inspect"),
      mode: z.enum(["raw", "effective"]).optional().default("effective").describe(
        '"raw": only asserted triples. ' +
        '"effective" (default): adds assertedDomain/Range, super-property chain, inheritedDomain/Range, effectiveDomain/Range.'
      ),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ propertyUri, mode }) => {
    const safeUri = sanitizeSparqlUri(propertyUri);
    const definitionQuery = buildPropertyDefinitionQuery(safeUri);

    return executeTool<unknown>("get_property_details", { propertyUri, mode }, async () => {
      const defResult = await executeSparql(definitionQuery);

      if (mode === "raw") {
        return {
          success: true,
          data: { mode, definition: compressSparqlResult(defResult) },
          rowCount: defResult.results?.bindings?.length ?? 0,
        };
      }

      const superQuery = buildPropertySuperQuery(safeUri, 50);
      const superResult = await executeSparql(superQuery);
      const { assertedDomain, assertedRange } = extractAssertedDomainRange(defResult);
      const superMap = collectPropertySuperMap(superResult);
      const { inheritedDomain, inheritedRange, superproperties } = buildPropertyInheritance(superMap);
      const effectiveDomain = [...new Set([...assertedDomain, ...inheritedDomain.map((x) => x.domain)])];
      const effectiveRange = [...new Set([...assertedRange, ...inheritedRange.map((x) => x.range)])];
      const redundancy_analysis = await buildRedundancyAnalysis(
        assertedDomain,
        assertedRange,
        inheritedDomain,
        inheritedRange,
        async (candidates, inherited) => {
          if (candidates.length === 0 || inherited.length === 0) {
            return new Map<string, string[]>();
          }

          const subclassResult = await executeSparql(`
            SELECT ?sub ?sup WHERE {
              VALUES ?sub { ${candidates.map((uri) => `<${uri}>`).join(" ")} }
              VALUES ?sup { ${inherited.map((uri) => `<${uri}>`).join(" ")} }
              ?sub rdfs:subClassOf+ ?sup .
            }
          `);

          const subclassMap = new Map<string, string[]>();
          for (const binding of subclassResult.results?.bindings ?? []) {
            const sub = binding.sub?.value ?? "";
            const sup = binding.sup?.value ?? "";
            if (!sub || !sup) continue;
            if (!subclassMap.has(sub)) subclassMap.set(sub, []);
            subclassMap.get(sub)!.push(sup);
          }
          return subclassMap;
        }
      );

      const totalRows =
        (defResult.results?.bindings?.length ?? 0) +
        (superResult.results?.bindings?.length ?? 0);

      return {
        success: true,
        data: {
          mode,
          definition: compressSparqlResult(defResult),
          assertedDomain,
          assertedRange,
          superproperties,
          inheritedDomain,
          inheritedRange,
          effectiveDomain,
          effectiveRange,
          redundancy_analysis,
        },
        rowCount: totalRows,
      };
    });
  }
);

server.registerTool(
  "list_instances_of_class",
  {
    title: "List Instances of Class",
    description: `List instances of a given class in the catalog.

**Args:**
- class_uri: URI of the class (e.g. 'https://w3id.org/italia/onto/COV/PublicOrganization')
- limit: Items per page (default: 20, max: 200)
- offset: Items to skip (default: 0)

**Returns:**
- instances: list of URIs with labels
- pagination: total count, offset, has_more

**Use when:** You found a class and want to know if it has real instances (i.e., whether it is used in the catalog, not just defined theoretically).`,
    inputSchema: {
      class_uri: z.string().describe("URI of the class to list instances of"),
      limit: z.number().optional().default(20).describe("Items per page (max 200)"),
      offset: z.number().optional().default(0).describe("Items to skip"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ class_uri, limit, offset }) => {
    const safeUri = sanitizeSparqlUri(class_uri);
    const safeLimit = Math.min(limit, 200);

    const dataQuery = `
      SELECT DISTINCT ?instance ?label
      WHERE {
        ?instance a <${safeUri}> .
        OPTIONAL {
          ?instance rdfs:label|l0:name|skos:prefLabel ?label .
          FILTER(LANG(?label) = "" || LANG(?label) = "it" || LANG(?label) = "en")
        }
      }
      ORDER BY ?label ?instance
      LIMIT ${safeLimit}
      OFFSET ${offset}
    `;
    const countQuery = `
      SELECT (COUNT(DISTINCT ?instance) AS ?total)
      WHERE { ?instance a <${safeUri}> }
    `;

    return executeTool("list_instances_of_class", { class_uri, limit: safeLimit, offset }, async () => {
      const [dataResult, countResult] = await Promise.all([
        executeSparql(dataQuery),
        executeSparql(countQuery),
      ]);

      const instances = compressSparqlResult(dataResult);
      const count = dataResult.results?.bindings?.length ?? 0;
      const total = parseInt(countResult.results?.bindings?.[0]?.total?.value ?? "0", 10);

      return {
        success: true,
        data: {
          instances,
          pagination: {
            total,
            count,
            offset,
            has_more: offset + safeLimit < total,
            next_offset: offset + safeLimit < total ? offset + safeLimit : null,
          },
        },
        rowCount: count,
      };
    });
  }
);

server.registerTool(
  "find_recommended_scheme_for_property",
  {
    title: "Find Recommended Scheme for Property",
    description: `Given a property URI, find its range class and any associated SKOS ConceptSchemes in the catalog.

**Args:**
- property_uri: URI of the property (e.g. 'https://w3id.org/italia/onto/COV/hasCategory')

**Returns:**
- range: the rdfs:range of the property (if declared)
- instance_count: number of instances of the range type in the catalog
- schemes: SKOS ConceptSchemes whose members are typed as the range class
- suggestion: actionable advice (use existing scheme, or create a local one)

**Use when:** You want to know what controlled vocabulary values to use for a property, or whether an official ConceptScheme exists.`,
    inputSchema: {
      property_uri: z.string().describe("URI of the property to analyze"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ property_uri }) => {
    const safePropUri = sanitizeSparqlUri(property_uri);

    return executeTool<unknown>("find_recommended_scheme_for_property", { property_uri }, async () => {
      // Step 1: Get the range of the property
      const rangeQuery = `
        SELECT ?range ?rangeLabel WHERE {
          <${safePropUri}> rdfs:range ?range .
          OPTIONAL { ?range rdfs:label|skos:prefLabel ?rangeLabel . FILTER(LANG(?rangeLabel) = "" || LANG(?rangeLabel) = "it") }
        }
        LIMIT 5
      `;
      const rangeResult = await executeSparql(rangeQuery);
      const rangeBindings = rangeResult.results?.bindings ?? [];

      if (rangeBindings.length === 0) {
        return {
          success: true,
          data: {
            property: safePropUri,
            range: null,
            instance_count: 0,
            schemes: [],
            suggestion: "No rdfs:range declared for this property. Inspect it with get_property_details for more context.",
          },
        };
      }

      const rangeUri = rangeBindings[0]?.range?.value ?? "";
      const rangeLabel = rangeBindings[0]?.rangeLabel?.value ?? "";
      let safeRangeUri: string;
      try {
        safeRangeUri = sanitizeSparqlUri(rangeUri);
      } catch {
        return {
          success: true,
          data: {
            property: safePropUri,
            range: { uri: rangeUri, label: rangeLabel },
            instance_count: 0,
            schemes: [],
            suggestion: `Range is a blank node or non-HTTP URI (${rangeUri}). Cannot look up ConceptSchemes automatically.`,
          },
        };
      }

      // Step 2 (parallel): count instances and find ConceptSchemes
      const countQuery = `
        SELECT (COUNT(DISTINCT ?instance) AS ?total)
        WHERE { ?instance a <${safeRangeUri}> }
      `;
      const schemesQuery = `
        SELECT DISTINCT ?scheme ?schemeLabel WHERE {
          ?concept a <${safeRangeUri}> ; skos:inScheme ?scheme .
          OPTIONAL { ?scheme rdfs:label|dct:title|skos:prefLabel ?schemeLabel . FILTER(LANG(?schemeLabel) = "" || LANG(?schemeLabel) = "it") }
        }
        LIMIT 10
      `;

      const [countResult, schemesResult] = await Promise.all([
        executeSparql(countQuery),
        executeSparql(schemesQuery),
      ]);

      const instanceCount = parseInt(countResult.results?.bindings?.[0]?.total?.value ?? "0", 10);
      const schemes = (schemesResult.results?.bindings ?? []).map(b => ({
        uri: b.scheme?.value ?? "",
        label: b.schemeLabel?.value ?? "",
      }));

      let suggestion: string;
      if (schemes.length > 0) {
        suggestion = `${schemes.length} ConceptScheme(s) found for range <${safeRangeUri}>. Use browse_vocabulary or search_in_vocabulary to explore them.`;
      } else if (instanceCount > 0) {
        suggestion = `${instanceCount} instance(s) of range <${safeRangeUri}> exist in the catalog but none belong to a formal ConceptScheme. You can use list_instances_of_class to inspect them directly.`;
      } else {
        suggestion = `No instances or ConceptSchemes found for range <${safeRangeUri}>. Consider defining a local SKOS ConceptScheme for this property.`;
      }

      return {
        success: true,
        data: {
          property: safePropUri,
          range: { uri: safeRangeUri, label: rangeLabel },
          instance_count: instanceCount,
          schemes,
          suggestion,
        },
      };
    });
  }
);

}
