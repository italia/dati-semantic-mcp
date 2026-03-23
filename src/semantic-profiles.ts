import { buildLangFilter, compressSparqlResult } from "./sparql.js";
import type { CompressedResult, SparqlResult } from "./types.js";
import type { LabelLang } from "./sparql.js";

export type ProfileMode = "raw" | "effective";
export type QueryExecutor = (query: string) => Promise<SparqlResult>;

export interface PropertySuperInfo {
  uri: string;
  label: string;
  domains: string[];
  ranges: string[];
  source?: string;
}

export interface PropertyInheritanceDomain {
  ancestor: string;
  ancestorLabel: string;
  domain: string;
  source?: string;
}

export interface PropertyInheritanceRange {
  ancestor: string;
  ancestorLabel: string;
  range: string;
  source?: string;
}

interface AnalysisEntry {
  value: string;
  status: "redundant" | "specialization" | "new";
  inherited_match?: string;
  specializes?: string[];
}

export function buildConceptProfileQueries(uri: string, mode: ProfileMode, lang: LabelLang = "any"): Record<string, string> {
  const literalFilter = lang === "any"
    ? "FILTER(ISLITERAL(?o))"
    : `FILTER(ISLITERAL(?o) && (LANG(?o) = "${lang}" || LANG(?o) = ""))`;
  const parentLabelFilter = buildLangFilter("?parentLabel", lang);
  const childLabelFilter = buildLangFilter("?childLabel", lang);
  const propLabelFilter = buildLangFilter("?propLabel", lang);
  const rangeLabelFilter = buildLangFilter("?rangeLabel", lang);
  const ancestorLabelFilter = buildLangFilter("?ancestorLabel", lang);
  const baseQueries: Record<string, string> = {
    definition: `
      SELECT ?p ?o WHERE { <${uri}> ?p ?o . ${literalFilter} }
    `,
    hierarchy: `
      SELECT ?type ?parent ?parentLabel ?child ?childLabel WHERE {
        { <${uri}> a ?type }
        UNION
        { <${uri}> rdfs:subClassOf|skos:broader ?parent .
          OPTIONAL { ?parent rdfs:label|skos:prefLabel ?parentLabel . ${parentLabelFilter} }
        }
        UNION
        { ?child rdfs:subClassOf|skos:broader <${uri}> .
          OPTIONAL { ?child rdfs:label|skos:prefLabel ?childLabel . ${childLabelFilter} }
        }
      } LIMIT 50
    `,
    usage: `
      SELECT (COUNT(?s) AS ?instanceCount) WHERE { ?s a <${uri}> }
    `,
    own_properties: `
      SELECT DISTINCT ?prop ?propType ?propLabel ?range ?rangeLabel WHERE {
        ?prop rdfs:domain <${uri}> .
        OPTIONAL { ?prop a ?propType . VALUES ?propType { owl:ObjectProperty owl:DatatypeProperty owl:AnnotationProperty } }
        OPTIONAL { ?prop rdfs:label ?propLabel . ${propLabelFilter} }
        OPTIONAL { ?prop rdfs:range ?range }
        OPTIONAL { ?range rdfs:label|skos:prefLabel ?rangeLabel . ${rangeLabelFilter} }
      }
      ORDER BY ?prop
      LIMIT 50
    `,
  };

  if (mode === "raw") {
    return baseQueries;
  }

  return {
    ...baseQueries,
    inherited_properties: `
      SELECT DISTINCT ?ancestor ?ancestorLabel ?prop ?propType ?propLabel ?range ?rangeLabel WHERE {
        <${uri}> rdfs:subClassOf+|skos:broader+ ?ancestor .
        FILTER(isIRI(?ancestor))
        ?prop rdfs:domain ?ancestor .
        OPTIONAL { ?prop a ?propType . VALUES ?propType { owl:ObjectProperty owl:DatatypeProperty owl:AnnotationProperty } }
        OPTIONAL { ?prop rdfs:label ?propLabel . ${propLabelFilter} }
        OPTIONAL { ?prop rdfs:range ?range }
        OPTIONAL { ?range rdfs:label|skos:prefLabel ?rangeLabel . ${rangeLabelFilter} }
        OPTIONAL { ?ancestor rdfs:label|skos:prefLabel ?ancestorLabel . ${ancestorLabelFilter} }
      }
      ORDER BY ?ancestor ?prop
      LIMIT 100
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
    `,
  };
}

