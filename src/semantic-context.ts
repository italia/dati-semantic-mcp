import { resolveLocalStore } from "./local-ontology.js";

export type SemanticSource = "schema" | "local" | "hybrid";

export interface SemanticContextInput {
  source?: SemanticSource;
  file_path?: string | undefined;
  content?: string | undefined;
  format?: string | undefined;
  upload_id?: string | undefined;
}

export function getSemanticSource(input: SemanticContextInput): SemanticSource {
  return input.source ?? "schema";
}

export async function resolveSemanticContextStore(input: SemanticContextInput) {
  const source = getSemanticSource(input);
  if (source === "schema") {
    throw new Error("Local ontology context is not available when source='schema'.");
  }

  return resolveLocalStore(input.file_path, input.content, input.format, input.upload_id);
}
