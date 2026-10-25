import { describe, expect, it } from "vitest";
import good from "../../../fixtures/extraction/model-output-good.json";
import { ExtractionError } from "./errors";
import { MODEL_OUTPUT_JSON_SCHEMA, nullableToAnyOf, parseModelOutput } from "./model-schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const clone = () => structuredClone(good) as Record<string, any>;

function code(raw: unknown) {
  try {
    parseModelOutput(raw);
  } catch (e) {
    if (e instanceof ExtractionError) return e.code;
    throw e;
  }
  return null;
}

describe("parseModelOutput", () => {
  it("accepts good output and assigns ids, unverified rows, modifiers and a low-confidence row", () => {
    const bill = parseModelOutput(good);
    expect(bill.lineItems.map((i) => i.id)).toEqual(
      bill.lineItems.map((_, i) => `li-${i + 1}`),
    );
    expect(bill.lineItems.every((i) => i.userVerified === false)).toBe(true);
    expect(bill.lineItems.some((i) => i.modifiers.length > 0)).toBe(true);
    expect(bill.lineItems.some((i) => i.confidence === "low")).toBe(true);
    expect(bill.eobLines).toHaveLength(1);
    expect(bill.totalBilledCents).toBe(good.totalBilledCents);
  });

  it("rejects non-object output", () => {
    for (const raw of [null, "text", 42, [], undefined]) expect(code(raw)).toBe("invalid_output");
  });

  it("rejects missing required fields", () => {
    const raw = clone();
    delete raw.lineItems;
    expect(code(raw)).toBe("invalid_output");
  });

  it("rejects a float amount (money must be integer cents)", () => {
    const raw = clone();
    raw.lineItems[0].chargeCents = 155.5;
    expect(code(raw)).toBe("invalid_output");
  });

  it("rejects amounts sent as strings", () => {
    const raw = clone();
    raw.lineItems[0].chargeCents = "$155.00";
    expect(code(raw)).toBe("invalid_output");
  });

  it("rejects an invalid or non-ISO date", () => {
    for (const date of ["09/12/2026", "2026-13-40"]) {
      const raw = clone();
      raw.lineItems[0].dateOfService = date;
      expect(code(raw)).toBe("invalid_output");
    }
  });

  it("rejects malformed modifiers", () => {
    const raw = clone();
    raw.lineItems[0].modifiers = ["abc"];
    expect(code(raw)).toBe("invalid_output");
  });

  it("rejects an unknown confidence value", () => {
    const raw = clone();
    raw.lineItems[0].confidence = "certain";
    expect(code(raw)).toBe("invalid_output");
  });

  it("rejects an out-of-range bounding box", () => {
    const raw = clone();
    raw.lineItems[0].sourceBox = { x: 1.5, y: 0, width: 0.5, height: 0.1 };
    expect(code(raw)).toBe("invalid_output");
  });

  it("rejects negative or fractional units", () => {
    for (const units of [-1, 1.5]) {
      const raw = clone();
      raw.lineItems[0].units = units;
      expect(code(raw)).toBe("invalid_output");
    }
  });

  it("uses the sum of the rows when no total is printed, and marks it not printed", () => {
    const raw = clone();
    raw.totalBilledCents = null;
    const bill = parseModelOutput(raw);
    const sum = raw.lineItems.reduce((s: number, l: { chargeCents: number }) => s + l.chargeCents, 0);
    expect(bill.totalBilledCents).toBe(sum);
    expect(bill.totalPrinted).toBe(false);
  });

  it("marks a printed total as printed, even when it differs from the rows", () => {
    const raw = clone();
    raw.totalBilledCents = 1;
    const bill = parseModelOutput(raw);
    expect(bill.totalBilledCents).toBe(1);
    expect(bill.totalPrinted).toBe(true);
  });

  it("calls a document with EOB lines but no bill rows and no total eob_only", () => {
    const raw = clone();
    raw.totalBilledCents = null;
    raw.lineItems = [];
    expect(code(raw)).toBe("eob_only");
  });

  it("still rejects output with no rows, no EOB lines and no total", () => {
    const raw = clone();
    raw.totalBilledCents = null;
    raw.lineItems = [];
    raw.eobLines = [];
    expect(code(raw)).toBe("invalid_output");
  });

  it("keeps a printed total when there are no rows (summary statements)", () => {
    const raw = clone();
    raw.lineItems = [];
    raw.eobLines = [];
    const bill = parseModelOutput(raw);
    expect(bill.totalBilledCents).toBe(raw.totalBilledCents);
    expect(bill.totalPrinted).toBe(true);
  });

  it("accepts an empty bill with no line items", () => {
    const raw = clone();
    raw.lineItems = [];
    raw.eobLines = [];
    expect(code(raw)).toBeNull();
  });

  it("errors carry only the opaque code, no values from the output", () => {
    const raw = clone();
    raw.providerName = "SECRET PROVIDER NAME";
    raw.lineItems[0].chargeCents = "SECRET";
    try {
      parseModelOutput(raw);
    } catch (e) {
      expect(String((e as Error).message)).toBe("invalid_output");
      expect(JSON.stringify(e)).not.toContain("SECRET");
    }
  });
});

