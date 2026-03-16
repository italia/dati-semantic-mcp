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

      // MCP_PUBLIC_URL lets Docker/reverse-proxy deployments advertise the correct external URL.
      // Without it, the server can only guess based on its internal bind address, which may be
      // wrong when port-mapped (e.g. -p 8080:3000) or behind a proxy.
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
