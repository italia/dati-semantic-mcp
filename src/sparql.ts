import { Store as OxStore } from "oxigraph";
import type { Term as OxTerm } from "oxigraph";
import type { SparqlResult, SparqlBinding, SparqlBindingValue, CompressedResult, CompressedSimple } from "./types.js";
import { PREFIXES, ENDPOINT } from "./constants.js";

const BROWSER_LIKE_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";
export type LabelLang = "it" | "en" | "any";

// Sanitize string literals for safe SPARQL interpolation
export function sanitizeSparqlString(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

// Sanitize URIs for safe SPARQL interpolation (only allow valid URI characters)
export function sanitizeSparqlUri(input: string): string {
  if (!/^https?:\/\/[^\s<>"{}|\\^`]+$/.test(input)) {
    throw new Error(`Invalid URI: ${input}`);
  }
  return input;
}

export function buildLangFilter(variable: string, lang: LabelLang, includeEmpty: boolean = true): string {
  if (lang === "any") return "";
  return `FILTER(LANG(${variable}) = "${lang}"${includeEmpty ? ` || LANG(${variable}) = ""` : ""})`;
}

/** Build a diagnostic error message from a failed SPARQL HTTP response */
export function buildSparqlDiagnosticMessage(
  status: number,
  statusText: string,
  body: string
): string {
  const preview = body.slice(0, 400).trim();

  if (/timeout|time.?limit|time limit exceeded/i.test(body)) {
    return `SPARQL endpoint timeout (HTTP ${status}). The query exceeded the server time limit. Suggestion: add LIMIT, simplify OPTIONAL/UNION blocks, or split into smaller queries.`;
  }
  if (/result.?set.?too.?large|too many results|maxRows/i.test(body)) {
    return `SPARQL result set too large (HTTP ${status}). Suggestion: add a LIMIT clause or narrow your filters.`;
  }
  if (/undefined.?prefix|unknown.?prefix|undefined.?namespace|QName/i.test(body)) {
    return `SPARQL prefix not defined (HTTP ${status}). Check that all namespace prefixes used in the query are declared.${preview ? ` Details: ${preview}` : ""}`;
  }
  if (/syntax.?error|parse.?error|lexical.?error|unexpected token/i.test(body)) {
    return `SPARQL syntax error (HTTP ${status}). Check query syntax.${preview ? ` Details: ${preview}` : ""}`;
  }
  if (status === 503 || /service.?unavailable|temporarily unavailable/i.test(body)) {
    return `SPARQL endpoint temporarily unavailable (HTTP ${status}). Retry later.`;
  }
  if (status === 500) {
    return `SPARQL internal server error (HTTP 500).${preview ? ` Details: ${preview}` : " No error details available from endpoint."}`;
  }

  return `SPARQL request failed: ${status} ${statusText}${preview ? `. Details: ${preview}` : ""}`;
}

export async function executeSparql(
  query: string,
  endpoint: string = ENDPOINT,
  injectPrefixes: boolean = true,
  timeoutMs: number = 30000
): Promise<SparqlResult> {
  const fullQuery = injectPrefixes ? PREFIXES + "\n" + query : query;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const isExternalEndpoint = endpoint !== ENDPOINT;
  const baseHeaders: Record<string, string> = {
    "Accept": "application/sparql-results+json",
  };

  if (isExternalEndpoint) {
    baseHeaders["User-Agent"] = BROWSER_LIKE_USER_AGENT;
    baseHeaders["Accept-Language"] = "it-IT,it;q=0.9,en;q=0.8";
  }

  try {
    const postResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        ...baseHeaders,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ query: fullQuery }),
      signal: controller.signal,
    });

    if (postResponse.ok) {
      return postResponse.json() as Promise<SparqlResult>;
    }

    // Some public endpoints behind proxies/WAFs reject POST from API clients
    // but accept browser-like GET requests for the same SPARQL query.
    if (isExternalEndpoint && postResponse.status === 403) {
      const getUrl = new URL(endpoint);
      getUrl.searchParams.set("query", fullQuery);

      const getResponse = await fetch(getUrl.toString(), {
        method: "GET",
        headers: baseHeaders,
        signal: controller.signal,
      });

      if (getResponse.ok) {
        return getResponse.json() as Promise<SparqlResult>;
      }

      const getErrBody = await getResponse.text().catch(() => "");
      throw new Error(buildSparqlDiagnosticMessage(getResponse.status, getResponse.statusText, getErrBody));
    }

    const postErrBody = await postResponse.text().catch(() => "");
    throw new Error(buildSparqlDiagnosticMessage(postResponse.status, postResponse.statusText, postErrBody));
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `SPARQL timeout after ${timeoutMs}ms${endpoint !== ENDPOINT ? ` (endpoint: ${endpoint})` : ""}. ` +
        `Suggestion: add LIMIT, simplify OPTIONAL/UNION blocks, or split into smaller queries.`
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

// =============================================================================
// RESULT COMPRESSION
// =============================================================================

/** Compress SPARQL results for token efficiency */
export function compressSparqlResult(result: SparqlResult): CompressedResult {
  if (!result?.results?.bindings) return [];

  const bindings = result.results.bindings;
  if (bindings.length === 0) return [];

  // Optimization: For lists > 5 items, return tabular format to save tokens on repeated keys
  if (bindings.length > 5) {
    const firstBinding = bindings[0];
    const headers = result.head?.vars || (firstBinding ? Object.keys(firstBinding) : []);
    const rows = bindings.map((b: SparqlBinding) => {
      return headers.map((h: string) => b[h]?.value ?? null);
    });
    return { headers, rows };
  }

  // Standard compact format for small results
  const simplified: CompressedSimple = bindings.map((binding: SparqlBinding) => {
    const row: Record<string, string> = {};
    for (const key in binding) {
      if (Object.prototype.hasOwnProperty.call(binding, key)) {
        const bindingValue = binding[key];
        if (bindingValue) {
          row[key] = bindingValue.value;
        }
      }
    }
    return row;
  });

  return simplified;
}

export function oxTermToBindingValue(term: OxTerm): SparqlBindingValue {
  if (term.termType === "NamedNode") return { type: "uri", value: term.value };
  if (term.termType === "BlankNode") return { type: "bnode", value: term.value };
  if (term.termType === "Literal") {
    const bv: SparqlBindingValue = { type: "literal", value: term.value };
    if (term.language) bv["xml:lang"] = term.language;
    if (term.datatype) bv.datatype = term.datatype.value;
    return bv;
  }
  return { type: "literal", value: term.value };
}

export function oxSelectToSparqlResult(rows: Map<string, OxTerm>[]): SparqlResult {
  const firstRow = rows[0];
  const vars = firstRow ? Array.from(firstRow.keys()) : [];
  const bindings: SparqlBinding[] = rows.map(row => {
    const b: SparqlBinding = {};
    for (const [k, v] of row.entries()) {
      if (v !== undefined) b[k] = oxTermToBindingValue(v);
    }
    return b;
  });
  return { head: { vars }, results: { bindings } };
}

export function runLocalSparql(store: OxStore, query: string, injectPrefixes = true): SparqlResult {
  const fullQuery = injectPrefixes ? PREFIXES + "\n" + query : query;
  const raw = store.query(fullQuery, { use_default_graph_as_union: true });
  if (!Array.isArray(raw)) {
    return { head: { vars: [] }, results: { bindings: [] } };
  }
  return oxSelectToSparqlResult(raw as Map<string, OxTerm>[]);
}