describe("MODEL_OUTPUT_JSON_SCHEMA", () => {
  it("is a plain object schema without $schema", () => {
    expect(MODEL_OUTPUT_JSON_SCHEMA.type).toBe("object");
    expect(MODEL_OUTPUT_JSON_SCHEMA).not.toHaveProperty("$schema");
    expect(MODEL_OUTPUT_JSON_SCHEMA.additionalProperties).toBe(false);
  });
});

function countUnions(node: unknown): number {
  if (Array.isArray(node)) return node.reduce((n: number, v) => n + countUnions(v), 0);
  if (node === null || typeof node !== "object") return 0;
  const o = node as Record<string, unknown>;
  const own = Array.isArray(o.anyOf) || Array.isArray(o.type) ? 1 : 0;
  return own + Object.values(o).reduce((n: number, v) => n + countUnions(v), 0);
}

describe("sentinel mapping", () => {
  const ZERO_BOX = { x: 0, y: 0, width: 0, height: 0 };

  it("maps every sentinel field to null", () => {
    const raw = clone();
    Object.assign(raw, { serviceStart: "", serviceEnd: "", insuranceStatus: "" });
    Object.assign(raw.lineItems[0], { dateOfService: "", code: "", codeType: "UNKNOWN", sourceBox: ZERO_BOX });
    Object.assign(raw.eobLines[0], { dateOfService: "", code: "", denialReason: "" });
    const bill = parseModelOutput(raw);
    expect(bill.serviceStart).toBeNull();
    expect(bill.serviceEnd).toBeNull();
    expect(bill.insuranceStatus).toBeNull();
    const li = bill.lineItems[0];
    expect([li.dateOfService, li.code, li.codeType, li.sourceBox]).toEqual([null, null, null, null]);
    const eob = bill.eobLines[0];
    expect([eob.dateOfService, eob.code, eob.denialReason]).toEqual([null, null, null]);
  });

  it("treats whitespace-only text as unknown", () => {
    const raw = clone();
    raw.lineItems[0].code = "   ";
    expect(parseModelOutput(raw).lineItems[0].code).toBeNull();
  });

  it("keeps real values, including a real box and a real code type", () => {
    const bill = parseModelOutput(good);
    expect(bill.lineItems[0].code).toBe(good.lineItems[0].code);
    expect(bill.lineItems[0].codeType).toBe("CPT");
    expect(bill.lineItems[0].dateOfService).toBe(good.lineItems[0].dateOfService);
    expect(bill.lineItems[0].sourceBox).toEqual(good.lineItems[0].sourceBox);
  });

  it("never turns an invalid value into null", () => {
    const raw = clone();
    raw.lineItems[0].dateOfService = "09/12/2026";
    expect(code(raw)).toBe("invalid_output");
  });

  it("preserves real zero values", () => {
    const raw = clone();
    Object.assign(raw.lineItems[0], {
      chargeCents: 0,
      unitPriceCents: 0,
      insurancePaidCents: 0,
      patientOwesCents: 0,
    });
    Object.assign(raw.eobLines[0], { billedCents: 0, allowedCents: 0, planPaidCents: 0, patientResponsibilityCents: 0 });
    const bill = parseModelOutput(raw);
    const li = bill.lineItems[0];
    expect([li.chargeCents, li.unitPriceCents, li.insurancePaidCents, li.patientOwesCents]).toEqual([0, 0, 0, 0]);
    const eob = bill.eobLines[0];
    expect([eob.billedCents, eob.allowedCents, eob.planPaidCents, eob.patientResponsibilityCents]).toEqual([0, 0, 0, 0]);
  });

  it("preserves a real $0.00 bill total and keeps null amounts null", () => {
    const raw = clone();
    raw.totalBilledCents = 0;
    expect(parseModelOutput(raw).totalBilledCents).toBe(0);
    expect(parseModelOutput(good).lineItems[0].insurancePaidCents).toBeNull();
  });

  it("reads zero units (no quantity printed) as 1 and marks the row low confidence for review", () => {
    const raw = clone();
    raw.lineItems[0].units = 0;
    raw.lineItems[0].confidence = "high";
    const row = parseModelOutput(raw).lineItems[0];
    expect(row.units).toBe(1);
    expect(row.confidence).toBe("low");
    expect(row.chargeCents).toBe(raw.lineItems[0].chargeCents);
  });

  it("leaves printed units and confidence untouched", () => {
    const raw = clone();
    raw.lineItems[0].units = 3;
    raw.lineItems[0].confidence = "high";
    const row = parseModelOutput(raw).lineItems[0];
    expect(row.units).toBe(3);
    expect(row.confidence).toBe("high");
  });
});

