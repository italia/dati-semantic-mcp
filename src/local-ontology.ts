import { readFile, stat } from "fs/promises";
import { Store as OxStore } from "oxigraph";
import type { SparqlResult } from "./types.js";
import { uploadedStores } from "./upload.js";

// =============================================================================
// LOCAL ONTOLOGY SUPPORT (oxigraph)
// =============================================================================

export interface LocalStoreEntry {
  store: OxStore;
  mtime: number;
  format: string;
  tripleCount: number;
  etag?: string;
  lastModified?: string;
}

export const localStoreCache = new Map<string, LocalStoreEntry>();

/** Max size for inline RDF content passed via the `content` parameter */
export const MAX_INLINE_CONTENT_SIZE = 1_000_000; // ~1 MB
export const GRAPHOL_FORMAT = "application/graphol+xml";

export function detectFormatFromContentType(contentType: string): string | undefined {
  const ct = (contentType.split(";")[0] ?? "").trim().toLowerCase();
  if (ct === "text/turtle" || ct === "application/turtle") return "text/turtle";
  if (ct === "application/rdf+xml") return "application/rdf+xml";
  if (ct === "application/n-triples") return "application/n-triples";
  if (ct === "application/ld+json") return "application/ld+json";
  if (ct === "text/n3" || ct === "text/rdf+n3") return "text/n3";
  if (ct === "application/graphol+xml" || ct === "text/graphol+xml") return GRAPHOL_FORMAT;
  return undefined;
}

export function detectRdfFormat(filePath: string): string {
  // Strip query string and fragment for URL detection
  const pathOnly = (filePath.split("?")[0] ?? "").split("#")[0] ?? "";
  const ext = pathOnly.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "ttl": return "text/turtle";
    case "n3":  return "text/n3";
    case "nt":  return "application/n-triples";
    case "jsonld":
    case "json": return "application/ld+json";
    case "owl":
    case "rdf":
    case "xml": return "application/rdf+xml";
    case "graphol": return GRAPHOL_FORMAT;
    default:    return "text/turtle";
  }
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function escapeTurtleLiteral(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

function escapeIri(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/>/g, "\\>");
}

function parseAttributes(tagAttrs: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of tagAttrs.matchAll(/([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*"([^"]*)"/g)) {
    const key = match[1];
    const value = match[2];
    if (!key || value === undefined) continue;
    attrs[key] = decodeXmlEntities(value);
  }
  return attrs;
}

function findFirstElement(xml: string, tagName: string): { attrs: Record<string, string>; body: string } | undefined {
  const match = new RegExp(`<${tagName}\\b([^>]*)>([\\s\\S]*?)</${tagName}>`, "i").exec(xml);
  if (!match) return undefined;
  return { attrs: parseAttributes(match[1] ?? ""), body: match[2] ?? "" };
}

function findElements(xml: string, tagName: string): Array<{ attrs: Record<string, string>; body: string }> {
  const matches: Array<{ attrs: Record<string, string>; body: string }> = [];
  for (const match of xml.matchAll(new RegExp(`<${tagName}\\b([^>]*)>([\\s\\S]*?)</${tagName}>`, "gi"))) {
    matches.push({ attrs: parseAttributes(match[1] ?? ""), body: match[2] ?? "" });
  }
  return matches;
}

function findSelfClosingElements(xml: string, tagName: string): Array<{ attrs: Record<string, string> }> {
  const matches: Array<{ attrs: Record<string, string> }> = [];
  for (const match of xml.matchAll(new RegExp(`<${tagName}\\b([^>]*)/>`, "gi"))) {
    matches.push({ attrs: parseAttributes(match[1] ?? "") });
  }
  return matches;
}

