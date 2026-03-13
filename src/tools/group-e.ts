import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { executeTool } from "../executor.js";
import { sanitizeSparqlUri, executeSparql, compressSparqlResult } from "../sparql.js";

// -----------------------------------------------------------------------------
// GROUP E: Dataset Tools
// -----------------------------------------------------------------------------

export function registerGroupE(server: McpServer): void {

server.registerTool(
  "list_datasets",
  {
    title: "List Datasets",
    description: `List available Datasets (dcatapit:Dataset) in the catalog.

Use this when you explicitly need DCAT-AP_IT dataset records. On schema.gov.it, these are often semantic assets such as ontologies, controlled vocabularies, and related distributions rather than classic tabular datasets, so ontology/vocabulary/SPARQL tools are usually a better starting point.

**Args:**
- limit: Maximum datasets per page (default: 20)
- offset: Number of datasets to skip (default: 0)

**Returns:**
- items: List of datasets with labels
- pagination: Metadata with count, offset, has_more, next_offset`,
    inputSchema: {
      limit: z.number().optional().default(20),
      offset: z.number().optional().default(0),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ limit, offset }) => {
    const dataQuery = `
      SELECT DISTINCT ?dataset ?label
      WHERE {
        ?dataset a <http://dati.gov.it/onto/dcatapit#Dataset> .
        OPTIONAL { ?dataset dct:title ?label }
      }
      ORDER BY ?label
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    const countQuery = `
      SELECT (COUNT(DISTINCT ?dataset) AS ?total)
      WHERE {
        ?dataset a <http://dati.gov.it/onto/dcatapit#Dataset> .
      }
    `;

    return executeTool("list_datasets", { limit, offset }, async () => {
      const [dataResult, countResult] = await Promise.all([
        executeSparql(dataQuery),
        executeSparql(countQuery),
      ]);

      const items = compressSparqlResult(dataResult);
      const count = dataResult.results?.bindings?.length ?? 0;
      const total = parseInt(countResult.results?.bindings?.[0]?.total?.value ?? "0", 10);

      return {
        success: true,
        data: {
          items,
          pagination: {
            total,
            count,
            offset,
            has_more: offset + count < total,
            next_offset: offset + count < total ? offset + count : null,
          },
        },
        rowCount: count,
        sourceData: {
          dataResult,
          countResult,
        },
      };
    });
  }
);

server.registerTool(
  "explore_dataset",
  {
    title: "Explore Dataset",
    description: `Get details of a specific Dataset including metadata and distributions.

Use this for targeted DCAT-AP_IT inspection. On schema.gov.it, many datasets describe semantic assets, so this tool is usually secondary to ontology, vocabulary, class/property, and SPARQL exploration.

**Args:**
- datasetUri: URI of the dataset to explore

**Returns:**
- metadata: Dataset properties (literals and distribution references)
- distributions: List of distributions with format and download URLs

**Note:** Both queries run in parallel for performance.`,
    inputSchema: {
      datasetUri: z.string().describe("The URI of the Dataset"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ datasetUri }) => {
    const safeUri = sanitizeSparqlUri(datasetUri);
    const metadataQuery = `
      SELECT ?p ?o
      WHERE {
        <${safeUri}> ?p ?o .
        FILTER (ISLITERAL(?o) || (ISURI(?o) && EXISTS { ?o a <http://dati.gov.it/onto/dcatapit#Distribution> }))
      }
      LIMIT 100
    `;

    const distQuery = `
      SELECT ?dist ?format ?url
      WHERE {
        ?dist a <http://dati.gov.it/onto/dcatapit#Distribution> .
        { <${safeUri}> dcat:distribution ?dist } UNION { ?dist isDistributionOf <${safeUri}> } .
        OPTIONAL { ?dist dct:format ?format }
        OPTIONAL { ?dist dcat:downloadURL ?url }
      }
      LIMIT 20
    `;

    return executeTool("explore_dataset", { datasetUri }, async () => {
      const [details, distributions] = await Promise.all([
        executeSparql(metadataQuery),
        executeSparql(distQuery),
      ]);

      return {
        success: true,
        data: {
          metadata: compressSparqlResult(details),
          distributions: compressSparqlResult(distributions),
        },
        sourceData: {
          metadata: details,
          distributions,
        },
        rowCount: (details.results?.bindings?.length ?? 0) +
          (distributions.results?.bindings?.length ?? 0),
      };
    });
  }
);

server.registerTool(
  "preview_distribution",
  {
    title: "Preview Distribution",
    description: `Download and preview the first rows of a distribution file.

Most useful after you already identified a concrete distribution URL. On schema.gov.it, distributions often belong to semantic assets rather than classic tabular datasets.

**Args:**
- url: Download URL of the distribution (CSV or JSON)

**Returns:**
- Preview of first 10-15 rows/items of data

**Supported formats:** CSV, JSON (auto-detected by content-type or extension)
**Timeout:** 10 seconds`,
    inputSchema: {
      url: z.string().describe("The download URL of the distribution"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ url }) => {
    return executeTool("preview_distribution", { url }, async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) {
          return {
            success: false,
            error: `Failed to fetch distribution: ${response.status} ${response.statusText}`,
          };
        }

        const contentType = response.headers.get("content-type") || "";
        const text = await response.text();

        let preview = "";

        if (contentType.includes("json") || url.endsWith(".json")) {
          try {
            const json = JSON.parse(text) as unknown;
            const jsonObj = json as Record<string, unknown>;
            const array = Array.isArray(json) ? json : (jsonObj.results || jsonObj.data || [json]);
            preview = JSON.stringify((array as unknown[]).slice(0, 10), null, 2);
          } catch {
            preview = text.slice(0, 2000) + "\n... (truncated)";
          }
        } else {
          const lines = text.split("\n").slice(0, 15);
          preview = lines.join("\n");
        }

        return {
          success: true,
          data: `Preview of ${url}:\n\n${preview}`,
          sourceData: {
            url,
            contentType,
            bodyPreview: text.slice(0, 4000),
          },
        };
      } finally {
        clearTimeout(timeoutId);
      }
    });
  }
);

}
