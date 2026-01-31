#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { appendFile, readFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

const server = new McpServer({
  name: "schema-gov-it",
  version: "1.0.0",
});

const LOG_FILE = join(process.cwd(), "usage_log.jsonl");

// Helper to log usage
async function logUsage(toolName: string, args: any, resultSummary: string) {
  const entry = {
    timestamp: new Date().toISOString(),
    tool: toolName,
    args,
    summary: resultSummary,
  };
  try {
    await appendFile(LOG_FILE, JSON.stringify(entry) + "\n");
  } catch (err) {
    console.error("Failed to log usage:", err);
  }
}

// SPARQL Endpoint
const ENDPOINT = "https://schema.gov.it/sparql";

const PREFIXES = `
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX dct: <http://purl.org/dc/terms/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX dcat: <http://www.w3.org/ns/dcat#>
PREFIX foaf: <http://xmlns.com/foaf/0.1/>
`;

async function executeSparql(query: string): Promise<any> {
  const fullQuery = PREFIXES + "\n" + query;
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/sparql-results+json",
    },
    body: new URLSearchParams({ query: fullQuery }),
  });

  if (!response.ok) {
    throw new Error(`SPARQL request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}


// Helper to compress SPARQL results
function compressSparqlResult(result: any): any {
  if (!result?.results?.bindings) return result;

  const bindings = result.results.bindings;
  if (bindings.length === 0) return [];

  // Optimization: For lists > 5 items, return tabular format to save tokens on repeated keys
  if (bindings.length > 5) {
    const headers = result.head?.vars || Object.keys(bindings[0]).map((k: any) => k.value);
    const rows = bindings.map((b: any) => {
      return headers.map((h: string) => b[h]?.value ?? null);
    });
    return { headers, rows };
  }

  // Standard compact format for small results
  const simplified = bindings.map((binding: any) => {
    const row: any = {};
    for (const key in binding) {
      row[key] = binding[key].value;
    }
    return row;
  });

  return simplified;
}

server.tool(
  "query_sparql",
  "Execute a RAW SPARQL query against schema.gov.it. Use this for ad-hoc exploration.",
  {
    query: z.string().describe("The SPARQL query to execute"),
  },
  async ({ query }) => {
    try {
      const result = await executeSparql(query);
      const rowCount = result.results?.bindings?.length ?? 0;
      await logUsage("query_sparql", { query }, `Success: ${rowCount} rows`);

      const compressed = compressSparqlResult(result);

      return {
        content: [
          {
            type: "text",
            // Use compact JSON (no whitespace) for maximum token efficiency
            text: JSON.stringify(compressed),
          },
        ],
      };
    } catch (error: any) {
      await logUsage("query_sparql", { query }, `Error: ${error.message}`);
      return {
        content: [
          {
            type: "text",
            text: `Error executing query: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// High-level tool: Explore Classes
server.tool(
  "explore_classes",
  "List available classes in the ontology to understand content.",
  {
    limit: z.number().optional().default(50),
    filter: z.string().optional().describe("Optional text filter for class URI"),
  },
  async ({ limit, filter }) => {
    let sparql = `
      SELECT DISTINCT ?class (COUNT(?s) AS ?count)
      WHERE {
        ?s a ?class .
        ${filter ? `FILTER(REGEX(STR(?class), "${filter}", "i"))` : ""}
      }
      GROUP BY ?class
      ORDER BY DESC(?count)
      LIMIT ${limit}
    `;

    try {
      const result = await executeSparql(sparql);
      await logUsage("explore_classes", { limit, filter }, "Success");
      return {
        content: [{ type: "text", text: JSON.stringify(compressSparqlResult(result)) }],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }
);


// High-level tool: Explore Catalog (Graphs/Ontologies)
server.tool(
  "explore_catalog",
  "List named graphs or ontologies available in the endpoint.",
  {},
  async () => {
    // Try to list graphs. If not supported, list top concept schemes or ontologies.
    const query = `
      SELECT DISTINCT ?g ?type
      WHERE {
        GRAPH ?g { ?s ?p ?o }
      }
      LIMIT 100
    `;
    // Fallback if GRAPH lookup is not allowed/supported in default graph
    const queryOntologies = `
      SELECT DISTINCT ?s ?type
      WHERE {
        VALUES ?type { owl:Ontology skos:ConceptScheme }
        ?s a ?type .
      }
      LIMIT 100
    `;

    try {
      const result = await executeSparql(query);
      const resultOnt = await executeSparql(queryOntologies);

      await logUsage("explore_catalog", {}, "Success");
      return {
        content: [{
          type: "text", text: JSON.stringify({
            graphs: compressSparqlResult(result),
            ontologies: compressSparqlResult(resultOnt)
          })
        }],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }
);

// High-level tool: Check Coverage
server.tool(
  "check_coverage",
  "Analyze the usage coverage of a specific class or property, or global stats.",
  {
    targetUri: z.string().optional().describe("URI of class or property to check coverage for"),
  },
  async ({ targetUri }) => {
    let query;
    if (targetUri) {
      query = `
        SELECT (COUNT(DISTINCT ?s) AS ?instances) (COUNT(DISTINCT ?p) AS ?propertiesUsed)
        WHERE {
            { ?s a <${targetUri}> }
            UNION
            { ?s <${targetUri}> ?o }
            UNION
            { ?sub <${targetUri}> ?obj }
        }
      `;
    } else {
      query = `
        SELECT ?type (COUNT(?s) AS ?count)
        WHERE {
          ?s a ?type .
        }
        GROUP BY ?type
        ORDER BY DESC(?count)
        LIMIT 50
      `;
    }

    try {
      const result = await executeSparql(query);
      await logUsage("check_coverage", { targetUri }, "Success");
      return {
        content: [{ type: "text", text: JSON.stringify(compressSparqlResult(result)) }],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }
);

// High-level tool: Check Quality
server.tool(
  "check_quality",
  "Verify quality issues like missing labels or descriptions.",
  {
    limit: z.number().optional().default(50),
  },
  async ({ limit }) => {
    const query = `
      SELECT ?s ?type ?issue
      WHERE {
        VALUES ?type { owl:Class owl:ObjectProperty owl:DatatypeProperty skos:Concept }
        ?s a ?type .
        FILTER NOT EXISTS { ?s rdfs:label ?label }
        FILTER NOT EXISTS { ?s skos:prefLabel ?label }
        BIND("Missing Label" AS ?issue)
      }
      LIMIT ${limit}
    `;

    try {
      const result = await executeSparql(query);
      await logUsage("check_quality", { limit }, "Success");
      return {
        content: [{ type: "text", text: JSON.stringify(compressSparqlResult(result)) }],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }
);

// High-level tool: Check Overlaps
server.tool(
  "check_overlaps",
  "Identify potential overlaps (same labels) or explicit mappings.",
  {
    limit: z.number().optional().default(50),
  },
  async ({ limit }) => {
    // Check for explicit mappings and label collisions
    const query = `
      SELECT ?s1 ?s2 ?label ?relation
      WHERE {
        {
          ?s1 owl:sameAs ?s2 .
          BIND("owl:sameAs" AS ?relation)
        }
        UNION
        {
          ?s1 skos:exactMatch ?s2 .
          BIND("skos:exactMatch" AS ?relation)
        }
        UNION
        {
          ?s1 rdfs:label ?label .
          ?s2 rdfs:label ?label .
          FILTER (?s1 != ?s2)
          BIND("Same Label" AS ?relation)
        }
      }
      LIMIT ${limit}
    `;

    try {
      const result = await executeSparql(query);
      await logUsage("check_overlaps", { limit }, "Success");
      return {
        content: [{ type: "text", text: JSON.stringify(compressSparqlResult(result)) }],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }
);


// ------------------------------------------------------------------
// 1. MODEL STRUCTURE (Ontologies)
// ------------------------------------------------------------------

server.tool(
  "list_ontologies",
  "List available Ontologies (Data Models) and their titles.",
  {
    limit: z.number().optional().default(50),
  },
  async ({ limit }) => {
    const query = `
      SELECT DISTINCT ?ont ?label
      WHERE {
        ?ont a owl:Ontology .
        OPTIONAL { ?ont rdfs:label|dct:title ?label }
      }
      ORDER BY ?label
      LIMIT ${limit}
    `;

    try {
      const result = await executeSparql(query);
      await logUsage("list_ontologies", { limit }, "Success");
      return {
        content: [{ type: "text", text: JSON.stringify(compressSparqlResult(result)) }],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "explore_ontology",
  "List Classes and Properties defined in a specific Ontology.",
  {
    ontologyUri: z.string().describe("The URI of the Ontology (from list_ontologies)"),
  },
  async ({ ontologyUri }) => {
    // We assume classes/props are linked via rdfs:isDefinedBy OR have the ontology URI as prefix (heuristic)
    // A more reliable check for schema.gov.it is looking for things defined IN that graph or with that namespace.
    // Given the structure, we'll try filtering by namespace match primarily.

    // Simplification: Check for Classes and Properties that validly start with the ontology URI
    // but often ontologies have hash or slash.

    const query = `
      SELECT DISTINCT ?type ?item ?label
      WHERE {
        VALUES ?type { owl:Class owl:ObjectProperty owl:DatatypeProperty }
        ?item a ?type .
        OPTIONAL { ?item rdfs:label ?label }
        
        # Heuristic: Filter where item URI starts with Ontology URI (common convention)
        FILTER(STRSTARTS(STR(?item), "${ontologyUri}"))
      }
      ORDER BY ?type ?item
      LIMIT 200
    `;

    try {
      const result = await executeSparql(query);
      await logUsage("explore_ontology", { ontologyUri }, "Success");
      return {
        content: [{ type: "text", text: JSON.stringify(compressSparqlResult(result)) }],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }
);


// ------------------------------------------------------------------
// 2. CONTROLLED VOCABULARIES (Codes & Values)
// ------------------------------------------------------------------

// High-level tool: List Controlled Vocabularies
server.tool(
  "list_vocabularies",
  "List available Controlled Vocabularies (ConceptSchemes) and their instance counts.",
  {
    limit: z.number().optional().default(20),
  },
  async ({ limit }) => {
    const query = `
      SELECT DISTINCT ?scheme ?label (COUNT(?c) AS ?count)
      WHERE {
        ?scheme a skos:ConceptScheme .
        OPTIONAL { ?scheme rdfs:label|dct:title ?label }
        OPTIONAL { ?c skos:inScheme ?scheme }
      }
      GROUP BY ?scheme ?label
      ORDER BY DESC(?count)
      LIMIT ${limit}
    `;

    try {
      const result = await executeSparql(query);
      await logUsage("list_vocabularies", { limit }, "Success");
      return {
        content: [{ type: "text", text: JSON.stringify(compressSparqlResult(result)) }],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }
);

// High-level tool: Search inside a Vocabulary
server.tool(
  "search_in_vocabulary",
  "Search for concepts within a specific Controlled Vocabulary (ConceptScheme).",
  {
    schemeUri: z.string().describe("The URI of the ConceptScheme (from list_vocabularies)"),
    keyword: z.string().describe("The search keyword"),
    limit: z.number().optional().default(20),
  },
  async ({ schemeUri, keyword, limit }) => {
    const query = `
      SELECT DISTINCT ?concept ?label ?code
      WHERE {
        ?concept skos:inScheme <${schemeUri}> .
        ?concept rdfs:label|skos:prefLabel ?label .
        OPTIONAL { ?concept skos:notation|dct:identifier ?code }
        FILTER(REGEX(STR(?label), "${keyword}", "i"))
      }
      ORDER BY ?label
      LIMIT ${limit}
    `;

    try {
      const result = await executeSparql(query);
      await logUsage("search_in_vocabulary", { schemeUri, keyword, limit }, "Success");
      return {
        content: [{ type: "text", text: JSON.stringify(compressSparqlResult(result)) }],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }
);

// ------------------------------------------------------------------
// 3. DATA & CATALOGS (Datasets)
// ------------------------------------------------------------------

server.tool(
  "list_datasets",
  "List available Datasets (dcatapit:Dataset) in the catalog.",
  {
    limit: z.number().optional().default(20),
    offset: z.number().optional().default(0),
  },
  async ({ limit, offset }) => {
    const query = `
      SELECT DISTINCT ?dataset ?label
      WHERE {
        ?dataset a <http://dati.gov.it/onto/dcatapit#Dataset> .
        OPTIONAL { ?dataset dct:title ?label }
      }
      ORDER BY ?label
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    try {
      const result = await executeSparql(query);
      await logUsage("list_datasets", { limit, offset }, "Success");
      return {
        content: [{ type: "text", text: JSON.stringify(compressSparqlResult(result)) }],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "explore_dataset",
  "Get details of a specific Dataset (Description, Distributions, Themes).",
  {
    datasetUri: z.string().describe("The URI of the Dataset"),
  },
  async ({ datasetUri }) => {
    const query = `
      SELECT ?p ?o
      WHERE {
        <${datasetUri}> ?p ?o .
        FILTER (ISLITERAL(?o) || (ISURI(?o) && EXISTS { ?o a <http://dati.gov.it/onto/dcatapit#Distribution> }))
      }
      LIMIT 100
    `;

    // Also fetch distributions explicitly if needed, but the above query might catch them if linked directly.
    // Let's do a specific query for distributions as well.
    const distQuery = `
        SELECT ?dist ?format ?url
        WHERE {
            ?dist a <http://dati.gov.it/onto/dcatapit#Distribution> .
            { <${datasetUri}> dcat:distribution ?dist } UNION { ?dist isDistributionOf <${datasetUri}> } .
            OPTIONAL { ?dist dct:format ?format }
            OPTIONAL { ?dist dcat:downloadURL ?url }
        }
        LIMIT 20
    `;

    try {
      const details = await executeSparql(query);
      const distributions = await executeSparql(distQuery);

      await logUsage("explore_dataset", { datasetUri }, "Success");
      return {
        content: [{
          type: "text", text: JSON.stringify({
            metadata: compressSparqlResult(details),
            distributions: compressSparqlResult(distributions)
          })
        }],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }
);

// ------------------------------------------------------------------
// 4. INTELLIGENT TOOLS (Advanced)
// Smart Tool: Search Concepts
server.tool(
  "search_concepts",
  "Fuzzy search for concepts/classes/properties by keyword. Use this when you don't know the exact URI.",
  {
    keyword: z.string().describe("The search term (e.g. 'amministrazione')"),
    limit: z.number().optional().default(10),
  },
  async ({ keyword, limit }) => {
    const query = `
      SELECT DISTINCT ?subject ?type ?label
      WHERE {
        VALUES ?type { owl:Class owl:ObjectProperty owl:DatatypeProperty skos:Concept }
        ?subject a ?type .
        ?subject rdfs:label|skos:prefLabel|dct:title ?label .
        FILTER(REGEX(STR(?label), "${keyword}", "i"))
      }
      LIMIT ${limit}
    `;

    try {
      const result = await executeSparql(query);
      await logUsage("search_concepts", { keyword, limit }, "Success");
      return {
        content: [{ type: "text", text: JSON.stringify(compressSparqlResult(result)) }],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }
);

// Smart Tool: Deep Concept Inspection
server.tool(
  "inspect_concept",
  "Get a comprehensive profile of a concept: definition, hierarchy, usage, and neighbors.",
  {
    uri: z.string().describe("The URI of the concept to inspect"),
  },
  async ({ uri }) => {
    // Parallel queries for speed
    const queries = {
      definition: `
        SELECT ?p ?o WHERE { <${uri}> ?p ?o . FILTER(ISLITERAL(?o)) }
      `,
      hierarchy: `
        SELECT ?type ?parent ?child WHERE {
          { <${uri}> a ?type }
          UNION
          { <${uri}> rdfs:subClassOf|skos:broader ?parent }
          UNION
          { ?child rdfs:subClassOf|skos:broader <${uri}> }
        } LIMIT 50
      `,
      usage: `
        SELECT (COUNT(?s) as ?instanceCount) WHERE { ?s a <${uri}> }
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
      `
    };

    try {
      const results: any = {};
      for (const [key, q] of Object.entries(queries)) {
        results[key] = compressSparqlResult(await executeSparql(q as string));
      }

      await logUsage("inspect_concept", { uri }, "Success");
      return {
        content: [{ type: "text", text: JSON.stringify(results) }],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }
);

// Smart Tool: Relationship Discovery
server.tool(
  "find_relations",
  "Find how two concepts are connected (direct link or via 1 intermediate).",
  {
    sourceUri: z.string(),
    targetUri: z.string(),
  },
  async ({ sourceUri, targetUri }) => {
    const query = `
      SELECT ?p1 ?mid ?p2
      WHERE {
        {
          <${sourceUri}> ?p1 <${targetUri}> .
          BIND("DIRECT" AS ?mid)
          BIND("NONE" AS ?p2)
        }
        UNION
        {
          <${sourceUri}> ?p1 ?mid .
          ?mid ?p2 <${targetUri}> .
        }
      }
      LIMIT 10
    `;

    try {
      const result = await executeSparql(query);
      await logUsage("find_relations", { sourceUri, targetUri }, "Success");
      return {
        content: [{ type: "text", text: JSON.stringify(compressSparqlResult(result)) }],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }
);

// Smart Tool: Suggest Improvements / Heuristics
server.tool(
  "suggest_improvements",
  "Analyze the ontology for structural issues (lonely classes, cycles, etc).",
  {
    limit: z.number().optional().default(20),
  },
  async ({ limit }) => {
    // 1. Lonely Classes (No instances, no subclasses)
    const lonelyQuery = `
      SELECT ?class (COUNT(?s) as ?instances)
      WHERE {
        ?class a owl:Class .
        FILTER NOT EXISTS { ?s a ?class }
        FILTER NOT EXISTS { ?sub rdfs:subClassOf ?class }
      }
      GROUP BY ?class
      LIMIT ${limit}
    `;

    // 2. Potential Cycles (A subClassOf B, B subClassOf A) - Simple 2-step check
    const cycleQuery = `
      SELECT ?a ?b
      WHERE {
        ?a rdfs:subClassOf ?b .
        ?b rdfs:subClassOf ?a .
        FILTER (?a != ?b)
      }
      LIMIT ${limit}
    `;

    try {
      const lonely = await executeSparql(lonelyQuery);
      const cycles = await executeSparql(cycleQuery);

      await logUsage("suggest_improvements", { limit }, "Success");
      return {
        content: [{
          type: "text", text: JSON.stringify({
            possible_cycles: compressSparqlResult(cycles),
            unused_classes: compressSparqlResult(lonely)
          })
        }],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }
);




// ------------------------------------------------------------------
// 5. META-TOOLS (Continuous Improvement)
// ------------------------------------------------------------------

server.tool(
  "preview_distribution",
  "Download and preview the first 10 rows of a distribution (CSV/JSON only). Use this to see actual data.",
  {
    url: z.string().describe("The download URL of the distribution"),
  },
  async ({ url }) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Failed to fetch distribution: ${response.status} ${response.statusText}`);
      }

      const contentType = response.headers.get("content-type") || "";
      const text = await response.text();

      let preview = "";

      if (contentType.includes("json") || url.endsWith(".json")) {
        try {
          const json = JSON.parse(text);
          const array = Array.isArray(json) ? json : (json.results || json.data || [json]);
          preview = JSON.stringify(array.slice(0, 10), null, 2);
        } catch (e) {
          preview = text.slice(0, 2000) + "\n... (truncated)";
        }
      } else {
        // Assume CSV or text
        const lines = text.split("\n").slice(0, 15); // Get a few more to handle headers
        preview = lines.join("\n");
      }

      await logUsage("preview_distribution", { url }, "Success");
      return {
        content: [{ type: "text", text: `Preview of ${url}:\n\n${preview}` }],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "suggest_new_tools",
  "Analyze usage logs to suggest new potential tools based on frequent RAW queries.",
  {},
  async () => {
    if (!existsSync(LOG_FILE)) {
      return { content: [{ type: "text", text: "No usage logs found yet." }] };
    }

    try {
      const data = await readFile(LOG_FILE, "utf-8");
      const lines = data.trim().split("\n");

      // Analyze RAW queries to find frequent patterns
      const rawQueries: string[] = [];

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          if (entry.tool === "query_sparql" && entry.args.query) {
            rawQueries.push(entry.args.query);
          }
        } catch (e) { }
      }

      // Heuristic: Check for common patterns in RAW queries (e.g. "?s a <URI>")
      const typeCounts: Record<string, number> = {};
      const regexType = /\ba\s+<([^>]+)>/g;

      for (const q of rawQueries) {
        let match;
        while ((match = regexType.exec(q)) !== null) {
          const typeUri = match[1];
          typeCounts[typeUri] = (typeCounts[typeUri] || 0) + 1;
        }
      }

      const suggestions = Object.entries(typeCounts)
        .filter(([_, count]) => count >= 2) // Threshold
        .map(([uri, count]) => ({
          type: "New Tool Recommendation",
          reason: `You frequently query for instances of <${uri}> (${count} times).`, // Escaped < and > for markdown safety in my mind, but logic is clean
          suggestion: `Consider adding a specialized tool: list_${uri.split('/').pop()?.toLowerCase()}`
        }));

      if (suggestions.length === 0) {
        return { content: [{ type: "text", text: "No clear patterns found in RAW queries yet to suggest new tools." }] };
      }

      await logUsage("suggest_new_tools", {}, "Success");
      return {
        content: [{ type: "text", text: JSON.stringify(suggestions, null, 2) }],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Error analyzing usage: ${error.message}` }],
        isError: true,
      };
    }
  }
);

// Tool: Analyze Usage (Meta-optimization)
server.tool(
  "analyze_usage",
  "Analyze the server's own usage logs to identify patterns, errors, or frequent queries.",
  {},
  async () => {
    if (!existsSync(LOG_FILE)) {
      return { content: [{ type: "text", text: "No usage logs found yet." }] };
    }

    try {
      const data = await readFile(LOG_FILE, "utf-8");
      const lines = data.trim().split("\n");
      const stats = {
        total_calls: 0,
        tool_usage: {} as Record<string, number>,
        errors: [] as string[],
        recent_timestamps: [] as string[] // Last 5
      };

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          stats.total_calls++;

          // Count tools
          if (entry.tool) {
            stats.tool_usage[entry.tool] = (stats.tool_usage[entry.tool] || 0) + 1;
          }

          // Track errors (heuristic: summary contains "Error")
          if (entry.summary && entry.summary.startsWith("Error")) {
            stats.errors.push(`[${entry.tool}] ${entry.summary}`);
          }

          // Keep recent timestamps
          stats.recent_timestamps.push(entry.timestamp);
        } catch (e) {
          // Ignore parse errors in log
        }
      }

      // Keep only last 5 timestamps
      stats.recent_timestamps = stats.recent_timestamps.slice(-5);

      // Summarize errors (top 5 distinct)
      const distinctErrors = [...new Set(stats.errors)].slice(0, 5);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            total_calls: stats.total_calls,
            tool_breakdown: stats.tool_usage,
            recent_errors: distinctErrors,
            last_activity: stats.recent_timestamps.pop()
          }, null, 2)
        }],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Error analyzing logs: ${error.message}` }],
        isError: true,
      };
    }
  }
);


async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Schema.gov.it MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
