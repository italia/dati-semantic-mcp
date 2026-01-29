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

### Tool Hierarchy (10 tools)

**Base Operations:**
- `query_sparql` - Raw SPARQL execution with automatic prefix injection
- `explore_catalog` - List available graphs/ontologies

**Semantic Analytics:**
- `explore_classes` - Discover classes with instance counts
- `check_coverage` - Analyze usage of specific classes/properties
- `check_quality` - Find missing labels/descriptions
- `check_overlaps` - Identify duplicate labels or explicit mappings

**Intelligent Tools:**
- `search_concepts` - Fuzzy keyword search (use when URI is unknown)
- `inspect_concept` - Deep profiling (definition, hierarchy, usage, relations)
- `find_relations` - Discover paths between two concepts (direct or 1-hop)
- `suggest_improvements` - Detect orphan classes and cycles

**Meta:**
- `analyze_usage` - Parse `usage_log.jsonl` for patterns and errors

### Key Patterns

**Automatic SPARQL Prefixes:** All queries receive these prefixes automatically:
```
rdf, rdfs, owl, skos, dct, xsd, dcat, foaf
```

**Result Compression:** Large results (>5 items) use tabular format (headers + rows) for token efficiency.

**Usage Logging:** All tool calls are logged to `usage_log.jsonl` with timestamp, tool name, args, and result status.

### SPARQL Endpoint

Target: `https://schema.gov.it/sparql`

The endpoint hosts Italian public administration ontologies including concepts for organizations, services, professional registers, and controlled vocabularies.

## Distribution

The compiled `dist/` directory is committed to the repository to allow direct GitHub installation without requiring a build step:
```bash
npx -y github:mfortini/schema-gov-it-mcp
```
