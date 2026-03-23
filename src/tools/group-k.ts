import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { executeTool } from "../executor.js";
import { executeSparql, runLocalSparql, compressSparqlResult } from "../sparql.js";
import { resolveLocalStore } from "../local-ontology.js";
import { uploadedStores } from "../upload.js";
import {
  buildConceptProfileQueries,
  executeNamedQueries,
  buildPropertyDefinitionQuery,
  buildPropertySuperQuery,
  extractAssertedDomainRange,
  collectPropertySuperMap,
  buildPropertyInheritance,
  buildRedundancyAnalysis,
} from "../semantic-profiles.js";

// =============================================================================
// GROUP K: Local Ontology Tools
// =============================================================================

export function registerGroupK(server: McpServer): void {

server.registerTool(
  "get_upload_instructions",
  {
    title: "Get Upload Instructions for Local Ontology",
    description: `Returns the exact curl command to upload a local RDF file to this MCP server and get back an upload_id — without the AI ever reading the file content.

**CRITICAL — how to use this tool:**
1. Call this tool with the local file path
2. Execute the returned \`curl_command\` via the Bash tool (do NOT read the file first, do NOT pass its content through the conversation)
3. Parse the \`id\` field from the curl JSON output
4. Pass the id as \`upload_id\` to \`inspect_local_ontology\`, \`query_local_ontology\`, \`compare_local_with_remote\`, or \`query_uploaded_store\`

**Why this matters:** Reading the file and sending its content through the AI conversation wastes tokens and may hit context limits. curl sends the raw bytes directly from the filesystem to the server — the AI never sees the content.

**When to use this vs X:**
- use this only when the file is on the client machine and the MCP server cannot read it directly
- if the server can already read the file, prefer \`file_path\` on the local ontology tools
- if the file is small and you only need a quick summary, \`inspect_local_ontology\` with \`content + format\` may be enough

**HTTP mode only:** This workflow requires the MCP server to be running in HTTP mode (\`MCP_TRANSPORT=http\`). In stdio mode the HTTP endpoint is not available; use the \`content\` parameter of \`inspect_local_ontology\` for small files instead.

**Docker / reverse-proxy:** Set the \`MCP_PUBLIC_URL\` env var to the externally reachable base URL (e.g. \`http://localhost:8080\`). Without it, the tool falls back to the internal bind address which may be unreachable from outside the container.

**Supported formats:** .ttl (Turtle), .owl/.rdf (RDF/XML), .nt (N-Triples), .jsonld (JSON-LD), .graphol (Graphol XML)

**Uploaded stores expire after 1 hour.**`,
    inputSchema: {
      file_path: z.string().describe("Absolute path to the local RDF file to upload"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ file_path }) => {
    return executeTool("get_upload_instructions", { file_path }, async () => {
      const transportMode = process.env.MCP_TRANSPORT || "stdio";

      if (transportMode !== "http" && transportMode !== "sse") {
        return {
          success: false,
          error: "HTTP upload endpoint is not available in stdio mode.",
          alternatives: [
            "Switch to HTTP mode: set MCP_TRANSPORT=http (and optionally PORT, HOST) then restart the server.",
            "Docker: add -e MCP_TRANSPORT=http -p 3000:3000 -e MCP_PUBLIC_URL=http://localhost:3000 to your docker run command.",
            "For small files (<1 MB), pass raw content via the 'content' parameter of inspect_local_ontology instead.",
          ],
        };
      }

      const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
      const HOST = process.env.HOST || "0.0.0.0";
      const internalBase = `http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`;
      const publicBase = (process.env.MCP_PUBLIC_URL ?? "").replace(/\/$/, "");
      const baseUrl = publicBase || internalBase;
      const urlSource = publicBase ? "MCP_PUBLIC_URL env var" : "internal bind address (set MCP_PUBLIC_URL for Docker/proxy)";

      const ext = file_path.split(".").pop()?.toLowerCase() ?? "";
      const extToContentType: Record<string, string> = {
        ttl: "text/turtle",
        owl: "application/rdf+xml",
        rdf: "application/rdf+xml",
        nt: "application/n-triples",
        jsonld: "application/ld+json",
        json: "application/ld+json",
        graphol: "application/graphol+xml",
      };
      const contentType = extToContentType[ext] ?? "text/turtle";

      const uploadUrl = `${baseUrl}/upload`;
      const curlCommand = `curl -s -X POST '${uploadUrl}' -H 'Content-Type: ${contentType}' --data-binary @'${file_path}'`;

      return {
        success: true,
        data: {
          instruction: "Run curl_command via Bash tool WITHOUT reading the file first. The file bytes go directly to the server.",
          curl_command: curlCommand,
          upload_url: uploadUrl,
          url_source: urlSource,
          file_path,
          content_type: contentType,
          next_steps: [
            "1. Execute curl_command via Bash tool",
            "2. Parse the 'id' field from the JSON response",
            "3. Use that id as upload_id in inspect_local_ontology, query_local_ontology, compare_local_with_remote, or query_uploaded_store",
          ],
          note: "Stores expire after 1 hour. Max file size: 1 MB.",
        },
      };
    });
  }
);

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

**Quale modalita di input usare:**
- stdio / stessa macchina → \`file_path\`
- server remoto, file grande → \`get_upload_instructions\` + \`upload_id\`
- server remoto, file piccolo (<1 MB) → usa \`inspect_local_ontology\` con \`content + format\` per l'analisi; per query ripetute preferisci upload + \`upload_id\`

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

**When to use this vs X:**
- vs \`query_sparql\`: use this for a local/uploaded ontology; use \`query_sparql\` for the default remote catalog
- vs \`query_uploaded_store\`: prefer this tool when you already have an \`upload_id\`; \`query_uploaded_store\` is only a thinner upload-specific path

**Do not use this if:**
- you need a standard profile of a concept or property → use \`inspect_local_concept\` or \`inspect_local_property\`
- you just need a summary of the ontology → use \`inspect_local_ontology\`

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

**Quale modalita di input usare:**
- stdio / stessa macchina → \`file_path\`
- server remoto, file grande → \`get_upload_instructions\` + \`upload_id\`
- server remoto, file piccolo (<1 MB) → valuta \`content + format\` con \`inspect_local_ontology\`, poi passa a upload se servono query ripetute

**Args:**
- uri: URI of the class/concept to inspect
- file_path / upload_id: exactly one (see workflow above)
- mode: "raw" | "effective" (default: "effective")

**Tip:** Use \`search_concepts\` first if you are checking whether a similar concept already exists in \`schema.gov.it\`. Use this tool only after you know you want to inspect the local/uploaded ontology.

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

**When to use this vs X:**
- vs \`inspect_concept\`: use this for a local or uploaded ontology; use \`inspect_concept\` for the remote \`schema.gov.it\` catalog
- vs \`query_local_ontology\`: use this when you want the standard profile of one concept; use \`query_local_ontology\` only for custom SPARQL questions not covered here

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
      const queries = buildConceptProfileQueries(uri, mode);
      const { results, totalRows } = await executeNamedQueries(
        queries,
        async (query) => runLocalSparql(store, query, true)
      );

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

**Quale modalita di input usare:**
- stdio / stessa macchina → \`file_path\`
- server remoto, file grande → \`get_upload_instructions\` + \`upload_id\`
- server remoto, file piccolo (<1 MB) → valuta \`content + format\` con \`inspect_local_ontology\`, poi passa a upload se servono query ripetute

**Tip:** Use \`search_concepts\` first if you are checking whether an equivalent property already exists in \`schema.gov.it\`. Use this tool only after you know you want to inspect the local/uploaded ontology.

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

**When to use this vs X:**
- vs \`get_property_details\`: use this for a local or uploaded ontology; use \`get_property_details\` for a property already published in the remote \`schema.gov.it\` catalog
- vs \`query_local_ontology\`: use this when you want the standard semantic profile of one property; use \`query_local_ontology\` only for custom SPARQL questions not covered here

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

      const defResult = runLocalSparql(store, buildPropertyDefinitionQuery(uri), true);
      const { assertedDomain, assertedRange } = extractAssertedDomainRange(defResult);
      const superResult = runLocalSparql(store, buildPropertySuperQuery(uri), true);
      const superMap = collectPropertySuperMap(superResult, "local");

      const warnings: string[] = [];
      const needsRemote = [...superMap.values()].filter(
        (info) => info.domains.length === 0 && info.ranges.length === 0
      );

      if (needsRemote.length > 0) {
        const valuesClause = needsRemote.map((info) => `<${info.uri}>`).join(" ");
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
            const info = superMap.get(aUri) ?? { uri: aUri, label: "", domains: [], ranges: [], source: "remote" as const };
            if (!superMap.has(aUri)) superMap.set(aUri, info);
            if (b.ancestorLabel?.value && !info.label) info.label = b.ancestorLabel.value;
            if (b.domain?.value && !info.domains.includes(b.domain.value)) info.domains.push(b.domain.value);
            if (b.range?.value && !info.ranges.includes(b.range.value)) info.ranges.push(b.range.value);
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

          const subResult = runLocalSparql(store, `
            SELECT ?sub ?sup WHERE {
              VALUES ?sub { ${candidates.map((value) => `<${value}>`).join(" ")} }
              VALUES ?sup { ${inherited.map((value) => `<${value}>`).join(" ")} }
              ?sub rdfs:subClassOf+ ?sup .
            }
          `, true);

          const subMap = new Map<string, string[]>();
          for (const binding of subResult.results.bindings) {
            const sub = binding.sub?.value ?? "";
            const sup = binding.sup?.value ?? "";
            if (!sub || !sup) continue;
            if (!subMap.has(sub)) subMap.set(sub, []);
            subMap.get(sub)!.push(sup);
          }
          return subMap;
        }
      );

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

server.registerTool(
  "query_uploaded_store",
  {
    title: "Query Uploaded Store",
    description: `Execute a SPARQL SELECT query against a temporary ontology store created via HTTP upload.

**Workflow (HTTP mode only):**
1. Call \`get_upload_instructions\` with the local file path → get the curl command
2. Execute the curl command via Bash tool (file bytes go directly to the server, no AI token consumption)
3. Parse the \`id\` from the curl response
4. Use \`id\` here to run SPARQL queries, OR pass it as \`upload_id\` to \`inspect_local_ontology\`, \`query_local_ontology\`, \`compare_local_with_remote\`

**When to use this workflow:**
- The MCP server is remote, containerized, or otherwise cannot read the user's local filesystem.
- A previous \`file_path\` attempt failed because the path only exists on the client machine.
- You want to send raw file bytes directly without consuming model tokens.

**When to use this vs X:**
- prefer \`query_local_ontology\` with \`upload_id\` for the main MCP workflow
- use this only if you already have the upload store id and explicitly want to query that temporary store directly

**Deprecated direction:** this is an upload-specific shortcut; for new agent flows prefer \`query_local_ontology\` with \`upload_id\`

**Supported Content-Types for upload:** text/turtle, application/rdf+xml, application/n-triples, application/ld+json, application/graphol+xml

**Notes:**
- Uploaded stores are kept for 1 hour then evicted
- Standard prefixes (rdf/rdfs/owl/skos/dct/xsd/dcat/foaf/clv/cpv/l0/sm) are auto-injected
- The same store is also queryable directly via \`GET /sparql/<id>?query=...\``,
    inputSchema: {
      id: z.string().describe("Upload UUID returned by POST /upload"),
      query: z.string().describe("SPARQL SELECT query to execute against the uploaded store"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ id, query }) => {
    return executeTool("query_uploaded_store", { id, query }, async () => {
      const entry = uploadedStores.get(id);
      if (!entry) {
        return {
          success: false,
          error: `Uploaded store '${id}' not found or expired.`,
          suggestion: "Upload a file first via POST /upload (raw RDF body, max 1 MB). Stores expire after 1 hour.",
        };
      }
      const result = runLocalSparql(entry.store, query, true);
      const rowCount = result.results.bindings.length;
      const compressed = compressSparqlResult(result);
      return { success: true, data: compressed, rowCount };
    });
  }
);

}
