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
    description: `Get a full profile of a class or concept from a local or uploaded ontology, including the complete inherited property chain.

**Args (provide exactly one of file_path or upload_id):**
- uri: URI of the class/concept to inspect
- file_path: Absolute path on the MCP server filesystem
- upload_id: UUID returned by POST /upload (HTTP/remote mode)

**Returns:**
- definition: Literal annotations of the concept (rdfs:label, rdfs:comment, skos:definition…)
- hierarchy: Direct type, parent classes (rdfs:subClassOf / skos:broader), and child classes
- usage: Count of instances typed as this class in the store
- own_properties: Properties whose rdfs:domain is exactly this class
- inherited_properties: Properties inherited from ancestor classes via rdfs:subClassOf+ / skos:broader+, each annotated with the ancestor it comes from — gives the complete effective property set
- incoming: Properties whose values are instances of this type (data-level)
- outgoing: Properties used by instances of this type (data-level)

**Why this matters:** oxigraph (the local SPARQL engine) does not perform automatic RDFS inference. A plain \`?prop rdfs:domain <class>\` query will miss properties declared on parent classes. This tool traverses the ancestry explicitly using SPARQL property paths (rdfs:subClassOf+) so the result reflects the full OWL/RDFS semantics.

**Use when:** You uploaded an ontology and want to understand what a specific class really models, including everything it inherits.`,
    inputSchema: {
      uri: z.string().describe("URI of the class or concept to inspect"),
      file_path: z.string().optional().describe("Absolute path to the ontology file on the server filesystem"),
      upload_id: z.string().optional().describe("Upload UUID returned by POST /upload (HTTP mode)"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ uri, file_path, upload_id }) => {
    return executeTool("inspect_local_concept", { uri, file_path, upload_id }, async () => {
      const { store } = await resolveLocalStore(file_path, undefined, undefined, upload_id);

      const queries: Record<string, string> = {
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

      const results: Record<string, unknown> = {};
      let totalRows = 0;
      for (const [key, q] of Object.entries(queries)) {
        const r = runLocalSparql(store, q, true);
        results[key] = compressSparqlResult(r);
        totalRows += r.results.bindings.length;
      }

      return { success: true, data: results, rowCount: totalRows };
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
