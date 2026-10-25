import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import { EXTRACTION_ERROR_CODES } from "@/lib/extraction/errors";
import { errorMessageKey } from "./error-messages";
import type { UploadErrorCode } from "./upload-validation";

const uploadCodes: UploadErrorCode[] = [
  "empty", "too_large", "unsupported_type", "pdf_unreadable", "pdf_encrypted", "pdf_too_many_pages",
];

describe("errorMessageKey", () => {
  it("maps every extraction and upload code to a message that exists", () => {
    const messages = en.Upload.errors as Record<string, string>;
    for (const code of [...EXTRACTION_ERROR_CODES, ...uploadCodes, "upload_failed", "bill_locked", "too_many_bills"]) {
      expect(messages[errorMessageKey(code)], code).toBeTruthy();
    }
  });

  it("gives a busy provider and an oversized file their own messages", () => {
    expect(errorMessageKey("provider_busy")).toBe("provider_busy");
    expect(errorMessageKey("file_too_large")).toBe("file_too_large");
    expect(errorMessageKey("provider_error")).toBe("unreadable");
    expect(errorMessageKey("eob_only")).toBe("eob_only");
  });

  it("falls back to unknown", () => {
    expect(errorMessageKey("nope")).toBe("unknown");
    expect(errorMessageKey(undefined)).toBe("unknown");
  });
});
