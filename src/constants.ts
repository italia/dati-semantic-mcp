import type { RecommendedExternalEndpoint } from "./types.js";

// =============================================================================
// CONSTANTS
// =============================================================================

/** Maximum character limit for tool responses to prevent excessive output */
export const CHARACTER_LIMIT = 50_000;

// SPARQL Endpoint
export const ENDPOINT = "https://schema.gov.it/sparql";

export const PREFIXES = `
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX dct: <http://purl.org/dc/terms/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX dcat: <http://www.w3.org/ns/dcat#>
PREFIX foaf: <http://xmlns.com/foaf/0.1/>
PREFIX clv: <https://w3id.org/italia/onto/CLV/>
PREFIX cpv: <https://w3id.org/italia/onto/CPV/>
PREFIX l0: <https://w3id.org/italia/onto/l0/>
PREFIX sm: <https://w3id.org/italia/onto/SM/>
`;

// Open Knowledge Graphs (OKG) — https://api.openknowledgegraphs.com
// Categories are static (no /categories endpoint exists); update here if OKG adds new ones.
export const OKG_CATEGORIES = [
  "Government & Public Sector",
  "Geospatial",
  "Life Sciences & Healthcare",
  "International Development",
  "Finance & Business",
  "Library & Cultural Heritage",
  "Technology & Web",
  "Environment & Agriculture",
  "General / Cross-domain",
] as const;

export type OkgCategory = typeof OKG_CATEGORIES[number];

export const RECOMMENDED_EXTERNAL_ENDPOINTS: RecommendedExternalEndpoint[] = [
  {
    id: "lod-dati-gov-it",
    name: "lod.dati.gov.it SPARQL",
    endpointUrl: "https://lod.dati.gov.it/sparql",
    category: "italian-pa",
    whySuggested: "National linked open data endpoint for Italian public datasets and metadata, useful as a natural extension of schema.gov.it exploration.",
    bestFor: ["dataset metadata", "catalog linking", "DCAT exploration", "public sector discovery"],
    relatedTo: ["dati.gov.it", "catalogo nazionale open data", "DCAT-AP_IT"],
    exampleQueryIdea: "Start from concepts or vocabularies in schema.gov.it, then inspect linked dataset metadata and distributions in the national catalog.",
    status: "curated",
  },
  {
    id: "dati-cultura",
    name: "dati.cultura.gov.it SPARQL",
    endpointUrl: "https://dati.cultura.gov.it/sparql",
    category: "italian-pa",
    whySuggested: "Italian culture domain endpoint for heritage, institutions, and cultural linked data modeled with national semantics.",
    bestFor: ["cultural heritage", "museums", "archives", "domain-specific linked data"],
    relatedTo: ["MiC", "beni culturali", "knowledge graphs della cultura"],
    exampleQueryIdea: "Reuse shared concepts from schema.gov.it to explore cultural entities, places, and heritage datasets.",
    status: "curated",
  },
  {
    id: "dati-camera",
    name: "dati.camera.it SPARQL",
    endpointUrl: "https://dati.camera.it/sparql",
    category: "italian-pa",
    whySuggested: "Rich institutional linked open data from the Italian Chamber of Deputies, useful for public sector entity linking.",
    bestFor: ["institutional data", "persons", "organizations", "legislative references"],
    relatedTo: ["dati.camera.it", "open data PA", "entity reconciliation"],
    exampleQueryIdea: "Link people, organizations, or roles found in schema.gov.it against parliamentary resources.",
    status: "curated",
  },
  {
    id: "dati-senato",
    name: "dati.senato.it SPARQL",
    endpointUrl: "https://dati.senato.it/sparql",
    category: "italian-pa",
    whySuggested: "Institutional RDF endpoint complementary to Camera data for cross-checking public administration actors and legislative entities.",
    bestFor: ["institutional data", "senate acts", "persons", "cross-checking"],
    relatedTo: ["dati.senato.it", "open data PA", "interoperability"],
    exampleQueryIdea: "Compare entities or legal references across multiple Italian institutional datasets.",
    status: "curated",
  },
  {
    id: "eu-publications",
    name: "EU Publications Office SPARQL",
    endpointUrl: "https://publications.europa.eu/webapi/rdf/sparql",
    category: "eu",
    whySuggested: "Reference endpoint for EU vocabularies, legal resources, and interoperability artifacts often linked from Italian public data.",
    bestFor: ["EU vocabularies", "legal metadata", "authority tables", "cross-border mappings"],
    relatedTo: ["EUR-Lex ecosystem", "DCAT-AP", "European interoperability"],
    exampleQueryIdea: "Resolve controlled vocabularies or legal concepts connected to Italian datasets and metadata profiles.",
    status: "curated",
  },
  {
    id: "wikidata",
    name: "Wikidata Query Service",
    endpointUrl: "https://query.wikidata.org/sparql",
    category: "knowledge-graph",
    whySuggested: "Broad public knowledge graph useful for enrichment and entity linking after you identify concepts in schema.gov.it.",
    bestFor: ["entity enrichment", "place data", "cross-dataset identifiers", "background knowledge"],
    relatedTo: ["Wikidata", "entity linking", "semantic enrichment"],
    exampleQueryIdea: "Enrich municipalities, organizations, or concepts discovered in schema.gov.it with external identifiers.",
    status: "curated",
  },
  {
    id: "dbpedia",
    name: "DBpedia SPARQL",
    endpointUrl: "https://dbpedia.org/sparql",
    category: "knowledge-graph",
    whySuggested: "General-purpose linked data endpoint still useful for simple lookups and alignment experiments.",
    bestFor: ["quick lookups", "sameAs checks", "exploratory linking"],
    relatedTo: ["DBpedia", "linked open data", "alignment testing"],
    exampleQueryIdea: "Test owl:sameAs or skos mappings from Italian concepts toward well-known public resources.",
    status: "curated",
  },
];
