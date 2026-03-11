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

export function detectFormatFromContentType(contentType: string): string | undefined {
  const ct = (contentType.split(";")[0] ?? "").trim().toLowerCase();
  if (ct === "text/turtle" || ct === "application/turtle") return "text/turtle";
  if (ct === "application/rdf+xml") return "application/rdf+xml";
  if (ct === "application/n-triples") return "application/n-triples";
  if (ct === "application/ld+json") return "application/ld+json";
  if (ct === "text/n3" || ct === "text/rdf+n3") return "text/n3";
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
    default:    return "text/turtle";
  }
}

export async function getLocalStore(filePath: string): Promise<LocalStoreEntry> {
  const fileStat = await stat(filePath);
  const mtime = fileStat.mtimeMs;
  const cached = localStoreCache.get(filePath);
  if (cached && cached.mtime === mtime) return cached;

  const content = await readFile(filePath, "utf-8");
  const format = detectRdfFormat(filePath);
  const store = new OxStore();
  store.load(content, { format, lenient: true });

  const entry: LocalStoreEntry = { store, mtime, format, tripleCount: store.size };
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
    throw new Error("Provide one of: file_path (local server), content (remote server), or upload_id (HTTP upload).");
  }

  if (uploadId) {
    const entry = uploadedStores.get(uploadId);
    if (!entry) {
      throw new Error(`Upload store '${uploadId}' not found or expired. Upload a file first via POST /upload (stores expire after 1 hour).`);
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
      `Use file_path instead for large ontologies.`
    );
  }
  const fmt = format ?? "text/turtle";
  const store = new OxStore();
  store.load(content!, { format: fmt, lenient: true });
  return { store, tripleCount: store.size, format: fmt, source: "inline" };
}
