import { z } from "zod";
import { ExtractedBillSchema, type ExtractedBill } from "@/lib/types";
import { ExtractionError } from "./errors";

/**
 * What the model is asked to return. It mirrors ExtractedBill minus the ids we
 * assign ourselves, using only plain JSON-schema types so it can be passed as
 * the structured-output schema. Strict validation happens afterwards, against
 * ExtractedBillSchema, so this schema is deliberately permissive in shape.
 *
 * The API caps union-typed (nullable) parameters at 16 per schema, so only the
 * money fields, where $0.00 is a real value and no sentinel is safe, stay
 * nullable. Text, enum and box fields use sentinels instead: "" for unknown
 * text or date, "UNKNOWN" for codeType, and an all-zero box for no position.
 * toNull() turns them back into null before strict validation.
 */
export const MODEL_SENTINEL = {
  text: "",
  codeType: "UNKNOWN",
} as const;

const ModelLineItemSchema = z.object({
  dateOfService: z.string(),
  code: z.string(),
  codeType: z.enum(["CPT", "HCPCS", "REVENUE", "DRG", "OTHER", "UNKNOWN"]),
  descriptionRaw: z.string(),
  modifiers: z.array(z.string()),
  units: z.number(),
  unitPriceCents: z.number().nullable(),
  chargeCents: z.number(),
  insurancePaidCents: z.number().nullable(),
  patientOwesCents: z.number().nullable(),
  sourcePage: z.number(),
  sourceBox: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
  confidence: z.enum(["high", "medium", "low"]),
});

const ModelEobLineSchema = z.object({
  dateOfService: z.string(),
  code: z.string(),
  billedCents: z.number(),
  allowedCents: z.number().nullable(),
  planPaidCents: z.number().nullable(),
  patientResponsibilityCents: z.number().nullable(),
  denialReason: z.string(),
});

export const ModelOutputSchema = z.object({
  providerName: z.string(),
  serviceStart: z.string(),
  serviceEnd: z.string(),
  totalBilledCents: z.number().nullable(),
  insuranceStatus: z.string(),
  lineItems: z.array(ModelLineItemSchema),
  eobLines: z.array(ModelEobLineSchema),
});

export type ModelOutput = z.infer<typeof ModelOutputSchema>;

/**
 * Rewrites `type: ["string", "null"]` as `anyOf: [{type: "string"}, {type: "null"}]`,
 * the nullable form structured outputs documents. Zod emits the array form.
 */
export function nullableToAnyOf(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(nullableToAnyOf);
  if (node === null || typeof node !== "object") return node;
  const { type, ...rest } = node as Record<string, unknown>;
  const converted = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, nullableToAnyOf(v)]));
  if (Array.isArray(type)) return { ...converted, anyOf: type.map((t) => ({ type: t })) };
  return type === undefined ? converted : { type, ...converted };
}

/** JSON Schema handed to the API as the output format. */
export const MODEL_OUTPUT_JSON_SCHEMA: Record<string, unknown> = (() => {
  const { $schema, ...schema } = z.toJSONSchema(ModelOutputSchema) as Record<string, unknown>;
  void $schema;
  return nullableToAnyOf(schema) as Record<string, unknown>;
})();

/** Sentinel "" (or whitespace only) means the bill did not show the value. */
function textOrNull(value: string): string | null {
  return value.trim() === MODEL_SENTINEL.text ? null : value;
}

/** A zero-area box is the "could not place it" sentinel; real boxes have area. */
function boxOrNull(box: ModelOutput["lineItems"][number]["sourceBox"]) {
  return box.width === 0 && box.height === 0 ? null : box;
}

/**
 * Units 0 is the "not shown" sentinel: many bills print no quantity column.
 * The row is kept as 1 unit and marked low confidence, so the review screen
 * asks the user to confirm it instead of the whole bill failing. Negative or
 * fractional units are left alone and still fail strict validation.
 */
function unitsOrOne(item: ModelOutput["lineItems"][number]) {
  return item.units === 0 ? { units: 1, confidence: "low" as const } : {};
}

/**
 * Validates raw model JSON and turns it into an ExtractedBill. Any failure is
 * the opaque "invalid_output" code: issues are dropped because they can echo
 * values from the bill, and the raw output is never kept.
 */
export function parseModelOutput(raw: unknown): ExtractedBill {
  const lax = ModelOutputSchema.safeParse(raw);
  if (!lax.success) throw new ExtractionError("invalid_output");
  const out = lax.data;

  // No printed total: fall back to the sum of the rows (flagged as not printed, and
  // used only for display; no rule reads it). With no rows there is nothing to add
  // up: EOB lines alone mean an insurer statement was uploaded instead of a bill.
  const totalPrinted = out.totalBilledCents !== null;
  if (!totalPrinted && out.lineItems.length === 0) {
    throw new ExtractionError(out.eobLines.length > 0 ? "eob_only" : "invalid_output");
  }
  const totalBilledCents = out.totalBilledCents ?? out.lineItems.reduce((sum, item) => sum + item.chargeCents, 0);

  const strict = ExtractedBillSchema.safeParse({
    ...out,
    totalBilledCents,
    totalPrinted,
    serviceStart: textOrNull(out.serviceStart),
    serviceEnd: textOrNull(out.serviceEnd),
    insuranceStatus: textOrNull(out.insuranceStatus),
    lineItems: out.lineItems.map((item, i) => ({
      ...item,
      id: `li-${i + 1}`,
      userVerified: false,
      dateOfService: textOrNull(item.dateOfService),
      code: textOrNull(item.code),
      codeType: item.codeType === MODEL_SENTINEL.codeType ? null : item.codeType,
      sourceBox: boxOrNull(item.sourceBox),
      ...unitsOrOne(item),
    })),
    eobLines: out.eobLines.map((line, i) => ({
      ...line,
      id: `eob-${i + 1}`,
      dateOfService: textOrNull(line.dateOfService),
      code: textOrNull(line.code),
      denialReason: textOrNull(line.denialReason),
    })),
  });
  if (!strict.success) throw new ExtractionError("invalid_output");
  return strict.data;
}
