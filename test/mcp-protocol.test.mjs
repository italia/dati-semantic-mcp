/**
 * MCP protocol tests.
 *
 * Tests covered:
 *  - MCP initialize handshake (session ID, server info)
 *  - tools/list: all 43 tools present, new Fase 1 + OKG tools included
 *  - recommend_external_endpoints: static list, no network
 *  - inspect_local_ontology: inline Turtle content, local oxigraph
 *  - query_local_ontology: via upload_id (file uploaded first via HTTP)
 *  - query_uploaded_store: same upload_id, direct SPARQL
 *  - list_instances_of_class: invalid URI → sanitizeSparqlUri error path
 *  - Group M (OKG): search_okg_resources, find_semantic_software (network),
 *    find_okg_alignments error path (offline), compare_coverage_with_okg (network)
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { TEST_TTL } from "./fixtures.mjs";

const HOST = "127.0.0.1";
const PORT = 4400 + Math.floor(Math.random() * 500);
const BASE_URL = `http://${HOST}:${PORT}`;
const SERVER_START_TIMEOUT_MS = 12000;

let serverProcess;
let mcpSessionId = null;
let uploadId = null;
let reqIdCounter = 1;

function nextId() {
  return ++reqIdCounter;
}

// ---------------------------------------------------------------------------
// SSE helpers
// ---------------------------------------------------------------------------

/**
 * Read SSE events from a fetch Response body until one with the given id is found.
 * Automatically cancels the reader once the target event is found or on timeout.
 */
async function readSSEUntilId(res, targetId, timeoutMs = 10000) {
  let timeoutHandle;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error(`SSE timeout after ${timeoutMs}ms waiting for id=${targetId}`)),
      timeoutMs
    );
  });

  async function loop() {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let eventEnd;
        while ((eventEnd = buffer.indexOf("\n\n")) !== -1) {
          const eventText = buffer.slice(0, eventEnd);
          buffer = buffer.slice(eventEnd + 2);

          const dataLines = eventText
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trim());

          if (dataLines.length > 0) {
            try {
              const event = JSON.parse(dataLines.join(""));
              if (event.id === targetId) return event;
            } catch {
              // skip non-JSON SSE events (e.g. comments)
            }
          }
        }
      }
    } finally {
      reader.cancel().catch(() => {});
    }

    throw new Error(`SSE stream ended before finding id=${targetId}`);
  }

  try {
    return await Promise.race([loop(), timeoutPromise]);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

// ---------------------------------------------------------------------------
// MCP protocol helpers
// ---------------------------------------------------------------------------

async function mcpPost(path, body, extraHeaders = {}) {
  return fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // StreamableHTTPServerTransport requires SSE capability declaration
      "Accept": "application/json, text/event-stream",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

/**
 * Initialize an MCP session. Returns the session ID.
 */
async function initMCPSession() {
  const id = nextId();
  const res = await mcpPost("/mcp", {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "ci-test-client", version: "0.0.1" },
    },
  });

  assert.equal(res.status, 200, "initialize: expected HTTP 200");
  const sessionId = res.headers.get("mcp-session-id");
  assert.ok(sessionId, "initialize: expected mcp-session-id header");

  const event = await readSSEUntilId(res, id);
  assert.equal(event.jsonrpc, "2.0");
  assert.ok(event.result, "initialize: expected result in response");
  assert.ok(event.result.serverInfo, "initialize: expected serverInfo in result");

  // Send notifications/initialized (fire-and-forget — server responds 202 no body)
  await mcpPost("/mcp", { jsonrpc: "2.0", method: "notifications/initialized" }, {
    "mcp-session-id": sessionId,
  });

  return sessionId;
}

/**
 * Send a JSON-RPC request to the current MCP session and return the SSE event.
 */
