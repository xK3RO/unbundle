import { describe, expect, it } from "vitest";
import { isSummaryStatement, suggestsItemizedRequest, summarizeConfidence } from "./extraction-confidence";

const rows = (...c: ("high" | "medium" | "low")[]) => c.map((confidence) => ({ confidence }));

describe("summarizeConfidence", () => {
  it("handles an empty bill without calling it low", () => {
    expect(summarizeConfidence([])).toEqual({ rowCount: 0, lowCount: 0, low: false });
  });

  it("is not low when most rows are confident", () => {
    expect(summarizeConfidence(rows("high", "medium", "high", "low"))).toMatchObject({
      rowCount: 4,
      lowCount: 1,
      low: false,
    });
  });

  it("is low at exactly half", () => {
    expect(summarizeConfidence(rows("low", "high")).low).toBe(true);
  });

  it("is low when every row is low", () => {
    expect(summarizeConfidence(rows("low", "low", "low")).low).toBe(true);
  });
});

describe("suggestsItemizedRequest", () => {
  it("suggests it when no rows were read", () => {
    expect(suggestsItemizedRequest(summarizeConfidence([]))).toBe(true);
  });

  it("suggests it when at least half the rows are low confidence", () => {
    expect(suggestsItemizedRequest(summarizeConfidence(rows("low", "high")))).toBe(true);
  });

  it("does not suggest it for a confident read", () => {
    expect(suggestsItemizedRequest(summarizeConfidence(rows("high", "high", "low")))).toBe(false);
  });
});

describe("isSummaryStatement", () => {
  const bill = (rowCount: number, totalPrinted: boolean) => ({
    lineItems: rows(...Array<"high">(rowCount).fill("high")) as never,
    totalPrinted,
  });

  it("is a summary statement when a file printed a total but no rows were read", () => {
    expect(isSummaryStatement(bill(0, true), false)).toBe(true);
  });

  it("is not one once any row was read", () => {
    expect(isSummaryStatement(bill(1, true), false)).toBe(false);
  });

  it("is not one when no total was printed either", () => {
    expect(isSummaryStatement(bill(0, false), false)).toBe(false);
  });

  it("never applies to a typed-in bill", () => {
    expect(isSummaryStatement(bill(0, true), true)).toBe(false);
  });
});
