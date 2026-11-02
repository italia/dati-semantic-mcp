#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Store as OxStore } from "oxigraph";
import type { Term as OxTerm } from "oxigraph";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { randomUUID } from "crypto";
import { mkdirSync } from "fs";
import { join } from "path";

import { createAndConfigureServer } from "./server.js";
import {
  uploadedStores,
  MAX_UPLOAD_SIZE,
  BodyTooLargeError,
  readRawBodyWithLimit,
  evictExpiredUploads,
} from "./upload.js";
import { GRAPHOL_FORMAT, loadOntologyContent } from "./local-ontology.js";

const LOG_DIR = join(process.cwd(), "logs");

/** 16 MB hard limit for the MCP JSON-RPC body. MCP messages are small; the
 *  inline `content` parameter of inspect_local_ontology is the largest
 *  legitimate body and the README points files above 1 MB at POST /upload. */
const MAX_BODY_SIZE = 16 * 1024 * 1024;

/** Parse JSON body from an IncomingMessage, refusing a body over maxBytes. */
async function parseBody(req: IncomingMessage, maxBytes = MAX_BODY_SIZE): Promise<unknown> {
  const raw = (await readRawBodyWithLimit(req, maxBytes)).toString("utf-8");
  if (!raw) return undefined;
  return JSON.parse(raw);
}