export async function executeNamedQueries(
  queries: Record<string, string>,
  execute: QueryExecutor
): Promise<{ results: Record<string, CompressedResult>; totalRows: number }> {
  const { results: rawResults, totalRows } = await executeNamedQueryResults(queries, execute);
  const results: Record<string, CompressedResult> = {};
  for (const [name, sparqlResult] of Object.entries(rawResults)) {
    results[name] = compressSparqlResult(sparqlResult);
  }

  return { results, totalRows };
}

export async function executeNamedQueryResults(
  queries: Record<string, string>,
  execute: QueryExecutor
): Promise<{ results: Record<string, SparqlResult>; totalRows: number }> {
  const entries = Object.entries(queries);
  const sparqlResults = await Promise.all(entries.map(([, query]) => execute(query)));

  const results: Record<string, SparqlResult> = {};
  let totalRows = 0;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const sparqlResult = sparqlResults[i];
    if (!entry || !sparqlResult) continue;
    results[entry[0]] = sparqlResult;
    totalRows += sparqlResult.results?.bindings?.length ?? 0;
  }

  return { results, totalRows };
}

export function buildPropertyDefinitionQuery(uri: string): string {
  return `
    SELECT ?p ?o
    WHERE {
      <${uri}> ?p ?o .
      FILTER(?p IN (
        rdf:type,
        rdfs:label,
        rdfs:comment,
        rdfs:domain,
        rdfs:range,
        rdfs:subPropertyOf,
        owl:inverseOf,
        owl:equivalentProperty
      ) || ?p = rdf:type && ?o IN (owl:FunctionalProperty, owl:InverseFunctionalProperty, owl:SymmetricProperty, owl:TransitiveProperty))
    }
  `;
}

export function buildPropertySuperQuery(uri: string, limit?: number): string {
  return `
    SELECT DISTINCT ?ancestor ?ancestorLabel ?domain ?range WHERE {
      <${uri}> rdfs:subPropertyOf+ ?ancestor .
      FILTER(isIRI(?ancestor))
      OPTIONAL { ?ancestor rdfs:label ?ancestorLabel . FILTER(LANG(?ancestorLabel) = "" || LANG(?ancestorLabel) = "it") }
      OPTIONAL { ?ancestor rdfs:domain ?domain }
      OPTIONAL { ?ancestor rdfs:range ?range }
    }
    ORDER BY ?ancestor
    ${limit ? `LIMIT ${limit}` : ""}
  `;
}

export function extractAssertedDomainRange(definitionResult: SparqlResult): { assertedDomain: string[]; assertedRange: string[] } {
  const RDFS_DOMAIN = "http://www.w3.org/2000/01/rdf-schema#domain";
  const RDFS_RANGE = "http://www.w3.org/2000/01/rdf-schema#range";
  const assertedDomain: string[] = [];
  const assertedRange: string[] = [];

  for (const binding of definitionResult.results?.bindings ?? []) {
    if (binding.p?.value === RDFS_DOMAIN && binding.o?.value) assertedDomain.push(binding.o.value);
    if (binding.p?.value === RDFS_RANGE && binding.o?.value) assertedRange.push(binding.o.value);
  }

  return { assertedDomain, assertedRange };
}

export function collectPropertySuperMap(result: SparqlResult, source?: string): Map<string, PropertySuperInfo> {
  const superMap = new Map<string, PropertySuperInfo>();
  for (const binding of result.results?.bindings ?? []) {
    const uri = binding.ancestor?.value ?? "";
    if (!uri) continue;
    if (!superMap.has(uri)) {
      superMap.set(uri, { uri, label: "", domains: [], ranges: [], ...(source ? { source } : {}) });
    }
    const info = superMap.get(uri)!;
    if (binding.ancestorLabel?.value && !info.label) info.label = binding.ancestorLabel.value;
    if (binding.domain?.value && !info.domains.includes(binding.domain.value)) info.domains.push(binding.domain.value);
    if (binding.range?.value && !info.ranges.includes(binding.range.value)) info.ranges.push(binding.range.value);
  }
  return superMap;
}

