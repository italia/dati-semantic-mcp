import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { executeSparqlTool } from "../executor.js";
import { sanitizeSparqlUri } from "../sparql.js";

// -----------------------------------------------------------------------------
// GROUP B: Analytics Tools
// -----------------------------------------------------------------------------

export function registerGroupB(server: McpServer): void {

server.registerTool(
  "check_coverage",
  {
    title: "Check Coverage",
    description: `Analyze usage coverage of a specific class or property, or get global stats.

**Args:**
- targetUri: (optional) URI of class or property to check

**Returns:**
- If targetUri provided: instance count and properties used
- If no targetUri: top 50 types by instance count

**Examples:**
- No args: Global coverage statistics
- targetUri="http://...#Person": Coverage for Person class

**How to interpret the two modes:**
- without \`targetUri\` = heatmap of the catalog, useful to see which types are most used overall
- with \`targetUri\` = targeted coverage analysis for one URI`,
    inputSchema: {
      targetUri: z.string().optional().describe("URI of class or property to check coverage for"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ targetUri }) => {
    let query: string;
    if (targetUri) {
      const safeUri = sanitizeSparqlUri(targetUri);
      query = `
        SELECT (COUNT(DISTINCT ?s) AS ?instances) (COUNT(DISTINCT ?p) AS ?propertiesUsed)
        WHERE {
            { ?s a <${safeUri}> }
            UNION
            { ?s <${safeUri}> ?o }
            UNION
            { ?sub <${safeUri}> ?obj }
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
    return executeSparqlTool("check_coverage", { targetUri }, query);
  }
);

server.registerTool(
  "check_quality",
  {
    title: "Check Quality",
    description: `Verify quality issues like missing labels or descriptions.

**Args:**
- limit: Maximum results to return (default: 50)

**Returns:**
- List of resources missing rdfs:label or skos:prefLabel

**Note:** Checks owl:Class, owl:ObjectProperty, owl:DatatypeProperty, and skos:Concept.`,
    inputSchema: {
      limit: z.number().optional().default(50),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
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
    return executeSparqlTool("check_quality", { limit }, query);
  }
);

server.registerTool(
  "check_overlaps",
  {
    title: "Check Overlaps",
    description: `Identify potential overlaps (same labels) or explicit mappings.

**Args:**
- limit: Maximum results to return (default: 50)

**Returns:**
- List of potential overlaps with relation type:
  - owl:sameAs mappings
  - skos:exactMatch mappings
  - Same Label collisions`,
    inputSchema: {
      limit: z.number().optional().default(50),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ limit }) => {
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
    return executeSparqlTool("check_overlaps", { limit }, query);
  }
);

}
