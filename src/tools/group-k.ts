import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { executeTool } from "../executor.js";
import { executeSparql, runLocalSparql, compressSparqlResult } from "../sparql.js";
import { resolveLocalStore } from "../local-ontology.js";

// =============================================================================
// GROUP K: Local Ontology Tools
// =============================================================================

export function registerGroupK(server: McpServer): void {

server.registerTool(
  "inspect_local_ontology",
  {
    title: "Inspect Local Ontology",
    description: `Load and summarize an RDF/OWL ontology from the server filesystem, inline content, or an uploaded HTTP store (TTL, OWL/RDF-XML, NT, JSON-LD, Graphol XML).

**Input (provide exactly one):**
- file_path: Absolute path on the MCP server filesystem. Use this only when the server process can really read that path (local stdio, same machine, or Docker with that directory mounted).
- content + format: Raw RDF text sent inline. Works in remote HTTP mode too, but only for small payloads (max 1 MB).
- upload_id: UUID returned by POST /upload. This is the preferred remote workflow when the ontology file is on the client machine instead of the server.

**Important for remote MCP servers:**
- Do not assume file_path points to the user's laptop or local workstation.
- If the MCP server runs on another machine/container and cannot access the file directly, call \`get_upload_instructions\` first, execute the returned curl command via Bash tool (do NOT read the file), then use the upload_id here.
- Prefer upload_id over trying many path variants when access to the original file is uncertain.
- Never read the file content and relay it through the conversation — this wastes tokens. Use get_upload_instructions + Bash tool instead.

**format values:** "text/turtle" (default), "application/rdf+xml", "application/n-triples", "application/ld+json", "application/graphol+xml"

**Returns:**
- File info: format, triple count, source
- Classes: defined owl:Class / rdfs:Class with instance counts (top 20)
- Properties: count of object and datatype properties
- Namespaces used

**Efficiency:** file_path results are cached by mtime; repeated calls on unchanged files skip re-parsing.`,
    inputSchema: {
      file_path: z.string().optional().describe("Absolute path to the ontology file on the server filesystem"),
      content: z.string().optional().describe("Raw RDF content as string (for remote server use; max 1 MB)"),
      format: z.string().optional().describe('RDF format of content: "text/turtle" (default), "application/rdf+xml", "application/n-triples", "application/ld+json", "application/graphol+xml"'),
      upload_id: z.string().optional().describe("Upload UUID returned by POST /upload (HTTP mode)"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ file_path, content, format, upload_id }) => {
    return executeTool("inspect_local_ontology", { file_path, content: content ? `[${content.length} chars]` : undefined, format, upload_id }, async () => {
      const { store, format: fmt, tripleCount, source } = await resolveLocalStore(file_path, content, format, upload_id);

      const classesResult = runLocalSparql(store, `
        SELECT ?class (COUNT(DISTINCT ?inst) AS ?count)
        WHERE {
          { ?class a owl:Class } UNION { ?class a rdfs:Class }
          OPTIONAL { ?inst a ?class }
        }
        GROUP BY ?class ORDER BY DESC(?count) LIMIT 20
      `);

      const propsResult = runLocalSparql(store, `
        SELECT
          (COUNT(DISTINCT ?op) AS ?objectProps)
          (COUNT(DISTINCT ?dp) AS ?dataProps)
        WHERE {
          OPTIONAL { ?op a owl:ObjectProperty }
          OPTIONAL { ?dp a owl:DatatypeProperty }
        }
      `);

      const nsResult = runLocalSparql(store, `
        SELECT DISTINCT (REPLACE(STR(?s), "(#|/)[^#/]*$", "$1") AS ?ns)
        WHERE { ?s a ?t . FILTER(isIRI(?s)) }
        LIMIT 15
      `);

      const classes = compressSparqlResult(classesResult);
      const props = compressSparqlResult(propsResult);
      const namespaces = (nsResult.results.bindings.map(b => b.ns?.value)).filter(Boolean);

      return {
        success: true,
        data: {
          source,
          format: fmt,
          tripleCount,
          classes,
          properties: props,
          namespaces,
        },
      };
    });
  }
);

server.registerTool(
  "query_local_ontology",
  {
    title: "Query Local Ontology",
    description: `Execute a SPARQL SELECT query against an ontology available on the server filesystem or through HTTP upload.

**Args (provide exactly one of file_path or upload_id):**
- file_path: Absolute path on the MCP server filesystem. Use only if the server can really read that path.
- upload_id: UUID returned by POST /upload. Use this in HTTP/remote mode when the file is local to the client, not the server.
- query: SPARQL SELECT query
- inject_prefixes: Inject standard prefixes (rdf, rdfs, owl, skos, dct…) — default true

**Important for remote MCP servers:**
- If a direct file path is not accessible from the server, do not keep retrying with alternative local paths.
- Call \`get_upload_instructions\` with the file path, execute the returned curl command via Bash tool (do NOT read the file first), then use the upload_id here.
- Never relay the file content through the conversation — this wastes tokens. curl sends bytes directly from disk to server.

**Returns:**
- Compressed SPARQL results (tabular for >5 rows, compact for ≤5 rows)

**Supported formats:** .ttl (Turtle), .owl / .rdf (RDF/XML), .nt (N-Triples), .jsonld (JSON-LD), .graphol (Graphol XML)
**Efficiency:** File is cached after first load; repeated queries on the same unchanged file skip re-parsing.
**Note:** Standard prefixes (rdf, rdfs, owl, skos…) are injected automatically unless inject_prefixes=false.`,
    inputSchema: {
      file_path: z.string().optional().describe("Absolute path to the local ontology file (local/Docker)"),
      upload_id: z.string().optional().describe("Upload UUID returned by POST /upload (HTTP mode)"),
      query: z.string().describe("SPARQL SELECT query to execute"),
      inject_prefixes: z.boolean().optional().default(true).describe("Inject standard prefixes (default: true)"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ file_path, upload_id, query, inject_prefixes }) => {
    return executeTool("query_local_ontology", { file_path, upload_id, query, inject_prefixes }, async () => {
      const { store } = await resolveLocalStore(file_path, undefined, undefined, upload_id);
      const result = runLocalSparql(store, query, inject_prefixes ?? true);
      const rowCount = result.results.bindings.length;
      const compressed = compressSparqlResult(result);
      return { success: true, data: compressed, rowCount };
    });
  }
);

server.registerTool(
  "inspect_local_concept",
  {
    title: "Inspect Concept in Local / Uploaded Ontology",
    description: `Get a full profile of a class or concept from a local or uploaded ontology.

**CRITICAL — file access workflow:**
1. Try \`file_path\` first (works only if the file is readable by the MCP server process).
2. If file_path fails for any reason → call \`get_upload_instructions\` with the local path, execute the returned curl command via Bash tool, parse the \`id\` from the JSON response, then call this tool again with \`upload_id\`.
3. NEVER read the file content and pass it through the conversation. NEVER attempt to parse or analyse the TTL text manually. The upload workflow sends raw bytes directly from disk to server without the AI ever seeing the content — it is always faster, cheaper, and more reliable.

**Args:**
- uri: URI of the class/concept to inspect
- file_path / upload_id: exactly one (see workflow above)
- mode: "raw" | "effective" (default: "effective")

**mode: "raw"** — only triples explicitly present in the local file:
- definition, hierarchy, usage, own_properties (rdfs:domain asserted directly on this class)
- No ancestor traversal, no incoming/outgoing

**mode: "effective"** (default) — full OWL/RDFS-implied view:
- All raw sections, plus:
- inherited_properties: properties from superclasses via rdfs:subClassOf+/skos:broader+, each annotated with the ancestor that declares them
- incoming / outgoing: data-level relations via instances

**Distinguishing own vs inherited:**
- own_properties = rdfs:domain explicitly written as this class in the local file
- inherited_properties = rdfs:domain written on an ancestor class (traversed via property paths)
- Properties applicable only via owl:restriction or anonymous class expressions are NOT shown — use query_local_ontology for those

**Limitation with owl:imports:** inherited_properties traverses only superclasses present in the local file. Classes from imported external ontologies (e.g. l0:, COV:, CPV:) are absent from the local store unless the file includes them. For complete property semantics of a property that subPropertyOf an external one, use inspect_local_property instead — it falls back to schema.gov.it for missing super-properties.

**Unicode SPARQL note:** oxigraph rejects prefixed names with non-ASCII local parts (e.g. \`myont:modalità_cup\`). Always use full URIs in angle brackets (\`<https://...#modalità_cup>\`) for properties or classes with Unicode in the local name.`,
    inputSchema: {
      uri: z.string().describe("URI of the class or concept to inspect"),
      file_path: z.string().optional().describe("Absolute path readable by the MCP server process. If this fails, do NOT read the file — use get_upload_instructions + Bash curl + upload_id instead."),
      upload_id: z.string().optional().describe("UUID from POST /upload. Preferred when the file is on the client machine or file_path failed."),
      mode: z.enum(["raw", "effective"]).optional().default("effective").describe(
        '"raw": only asserted triples (own_properties, no ancestor traversal). ' +
        '"effective" (default): adds inherited_properties via rdfs:subClassOf+/skos:broader+ and data-level incoming/outgoing.'
      ),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ uri, file_path, upload_id, mode }) => {
    return executeTool("inspect_local_concept", { uri, file_path, upload_id, mode }, async () => {
      const { store } = await resolveLocalStore(file_path, undefined, undefined, upload_id);

      const baseQueries: Record<string, string> = {
        definition: `
          SELECT ?p ?o WHERE { <${uri}> ?p ?o . FILTER(ISLITERAL(?o)) }
        `,
        hierarchy: `
          SELECT ?type ?parent ?parentLabel ?child ?childLabel WHERE {
            { <${uri}> a ?type }
            UNION
            { <${uri}> rdfs:subClassOf|skos:broader ?parent .
              OPTIONAL { ?parent rdfs:label|skos:prefLabel ?parentLabel . FILTER(LANG(?parentLabel) = "it" || LANG(?parentLabel) = "") }
            }
            UNION
            { ?child rdfs:subClassOf|skos:broader <${uri}> .
              OPTIONAL { ?child rdfs:label|skos:prefLabel ?childLabel . FILTER(LANG(?childLabel) = "it" || LANG(?childLabel) = "") }
            }
          } LIMIT 50
        `,
        usage: `
          SELECT (COUNT(?s) AS ?instanceCount) WHERE { ?s a <${uri}> }
        `,
        own_properties: `
          SELECT DISTINCT ?prop ?propType ?propLabel ?range ?rangeLabel WHERE {
            ?prop rdfs:domain <${uri}> .
            OPTIONAL { ?prop a ?propType . VALUES ?propType { owl:ObjectProperty owl:DatatypeProperty owl:AnnotationProperty } }
            OPTIONAL { ?prop rdfs:label ?propLabel . FILTER(LANG(?propLabel) = "it" || LANG(?propLabel) = "") }
            OPTIONAL { ?prop rdfs:range ?range }
            OPTIONAL { ?range rdfs:label|skos:prefLabel ?rangeLabel . FILTER(LANG(?rangeLabel) = "it" || LANG(?rangeLabel) = "") }
          }
          ORDER BY ?prop
          LIMIT 50
        `,
      };

      const effectiveOnlyQueries: Record<string, string> = {
        inherited_properties: `
          SELECT DISTINCT ?ancestor ?ancestorLabel ?prop ?propType ?propLabel ?range ?rangeLabel WHERE {
            <${uri}> rdfs:subClassOf+|skos:broader+ ?ancestor .
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
            ?o a <${uri}> .
            OPTIONAL { ?s a ?sType }
          } LIMIT 20
        `,
        outgoing: `
          SELECT DISTINCT ?p ?oType WHERE {
            ?s a <${uri}> .
            ?s ?p ?o .
            OPTIONAL { ?o a ?oType }
          } LIMIT 20
        `,
      };

      const queries = mode === "raw"
        ? baseQueries
        : { ...baseQueries, ...effectiveOnlyQueries };

      const results: Record<string, unknown> = {};
      let totalRows = 0;
      for (const [key, q] of Object.entries(queries)) {
        const r = runLocalSparql(store, q, true);
        results[key] = compressSparqlResult(r);
        totalRows += r.results.bindings.length;
      }

      return {
        success: true,
        data: {
          mode,
          ...(mode === "effective" ? {
            note: "inherited_properties covers only superclasses present in the local file. For properties from external imported ontologies, use inspect_local_property which falls back to schema.gov.it."
          } : {}),
          ...results,
        },
        rowCount: totalRows,
      };
    });
  }
);

server.registerTool(
  "inspect_local_property",
  {
    title: "Inspect Property in Local / Uploaded Ontology",
    description: `Get the full semantic profile of a property from a local or uploaded ontology, resolving inherited domain and range via rdfs:subPropertyOf+.

**CRITICAL — file access workflow:**
1. Try \`file_path\` first (works only if the file is readable by the MCP server process).
2. If file_path fails for any reason → call \`get_upload_instructions\` with the local path, execute the returned curl command via Bash tool, parse the \`id\` from the JSON response, then call this tool again with \`upload_id\`.
3. NEVER read the file content and pass it through the conversation. NEVER attempt to parse or analyse the TTL text manually. The upload workflow sends raw bytes directly from disk to server without the AI ever seeing the content — it is always faster, cheaper, and more reliable.

**Returns:**
- definition: direct attributes from the local store (type, label, comment, subPropertyOf, inverseOf, functional flags)
- assertedDomain: rdfs:domain declared directly on this property in the local file
- assertedRange: rdfs:range declared directly on this property in the local file
- superproperties: ancestor chain via rdfs:subPropertyOf+; each entry has source:
  - "local" = found in the local store
  - "remote" = not in local file, resolved from schema.gov.it
  - "not-found" = absent from both
- inheritedDomain: domain values collected from super-properties, each annotated with ancestor URI and source
- inheritedRange: range values collected from super-properties, each annotated with ancestor URI and source
- effectiveDomain: deduplicated union of assertedDomain + inheritedDomain
- effectiveRange: deduplicated union of assertedRange + inheritedRange
- redundancy_analysis: diagnostic view of each asserted value:
  - "redundant": identical to an inherited value — the axiom can be dropped without semantic loss
  - "specialization": a rdfs:subClassOf of an inherited value — genuinely narrows the domain/range
  - "new": not present in any inherited value — adds information not implied by the super-property chain
  - summary counts per category for quick overview
- warnings: super-properties not resolved, remote lookup failures

**owl:imports handling:** The local store typically does NOT contain imported ontologies (owl:imports declarations are not followed automatically). Super-properties from external namespaces (e.g. l0:name, l0:description from OntoPiA) are resolved against schema.gov.it automatically, making the effective semantics complete without requiring the full import chain to be loaded.

**Use case — subproperty chains:** For properties like \`ha_cup_collegato_per_fusione rdfs:subPropertyOf ha_cup_collegato\`, this tool shows whether domain/range are asserted directly, inherited from \`ha_cup_collegato\`, or need remote resolution. For \`subPropertyOf l0:name\`, it fetches l0:name's domain/range from schema.gov.it and shows it as source "remote".

**Unicode SPARQL note:** oxigraph rejects prefixed names with non-ASCII local parts. For properties with Unicode in the local name (e.g. \`myont:modalità_cup\`), always pass the full URI in angle brackets (\`<https://...#modalità_cup>\`).`,
    inputSchema: {
      uri: z.string().describe("URI of the property to inspect"),
      file_path: z.string().optional().describe("Absolute path readable by the MCP server process. If this fails, do NOT read the file — use get_upload_instructions + Bash curl + upload_id instead."),
      upload_id: z.string().optional().describe("UUID from POST /upload. Preferred when the file is on the client machine or file_path failed."),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ uri, file_path, upload_id }) => {
    return executeTool("inspect_local_property", { uri, file_path, upload_id }, async () => {
      const { store } = await resolveLocalStore(file_path, undefined, undefined, upload_id);

      // 1. Direct attributes
      const defResult = runLocalSparql(store, `
        SELECT ?p ?o WHERE {
          <${uri}> ?p ?o .
          FILTER(?p IN (
            rdf:type, rdfs:label, rdfs:comment,
            rdfs:domain, rdfs:range, rdfs:subPropertyOf,
            owl:inverseOf, owl:equivalentProperty
          ) || (?p = rdf:type && ?o IN (
            owl:FunctionalProperty, owl:InverseFunctionalProperty,
            owl:SymmetricProperty, owl:TransitiveProperty
          )))
        }
      `, true);

      // 2. Asserted domain / range
      const RDFS_DOMAIN = "http://www.w3.org/2000/01/rdf-schema#domain";
      const RDFS_RANGE  = "http://www.w3.org/2000/01/rdf-schema#range";
      const assertedDomain: string[] = [];
      const assertedRange:  string[] = [];
      for (const b of defResult.results.bindings) {
        if (b.p?.value === RDFS_DOMAIN && b.o?.value) assertedDomain.push(b.o.value);
        if (b.p?.value === RDFS_RANGE  && b.o?.value) assertedRange.push(b.o.value);
      }

      // 3. Super-property chain with local domain/range (one query)
      const superResult = runLocalSparql(store, `
        SELECT DISTINCT ?ancestor ?ancestorLabel ?domain ?range WHERE {
          <${uri}> rdfs:subPropertyOf+ ?ancestor .
          FILTER(isIRI(?ancestor))
          OPTIONAL { ?ancestor rdfs:label ?ancestorLabel . FILTER(LANG(?ancestorLabel) = "" || LANG(?ancestorLabel) = "it") }
          OPTIONAL { ?ancestor rdfs:domain ?domain }
          OPTIONAL { ?ancestor rdfs:range ?range }
        }
        ORDER BY ?ancestor
      `, true);

      type SuperInfo = {
        uri: string;
        label: string;
        localDomains: string[];
        localRanges: string[];
        source: "local" | "remote" | "not-found";
      };

      const superMap = new Map<string, SuperInfo>();
      for (const b of superResult.results.bindings) {
        const aUri = b.ancestor?.value ?? "";
        if (!aUri) continue;
        if (!superMap.has(aUri)) {
          superMap.set(aUri, { uri: aUri, label: "", localDomains: [], localRanges: [], source: "local" });
        }
        const info = superMap.get(aUri)!;
        if (b.ancestorLabel?.value && !info.label) info.label = b.ancestorLabel.value;
        if (b.domain?.value && !info.localDomains.includes(b.domain.value)) info.localDomains.push(b.domain.value);
        if (b.range?.value  && !info.localRanges.includes(b.range.value))   info.localRanges.push(b.range.value);
      }

      // 4. For super-properties with no local domain/range, fall back to schema.gov.it
      const warnings: string[] = [];
      const needsRemote = [...superMap.values()].filter(
        info => info.localDomains.length === 0 && info.localRanges.length === 0
      );

      if (needsRemote.length > 0) {
        const valuesClause = needsRemote.map(info => `<${info.uri}>`).join(" ");
        try {
          const remoteResult = await executeSparql(`
            SELECT DISTINCT ?ancestor ?ancestorLabel ?domain ?range WHERE {
              VALUES ?ancestor { ${valuesClause} }
              OPTIONAL { ?ancestor rdfs:label ?ancestorLabel . FILTER(LANG(?ancestorLabel) = "" || LANG(?ancestorLabel) = "it") }
              OPTIONAL { ?ancestor rdfs:domain ?domain }
              OPTIONAL { ?ancestor rdfs:range ?range }
            }
          `);
          const remoteFound = new Set<string>();
          for (const b of remoteResult.results?.bindings ?? []) {
            const aUri = b.ancestor?.value ?? "";
            if (!aUri) continue;
            remoteFound.add(aUri);
            const info = superMap.get(aUri) ?? { uri: aUri, label: "", localDomains: [], localRanges: [], source: "remote" as const };
            if (!superMap.has(aUri)) superMap.set(aUri, info);
            if (b.ancestorLabel?.value && !info.label) info.label = b.ancestorLabel.value;
            if (b.domain?.value && !info.localDomains.includes(b.domain.value)) info.localDomains.push(b.domain.value);
            if (b.range?.value  && !info.localRanges.includes(b.range.value))   info.localRanges.push(b.range.value);
            info.source = "remote";
          }
          for (const info of needsRemote) {
            if (!remoteFound.has(info.uri)) {
              superMap.get(info.uri)!.source = "not-found";
              warnings.push(`<${info.uri}> not found in local store or schema.gov.it — domain/range unknown.`);
            }
          }
        } catch (e) {
          warnings.push(`Remote lookup failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      // 5. Build inherited lists
      const inheritedDomain: Array<{ ancestor: string; ancestorLabel: string; domain: string; source: string }> = [];
      const inheritedRange:  Array<{ ancestor: string; ancestorLabel: string; range:  string; source: string }> = [];
      for (const info of superMap.values()) {
        for (const d of info.localDomains) inheritedDomain.push({ ancestor: info.uri, ancestorLabel: info.label, domain: d, source: info.source });
        for (const r of info.localRanges)  inheritedRange.push({ ancestor:  info.uri, ancestorLabel: info.label, range:  r, source: info.source });
      }

      // 6. Effective = deduplicated union
      const effectiveDomain = [...new Set([...assertedDomain, ...inheritedDomain.map(x => x.domain)])];
      const effectiveRange  = [...new Set([...assertedRange,  ...inheritedRange.map(x => x.range)])];

      const superproperties = [...superMap.values()].map(info => ({
        uri: info.uri,
        label: info.label,
        source: info.source,
        hasDomainLocally: info.localDomains.length > 0,
        hasRangeLocally:  info.localRanges.length  > 0,
      }));

      // 7. Redundancy analysis
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
        const subResult = runLocalSparql(store, `
          SELECT ?sub ?sup WHERE {
            VALUES ?sub { ${vSub} }
            VALUES ?sup { ${vSup} }
            ?sub rdfs:subClassOf+ ?sup .
          }
        `, true);
        const subMap = new Map<string, string[]>();
        for (const b of subResult.results.bindings) {
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

      return {
        success: true,
        data: {
          definition: compressSparqlResult(defResult),
          assertedDomain,
          assertedRange,
          superproperties,
          inheritedDomain,
          inheritedRange,
          effectiveDomain,
          effectiveRange,
          redundancy_analysis,
          ...(warnings.length > 0 ? { warnings } : {}),
        },
        rowCount: defResult.results.bindings.length + superResult.results.bindings.length,
      };
    });
  }
);

server.registerTool(
  "compare_local_with_remote",
  {
    title: "Compare Local Ontology with schema.gov.it",
    description: `Compare classes and/or properties defined in an ontology available on the server filesystem or through HTTP upload against schema.gov.it.

**Args (provide exactly one of file_path or upload_id):**
- file_path: Absolute path on the MCP server filesystem. Use only if the server can really read that path.
- upload_id: UUID returned by POST /upload. Use this in HTTP/remote mode when the ontology file is not present on the server.
- type: What to compare — "classes" | "properties" | "all" (default: "classes")
- limit: Max local items to check (default: 50)

**Important for remote MCP servers:**
- file_path is not a transport mechanism. It works only for files visible to the server process.
- If the ontology sits on the client machine, call \`get_upload_instructions\`, execute the curl command via Bash tool (without reading the file), then use the upload_id here.
- Never copy ontology text into the conversation — use get_upload_instructions + Bash tool to send bytes directly.

**Returns:**
- matched: URIs found in both local file and schema.gov.it (with Italian label if available)
- local_only: URIs defined locally but absent from schema.gov.it
- summary counts

**Use when:** Starting to build an ontology — quickly discover which of your classes/properties already exist in schema.gov.it so you can reuse or align them.`,
    inputSchema: {
      file_path: z.string().optional().describe("Absolute path to the local ontology file (local/Docker)"),
      upload_id: z.string().optional().describe("Upload UUID returned by POST /upload (HTTP mode)"),
      type: z.enum(["classes", "properties", "all"]).optional().default("classes").describe("What to compare"),
      limit: z.number().optional().default(50).describe("Max local items to check remotely"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ file_path, upload_id, type, limit }) => {
    return executeTool("compare_local_with_remote", { file_path, upload_id, type, limit }, async () => {
      const { store } = await resolveLocalStore(file_path, undefined, undefined, upload_id);
      const safeLimit = Math.min(limit ?? 50, 100);

      // Collect local URIs
      const localUris: string[] = [];

      if (type === "classes" || type === "all") {
        const r = runLocalSparql(store, `
          SELECT DISTINCT ?c WHERE {
            { ?c a owl:Class } UNION { ?c a rdfs:Class }
            FILTER(isIRI(?c))
          } LIMIT ${safeLimit}
        `);
        for (const b of r.results.bindings) {
          if (b.c?.value) localUris.push(b.c.value);
        }
      }

      if (type === "properties" || type === "all") {
        const r = runLocalSparql(store, `
          SELECT DISTINCT ?p WHERE {
            { ?p a owl:ObjectProperty } UNION { ?p a owl:DatatypeProperty } UNION { ?p a rdf:Property }
            FILTER(isIRI(?p))
          } LIMIT ${safeLimit}
        `);
        for (const b of r.results.bindings) {
          if (b.p?.value) localUris.push(b.p.value);
        }
      }

      if (localUris.length === 0) {
        return { success: true, data: { matched: [], local_only: [], summary: { localCount: 0, matchedCount: 0, localOnlyCount: 0 } } };
      }

      // Check which URIs exist in schema.gov.it
      const valuesClause = localUris.map(u => `<${u}>`).join(" ");
      const remoteQuery = `
        SELECT DISTINCT ?uri ?label
        WHERE {
          VALUES ?uri { ${valuesClause} }
          ?uri ?p [] .
          OPTIONAL { ?uri rdfs:label ?label . FILTER(LANG(?label) = "it") }
        }
      `;
      const remoteResult = await executeSparql(remoteQuery);
      const remoteUris = new Set(remoteResult.results.bindings.map(b => b.uri?.value).filter(Boolean));
      const labelMap: Record<string, string> = {};
      for (const b of remoteResult.results.bindings) {
        if (b.uri?.value && b.label?.value) labelMap[b.uri.value] = b.label.value;
      }

      const matched = localUris
        .filter(u => remoteUris.has(u))
        .map(u => ({ uri: u, label: labelMap[u] ?? null }));
      const local_only = localUris.filter(u => !remoteUris.has(u));

      return {
        success: true,
        data: {
          matched,
          local_only,
          summary: {
            localCount: localUris.length,
            matchedCount: matched.length,
            localOnlyCount: local_only.length,
          },
        },
        rowCount: localUris.length,
      };
    });
  }
);

}
