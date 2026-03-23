import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { executeTool, executeSparqlTool } from "../executor.js";
import { sanitizeSparqlUri, sanitizeSparqlString, executeSparql, compressSparqlResult } from "../sparql.js";

// -----------------------------------------------------------------------------
// GROUP G: Property Tools (based on usage patterns)
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

    const definitionQuery = `
      SELECT ?p ?o
      WHERE {
        <${safeUri}> ?p ?o .
        FILTER(?p IN (
          rdf:type,
          rdfs:label,
          rdfs:comment,
          rdfs:domain,
          rdfs:range,
          rdfs:subPropertyOf,
          owl:inverseOf,
          owl:equivalentProperty
        ) || ?p = rdf:type && ?o IN (owl:FunctionalProperty, owl:InverseFunctionalProperty, owl:SymmetricProperty, owl:TransitiveProperty))
      }
    `;

    return executeTool<unknown>("get_property_details", { propertyUri, mode }, async () => {
      const defResult = await executeSparql(definitionQuery);

      if (mode === "raw") {
        return {
          success: true,
          data: { mode, definition: compressSparqlResult(defResult) },
          rowCount: defResult.results?.bindings?.length ?? 0,
        };
      }

      // effective mode: also query super-property chain with domain/range per ancestor
      const superQuery = `
        SELECT DISTINCT ?ancestor ?ancestorLabel ?domain ?range WHERE {
          <${safeUri}> rdfs:subPropertyOf+ ?ancestor .
          FILTER(isIRI(?ancestor))
          OPTIONAL { ?ancestor rdfs:label ?ancestorLabel . FILTER(LANG(?ancestorLabel) = "" || LANG(?ancestorLabel) = "it") }
          OPTIONAL { ?ancestor rdfs:domain ?domain }
          OPTIONAL { ?ancestor rdfs:range ?range }
        }
        ORDER BY ?ancestor
        LIMIT 50
      `;
      const superResult = await executeSparql(superQuery);

      // Extract asserted domain / range from definition
      const RDFS_DOMAIN = "http://www.w3.org/2000/01/rdf-schema#domain";
      const RDFS_RANGE  = "http://www.w3.org/2000/01/rdf-schema#range";
      const assertedDomain: string[] = [];
      const assertedRange:  string[] = [];
      for (const b of defResult.results?.bindings ?? []) {
        if (b.p?.value === RDFS_DOMAIN && b.o?.value) assertedDomain.push(b.o.value);
        if (b.p?.value === RDFS_RANGE  && b.o?.value) assertedRange.push(b.o.value);
      }

      // Build super-property map
      type SuperInfo = { uri: string; label: string; domains: string[]; ranges: string[] };
      const superMap = new Map<string, SuperInfo>();
      for (const b of superResult.results?.bindings ?? []) {
        const aUri = b.ancestor?.value ?? "";
        if (!aUri) continue;
        if (!superMap.has(aUri)) superMap.set(aUri, { uri: aUri, label: "", domains: [], ranges: [] });
        const info = superMap.get(aUri)!;
        if (b.ancestorLabel?.value && !info.label) info.label = b.ancestorLabel.value;
        if (b.domain?.value && !info.domains.includes(b.domain.value)) info.domains.push(b.domain.value);
        if (b.range?.value  && !info.ranges.includes(b.range.value))   info.ranges.push(b.range.value);
      }

      // Build inherited lists (annotated with ancestor)
      const inheritedDomain: Array<{ ancestor: string; ancestorLabel: string; domain: string }> = [];
      const inheritedRange:  Array<{ ancestor: string; ancestorLabel: string; range:  string }> = [];
      for (const info of superMap.values()) {
        for (const d of info.domains) inheritedDomain.push({ ancestor: info.uri, ancestorLabel: info.label, domain: d });
        for (const r of info.ranges)  inheritedRange.push({ ancestor: info.uri,  ancestorLabel: info.label, range:  r });
      }

      // Effective = deduplicated union
      const effectiveDomain = [...new Set([...assertedDomain, ...inheritedDomain.map(x => x.domain)])];
      const effectiveRange  = [...new Set([...assertedRange,  ...inheritedRange.map(x => x.range)])];

      const superproperties = [...superMap.values()].map(info => ({
        uri: info.uri,
        label: info.label,
        hasDomainLocally: info.domains.length > 0,
        hasRangeLocally:  info.ranges.length  > 0,
      }));

      // Redundancy analysis
      type AnalysisEntry = {
        value: string;
        status: "redundant" | "specialization" | "new";
        inherited_match?: string;
        specializes?: string[];
      };

      const inheritedDomainValues = new Set(inheritedDomain.map(x => x.domain));
      const inheritedRangeValues  = new Set(inheritedRange.map(x => x.range));

      const classifyInitial = (asserted: string[], inheritedValues: Set<string>): AnalysisEntry[] =>
        asserted.map(v => inheritedValues.has(v)
          ? { value: v, status: "redundant" as const, inherited_match: v }
          : { value: v, status: "new" as const }
        );

      let domainAnalysis = classifyInitial(assertedDomain, inheritedDomainValues);
      let rangeAnalysis  = classifyInitial(assertedRange,  inheritedRangeValues);

      // Subclass check for "new" candidates → may be specializations
      const domainCandidates = domainAnalysis.filter(e => e.status === "new").map(e => e.value);
      const rangeCandidates  = rangeAnalysis.filter(e => e.status === "new").map(e => e.value);
      const allCandidates    = [...new Set([...domainCandidates, ...rangeCandidates])];
      const allInherited     = [...new Set([...inheritedDomainValues, ...inheritedRangeValues])];

      if (allCandidates.length > 0 && allInherited.length > 0) {
        const vSub = allCandidates.map(u => `<${u}>`).join(" ");
        const vSup = allInherited.map(u => `<${u}>`).join(" ");
        const subResult = await executeSparql(`
          SELECT ?sub ?sup WHERE {
            VALUES ?sub { ${vSub} }
            VALUES ?sup { ${vSup} }
            ?sub rdfs:subClassOf+ ?sup .
          }
        `);
        const subMap = new Map<string, string[]>();
        for (const b of subResult.results?.bindings ?? []) {
          const sub = b.sub?.value ?? "", sup = b.sup?.value ?? "";
          if (!sub || !sup) continue;
          if (!subMap.has(sub)) subMap.set(sub, []);
          subMap.get(sub)!.push(sup);
        }
        const upgrade = (entries: AnalysisEntry[], inheritedValues: Set<string>): AnalysisEntry[] =>
          entries.map(e => {
            if (e.status !== "new") return e;
            const supers = (subMap.get(e.value) ?? []).filter(s => inheritedValues.has(s));
            return supers.length > 0 ? { value: e.value, status: "specialization" as const, specializes: supers } : e;
          });
        domainAnalysis = upgrade(domainAnalysis, inheritedDomainValues);
        rangeAnalysis  = upgrade(rangeAnalysis,  inheritedRangeValues);
      }

      const count = (entries: AnalysisEntry[], s: string) => entries.filter(e => e.status === s).length;
      const redundancy_analysis = {
        domain: domainAnalysis,
        range:  rangeAnalysis,
        summary: {
          domain_redundant:      count(domainAnalysis, "redundant"),
          domain_specialization: count(domainAnalysis, "specialization"),
          domain_new:            count(domainAnalysis, "new"),
          range_redundant:       count(rangeAnalysis,  "redundant"),
          range_specialization:  count(rangeAnalysis,  "specialization"),
          range_new:             count(rangeAnalysis,  "new"),
        },
      };

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

server.registerTool(
  "resolve_territorial_uri",
  {
    title: "Resolve Territorial URI",
    description: `Resolve an Italian territorial code to its canonical CLV URI with labels and related URIs.

**Args:**
- code_type: Type of code: "istat-comune", "istat-provincia", "istat-regione", or "belfiore"
- code: The code value (e.g. "046030" for ISTAT comune, "F205" for Belfiore)
- date: (optional) ISO date string (e.g. "2022-08-12") — noted in output, full temporal filtering not yet implemented

**Returns:**
- uri: canonical CLV URI
- name: official name
- code_type and code
- related: connected territorial URIs (province for cities, region for provinces)
- date_note: reminder if date was provided

**Use when:** You have a raw territorial code (ISTAT or Belfiore) and need the official semantic URI to use in JSON-LD or RDF modeling.`,
    inputSchema: {
      code_type: z.enum(["istat-comune", "istat-provincia", "istat-regione", "belfiore"]).describe("Type of territorial code"),
      code: z.string().describe("The code value (e.g. '046030', 'F205', '001')"),
      date: z.string().optional().describe("Optional ISO date for temporal context (e.g. '2022-08-12')"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ code_type, code, date }) => {
    const safeCode = sanitizeSparqlString(code);

    return executeTool<unknown>("resolve_territorial_uri", { code_type, code, date }, async () => {
      let mainQuery: string;

      if (code_type === "istat-comune") {
        mainQuery = `
          SELECT DISTINCT ?uri ?name WHERE {
            ?uri a clv:City ;
                 skos:notation "${safeCode}" ;
                 l0:name ?name .
          }
          LIMIT 5
        `;
      } else if (code_type === "istat-provincia") {
        mainQuery = `
          SELECT DISTINCT ?uri ?name WHERE {
            ?uri a clv:Province ;
                 skos:notation "${safeCode}" ;
                 l0:name ?name .
          }
          LIMIT 5
        `;
      } else if (code_type === "istat-regione") {
        mainQuery = `
          SELECT DISTINCT ?uri ?name WHERE {
            ?uri a clv:Region ;
                 skos:notation "${safeCode}" ;
                 l0:name ?name .
          }
          LIMIT 5
        `;
      } else {
        // belfiore: search via hasIdentifier URI pattern
        mainQuery = `
          SELECT DISTINCT ?uri ?name WHERE {
            ?uri clv:hasIdentifier ?id .
            FILTER(CONTAINS(STR(?id), "/cadastral-code/${safeCode}"))
            OPTIONAL { ?uri l0:name ?name }
            OPTIONAL { ?uri rdfs:label ?name }
          }
          LIMIT 5
        `;
      }

      const mainResult = await executeSparql(mainQuery);
      const mainBindings = mainResult.results?.bindings ?? [];

      if (mainBindings.length === 0) {
        return {
          success: true,
          data: {
            found: false,
            code_type,
            code,
            message: `No result found for ${code_type} = "${code}". Check code format (e.g. ISTAT comune codes are 6 digits like "046030").`,
          },
        };
      }

      // Deduplicate: pick the binding with the longest name (historical names may repeat)
      const seen = new Map<string, string>();
      for (const b of mainBindings) {
        const uri = b.uri?.value ?? "";
        const name = b.name?.value ?? "";
        const existing = seen.get(uri);
        if (!existing || name.length > existing.length) seen.set(uri, name);
      }
      const primaryUri = seen.keys().next().value ?? "";
      const primaryName = seen.get(primaryUri) ?? "";

      // Query related territorial URIs (parent entities)
      let relatedQuery: string | null = null;
      if (code_type === "istat-comune") {
        relatedQuery = `
          SELECT DISTINCT ?related ?relatedName ?relatedCode ?relatedType WHERE {
            ?city a clv:City ; skos:notation "${safeCode}" .
            ?city ?p ?related .
            ?related a ?relatedType .
            VALUES ?relatedType { clv:Province clv:Region }
            OPTIONAL { ?related l0:name ?relatedName }
            OPTIONAL { ?related skos:notation ?relatedCode }
          }
          LIMIT 5
        `;
      } else if (code_type === "istat-provincia") {
        relatedQuery = `
          SELECT DISTINCT ?related ?relatedName ?relatedCode ?relatedType WHERE {
            ?prov a clv:Province ; skos:notation "${safeCode}" .
            ?prov ?p ?related .
            ?related a ?relatedType .
            VALUES ?relatedType { clv:Region }
            OPTIONAL { ?related l0:name ?relatedName }
            OPTIONAL { ?related skos:notation ?relatedCode }
          }
          LIMIT 3
        `;
      }

      const related: Array<{ uri: string; name: string; code: string; type: string }> = [];
      if (relatedQuery) {
        const relatedResult = await executeSparql(relatedQuery);
        for (const b of relatedResult.results?.bindings ?? []) {
          related.push({
            uri: b.related?.value ?? "",
            name: b.relatedName?.value ?? "",
            code: b.relatedCode?.value ?? "",
            type: (b.relatedType?.value ?? "").split("/").pop() ?? "",
          });
        }
      }

      return {
        success: true,
        data: {
          found: true,
          code_type,
          code,
          uri: primaryUri,
          name: primaryName,
          related,
          ...(date ? { date_note: `Date "${date}" was provided. Full temporal filtering is not yet implemented; results may include historical or future entities.` } : {}),
        },
      };
    });
  }
);

}
