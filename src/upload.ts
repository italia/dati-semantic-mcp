import { IncomingMessage } from "http";
import { Store as OxStore } from "oxigraph";

// =============================================================================
// UPLOADED STORE REGISTRY (module-level, shared between HTTP handler and tools)
// =============================================================================

/** Temporary ontology store created via HTTP POST /upload, keyed by UUID */
export interface UploadedStoreEntry {
  store: OxStore;
  format: string;
  tripleCount: number;
  created: number;
}

export const uploadedStores = new Map<string, UploadedStoreEntry>();
export const MAX_UPLOAD_SIZE = 1_000_000; // 1 MB hard limit for HTTP uploads
export const UPLOAD_TTL_MS = 3_600_000;   // Evict stores after 1 hour

/** Read raw HTTP body up to maxBytes; rejects with RangeError if exceeded. */
export function readRawBodyWithLimit(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        reject(new RangeError(`Body exceeds ${maxBytes} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Remove uploaded stores older than UPLOAD_TTL_MS */
export function evictExpiredUploads(): void {
  const cutoff = Date.now() - UPLOAD_TTL_MS;
  for (const [id, entry] of uploadedStores) {
    if (entry.created < cutoff) uploadedStores.delete(id);
  }
}
