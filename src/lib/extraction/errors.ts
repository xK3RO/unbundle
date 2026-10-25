/**
 * Opaque, content-free failure codes. These are the only thing that is ever
 * stored, logged or returned about a failed extraction: never model output,
 * bill text, or validation issue details (which can echo values).
 */
export const EXTRACTION_ERROR_CODES = [
  "disabled",
  "missing_api_key",
  "invalid_mode",
  "unauthenticated",
  "not_found",
  "busy",
  "rate_limited",
  "already_done",
  "claim_failed",
  "no_files",
  "file_unreadable",
  "file_too_large",
  "invalid_output",
  "eob_only",
  "refused",
  "truncated",
  "timeout",
  "provider_busy",
  "provider_error",
  "save_failed",
] as const;

export type ExtractionErrorCode = (typeof EXTRACTION_ERROR_CODES)[number];

export class ExtractionError extends Error {
  readonly code: ExtractionErrorCode;
  /**
   * Redacted provider detail. Only set when the extractor was created with
   * diagnostics on (the eval script); the app's route reads `code` alone.
   */
  readonly diagnostic?: string;

  constructor(code: ExtractionErrorCode, diagnostic?: string) {
    // The message is the code, so an uncaught error can't leak anything else.
    super(code);
    this.name = "ExtractionError";
    this.code = code;
    if (diagnostic) this.diagnostic = diagnostic;
  }
}

export function toErrorCode(error: unknown): ExtractionErrorCode {
  return error instanceof ExtractionError ? error.code : "provider_error";
}

export function toDiagnostic(error: unknown): string | undefined {
  return error instanceof ExtractionError ? error.diagnostic : undefined;
}
