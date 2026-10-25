import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  createExtractor,
  ExtractionError,
  readExtractionConfig,
  toErrorCode,
  type ExtractionErrorCode,
} from "@/lib/extraction";
import { runExtraction } from "@/lib/extraction/run";
import { createSupabaseExtractionStore } from "@/lib/extraction/supabase-store";
import { checkServerEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

const BodySchema = z.object({ billId: z.uuid() }).strict();

const STATUS: Record<ExtractionErrorCode, number> = {
  disabled: 503,
  missing_api_key: 503,
  invalid_mode: 503,
  unauthenticated: 401,
  not_found: 404,
  busy: 409,
  rate_limited: 429,
  already_done: 409,
  claim_failed: 500,
  no_files: 400,
  file_unreadable: 500,
  file_too_large: 413,
  invalid_output: 502,
  eob_only: 422,
  refused: 502,
  truncated: 502,
  timeout: 504,
  provider_busy: 503,
  provider_error: 502,
  save_failed: 500,
};

const fail = (code: ExtractionErrorCode) => NextResponse.json({ error: code }, { status: STATUS[code] });

// Allow the (single, non-retried) vision call to finish on hosts with a limit.
export const maxDuration = 120;

/**
 * Reads an uploaded bill into line items. Server only: the Anthropic key is
 * read from the environment here and never leaves this process. The caller is
 * authenticated with the user-scoped client, and ownership, the rate limit and
 * the "one at a time" lock are enforced inside the claim_extraction() database
 * function, not by anything the client sends.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthenticated");

  const body = BodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail("not_found");

  try {
    // Config first: a disabled or misconfigured server must not use up a slot.
    if (!checkServerEnv().ok) throw new ExtractionError("invalid_mode");
    const config = readExtractionConfig();
    const extractor = createExtractor(config);
    await runExtraction({
      billId: body.data.billId,
      store: createSupabaseExtractionStore(supabase, user.id),
      extractor,
    });
    return NextResponse.json({ status: "needs_review" });
  } catch (error) {
    return fail(error instanceof ExtractionError ? error.code : toErrorCode(error));
  }
}
