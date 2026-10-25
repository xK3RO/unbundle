import Anthropic from "@anthropic-ai/sdk";
import type { ExtractedBill } from "@/lib/types";
import { mergeChunkOutputs, splitIntoChunks, type BillChunk } from "./chunks";
import { describeProviderError } from "./diagnostic";
import { ExtractionError } from "./errors";
import { MODEL_OUTPUT_JSON_SCHEMA, ModelOutputSchema, parseModelOutput } from "./model-schema";
import { EXTRACTION_SYSTEM_PROMPT, EXTRACTION_USER_PROMPT, chunkUserPrompt } from "./prompt";
import type { BillExtractor, ExtractionFile } from "./types";

/**
 * Includes adaptive thinking tokens. Non-streaming stays valid in SDK 0.133:
 * its guard only throws when max_tokens * 3600 / 128000 exceeds 600s (that is,
 * above 21,333 tokens), and there is no per-model cap for the models we use.
 */
export const EXTRACTION_MAX_TOKENS = 16_000;
export const EXTRACTION_TIMEOUT_MS = 90_000;

/**
 * One retry when the API turns a request away as rate limited (429) or
 * overloaded (529): the request was not run, so it is not billed twice. Only
 * when that answer came back fast, so a retry that runs its full 90 s still
 * ends inside the route's 120 s limit (15 s + 2 s + 90 s). Timeouts and other
 * errors are never retried, since a timed-out request may still be billed.
 */
export const BUSY_RETRY_DELAY_MS = 2_000;
export const BUSY_RETRY_WITHIN_MS = 15_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Models known to accept output_config.effort. Anything else (for example an
 * older Haiku or Sonnet set through EXTRACTION_MODEL) is sent without it,
 * because an unsupported parameter is a 400 on every call.
 */
export const EFFORT_MODELS: readonly string[] = [
  "claude-sonnet-5-5",
  "claude-sonnet-5",
  "claude-opus-5-5",
  "claude-opus-5",
];

const MIB = 1024 * 1024;
/** Conservative per-image limit, measured on the base64 payload (documented as 10 MB on the direct API, 5 MB on Bedrock and Vertex). */
export const MAX_IMAGE_BASE64_BYTES = 5 * MIB;
/** Documented request-size limit (PDFs count toward the whole request payload). */
export const MAX_REQUEST_BASE64_BYTES = 32 * MIB;

const base64Length = (bytes: number) => Math.ceil(bytes / 3) * 4;

/** The one method of the SDK this class uses, so tests can substitute it. */
export type MessagesClient = {
  messages: {
    create: (
      body: Anthropic.MessageCreateParamsNonStreaming,
      options?: Parameters<Anthropic["messages"]["create"]>[1],
    ) => Promise<Anthropic.Message>;
  };
};

function toContentBlock(file: ExtractionFile): Anthropic.ContentBlockParam {
  const data = Buffer.from(file.bytes).toString("base64");
  if (file.mimeType === "application/pdf") {
    return {
      type: "document" as const,
      source: { type: "base64" as const, media_type: "application/pdf" as const, data },
    };
  }
  return {
    type: "image" as const,
    source: { type: "base64" as const, media_type: file.mimeType, data },
  };
}

/**
 * Vision extraction through the Anthropic Messages API with a JSON-schema
 * output format. One request per chunk (bills over PAGES_PER_CHUNK pages are
 * split and read in parallel). No retries (a timed-out request may still be
 * billed, so retrying could double-bill), except one after a fast 429/529.
 * The user can retry explicitly and that goes through the per-user rate limit. Nothing about the images or the
 * response is logged, and no error carries the response body.
 */
export class AnthropicExtractor implements BillExtractor {
  constructor(
    private readonly client: MessagesClient,
    private readonly model: string,
    /** Debug only: attach a redacted status/type/message to provider errors. */
    private readonly diagnostics = false,
    /** Injected so tests don't wait out the retry pause or read the real clock. */
    private readonly timing: { sleep: (ms: number) => Promise<void>; now: () => number } = { sleep, now: Date.now },
  ) {}

  static fromApiKey(apiKey: string, model: string, diagnostics = false): AnthropicExtractor {
    const client = new Anthropic({ apiKey, maxRetries: 0, timeout: EXTRACTION_TIMEOUT_MS });
    return new AnthropicExtractor(client, model, diagnostics);
  }

