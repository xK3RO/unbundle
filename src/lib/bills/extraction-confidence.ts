import type { ExtractedBill, LineItem } from "@/lib/types";

/**
 * Summary of how sure the extraction was, for the review screen. Reads only
 * the per-row confidence labels; it never inspects bill text.
 */
export type ExtractionConfidence = {
  rowCount: number;
  lowCount: number;
  /** True when at least half of the rows were read with low confidence. */
  low: boolean;
};

export function summarizeConfidence(items: readonly Pick<LineItem, "confidence">[]): ExtractionConfidence {
  const rowCount = items.length;
  const lowCount = items.filter((item) => item.confidence === "low").length;
  return { rowCount, lowCount, low: rowCount > 0 && lowCount * 2 >= rowCount };
}

/**
 * Whether the dashboard should point the user at the itemized-bill request:
 * the bill had no readable rows, or most of what was read was low confidence.
 */
export function suggestsItemizedRequest(summary: ExtractionConfidence): boolean {
  return summary.rowCount === 0 || summary.low;
}

/**
 * A bill read from a file that printed a total but no separate charges: a
 * summary statement. There is nothing to check line by line, so the review
 * screen points the user at the itemized-bill request. Typed-in bills are
 * left out (their total is the sum of the rows they typed).
 */
export function isSummaryStatement(
  bill: Pick<ExtractedBill, "lineItems" | "totalPrinted">,
  manual: boolean,
): boolean {
  return !manual && bill.lineItems.length === 0 && bill.totalPrinted;
}