export function buildPropertyInheritance(superMap: Map<string, PropertySuperInfo>): {
  inheritedDomain: PropertyInheritanceDomain[];
  inheritedRange: PropertyInheritanceRange[];
  effectiveDomain: string[];
  effectiveRange: string[];
  superproperties: Array<{ uri: string; label: string; hasDomainLocally: boolean; hasRangeLocally: boolean; source?: string }>;
} {
  const inheritedDomain: PropertyInheritanceDomain[] = [];
  const inheritedRange: PropertyInheritanceRange[] = [];

  for (const info of superMap.values()) {
    for (const domain of info.domains) {
      inheritedDomain.push({
        ancestor: info.uri,
        ancestorLabel: info.label,
        domain,
        ...(info.source ? { source: info.source } : {}),
      });
    }
    for (const range of info.ranges) {
      inheritedRange.push({
        ancestor: info.uri,
        ancestorLabel: info.label,
        range,
        ...(info.source ? { source: info.source } : {}),
      });
    }
  }

  const superproperties = [...superMap.values()].map((info) => ({
    uri: info.uri,
    label: info.label,
    hasDomainLocally: info.domains.length > 0,
    hasRangeLocally: info.ranges.length > 0,
    ...(info.source ? { source: info.source } : {}),
  }));

  return {
    inheritedDomain,
    inheritedRange,
    effectiveDomain: [],
    effectiveRange: [],
    superproperties,
  };
}

export async function buildRedundancyAnalysis(
  assertedDomain: string[],
  assertedRange: string[],
  inheritedDomain: PropertyInheritanceDomain[],
  inheritedRange: PropertyInheritanceRange[],
  runSubclassCheck: (candidates: string[], inherited: string[]) => Promise<Map<string, string[]>>
): Promise<{
  domain: AnalysisEntry[];
  range: AnalysisEntry[];
  summary: Record<string, number>;
}> {
  const inheritedDomainValues = new Set(inheritedDomain.map((x) => x.domain));
  const inheritedRangeValues = new Set(inheritedRange.map((x) => x.range));

  const classifyInitial = (asserted: string[], inheritedValues: Set<string>): AnalysisEntry[] =>
    asserted.map((value) =>
      inheritedValues.has(value)
        ? { value, status: "redundant" as const, inherited_match: value }
        : { value, status: "new" as const }
    );

  let domainAnalysis = classifyInitial(assertedDomain, inheritedDomainValues);
  let rangeAnalysis = classifyInitial(assertedRange, inheritedRangeValues);

  const domainCandidates = domainAnalysis.filter((entry) => entry.status === "new").map((entry) => entry.value);
  const rangeCandidates = rangeAnalysis.filter((entry) => entry.status === "new").map((entry) => entry.value);
  const allCandidates = [...new Set([...domainCandidates, ...rangeCandidates])];
  const allInherited = [...new Set([...inheritedDomainValues, ...inheritedRangeValues])];

  if (allCandidates.length > 0 && allInherited.length > 0) {
    const subclassMap = await runSubclassCheck(allCandidates, allInherited);
    const upgrade = (entries: AnalysisEntry[], inheritedValues: Set<string>): AnalysisEntry[] =>
      entries.map((entry) => {
        if (entry.status !== "new") return entry;
        const supers = (subclassMap.get(entry.value) ?? []).filter((sup) => inheritedValues.has(sup));
        return supers.length > 0
          ? { value: entry.value, status: "specialization" as const, specializes: supers }
          : entry;
      });

    domainAnalysis = upgrade(domainAnalysis, inheritedDomainValues);
    rangeAnalysis = upgrade(rangeAnalysis, inheritedRangeValues);
  }

  const count = (entries: AnalysisEntry[], status: AnalysisEntry["status"]) =>
    entries.filter((entry) => entry.status === status).length;

  return {
    domain: domainAnalysis,
    range: rangeAnalysis,
    summary: {
      domain_redundant: count(domainAnalysis, "redundant"),
      domain_specialization: count(domainAnalysis, "specialization"),
      domain_new: count(domainAnalysis, "new"),
      range_redundant: count(rangeAnalysis, "redundant"),
      range_specialization: count(rangeAnalysis, "specialization"),
      range_new: count(rangeAnalysis, "new"),
    },
  };
}