describe("MODEL_OUTPUT_JSON_SCHEMA", () => {
  function typeArrays(node: unknown, path = "$"): string[] {
    if (Array.isArray(node)) return node.flatMap((v, i) => typeArrays(v, `${path}[${i}]`));
    if (node === null || typeof node !== "object") return [];
    return Object.entries(node).flatMap(([k, v]) =>
      k === "type" && Array.isArray(v) ? [`${path}.type`] : typeArrays(v, `${path}.${k}`),
    );
  }

  it("never uses an array for a type", () => {
    expect(typeArrays(MODEL_OUTPUT_JSON_SCHEMA)).toEqual([]);
  });

  it("expresses nullable fields as anyOf", () => {
    const props = (MODEL_OUTPUT_JSON_SCHEMA.properties as Record<string, unknown>);
    expect(props.serviceStart).toEqual({ type: "string" });
    expect(props.totalBilledCents).toEqual({ anyOf: [{ type: "number" }, { type: "null" }] });
  });

  it("stays at or under 15 union-typed parameters (API limit is 16)", () => {
    expect(countUnions(MODEL_OUTPUT_JSON_SCHEMA)).toBeLessThanOrEqual(15);
  });

  it("converts nested type arrays and leaves other nodes alone", () => {
    const input = {
      type: "object",
      properties: { a: { type: ["integer", "null"] }, b: { type: "string" }, c: { type: "array", items: { type: ["string", "null"] } } },
      required: ["a"],
    };
    expect(nullableToAnyOf(input)).toEqual({
      type: "object",
      properties: {
        a: { anyOf: [{ type: "integer" }, { type: "null" }] },
        b: { type: "string" },
        c: { type: "array", items: { anyOf: [{ type: "string" }, { type: "null" }] } },
      },
      required: ["a"],
    });
  });
});
