import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { TEST_GRAPHOL, TEST_TTL } from "./fixtures.mjs";

const HOST = "127.0.0.1";
const PORT = 3400 + Math.floor(Math.random() * 1000);
const BASE_URL = `http://${HOST}:${PORT}`;
const SERVER_START_TIMEOUT_MS = 12000;

let serverProcess;

async function waitForServerReady() {
  const start = Date.now();
  while (Date.now() - start < SERVER_START_TIMEOUT_MS) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) return;
    } catch {
      // Server not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
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
  serverProcess.stdout?.on("data", (chunk) => { startupLogs += String(chunk); });
  serverProcess.stderr?.on("data", (chunk) => { startupLogs += String(chunk); });
  serverProcess.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      process.stderr.write(`\n[MCP test] server exited early with code ${code}\n${startupLogs}\n`);
    }
  });

  await waitForServerReady();
});

test.after(async () => {
  if (!serverProcess || serverProcess.killed) return;
  serverProcess.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 300));
  if (!serverProcess.killed) {
    serverProcess.kill("SIGKILL");
  }
});

test("GET /health returns service status", async () => {
  const res = await fetch(`${BASE_URL}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "ok");
  assert.equal(body.service, "schema-gov-it-mcp");
  assert.equal(typeof body.sessions, "number");
});

test("POST /upload + GET /sparql/{id} can query uploaded ontology", async () => {
  const ttl = TEST_TTL;

  const uploadRes = await fetch(`${BASE_URL}/upload`, {
    method: "POST",
    headers: { "Content-Type": "text/turtle" },
    body: ttl,
  });
  assert.equal(uploadRes.status, 200);
  const uploaded = await uploadRes.json();
  assert.match(uploaded.id, /^[0-9a-f-]{36}$/i);
  assert.equal(uploaded.format, "text/turtle");
  assert.equal(typeof uploaded.tripleCount, "number");

  const query = "SELECT ?c WHERE { ?c a <http://www.w3.org/2002/07/owl#Class> } ORDER BY ?c";
  const queryRes = await fetch(`${BASE_URL}/sparql/${uploaded.id}?query=${encodeURIComponent(query)}`);
  assert.equal(queryRes.status, 200);
  const result = await queryRes.json();
  assert.deepEqual(result.head.vars, ["c"]);

  const values = result.results.bindings.map((b) => b.c?.value);
  assert.deepEqual(values, [
    "http://example.org/onto#Organizzazione",
    "http://example.org/onto#Persona",
  ]);
});

test("POST /upload rejects malformed RDF", async () => {
  const badUpload = await fetch(`${BASE_URL}/upload`, {
    method: "POST",
    headers: { "Content-Type": "text/turtle" },
    body: "@prefix ex: <http://example.org/> . ex:s ex:p",
  });
  assert.equal(badUpload.status, 400);
  const body = await badUpload.json();
  assert.match(body.error, /Failed to parse RDF/i);
});

test("POST /upload accepts Graphol XML and exposes it as a queryable store", async () => {
  const uploadRes = await fetch(`${BASE_URL}/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/graphol+xml" },
    body: TEST_GRAPHOL,
  });
  assert.equal(uploadRes.status, 200);
  const uploaded = await uploadRes.json();
  assert.match(uploaded.id, /^[0-9a-f-]{36}$/i);
  assert.equal(uploaded.format, "text/turtle");

  const query = "SELECT ?c WHERE { ?c a <http://www.w3.org/2002/07/owl#Class> } ORDER BY ?c";
  const queryRes = await fetch(`${BASE_URL}/sparql/${uploaded.id}?query=${encodeURIComponent(query)}`);
  assert.equal(queryRes.status, 200);
  const result = await queryRes.json();
  const values = result.results.bindings.map((b) => b.c?.value);
  assert.deepEqual(values, [
    "http://example.org/onto#Agent",
    "http://example.org/onto#Person",
  ]);
});

test("POST /upload rejects payload > 1MB", async () => {
  const tooBig = "a".repeat(1_000_001);
  try {
    const res = await fetch(`${BASE_URL}/upload`, {
      method: "POST",
      headers: { "Content-Type": "text/turtle" },
      body: tooBig,
    });
    assert.equal(res.status, 413);
    const body = await res.json();
    assert.match(body.error, /Maximum size is 1000000 bytes/i);
  } catch (error) {
    // The server may destroy the connection once the limit is exceeded.
    assert.match(String(error), /fetch failed/i);
  }
});

test("GET /sparql/{id} without query returns 400", async () => {
  const ttl = TEST_TTL;
  const uploadRes = await fetch(`${BASE_URL}/upload`, {
    method: "POST",
    headers: { "Content-Type": "text/turtle" },
    body: ttl,
  });
  assert.equal(uploadRes.status, 200);
  const uploaded = await uploadRes.json();

  const res = await fetch(`${BASE_URL}/sparql/${uploaded.id}`);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /Missing SPARQL query/i);
});

// ---------------------------------------------------------------------------
// Unbounded request bodies: both routes used to read a body with no byte gate.
// The /mcp body was buffered whole and answered from memory (above V8's
// 536,870,888-character string limit the process exited on
// ERR_STRING_TOO_LONG); the /sparql/{id} body was bounded but its rejection was
// uncaught, so a body over 1 MB exited the process. These tests pin the 413 and
// the fact that the server answers the next request.
// ---------------------------------------------------------------------------

test("POST /mcp rejects a body over 16 MB with 413 and stays up", async () => {
  const oversized = "x".repeat(17 * 1024 * 1024);
  const res = await fetch(`${BASE_URL}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: oversized,
  });
  assert.equal(res.status, 413);
  const body = await res.json();
  assert.match(body.error, /Request body exceeds 16777216 bytes/i);

  const health = await fetch(`${BASE_URL}/health`);
  assert.equal(health.status, 200);
});

test("POST /mcp still accepts an initialize request under the cap", async () => {
  const res = await fetch(`${BASE_URL}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "http-api-test", version: "1" },
      },
    }),
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("mcp-session-id") ?? "", /^[0-9a-f-]{36}$/i);
});

test("POST /sparql/{id} rejects a query body over 1 MB with 413 and stays up", async () => {
  const uploadRes = await fetch(`${BASE_URL}/upload`, {
    method: "POST",
    headers: { "Content-Type": "text/turtle" },
    body: TEST_TTL,
  });
  assert.equal(uploadRes.status, 200);
  const uploaded = await uploadRes.json();

  const res = await fetch(`${BASE_URL}/sparql/${uploaded.id}`, {
    method: "POST",
    headers: { "Content-Type": "application/sparql-query" },
    body: "y".repeat(1_000_001),
  });
  assert.equal(res.status, 413);
  const body = await res.json();
  assert.match(body.error, /Query body too large\. Maximum size is 1000000 bytes/i);

  const health = await fetch(`${BASE_URL}/health`);
  assert.equal(health.status, 200);
});