  async extractBill(files: ExtractionFile[]): Promise<ExtractedBill> {
    if (files.length === 0) throw new ExtractionError("no_files");

    // Reject before spending a request: the API would answer with a 400.
    let total = 0;
    for (const file of files) {
      const size = base64Length(file.bytes.byteLength);
      total += size;
      if (file.mimeType !== "application/pdf" && size > MAX_IMAGE_BASE64_BYTES) {
        throw new ExtractionError("file_too_large");
      }
    }
    if (total > MAX_REQUEST_BASE64_BYTES) throw new ExtractionError("file_too_large");

    const chunks = await splitIntoChunks(files);
    if (chunks.length === 1) return parseModelOutput(await this.request(chunks[0].files, EXTRACTION_USER_PROMPT));

    // All chunks run at once, so the wall time is one chunk's. Every request is
    // awaited before failing, then the first failure in page order is reported.
    const settled = await Promise.allSettled(
      chunks.map((chunk) => this.request(chunk.files, chunkUserPrompt(describe(chunks, chunk)))),
    );
    const parts = settled.map((result, i) => {
      if (result.status === "rejected") throw result.reason;
      const lax = ModelOutputSchema.safeParse(result.value);
      if (!lax.success) throw new ExtractionError("invalid_output");
      return { output: lax.data, pageOffset: chunks[i].pageOffset, pageCount: chunks[i].pageCount };
    });
    return parseModelOutput(mergeChunkOutputs(parts));
  }

  /** Sends one request, retrying once on a fast 429/529 (see BUSY_RETRY_DELAY_MS). */
  private async send(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> {
    const started = this.timing.now();
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.client.messages.create(params, { timeout: EXTRACTION_TIMEOUT_MS, maxRetries: 0 });
      } catch (error) {
        const detail = this.diagnostics ? describeProviderError(error) : undefined;
        if (error instanceof Anthropic.APIConnectionTimeoutError) throw new ExtractionError("timeout", detail);
        // 429 (rate limited) and 529 (overloaded) are transient: tell the user to wait, not to retake the photo.
        if (error instanceof Anthropic.APIError && (error.status === 429 || error.status === 529)) {
          if (attempt === 1 && this.timing.now() - started <= BUSY_RETRY_WITHIN_MS) {
            await this.timing.sleep(BUSY_RETRY_DELAY_MS);
            continue;
          }
          throw new ExtractionError("provider_busy", detail);
        }
        throw new ExtractionError("provider_error", detail);
      }
    }
  }

  /** One schema-constrained request; returns the parsed (not yet validated) JSON. */
  private async request(files: ExtractionFile[], userPrompt: string): Promise<unknown> {
    // Bill first, then the EOB, each introduced so the model knows which is which.
    const ordered = [...files].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "bill" ? -1 : 1));
    const content: Anthropic.ContentBlockParam[] = [
      ...ordered.map(toContentBlock),
      { type: "text", text: userPrompt },
    ];
    const params = {
      model: this.model,
      max_tokens: EXTRACTION_MAX_TOKENS,
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
      output_config: {
        ...(EFFORT_MODELS.includes(this.model) ? { effort: "medium" as const } : {}),
        format: { type: "json_schema", schema: MODEL_OUTPUT_JSON_SCHEMA },
      },
    } satisfies Anthropic.MessageCreateParamsNonStreaming;

    const response = await this.send(params);

    if (response.stop_reason === "refusal") throw new ExtractionError("refused");
    if (response.stop_reason === "max_tokens" || response.stop_reason === "model_context_window_exceeded") {
      throw new ExtractionError("truncated");
    }
    // Anything else that is not a normal finish (tool_use, pause_turn) is not output we can trust.
    if (response.stop_reason !== "end_turn") throw new ExtractionError("invalid_output");

    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") throw new ExtractionError("invalid_output");

    let raw: unknown;
    try {
      raw = JSON.parse(block.text);
    } catch {
      throw new ExtractionError("invalid_output");
    }
    return raw;
  }
}

/** Where a chunk sits in the whole bill, for the chunk prompt. */
function describe(chunks: BillChunk[], chunk: BillChunk) {
  const last = chunks.at(-1)!;
  return {
    firstPage: chunk.pageOffset + 1,
    lastPage: chunk.pageOffset + chunk.pageCount,
    totalPages: last.pageOffset + last.pageCount,
    withEob: chunk.files.some((f) => f.kind === "eob"),
  };
}
