import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { executeTool, executeSparqlTool } from "../executor.js";
import { sanitizeSparqlString, executeSparql, compressSparqlResult, buildLangFilter } from "../sparql.js";

// -----------------------------------------------------------------------------
// GROUP I: OntoPiA Territorial Tools
// -----------------------------------------------------------------------------

export function registerGroupI(server: McpServer): void {

server.registerTool(
  "resolve_territorial_uri",
  {
    title: "Resolve Territorial URI",
    description: `Resolve an Italian territorial code to its canonical CLV URI with labels and related URIs.

**Args:**
- code_type: Type of code: "istat-comune", "istat-provincia", "istat-regione", or "belfiore"
- code: The code value (e.g. "046030" for ISTAT comune, "F205" for Belfiore)
- date: (optional) ISO date string (e.g. "2022-08-12") — noted in output, full temporal filtering not yet implemented

**Returns:**
- uri: canonical CLV URI
- name: official name
- code_type and code
- related: connected territorial URIs (province for cities, region for provinces)
- date_note: reminder if date was provided

**Use when:** You have a raw territorial code (ISTAT or Belfiore) and need the official semantic URI to use in JSON-LD or RDF modeling.`,
    inputSchema: {
      code_type: z.enum(["istat-comune", "istat-provincia", "istat-regione", "belfiore"]).describe("Type of territorial code"),
      code: z.string().describe("The code value (e.g. '046030', 'F205', '001')"),
      date: z.string().optional().describe("Optional ISO date for temporal context (e.g. '2022-08-12')"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ code_type, code, date }) => {
    const safeCode = sanitizeSparqlString(code);

    return executeTool<unknown>("resolve_territorial_uri", { code_type, code, date }, async () => {
      let mainQuery: string;

      if (code_type === "istat-comune") {
        mainQuery = `
          SELECT DISTINCT ?uri ?name WHERE {
            ?uri a clv:City ;
                 skos:notation "${safeCode}" ;
                 l0:name ?name .
          }
          LIMIT 5
        `;
      } else if (code_type === "istat-provincia") {
        mainQuery = `
          SELECT DISTINCT ?uri ?name WHERE {
            ?uri a clv:Province ;
                 skos:notation "${safeCode}" ;
                 l0:name ?name .
          }
          LIMIT 5
        `;
      } else if (code_type === "istat-regione") {
        mainQuery = `
          SELECT DISTINCT ?uri ?name WHERE {
            ?uri a clv:Region ;
                 skos:notation "${safeCode}" ;
                 l0:name ?name .
          }
          LIMIT 5
        `;
      } else {
        mainQuery = `
          SELECT DISTINCT ?uri ?name WHERE {
            ?uri clv:hasIdentifier ?id .
            FILTER(CONTAINS(STR(?id), "/cadastral-code/${safeCode}"))
            OPTIONAL { ?uri l0:name ?name }
            OPTIONAL { ?uri rdfs:label ?name }
          }
          LIMIT 5
        `;
      }

      const mainResult = await executeSparql(mainQuery);
      const mainBindings = mainResult.results?.bindings ?? [];

      if (mainBindings.length === 0) {
        return {
          success: true,
          data: {
            found: false,
            code_type,
            code,
            message: `No result found for ${code_type} = "${code}". Check code format (e.g. ISTAT comune codes are 6 digits like "046030").`,
          },
        };
      }

      const seen = new Map<string, string>();
      for (const b of mainBindings) {
        const uri = b.uri?.value ?? "";
        const name = b.name?.value ?? "";
        const existing = seen.get(uri);
        if (!existing || name.length > existing.length) seen.set(uri, name);
      }
      const primaryUri = seen.keys().next().value ?? "";
      const primaryName = seen.get(primaryUri) ?? "";

      let relatedQuery: string | null = null;
      if (code_type === "istat-comune") {
        relatedQuery = `
          SELECT DISTINCT ?related ?relatedName ?relatedCode ?relatedType WHERE {
            ?city a clv:City ; skos:notation "${safeCode}" .
            ?city ?p ?related .
            ?related a ?relatedType .
            VALUES ?relatedType { clv:Province clv:Region }
            OPTIONAL { ?related l0:name ?relatedName }
            OPTIONAL { ?related skos:notation ?relatedCode }
          }
          LIMIT 5
        `;
      } else if (code_type === "istat-provincia") {
        relatedQuery = `
          SELECT DISTINCT ?related ?relatedName ?relatedCode ?relatedType WHERE {
            ?prov a clv:Province ; skos:notation "${safeCode}" .
            ?prov ?p ?related .
            ?related a ?relatedType .
            VALUES ?relatedType { clv:Region }
            OPTIONAL { ?related l0:name ?relatedName }
            OPTIONAL { ?related skos:notation ?relatedCode }
          }
          LIMIT 3
        `;
      }

      const related: Array<{ uri: string; name: string; code: string; type: string }> = [];
      if (relatedQuery) {
        const relatedResult = await executeSparql(relatedQuery);
        for (const b of relatedResult.results?.bindings ?? []) {
          related.push({
            uri: b.related?.value ?? "",
            name: b.relatedName?.value ?? "",
            code: b.relatedCode?.value ?? "",
            type: (b.relatedType?.value ?? "").split("/").pop() ?? "",
          });
        }
      }

      return {
        success: true,
        data: {
          found: true,
          code_type,
          code,
          uri: primaryUri,
          name: primaryName,
          related,
          ...(date ? { date_note: `Date "${date}" was provided. Full temporal filtering is not yet implemented; results may include historical or future entities.` } : {}),
        },
      };
    });
  }
);

server.registerTool(
  "list_municipalities",
  {
    title: "List Municipalities",
    description: `Browse Italian municipalities (comuni) with their codes.

**Args:**
- limit: Items per page (default: 50, max: 500)
- offset: Items to skip (default: 0)
- keyword: (optional) Filter by name (case-insensitive)
- withBelfiore: (optional) If true, include Belfiore/cadastral codes via URI extraction (slower)
- lang: "it" | "en" | "any" (default: "any")

**Returns:**
- municipalities: List of cities with ISTAT code, name, and optionally Belfiore code
- pagination: Total count, offset, has_more

**Note:** Uses BIND+REPLACE URI extraction for Belfiore codes to avoid Virtuoso timeout on identifierType joins.
Each ISTAT code may appear with multiple historical names; results are deduplicated by notation.`,
    inputSchema: {
      limit: z.number().optional().default(50).describe("Items per page (max 500)"),
      offset: z.number().optional().default(0).describe("Items to skip"),
      keyword: z.string().optional().describe("Filter by municipality name"),
      withBelfiore: z.boolean().optional().default(false).describe("Include Belfiore/cadastral codes"),
      lang: z.enum(["it", "en", "any"]).optional().default("any").describe('Preferred name language; "any" keeps all languages.'),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ limit, offset, keyword, withBelfiore, lang }) => {
    const safeLimit = Math.min(limit, 500);
    const nameLangFilter = buildLangFilter("?name", lang);
    const keywordFilter = keyword
      ? `FILTER(REGEX(?name, "${sanitizeSparqlString(keyword)}", "i"))`
      : "";

    if (withBelfiore) {
      // Two parallel queries: names + Belfiore codes, joined client-side
      const namesQuery = `
        SELECT DISTINCT ?notation ?name
        WHERE {
          ?city a clv:City ;
                skos:notation ?notation ;
                l0:name ?name .
          ${nameLangFilter}
          ${keywordFilter}
        }
        ORDER BY ?notation
        LIMIT ${safeLimit}
        OFFSET ${offset}
      `;
      const belfioreQuery = `
        SELECT DISTINCT ?notation ?belfiore
        WHERE {
          ?city skos:notation ?notation ;
                clv:hasIdentifier ?id .
          BIND(REPLACE(STR(?id), ".*cadastral-code/", "") AS ?belfiore)
          FILTER(CONTAINS(STR(?id), "cadastral-code/"))
        }
        ORDER BY ?notation
        LIMIT ${safeLimit}
        OFFSET ${offset}
      `;
      const countQuery = `
        SELECT (COUNT(DISTINCT ?notation) AS ?total)
        WHERE {
          ?city a clv:City ; skos:notation ?notation .
          ${keyword ? `?city l0:name ?name . ${nameLangFilter} ${keywordFilter}` : ""}
        }
      `;

      return executeTool("list_municipalities", { limit: safeLimit, offset, keyword, withBelfiore, lang }, async () => {
        const [namesResult, belfioreResult, countResult] = await Promise.all([
          executeSparql(namesQuery),
          executeSparql(belfioreQuery),
          executeSparql(countQuery),
        ]);

        // Build Belfiore lookup: notation -> belfiore
        const belfioreLookup: Record<string, string> = {};
        for (const b of belfioreResult.results?.bindings ?? []) {
          const notation = b.notation?.value;
          const belfiore = b.belfiore?.value;
          if (notation && belfiore) {
            belfioreLookup[notation] = belfiore;
          }
        }

        // Deduplicate names: pick longest name per notation
        const cityMap: Record<string, { notation: string; name: string; belfiore?: string }> = {};
        for (const row of namesResult.results?.bindings ?? []) {
          const notation = row.notation?.value;
          const name = row.name?.value;
          if (!notation || !name) continue;
          const existing = cityMap[notation];
          if (!existing || name.length > existing.name.length) {
            cityMap[notation] = {
              notation,
              name,
              ...(belfioreLookup[notation] ? { belfiore: belfioreLookup[notation] } : {}),
            };
          }
        }

        const municipalities = Object.values(cityMap).sort((a, b) => a.notation.localeCompare(b.notation));
        const total = parseInt(countResult.results?.bindings?.[0]?.total?.value ?? "0", 10);
        const count = municipalities.length;

        return {
          success: true,
          data: {
            municipalities: count > 5
              ? { headers: ["notation", "name", "belfiore"], rows: municipalities.map(m => [m.notation, m.name, m.belfiore ?? null]) }
              : municipalities,
            pagination: { total, count, offset, has_more: offset + safeLimit < total, next_offset: offset + safeLimit < total ? offset + safeLimit : null },
          },
          rowCount: count,
        };
      });
    }

    // Simple mode: just names and notations
    const dataQuery = `
      SELECT DISTINCT ?notation ?name
      WHERE {
        ?city a clv:City ;
              skos:notation ?notation ;
              l0:name ?name .
        ${nameLangFilter}
        ${keywordFilter}
      }
      ORDER BY ?notation
      LIMIT ${safeLimit}
      OFFSET ${offset}
    `;
    const countQuery = `
      SELECT (COUNT(DISTINCT ?notation) AS ?total)
      WHERE {
        ?city a clv:City ; skos:notation ?notation .
        ${keyword ? `?city l0:name ?name . ${nameLangFilter} ${keywordFilter}` : ""}
      }
    `;

    return executeTool("list_municipalities", { limit: safeLimit, offset, keyword, withBelfiore, lang }, async () => {
      const [dataResult, countResult] = await Promise.all([
        executeSparql(dataQuery),
        executeSparql(countQuery),
      ]);

      const municipalities = compressSparqlResult(dataResult);
      const count = dataResult.results?.bindings?.length ?? 0;
      const total = parseInt(countResult.results?.bindings?.[0]?.total?.value ?? "0", 10);

      return {
        success: true,
        data: {
          municipalities,
          pagination: { total, count, offset, has_more: offset + count < total, next_offset: offset + count < total ? offset + count : null },
        },
        rowCount: count,
      };
    });
  }
);


server.registerTool(
  "list_provinces",
  {
    title: "List Provinces",
    description: `List Italian provinces with their codes (ISTAT, car plate, metropolitan city).

**Args:**
- keyword: (optional) Filter by province name (case-insensitive)
- lang: "it" | "en" | "any" (default: "any")

**Returns:**
- List of provinces with notation (ISTAT code), name, sigla (car plate), and metro code (if metropolitan city)

**Note:** Runs 3 parallel queries for names, car plates, and metro codes, then joins client-side.
There are ~107 provinces, 14 of which are metropolitan cities.`,
    inputSchema: {
      keyword: z.string().optional().describe("Filter by province name"),
      lang: z.enum(["it", "en", "any"]).optional().default("any").describe('Preferred name language; "any" keeps all languages.'),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ keyword, lang }) => {
    const nameLangFilter = buildLangFilter("?name", lang);
    const keywordFilter = keyword
      ? `FILTER(REGEX(?name, "${sanitizeSparqlString(keyword)}", "i"))`
      : "";

    const namesQuery = `
      SELECT DISTINCT ?notation ?name
      WHERE {
        ?prov a clv:Province ;
              skos:notation ?notation ;
              l0:name ?name .
        ${nameLangFilter}
        ${keywordFilter}
      }
      ORDER BY ?notation
    `;
    const siglaQuery = `
      SELECT DISTINCT ?notation ?sigla
      WHERE {
        ?prov skos:notation ?notation ;
              clv:hasIdentifier ?id .
        BIND(REPLACE(STR(?id), ".*vehicle-code/", "") AS ?sigla)
        FILTER(CONTAINS(STR(?id), "vehicle-code/"))
      }
      ORDER BY ?notation
    `;
    const metroQuery = `
      SELECT DISTINCT ?notation ?metro
      WHERE {
        ?prov skos:notation ?notation ;
              clv:hasIdentifier ?id .
        BIND(REPLACE(STR(?id), ".*metropolitan-city-code/", "") AS ?metro)
        FILTER(CONTAINS(STR(?id), "metropolitan-city-code/"))
      }
      ORDER BY ?notation
    `;

    return executeTool("list_provinces", { keyword, lang }, async () => {
      const [namesResult, siglaResult, metroResult] = await Promise.all([
        executeSparql(namesQuery),
        executeSparql(siglaQuery),
        executeSparql(metroQuery),
      ]);

      // Build lookups
      const siglaLookup: Record<string, string> = {};
      for (const b of siglaResult.results?.bindings ?? []) {
        const n = b.notation?.value;
        const s = b.sigla?.value;
        if (n && s) siglaLookup[n] = s;
      }

      const metroLookup: Record<string, string> = {};
      for (const b of metroResult.results?.bindings ?? []) {
        const n = b.notation?.value;
        const m = b.metro?.value;
        if (n && m) metroLookup[n] = m;
      }

      // Build province list, deduplicate names (pick longest)
      const provMap: Record<string, { notation: string; name: string; sigla: string | null; metro: string | null }> = {};
      for (const row of namesResult.results?.bindings ?? []) {
        const notation = row.notation?.value;
        const name = row.name?.value;
        if (!notation || !name) continue;
        const existing = provMap[notation];
        if (!existing || name.length > existing.name.length) {
          provMap[notation] = {
            notation,
            name,
            sigla: siglaLookup[notation] ?? null,
            metro: metroLookup[notation] ?? null,
          };
        }
      }

      const provinces = Object.values(provMap).sort((a, b) => a.notation.localeCompare(b.notation));
      const count = provinces.length;

      return {
        success: true,
        data: count > 5
          ? { headers: ["notation", "name", "sigla", "metro"], rows: provinces.map(p => [p.notation, p.name, p.sigla, p.metro]) }
          : provinces,
        rowCount: count,
      };
    });
  }
);


server.registerTool(
  "list_identifiers",
  {
    title: "List Identifiers",
    description: `List CLV Identifier resources by type, with counts and sample values.

**Args:**
- identifierType: (optional) Filter by identifier type string (e.g. "Codice Catastale", "Sigla Automobilistica")
- limit: Maximum results (default: 20)

**Returns:**
- If no identifierType: Summary of all identifier types with counts
- If identifierType provided: Sample identifiers of that type with their values and linked entities

**Use when:** Exploring the clv:Identifier resources and their identifierType values in the triplestore.`,
    inputSchema: {
      identifierType: z.string().optional().describe('Filter by type (e.g. "Codice Catastale")'),
      limit: z.number().optional().default(20).describe("Maximum results"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ identifierType, limit }) => {
    if (!identifierType) {
      // Summary mode: count by type
      const query = `
        SELECT ?type (COUNT(*) AS ?count)
        WHERE {
          ?id a clv:Identifier ;
              clv:identifierType ?type .
        }
        GROUP BY ?type
        ORDER BY DESC(?count)
      `;
      return executeSparqlTool("list_identifiers", { identifierType, limit }, query);
    }

    // Detail mode: sample identifiers of specific type
    const safeType = sanitizeSparqlString(identifierType);
    const query = `
      SELECT ?id ?value ?entity
      WHERE {
        ?id a clv:Identifier ;
            clv:identifierType "${safeType}" ;
            l0:identifier ?value .
        OPTIONAL { ?entity clv:hasIdentifier ?id }
      }
      LIMIT ${limit}
    `;
    return executeSparqlTool("list_identifiers", { identifierType, limit }, query);
  }
);

}
