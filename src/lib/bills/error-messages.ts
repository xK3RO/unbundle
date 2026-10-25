/**
 * Maps the opaque codes returned by the upload and extraction routes to keys
 * under `Upload.errors`. Unknown codes fall back to "unknown".
 */
export type ErrorMessageKey =
  | "empty" | "too_large" | "unsupported_type" | "pdf_unreadable" | "pdf_encrypted"
  | "pdf_too_many_pages" | "unauthenticated" | "not_found" | "too_many_bills" | "upload"
  | "busy" | "rate_limited" | "provider_busy" | "file_too_large" | "unavailable" | "unreadable" | "eob_only" | "network" | "unknown";

const KEYS: Record<string, ErrorMessageKey> = {
  empty: "empty",
  too_large: "too_large",
  unsupported_type: "unsupported_type",
  pdf_unreadable: "pdf_unreadable",
  pdf_encrypted: "pdf_encrypted",
  pdf_too_many_pages: "pdf_too_many_pages",
  unauthenticated: "unauthenticated",
  not_found: "not_found",
  too_many_bills: "too_many_bills",
  upload_failed: "upload",
  create_failed: "upload",
  bill_locked: "upload",
  busy: "busy",
  rate_limited: "rate_limited",
  disabled: "unavailable",
  missing_api_key: "unavailable",
  invalid_mode: "unavailable",
  invalid_output: "unreadable",
  eob_only: "eob_only",
  refused: "unreadable",
  truncated: "unreadable",
  timeout: "unreadable",
  provider_busy: "provider_busy",
  provider_error: "unreadable",
  no_files: "upload",
  file_unreadable: "upload",
  file_too_large: "file_too_large",
  save_failed: "unknown",
  claim_failed: "unknown",
  network: "network",
};

export function errorMessageKey(code: string | undefined): ErrorMessageKey {
  return (code !== undefined && Object.hasOwn(KEYS, code) && KEYS[code]) || "unknown";
}
