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

/** Rejection type for a body over the limit its reader was given. */
export class BodyTooLargeError extends RangeError {
  readonly maxBytes: number;

  constructor(maxBytes: number) {
    super(`Body exceeds ${maxBytes} bytes`);
    this.name = "BodyTooLargeError";
    this.maxBytes = maxBytes;
  }
}

/** Read raw HTTP body up to maxBytes; rejects with BodyTooLargeError if exceeded. */
export function readRawBodyWithLimit(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    req.on("data", (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBytes) {
        settled = true;
        chunks.length = 0;
        // Drain instead of destroy: the caller still has to write its 413, and
        // destroying the socket here is what made that response unreachable.
        req.resume();
        reject(new BodyTooLargeError(maxBytes));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

/** Remove uploaded stores older than UPLOAD_TTL_MS */
export function evictExpiredUploads(): void {
  const cutoff = Date.now() - UPLOAD_TTL_MS;
  for (const [id, entry] of uploadedStores) {
    if (entry.created < cutoff) uploadedStores.delete(id);
  }
}