async function mcpRequest(method, params = {}) {
  const id = nextId();
  const res = await mcpPost(
    "/mcp",
    { jsonrpc: "2.0", id, method, params },
    { "mcp-session-id": mcpSessionId }
  );
  assert.equal(res.status, 200, `${method}: expected HTTP 200`);
  return readSSEUntilId(res, id);
}

/**
 * Call a tool and return the first content item text (parsed JSON if possible).
 */
async function callTool(name, args = {}) {
  const event = await mcpRequest("tools/call", { name, arguments: args });
  assert.ok(event.result, `tools/call ${name}: expected result`);
  const text = event.result.content?.[0]?.text ?? "";
  try {
    return { raw: event.result, parsed: JSON.parse(text), isError: event.result.isError ?? false };
  } catch {
    return { raw: event.result, parsed: null, isError: event.result.isError ?? false };
  }
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

async function waitForServerReady() {
  const start = Date.now();
  while (Date.now() - start < SERVER_START_TIMEOUT_MS) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Server did not become ready within ${SERVER_START_TIMEOUT_MS}ms`);
}

test.before(async () => {
  serverProcess = spawn("node", ["dist/index.js"], {
    env: {
      ...process.env,
      MCP_TRANSPORT: "http",
      HOST,
      PORT: String(PORT),
      MCP_TEST_SESSION: randomUUID(),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let startupLogs = "";
  serverProcess.stdout?.on("data", (c) => { startupLogs += String(c); });
  serverProcess.stderr?.on("data", (c) => { startupLogs += String(c); });
  serverProcess.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      process.stderr.write(`\n[mcp-protocol test] server exited early: code=${code}\n${startupLogs}\n`);
    }
  });

  await waitForServerReady();

  // Initialize MCP session once — reused across all tests
  mcpSessionId = await initMCPSession();

  // Upload test.ttl once — upload_id reused in query tests
  const ttl = TEST_TTL;
  const uploadRes = await fetch(`${BASE_URL}/upload`, {
    method: "POST",
    headers: { "Content-Type": "text/turtle" },
    body: ttl,
  });
  assert.equal(uploadRes.status, 200, "upload of test.ttl failed in before()");
  const uploaded = await uploadRes.json();
  uploadId = uploaded.id;
});

test.after(async () => {
  if (!serverProcess || serverProcess.killed) return;
  serverProcess.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 300));
  if (!serverProcess.killed) serverProcess.kill("SIGKILL");
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("MCP initialize returns valid session ID and server info", () => {
  // mcpSessionId and serverInfo were already validated in test.before via initMCPSession()
  assert.match(mcpSessionId, /^[0-9a-f-]{36}$/i, "session ID should be a UUID");
});

test("MCP tools/list returns all 43 tools with expected names", async () => {
  const event = await mcpRequest("tools/list");
  const tools = event.result?.tools ?? [];

  assert.equal(tools.length, 43, `Expected 43 tools, got ${tools.length}`);

  const names = new Set(tools.map((t) => t.name));

  // Core tools
  assert.ok(names.has("query_sparql"),       "missing query_sparql");
  assert.ok(names.has("search_concepts"),    "missing search_concepts");
  assert.ok(names.has("inspect_concept"),    "missing inspect_concept");

  // Fase 1 new tools
  assert.ok(names.has("resolve_territorial_uri"),              "missing resolve_territorial_uri (Fase 1)");
  assert.ok(names.has("list_instances_of_class"),              "missing list_instances_of_class (Fase 1)");
  assert.ok(names.has("find_recommended_scheme_for_property"), "missing find_recommended_scheme_for_property (Fase 1)");

  // Local ontology tools
  assert.ok(names.has("inspect_local_ontology"),  "missing inspect_local_ontology");
  assert.ok(names.has("query_local_ontology"),    "missing query_local_ontology");
  assert.ok(names.has("query_uploaded_store"),    "missing query_uploaded_store");

  // Group M: OKG tools
  assert.ok(names.has("list_okg_categories"),        "missing list_okg_categories (Group M)");
  assert.ok(names.has("search_okg_resources"),       "missing search_okg_resources (Group M)");
  assert.ok(names.has("find_okg_alignments"),        "missing find_okg_alignments (Group M)");
  assert.ok(names.has("find_semantic_software"),     "missing find_semantic_software (Group M)");
  assert.ok(names.has("compare_coverage_with_okg"),  "missing compare_coverage_with_okg (Group M)");

  // Verify search_concepts has new params in its schema
  const searchConcepts = tools.find((t) => t.name === "search_concepts");
  assert.ok(searchConcepts?.inputSchema?.properties?.resource_type,   "search_concepts missing resource_type param");
  assert.ok(searchConcepts?.inputSchema?.properties?.ontology_filter, "search_concepts missing ontology_filter param");
  assert.ok(searchConcepts?.inputSchema?.properties?.prefer_core,     "search_concepts missing prefer_core param");
});

test("recommend_external_endpoints returns curated list without network", async () => {
  const { parsed, isError } = await callTool("recommend_external_endpoints", {});
  assert.equal(isError, false, "should not be an error");
  assert.ok(Array.isArray(parsed?.endpoints), "expected endpoints array");
  assert.ok(parsed.endpoints.length >= 5, "expected at least 5 endpoints");

  const first = parsed.endpoints[0];
  assert.ok(first.endpointUrl, "each endpoint should have an endpointUrl");
  assert.ok(first.whySuggested, "each endpoint should have whySuggested");
});

test("inspect_local_ontology with inline Turtle content summarizes test.ttl", async () => {
  const ttl = TEST_TTL;

  const { parsed, isError } = await callTool("inspect_local_ontology", {
    content: ttl,
    format: "text/turtle",
  });

  assert.equal(isError, false, "should not be an error");
  assert.ok(parsed.tripleCount >= 5, `expected tripleCount >= 5, got ${parsed.tripleCount}`);

  // Classes: Persona and Organizzazione should appear
  const classUris = JSON.stringify(parsed.classes);
  assert.ok(classUris.includes("Persona"),       "expected Persona class in output");
  assert.ok(classUris.includes("Organizzazione"),"expected Organizzazione class in output");

  // Namespaces
  assert.ok(
    parsed.namespaces.some((ns) => ns.includes("example.org")),
    "expected example.org namespace"
  );
});

test("query_local_ontology via upload_id returns classes from test.ttl", async () => {
  const { parsed, isError } = await callTool("query_local_ontology", {
    upload_id: uploadId,
    query: "SELECT ?c WHERE { ?c a owl:Class } ORDER BY ?c",
    inject_prefixes: true,
  });

  assert.equal(isError, false, "should not be an error");

  // Result is either tabular (>5 rows) or compact (≤5 rows)
  const resultStr = JSON.stringify(parsed);
  assert.ok(
    resultStr.includes("Organizzazione") && resultStr.includes("Persona"),
    "expected both classes in query result"
  );
});

test("query_uploaded_store via upload_id returns DatatypeProperties", async () => {
  const { parsed, isError } = await callTool("query_uploaded_store", {
    id: uploadId,
    query: "SELECT ?p WHERE { ?p a owl:DatatypeProperty }",
  });

  assert.equal(isError, false, "should not be an error");
  assert.ok(
    JSON.stringify(parsed).includes("nome"),
    "expected DatatypeProperty 'nome' in result"
  );
});

test("list_instances_of_class with invalid URI returns sanitization error", async () => {
  const { isError, raw } = await callTool("list_instances_of_class", {
    class_uri: "not-a-valid-uri",
  });

  assert.equal(isError, true, "expected isError=true for invalid URI");
  const text = raw.content?.[0]?.text ?? "";
  assert.ok(
    text.includes("Invalid URI") || text.includes("invalid") || text.includes("Error"),
    `expected an error message about the URI, got: ${text}`
  );
});

test("find_recommended_scheme_for_property with invalid URI returns error", async () => {
  const { isError } = await callTool("find_recommended_scheme_for_property", {
    property_uri: "urn:not-https",
  });

  assert.equal(isError, true, "expected isError=true for non-HTTPS URI");
});

// ---------------------------------------------------------------------------
// Group M: Open Knowledge Graphs (OKG) integration
// These tests call api.openknowledgegraphs.com (public, CC0, no auth).
// ---------------------------------------------------------------------------

test("list_okg_categories returns a non-empty list of strings from OKG", async () => {
  const { parsed, isError } = await callTool("list_okg_categories", {});

  assert.equal(isError, false, "should not be an error");
  assert.ok(Array.isArray(parsed?.categories), "expected categories array");
  assert.ok(parsed.categories.length > 0, "expected at least one category");
  assert.ok(parsed.categories.every((c) => typeof c === "string"), "all categories should be strings");
  assert.equal(parsed.source, "openknowledgegraphs.com (CC0)", "expected CC0 source tag");
});

test("search_okg_resources returns structured results from OKG", async () => {
  const { parsed, isError } = await callTool("search_okg_resources", {
    query: "government",
    limit: 5,
  });

  assert.equal(isError, false, "should not be an error");
  assert.ok(Array.isArray(parsed?.results), "expected results array");
  assert.equal(parsed.source, "openknowledgegraphs.com (CC0)", "expected CC0 source tag");
  assert.ok(typeof parsed.total === "number", "expected total to be a number");
  assert.ok(parsed.returned <= 5, "expected at most 5 results");
});

test("search_okg_resources with category filter returns matching results", async () => {
  const { parsed, isError } = await callTool("search_okg_resources", {
    query: "public sector",
    category: "Government & Public Sector",
    limit: 3,
  });

  assert.equal(isError, false, "should not be an error");
  assert.ok(Array.isArray(parsed?.results), "expected results array");
  assert.equal(parsed.category, "Government & Public Sector", "expected category in response");
});

test("find_semantic_software returns software tools from OKG", async () => {
  const { parsed, isError } = await callTool("find_semantic_software", {
    query: "SPARQL",
    limit: 5,
  });

  assert.equal(isError, false, "should not be an error");
  assert.ok(Array.isArray(parsed?.tools), "expected tools array");
  assert.equal(parsed.source, "openknowledgegraphs.com (CC0)", "expected CC0 source tag");
});

test("find_okg_alignments with invalid URI returns sanitization error", async () => {
  const { isError, raw } = await callTool("find_okg_alignments", {
    uri: "not-a-valid-uri",
  });

  assert.equal(isError, true, "expected isError=true for invalid URI");
  const text = raw.content?.[0]?.text ?? "";
  assert.ok(
    text.includes("Invalid") || text.includes("invalid") || text.includes("Error"),
    `expected an error message about the URI, got: ${text}`
  );
});

test("compare_coverage_with_okg returns structured summary and lists", async () => {
  const { parsed, isError } = await callTool("compare_coverage_with_okg", {
    category: "Government & Public Sector",
    limit: 10,
  });

  assert.equal(isError, false, "should not be an error");
  assert.ok(parsed?.summary, "expected summary object");
  assert.ok(typeof parsed.summary.total_okg === "number",       "expected total_okg to be a number");
  assert.ok(typeof parsed.summary.covered === "number",         "expected covered to be a number");
  assert.ok(typeof parsed.summary.gaps === "number",            "expected gaps to be a number");
  assert.ok(typeof parsed.summary.coverage_percent === "number","expected coverage_percent to be a number");
  assert.ok(Array.isArray(parsed.covered),          "expected covered array");
  assert.ok(Array.isArray(parsed.gaps),             "expected gaps array");
  assert.ok(Array.isArray(parsed.without_wikidata), "expected without_wikidata array");
});
