import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { TEST_TTL } from "./fixtures.mjs";

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
