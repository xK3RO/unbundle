import type { ExtractedBill, LineItem } from "@/lib/types";

/**
 * A heads-up for the review screen when the rows don't fit the bill they were
 * read from. It never changes, drops or adds a row and is not a finding (rules
 * live in src/lib/rules); it only asks the user to check the rows against the
 * paper. Uploads that bundle two statements, or the same page twice, are the
 * usual cause.
 */
export type TotalCheck = {
  /** The rows add up to more than the total printed on the bill. */
  overTotal: { rowsCents: number; totalCents: number } | null;
  /** A page lists exactly the same rows, in the same order, as an earlier page. */
  repeatedPage: { page: number; earlierPage: number } | null;
};

type Row = Pick<LineItem, "sourcePage" | "dateOfService" | "code" | "units" | "chargeCents">;

/** A page needs at least this many rows to count as a repeat; one matching row is common. */
const MIN_REPEATED_ROWS = 2;

const signature = (row: Row) => [row.dateOfService ?? "", row.code ?? "", row.units, row.chargeCents].join("|");

function findRepeatedPage(rows: readonly Row[]): TotalCheck["repeatedPage"] {
  const pages = new Map<number, string[]>();
  for (const row of rows) {
    if (!Number.isInteger(row.sourcePage) || row.sourcePage < 1) continue;
    const list = pages.get(row.sourcePage) ?? [];
    list.push(signature(row));
    pages.set(row.sourcePage, list);
  }
  const seen = new Map<string, number>();
  for (const [page, list] of [...pages.entries()].sort(([a], [b]) => a - b)) {
    if (list.length < MIN_REPEATED_ROWS) continue;
    const key = list.join("\n");
    const earlierPage = seen.get(key);
    if (earlierPage !== undefined) return { page, earlierPage };
    seen.set(key, page);
  }
  return null;
}

export function checkRowsAgainstTotal(
  bill: Pick<ExtractedBill, "totalBilledCents" | "totalPrinted">,
  rows: readonly Row[],
): TotalCheck {
  const rowsCents = rows.reduce((sum, row) => sum + row.chargeCents, 0);
  // Without a printed total the total is the row sum, so there is nothing to compare.
  const overTotal =
    bill.totalPrinted && rowsCents > bill.totalBilledCents ? { rowsCents, totalCents: bill.totalBilledCents } : null;
  return { overTotal, repeatedPage: findRepeatedPage(rows) };
}