async function main() {
  console.error("[Startup] Schema.gov.it MCP Server initializing...");
  console.error("[Startup] Node version:", process.version);
  console.error("[Startup] Working directory:", process.cwd());

  // Ensure log directory exists
  mkdirSync(LOG_DIR, { recursive: true });

  // Support both stdio (default) and HTTP/SSE modes
  const transportMode = process.env.MCP_TRANSPORT || 'stdio';
  console.error("[Startup] Transport mode:", transportMode);

  if (transportMode === 'sse' || transportMode === 'http') {
    // HTTP mode for Docker/remote access using StreamableHTTPServerTransport
    console.error("[Startup] Configuring Streamable HTTP server...");
    const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
    const HOST = process.env.HOST || '0.0.0.0';
    console.error(`[Startup] Will listen on ${HOST}:${PORT}`);

    // Session tracking: map session IDs to their transport + server
    const sessions = new Map<string, { server: McpServer; transport: StreamableHTTPServerTransport }>();

    const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      console.error(`[HTTP] ${req.method} ${url.pathname} from ${req.socket.remoteAddress}`);

      // Health check endpoint
      if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', service: 'schema-gov-it-mcp', sessions: sessions.size, uploadedStores: uploadedStores.size }));
        return;
      }

      // POST /upload – upload an RDF file (max 1 MB), get back an id + SPARQL endpoint
      if (url.pathname === '/upload' && req.method === 'POST') {
        evictExpiredUploads();
        let bodyBuf: Buffer;
        try {
          bodyBuf = await readRawBodyWithLimit(req, MAX_UPLOAD_SIZE);
        } catch (e) {
          const tooLarge = e instanceof BodyTooLargeError;
          res.writeHead(tooLarge ? 413 : 400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: tooLarge
              ? `File too large. Maximum size is ${MAX_UPLOAD_SIZE} bytes (1 MB).`
              : `Failed to read request body: ${String(e)}`,
          }));
          return;
        }
        const contentType = req.headers['content-type'] ?? '';
        const formatParam = url.searchParams.get('format');
        const ctNorm = (contentType.split(';')[0] ?? '').trim().toLowerCase();
        const ctFormatMap: Record<string, string> = {
          'text/turtle': 'text/turtle', 'application/turtle': 'text/turtle',
          'application/rdf+xml': 'application/rdf+xml',
          'application/n-triples': 'application/n-triples',
          'application/ld+json': 'application/ld+json',
          'text/n3': 'text/n3', 'text/rdf+n3': 'text/n3',
          'application/graphol+xml': GRAPHOL_FORMAT,
          'text/graphol+xml': GRAPHOL_FORMAT,
        };
        const extFormatMap: Record<string, string> = {
          ttl: 'text/turtle', n3: 'text/n3', nt: 'application/n-triples',
          jsonld: 'application/ld+json', json: 'application/ld+json',
          xml: 'application/rdf+xml', rdf: 'application/rdf+xml', owl: 'application/rdf+xml',
          graphol: GRAPHOL_FORMAT,
        };
        const format =
          ctFormatMap[ctNorm] ??
          (formatParam ? extFormatMap[formatParam.toLowerCase()] : undefined) ??
          'text/turtle';
        const store = new OxStore();
        let loadedFormat = format;
        try {
          const loaded = loadOntologyContent(store, bodyBuf.toString('utf-8'), format);
          loadedFormat = loaded.format;
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Failed to parse RDF: ${String(e)}` }));
          return;
        }
        const id = randomUUID();
        uploadedStores.set(id, { store, format: loadedFormat, tripleCount: store.size, created: Date.now() });
        console.error(`[Upload] Stored ontology id=${id} triples=${store.size} format=${loadedFormat}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id, tripleCount: store.size, format: loadedFormat, endpoint: `/sparql/${id}` }));
        return;
      }

      // GET|POST /sparql/{id} – SPARQL 1.1 Protocol endpoint for an uploaded store
      const sparqlMatch = /^\/sparql\/([0-9a-f-]{36})$/i.exec(url.pathname);
      if (sparqlMatch) {
        const id = sparqlMatch[1] ?? '';
        const entry = uploadedStores.get(id);
        if (!entry) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Store '${id}' not found or expired. Upload a file first via POST /upload.` }));
          return;
        }
        let sparqlQuery: string | undefined;
        if (req.method === 'GET') {
          sparqlQuery = url.searchParams.get('query') ?? undefined;
        } else if (req.method === 'POST') {
          let bodyBuf: Buffer;
          try {
            bodyBuf = await readRawBodyWithLimit(req, MAX_UPLOAD_SIZE);
          } catch (e) {
            // This read used to sit outside any try: its rejection escaped the
            // async request listener as an unhandled rejection and exited the
            // process on the first query body over MAX_UPLOAD_SIZE.
            const tooLarge = e instanceof BodyTooLargeError;
            res.writeHead(tooLarge ? 413 : 400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: tooLarge
                ? `Query body too large. Maximum size is ${MAX_UPLOAD_SIZE} bytes (1 MB).`
                : `Failed to read request body: ${String(e)}`,
            }));
            return;
          }
          const body = bodyBuf.toString('utf-8');
          const ct = req.headers['content-type'] ?? '';
          if (ct.includes('application/sparql-query')) {
            sparqlQuery = body;
          } else if (ct.includes('application/x-www-form-urlencoded')) {
            sparqlQuery = new URLSearchParams(body).get('query') ?? undefined;
          } else {
            sparqlQuery = body; // fallback: treat body as raw SPARQL
          }
        }
        if (!sparqlQuery) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing SPARQL query. Use ?query= (GET) or POST body.' }));
          return;
        }
        try {
          const raw = entry.store.query(sparqlQuery, { use_default_graph_as_union: true });
          if (Array.isArray(raw)) {
            const rows = raw as Map<string, OxTerm>[];
            const vars = rows[0] ? Array.from(rows[0].keys()) : [];
            const bindings = rows.map(row => {
              const b: Record<string, unknown> = {};
              for (const [k, v] of row.entries()) {
                if (v.termType === "NamedNode") {
                  b[k] = { type: "uri", value: v.value };
                } else if (v.termType === "BlankNode") {
                  b[k] = { type: "bnode", value: v.value };
                } else if (v.termType === "Literal") {
                  const lit: Record<string, unknown> = { type: "literal", value: v.value };
                  if (v.language) lit["xml:lang"] = v.language;
                  if (v.datatype) lit["datatype"] = v.datatype.value;
                  b[k] = lit;
                }
              }
              return b;
            });
            res.writeHead(200, { 'Content-Type': 'application/sparql-results+json' });
            res.end(JSON.stringify({ head: { vars }, results: { bindings } }));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/sparql-results+json' });
            res.end(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }));
          }
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(e) }));
        }
        return;
      }

      // MCP endpoint – delegate everything to StreamableHTTPServerTransport
      if (url.pathname === '/mcp') {
        try {
          // Check for existing session
          const sessionId = req.headers['mcp-session-id'] as string | undefined;

          if (sessionId && sessions.has(sessionId)) {
            // Existing session: forward request to its transport
            const session = sessions.get(sessionId)!;
            const body = req.method === 'POST' ? await parseBody(req) : undefined;
            console.error(`[MCP] Existing session ${sessionId}, method=${req.method}`);
            await session.transport.handleRequest(req, res, body);
            return;
          }

          if (req.method === 'POST') {
            // New session: create server + transport, connect, then handle the initialize request
            console.error("[MCP] New session initializing...");
            const body = await parseBody(req);
            const serverInstance = createAndConfigureServer();
            const transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => randomUUID(),
            });

            // Clean up session when transport closes
            transport.onclose = () => {
              const sid = transport.sessionId;
              if (sid) {
                console.error(`[MCP] Session ${sid} closed, cleaning up`);
                sessions.delete(sid);
              }
            };

            // exactOptionalPropertyTypes requires onclose to be defined before connect
            await serverInstance.connect(transport as Parameters<typeof serverInstance.connect>[0]);

            // Handle the initialize request (this sets transport.sessionId)
            await transport.handleRequest(req, res, body);

            // Store session for future requests
            const sid = transport.sessionId;
            if (sid) {
              sessions.set(sid, { server: serverInstance, transport });
              console.error(`[MCP] Session ${sid} created (active sessions: ${sessions.size})`);
            }
            return;
          }

          // GET or DELETE without valid session
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'No valid session. Send an initialize POST first.' },
            id: null,
          }));
        } catch (error) {
          console.error("[MCP] Request error:", error);
          if (!res.headersSent) {
            if (error instanceof BodyTooLargeError) {
              res.writeHead(413, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: `Request body exceeds ${MAX_BODY_SIZE} bytes (16 MB).` }));
            } else {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: String(error) }));
            }
          }
        }
        return;
      }

      // 404 for other paths
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found', hint: 'MCP endpoint is at /mcp' }));
    });

    httpServer.listen(PORT, HOST, () => {
      console.error(`[Startup] ✓ Schema.gov.it MCP Server running on http://${HOST}:${PORT}`);
      console.error(`[Startup] ✓ MCP endpoint: http://${HOST}:${PORT}/mcp`);
      console.error(`[Startup] ✓ Health check: http://${HOST}:${PORT}/health`);
      console.error("[Startup] Server ready to accept connections");
    });

    httpServer.on('error', (error) => {
      console.error("[Startup] HTTP Server error:", error);
    });
  } else {
    // Stdio mode for local process spawning (default)
    console.error("[Startup] Initializing stdio transport...");
    console.error("[Startup] Creating and configuring server instance...");
    const server = createAndConfigureServer();
    const transport = new StdioServerTransport();
    console.error("[Startup] Connecting server to transport...");
    await server.connect(transport);
    console.error("[Startup] Schema.gov.it MCP Server running on stdio");
    console.error("[Startup] Server ready to accept requests");
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
