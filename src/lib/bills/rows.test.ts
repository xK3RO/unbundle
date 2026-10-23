import { describe, expect, it } from "vitest";
import { ExtractedBillSchema } from "@/lib/types";
import demoBill from "../../../fixtures/review/demo-bill.json";
import { billToRow, lineItemToRow, rowToLineItem, rowsToBill } from "./rows";

const lineRow = {
  id: "11111111-1111-4111-8111-111111111111",
  date_of_service: "2026-09-12",
  code: "99213",
  code_type: "CPT",
  description_raw: "OFFICE VISIT",
  modifiers: ["25"],
  units: 1,
  unit_price_cents: 15500,
  charge_cents: 15500,
  insurance_paid_cents: null,
  patient_owes_cents: null,
  source_page: 1,
  source_box: { x: 0.1, y: 0.2, width: 0.5, height: 0.05 },
  confidence: "high",
  user_verified: true,
};

describe("rowToLineItem", () => {
  it("maps a full row", () => {
    expect(rowToLineItem(lineRow)).toMatchObject({
      id: lineRow.id,
      dateOfService: "2026-09-12",
      modifiers: ["25"],
      chargeCents: 15500,
      userVerified: true,
    });
  });

  it("applies safe defaults for nullable columns, with unknown confidence treated as low", () => {
    const item = rowToLineItem({
      ...lineRow,
      modifiers: null,
      units: null,
      confidence: null,
      user_verified: null,
      source_page: null,
      description_raw: null,
      charge_cents: null,
    });
    expect(item).toMatchObject({
      modifiers: [],
      units: 1,
      confidence: "low",
      userVerified: false,
      sourcePage: 1,
      descriptionRaw: "",
      chargeCents: 0,
    });
  });

  it("rejects a malformed row instead of passing it on", () => {
    expect(() => rowToLineItem({ ...lineRow, charge_cents: "12" })).toThrow();
    expect(() => rowToLineItem({ ...lineRow, units: 1.5 })).toThrow();
    expect(() => rowToLineItem({ ...lineRow, confidence: "sure" })).toThrow();
    expect(() => rowToLineItem({ ...lineRow, source_box: { x: 2, y: 0, width: 1, height: 1 } })).toThrow();
  });
});

describe("rowsToBill", () => {
  it("builds a validated bill and keeps null provider as empty", () => {
    const bill = rowsToBill(
      {
        provider_name: null,
        service_start: null,
        service_end: null,
        total_billed_cents: 15500,
        insurance_status: null,
        extraction_status: "needs_review",
      },
      [lineRow],
      [],
    );
    expect(bill.providerName).toBe("");
    expect(bill.lineItems).toHaveLength(1);
    expect(bill.totalPrinted).toBe(true);
  });

  it("reads a null total as not printed and shows the sum of the rows", () => {
    const bill = rowsToBill(
      {
        provider_name: "Clinic",
        service_start: null,
        service_end: null,
        total_billed_cents: null,
        insurance_status: null,
        extraction_status: "needs_review",
      },
      [lineRow, { ...lineRow, id: "22222222-2222-4222-8222-222222222222", charge_cents: 4500 }],
      [],
    );
    expect(bill.totalBilledCents).toBe(20000);
    expect(bill.totalPrinted).toBe(false);
  });

  it("shows 0 for a null total with no rows", () => {
    const bill = rowsToBill(
      { provider_name: null, service_start: null, service_end: null, total_billed_cents: null, insurance_status: null, extraction_status: "needs_review" },
      [],
      [],
    );
    expect(bill.totalBilledCents).toBe(0);
    expect(bill.totalPrinted).toBe(false);
  });
});

describe("lineItemToRow / billToRow round trip", () => {
  it("writes snake_case rows owned by the user and always unverified", () => {
    const bill = ExtractedBillSchema.parse(demoBill);
    const row = lineItemToRow(bill.lineItems[0], { userId: "u", billId: "b", index: 3 });
    expect(row).toMatchObject({
      user_id: "u",
      bill_id: "b",
      sort_order: 3,
      user_verified: false,
      modifiers: ["25"],
      charge_cents: 15500,
    });
    expect(row).not.toHaveProperty("id");
    expect(billToRow(bill)).toMatchObject({ total_billed_cents: bill.totalBilledCents });
  });

  it("stores a total that was not printed as null, so it is re-added from the rows on read", () => {
    const bill = ExtractedBillSchema.parse({ ...demoBill, totalPrinted: false });
    expect(billToRow(bill).total_billed_cents).toBeNull();
  });
});
