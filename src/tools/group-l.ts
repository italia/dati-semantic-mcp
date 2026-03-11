import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { executeTool } from "../executor.js";
import { runLocalSparql, compressSparqlResult } from "../sparql.js";
import { uploadedStores } from "../upload.js";

// =============================================================================
// GROUP L: Uploaded Store Tools (HTTP upload workflow)
// =============================================================================

export function registerGroupL(server: McpServer): void {

server.registerTool(
  "query_uploaded_store",
  {
    title: "Query Uploaded Store",
    description: `Execute a SPARQL SELECT query against a temporary ontology store created via HTTP upload.

**Workflow (HTTP mode only):**
1. Upload a local RDF file: \`POST /upload\` with raw RDF body and correct Content-Type (max 1 MB)
2. Response: \`{"id": "<uuid>", "tripleCount": N, "endpoint": "/sparql/<uuid>"}\`
3. Use the \`id\` here to run SPARQL queries, OR pass it as \`upload_id\` to \`inspect_local_ontology\`, \`query_local_ontology\`, \`compare_local_with_remote\`

**Supported Content-Types for upload:** text/turtle, application/rdf+xml, application/n-triples, application/ld+json

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
