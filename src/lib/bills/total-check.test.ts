import { describe, expect, it } from "vitest";
import { checkRowsAgainstTotal } from "./total-check";

const row = (sourcePage: number, chargeCents: number, code: string | null = "99213", dateOfService: string | null = "2026-03-01") => ({
  sourcePage,
  chargeCents,
  code,
  dateOfService,
  units: 1,
});
const printed = (totalBilledCents: number) => ({ totalBilledCents, totalPrinted: true });

describe("checkRowsAgainstTotal: over the printed total", () => {
  it("flags rows that add up to more than the printed total", () => {
    const check = checkRowsAgainstTotal(printed(1000), [row(1, 700), row(2, 400, "85025")]);
    expect(check.overTotal).toEqual({ rowsCents: 1100, totalCents: 1000 });
  });

  it("is quiet when the rows equal the total", () => {
    expect(checkRowsAgainstTotal(printed(1100), [row(1, 700), row(1, 400, "85025")]).overTotal).toBeNull();
  });

  it("is quiet when the rows fall short of the total (fees and rows not read are common)", () => {
    expect(checkRowsAgainstTotal(printed(5000), [row(1, 700)]).overTotal).toBeNull();
  });

  it("flags a single cent over", () => {
    expect(checkRowsAgainstTotal(printed(999), [row(1, 1000)]).overTotal).toEqual({ rowsCents: 1000, totalCents: 999 });
  });

  it("never compares against a total that was itself added up from the rows", () => {
    expect(checkRowsAgainstTotal({ totalBilledCents: 0, totalPrinted: false }, [row(1, 700)]).overTotal).toBeNull();
  });

  it("flags rows over a printed $0.00 total", () => {
    expect(checkRowsAgainstTotal(printed(0), [row(1, 1)]).overTotal).toEqual({ rowsCents: 1, totalCents: 0 });
  });

  it("is quiet with no rows", () => {
    expect(checkRowsAgainstTotal(printed(1000), [])).toEqual({ overTotal: null, repeatedPage: null });
  });

  it("counts negative rows (credits) in the sum", () => {
    expect(checkRowsAgainstTotal(printed(1000), [row(1, 1200), row(1, -300, "CREDIT")]).overTotal).toBeNull();
  });
});

describe("checkRowsAgainstTotal: repeated page", () => {
  const page = (p: number) => [row(p, 100, "36415"), row(p, 2900, "80053"), row(p, 4550, "80061")];

  it("finds a page that repeats an earlier page's rows", () => {
    const check = checkRowsAgainstTotal(printed(7550), [...page(1), ...page(2)]);
    expect(check.repeatedPage).toEqual({ page: 2, earlierPage: 1 });
  });

  it("names the first repeat in page order", () => {
    const rows = [...page(3), row(4, 1, "A"), row(4, 2, "B"), ...page(5), ...page(6)];
    expect(checkRowsAgainstTotal(printed(0), rows).repeatedPage).toEqual({ page: 5, earlierPage: 3 });
  });

  it("ignores pages with a single row, since one matching charge is common", () => {
    expect(checkRowsAgainstTotal(printed(200), [row(1, 100), row(2, 100)]).repeatedPage).toBeNull();
  });

  it("ignores pages whose rows differ in any field or in order", () => {
    const [a, b, c] = page(2);
    expect(checkRowsAgainstTotal(printed(0), [...page(1), { ...a, units: 2 }, b, c]).repeatedPage).toBeNull();
    expect(checkRowsAgainstTotal(printed(0), [...page(1), { ...a, dateOfService: "2026-03-02" }, b, c]).repeatedPage).toBeNull();
    expect(checkRowsAgainstTotal(printed(0), [...page(1), b, a, c]).repeatedPage).toBeNull();
  });

  it("does not treat repeated rows on one page as a repeated page", () => {
    expect(checkRowsAgainstTotal(printed(0), [...page(1), ...page(1)]).repeatedPage).toBeNull();
  });

  it("matches rows with no code or date as long as everything else agrees", () => {
    const blank = (p: number) => [row(p, 500, null, null), row(p, 700, null, null)];
    expect(checkRowsAgainstTotal(printed(0), [...blank(1), ...blank(2)]).repeatedPage).toEqual({ page: 2, earlierPage: 1 });
  });

  it("skips rows without a usable page number", () => {
    const rows = [...page(1), ...page(0), ...page(-1)];
    expect(checkRowsAgainstTotal(printed(0), rows).repeatedPage).toBeNull();
  });

  it("is reported even when the rows don't exceed the total", () => {
    const check = checkRowsAgainstTotal(printed(1_000_000), [...page(1), ...page(2)]);
    expect(check.overTotal).toBeNull();
    expect(check.repeatedPage).toEqual({ page: 2, earlierPage: 1 });
  });
});
