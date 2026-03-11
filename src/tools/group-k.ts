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
    description: `Load and summarize a local RDF/OWL ontology file (TTL, OWL/RDF-XML, NT, JSON-LD).

**Input (provide exactly one):**
- file_path: Absolute path on the server filesystem — use when running locally or via Docker with a mounted volume
- content + format: Raw RDF text — use when the server is remote (HTTP mode); the client reads the file and sends its content inline (max 1 MB)
- upload_id: UUID returned by POST /upload — use when the file was already uploaded via HTTP

**format values:** "text/turtle" (default), "application/rdf+xml", "application/n-triples", "application/ld+json"

**Returns:**
- File info: format, triple count, source
- Classes: defined owl:Class / rdfs:Class with instance counts (top 20)
- Properties: count of object and datatype properties
- Namespaces used

**Efficiency:** file_path results are cached by mtime; repeated calls on unchanged files skip re-parsing.`,
    inputSchema: {
      file_path: z.string().optional().describe("Absolute path to the ontology file on the server filesystem"),
      content: z.string().optional().describe("Raw RDF content as string (for remote server use; max 1 MB)"),
      format: z.string().optional().describe('RDF format of content: "text/turtle" (default), "application/rdf+xml", "application/n-triples", "application/ld+json"'),
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
    description: `Execute a SPARQL SELECT query against a local RDF/OWL ontology file.

**Args (provide exactly one of file_path or upload_id):**
- file_path: Absolute path to the ontology file (local/Docker)
- upload_id: UUID returned by POST /upload (HTTP mode)
- query: SPARQL SELECT query
- inject_prefixes: Inject standard prefixes (rdf, rdfs, owl, skos, dct…) — default true

**Returns:**
- Compressed SPARQL results (tabular for >5 rows, compact for ≤5 rows)

**Supported formats:** .ttl (Turtle), .owl / .rdf (RDF/XML), .nt (N-Triples), .jsonld (JSON-LD)
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
  "compare_local_with_remote",
  {
    title: "Compare Local Ontology with schema.gov.it",
    description: `Compare classes and/or properties defined in a local ontology file against schema.gov.it.

**Args (provide exactly one of file_path or upload_id):**
- file_path: Absolute path to the local ontology file (local/Docker)
- upload_id: UUID returned by POST /upload (HTTP mode)
- type: What to compare — "classes" | "properties" | "all" (default: "classes")
- limit: Max local items to check (default: 50)

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