function getTagText(xml: string, tagName: string): string | undefined {
  const match = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)</${tagName}>`, "i").exec(xml);
  if (!match) return undefined;
  const body = match[1];
  if (body === undefined) return undefined;
  return decodeXmlEntities(body.replace(/<[^>]+>/g, "").trim());
}

function isGrapholContent(content: string): boolean {
  return /<graphol\b/i.test(content) && /<ontology\b/i.test(content);
}

function normalizeLabel(label: string | undefined): string | undefined {
  if (!label) return undefined;
  const trimmed = label.replace(/\s+/g, " ").trim();
  return trimmed || undefined;
}

function resolvePrefixedName(value: string | undefined, prefixes: Map<string, string>): string | undefined {
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  const idx = value.indexOf(":");
  if (idx < 0) return undefined;
  const prefix = value.slice(0, idx);
  const local = value.slice(idx + 1);
  const ns = prefixes.get(prefix);
  if (!ns || !local) return undefined;
  return `${ns}${local}`;
}

type GrapholEntityKind = "class" | "objectProperty" | "dataProperty" | "individual" | "annotationProperty";

interface GrapholEntity {
  id: string;
  iri: string;
  kind: GrapholEntityKind;
  label?: string;
}

function grapholTypeToEntityKind(type: string | undefined): GrapholEntityKind | undefined {
  switch ((type ?? "").toLowerCase()) {
    case "concept":
    case "class":
      return "class";
    case "role":
    case "object-property":
      return "objectProperty";
    case "attribute":
    case "data-property":
      return "dataProperty";
    case "individual":
    case "individuals":
      return "individual";
    case "annotation-property":
      return "annotationProperty";
    default:
      return undefined;
  }
}

function grapholEntityTypeTriple(kind: GrapholEntityKind): string {
  switch (kind) {
    case "class":
      return "owl:Class";
    case "objectProperty":
      return "owl:ObjectProperty";
    case "dataProperty":
      return "owl:DatatypeProperty";
    case "individual":
      return "owl:NamedIndividual";
    case "annotationProperty":
      return "owl:AnnotationProperty";
  }
}

function grapholEdgePredicate(source: GrapholEntity, target: GrapholEntity, edgeType: string): string | undefined {
  switch (edgeType) {
    case "inclusion":
      if (source.kind === "class" && target.kind === "class") return "rdfs:subClassOf";
      if (source.kind === "individual" && target.kind === "class") return "rdf:type";
      if (source.kind !== "individual" && target.kind !== "individual") return "rdfs:subPropertyOf";
      return undefined;
    case "equivalence":
      if (source.kind === "class" && target.kind === "class") return "owl:equivalentClass";
      if (source.kind === "individual" && target.kind === "individual") return "owl:sameAs";
      if (source.kind !== "individual" && target.kind !== "individual") return "owl:equivalentProperty";
      return undefined;
    default:
      return undefined;
  }
}

export function convertGrapholToTurtle(content: string): string {
  const ontology = findFirstElement(content, "ontology");
  if (!ontology) {
    throw new Error("Invalid Graphol file: missing <ontology> element.");
  }

  const turtleLines = [
    "@prefix owl: <http://www.w3.org/2002/07/owl#> .",
    "@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .",
    "@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .",
    "",
  ];

  const prefixes = new Map<string, string>();
  for (const prefix of findElements(ontology.body, "prefix")) {
    const value = getTagText(prefix.body, "value");
    const namespace = getTagText(prefix.body, "namespace");
    if (!value || !namespace) continue;
    prefixes.set(value, namespace);
    turtleLines.push(`@prefix ${value}: <${escapeIri(namespace)}> .`);
  }
  if (prefixes.size > 0) turtleLines.push("");

  const ontologyIri = ontology.attrs.iri;
  if (ontologyIri) {
    turtleLines.push(`<${escapeIri(ontologyIri)}> a owl:Ontology .`);
    const importEntries = [
      ...findSelfClosingElements(ontology.body, "import"),
      ...findElements(ontology.body, "import").map((entry) => ({ attrs: entry.attrs })),
    ];
    for (const imported of importEntries) {
      const importIri = imported.attrs.iri ?? imported.attrs.url;
      if (importIri) turtleLines.push(`<${escapeIri(ontologyIri)}> owl:imports <${escapeIri(importIri)}> .`);
    }
    turtleLines.push("");
  }

  const entitiesById = new Map<string, GrapholEntity>();
  for (const diagram of findElements(content, "diagram")) {
    for (const node of findElements(diagram.body, "node")) {
      const id = node.attrs.id;
      const kind = grapholTypeToEntityKind(node.attrs.type);
      if (!id || !kind) continue;

      const iriFromTag = getTagText(node.body, "iri");
      const iriFromLabel = resolvePrefixedName(normalizeLabel(getTagText(node.body, "label")), prefixes);
      const iri = iriFromTag ?? iriFromLabel;
      if (!iri) continue;

      const label = normalizeLabel(getTagText(node.body, "label"));
      const entity: GrapholEntity = label ? { id, iri, kind, label } : { id, iri, kind };
      entitiesById.set(id, entity);
    }
  }

  const emittedEntities = new Set<string>();
  for (const entity of entitiesById.values()) {
    if (emittedEntities.has(entity.iri)) continue;
    emittedEntities.add(entity.iri);
    turtleLines.push(`<${escapeIri(entity.iri)}> a ${grapholEntityTypeTriple(entity.kind)} .`);
    if (entity.label) {
      turtleLines.push(`<${escapeIri(entity.iri)}> rdfs:label "${escapeTurtleLiteral(entity.label)}"@it .`);
    }
  }

  if (emittedEntities.size > 0) turtleLines.push("");

  const emittedEdges = new Set<string>();
  for (const diagram of findElements(content, "diagram")) {
    for (const edge of findElements(diagram.body, "edge")) {
      const edgeType = (edge.attrs.type ?? "").toLowerCase();
      const source = edge.attrs.source ? entitiesById.get(edge.attrs.source) : undefined;
      const target = edge.attrs.target ? entitiesById.get(edge.attrs.target) : undefined;
      if (!source || !target) continue;
      const predicate = grapholEdgePredicate(source, target, edgeType);
      if (!predicate) continue;
      const triple = `<${escapeIri(source.iri)}> ${predicate} <${escapeIri(target.iri)}> .`;
      if (emittedEdges.has(triple)) continue;
      emittedEdges.add(triple);
      turtleLines.push(triple);
    }
  }

  return `${turtleLines.join("\n").trim()}\n`;
}

export function normalizeOntologyContent(content: string, format: string): { content: string; format: string } {
  if (format === GRAPHOL_FORMAT || isGrapholContent(content)) {
    return {
      content: convertGrapholToTurtle(content),
      format: "text/turtle",
    };
  }
  return { content, format };
}

export function loadOntologyContent(store: OxStore, content: string, format: string): { format: string; tripleCount: number } {
  const normalized = normalizeOntologyContent(content, format);
  store.load(normalized.content, { format: normalized.format, lenient: true });
  return { format: normalized.format, tripleCount: store.size };
}

export async function getLocalStore(filePath: string): Promise<LocalStoreEntry> {
  const fileStat = await stat(filePath);
  const mtime = fileStat.mtimeMs;
  const cached = localStoreCache.get(filePath);
  if (cached && cached.mtime === mtime) return cached;

  const content = await readFile(filePath, "utf-8");
  const format = detectRdfFormat(filePath);
  const store = new OxStore();
  const loaded = loadOntologyContent(store, content, format);

  const entry: LocalStoreEntry = { store, mtime, format: loaded.format, tripleCount: loaded.tripleCount };
  localStoreCache.set(filePath, entry);
  return entry;
}

/**
 * Resolve a local store from either a file path (cached) or inline content.
 * Exactly one of file_path or content must be provided.
 */
export async function resolveLocalStore(
  filePath: string | undefined,
  content: string | undefined,
  format: string | undefined,
  uploadId?: string
): Promise<{ store: OxStore; tripleCount: number; format: string; source: string }> {
  const provided = [filePath, content, uploadId].filter(Boolean).length;
  if (provided > 1) {
    throw new Error("Provide exactly one of: file_path, content, or upload_id.");
  }
  if (provided === 0) {
    throw new Error("Provide one of: file_path (server-local file), content (inline RDF for small payloads), or upload_id (recommended for remote HTTP servers).");
  }

  if (uploadId) {
    const entry = uploadedStores.get(uploadId);
    if (!entry) {
      throw new Error(`Upload store '${uploadId}' not found or expired. Upload the file first via POST /upload (preferred when the file is on the client machine and the MCP server is remote). Stores expire after 1 hour.`);
    }
    return { store: entry.store, tripleCount: entry.tripleCount, format: entry.format, source: `upload:${uploadId}` };
  }

  if (filePath) {
    const entry = await getLocalStore(filePath);
    return { store: entry.store, tripleCount: entry.tripleCount, format: entry.format, source: filePath };
  }

  // Inline content path
  if (content!.length > MAX_INLINE_CONTENT_SIZE) {
    throw new Error(
      `Content length (${content!.length} chars) exceeds the ${MAX_INLINE_CONTENT_SIZE}-character limit. ` +
      `Use upload_id instead for large ontologies on remote servers, or file_path only when the server can read the file directly.`
    );
  }
  const fmt = format ?? "text/turtle";
  const store = new OxStore();
  const loaded = loadOntologyContent(store, content!, fmt);
  return { store, tripleCount: loaded.tripleCount, format: loaded.format, source: "inline" };
}
