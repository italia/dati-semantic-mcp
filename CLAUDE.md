# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an MCP (Model Context Protocol) server that provides semantic interaction with the schema.gov.it SPARQL endpoint. It enables AI agents to explore and analyze Italy's semantic web catalog of public administration ontologies.

## Build Commands

```bash
npm run build    # Compile TypeScript from src/ to dist/
npm start        # Run the compiled server (node dist/index.js)
```

No test or lint commands are configured. The project uses TypeScript strict mode for type checking.

## Architecture

### Server Structure

Single-file implementation (`src/index.ts`) using:
- `@modelcontextprotocol/sdk` for MCP protocol handling over stdio
- `zod` for parameter validation
- Direct `fetch` calls to the SPARQL endpoint

### Tool Hierarchy (30 tools)

**Base Operations:**
- `query_sparql` - Raw SPARQL execution with automatic prefix injection
- `explore_catalog` - List available graphs/ontologies
- `explore_classes` - Discover classes with instance counts

**Semantic Analytics:**
- `check_coverage` - Analyze usage of specific classes/properties
- `check_quality` - Find missing labels/descriptions
- `check_overlaps` - Identify duplicate labels or explicit mappings

**Data Model (Ontologies):**
- `list_ontologies` - List available ontologies with titles
- `explore_ontology` - List classes and properties in a specific ontology
- `list_properties` - List ObjectProperty and DatatypeProperty with domain/range
- `get_property_details` - Full property details (domain, range, inverse, functional)

**Controlled Vocabularies:**
- `list_vocabularies` - List ConceptSchemes with instance counts
- `search_in_vocabulary` - Search concepts within a specific vocabulary
- `browse_vocabulary` - Paginated browsing of large vocabularies

**Catalogs & Datasets:**
- `list_datasets` - List DCAT-AP_IT datasets
- `explore_dataset` - Get dataset details and distributions
- `preview_distribution` - Download and preview first rows of CSV/JSON data

**Intelligent Tools:**
- `search_concepts` - Fuzzy keyword search (use when URI is unknown)
- `inspect_concept` - Deep profiling (definition, hierarchy, usage, relations)
- `find_relations` - Discover paths between two concepts (direct or 1-hop)
- `suggest_improvements` - Detect orphan classes and cycles
- `describe_resource` - Concise Bounded Description (all RDF triples for a resource)

**Territorial (OntoPiA):**
- `list_municipalities` - Italian municipalities with ISTAT/Belfiore codes (paginated)
- `list_provinces` - Italian provinces with codes
- `list_identifiers` - CLV Identifier resources by type

**Linked SPARQL Endpoints:**
- `list_linked_endpoints` - Discover `dcat:DataService` endpoints in the catalog
- `query_external_endpoint` - Execute SPARQL against any public HTTPS endpoint
- `find_external_alignments` - Find owl:sameAs / skos:*Match links toward external systems
- `explore_external_endpoint` - Explore classes/counts of an external SPARQL endpoint

**Meta:**
- `suggest_new_tools` - Analyze usage logs to suggest new specialized tools
- `analyze_usage` - Parse `usage_log.jsonl` for patterns and errors

### Key Patterns

**Automatic SPARQL Prefixes:** Internal queries receive these prefixes automatically:
```
rdf, rdfs, owl, skos, dct, xsd, dcat, foaf, clv, cpv, l0, sm
```
External endpoint queries do NOT inject prefixes by default (`injectPrefixes: false`).

**Input Sanitization:** All user-provided parameters are sanitized before SPARQL interpolation (string escaping for literals, URI validation for URIs via `sanitizeSparqlUri()`).

**Result Compression:** Large results (>5 items) use tabular format (headers + rows) for token efficiency.

**Usage Logging:** All tool calls are logged to `usage_log.jsonl` with timestamp, tool name, args, and result status.

**Timeout:** External endpoint queries use a 15-second `AbortController` timeout. Internal queries use 30 seconds. Implemented via the `executeSparql(query, endpoint?, injectPrefixes?, timeoutMs?)` signature.

### SPARQL Endpoint

Primary: `https://schema.gov.it/sparql`

External endpoints (via Linked SPARQL Endpoints tools): any public HTTPS SPARQL endpoint, validated by `sanitizeSparqlUri()` before use.

The endpoint hosts Italian public administration ontologies including concepts for organizations, services, professional registers, and controlled vocabularies.

## Distribution

The `dist/` directory is NOT committed to the repository. It is built automatically via the `prepare` script when installing from git:
```bash
npx -y github:mfortini/schema-gov-it-mcp
```

The `"files": ["dist"]` field in package.json ensures only the compiled output is included when publishing to npm.
