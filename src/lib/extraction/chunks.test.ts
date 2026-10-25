import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import good from "../../../fixtures/extraction/model-output-good.json";
import { PAGES_PER_CHUNK, mergeChunkOutputs, splitIntoChunks, wholeBillPage } from "./chunks";
import type { ModelOutput } from "./model-schema";
import type { ExtractionFile } from "./types";

async function pdfOf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200 + i, 300]); // width marks the page
  return doc.save();
}
const pdfFile = async (pages: number, kind: ExtractionFile["kind"] = "bill"): Promise<ExtractionFile> => ({
  kind,
  mimeType: "application/pdf",
  bytes: await pdfOf(pages),
});
const img = (n: number, kind: ExtractionFile["kind"] = "bill"): ExtractionFile => ({
  kind,
  mimeType: "image/jpeg",
  bytes: new Uint8Array([n]),
});
async function widths(file: ExtractionFile) {
  const doc = await PDFDocument.load(file.bytes);
  return doc.getPages().map((p) => p.getWidth());
}

describe("splitIntoChunks", () => {
  it("reads one page per request", () => {
    expect(PAGES_PER_CHUNK).toBe(1);
  });

  it("leaves a one-page bill as one chunk with every file", async () => {
    const files = [await pdfFile(1), img(9, "eob")];
    const chunks = await splitIntoChunks(files);
    expect(chunks).toEqual([{ files, pageOffset: 0, pageCount: 1 }]);
  });

  it("leaves a single image as one chunk", async () => {
    const chunks = await splitIntoChunks([img(1)]);
    expect(chunks).toHaveLength(1);
  });

  it("splits a five-page PDF into one-page PDFs, in order", async () => {
    const chunks = await splitIntoChunks([await pdfFile(5)]);
    expect(chunks.map((c) => [c.pageOffset, c.pageCount])).toEqual([[0, 1], [1, 1], [2, 1], [3, 1], [4, 1]]);
    expect(await Promise.all(chunks.map((c) => widths(c.files[0])))).toEqual([[200], [201], [202], [203], [204]]);
  });

  it("splits a two-page PDF too, since two dense pages can pass the output cap", async () => {
    expect(await splitIntoChunks([await pdfFile(2)])).toHaveLength(2);
  });

  it("sends each page image alone and attaches the EOB to the first chunk only", async () => {
    const eob = img(99, "eob");
    const chunks = await splitIntoChunks([img(1), img(2), img(3), eob]);
    expect(chunks.map((c) => c.files.map((f) => f.bytes[0]))).toEqual([[1, 99], [2], [3]]);
    expect(chunks.map((c) => c.pageOffset)).toEqual([0, 1, 2]);
  });

  it("counts pages across mixed images and PDFs", async () => {
    const chunks = await splitIntoChunks([img(1), await pdfFile(2), img(2)]);
    expect(chunks.map((c) => [c.pageOffset, c.pageCount, c.files[0].mimeType])).toEqual([
      [0, 1, "image/jpeg"],
      [1, 1, "application/pdf"],
      [2, 1, "application/pdf"],
      [3, 1, "image/jpeg"],
    ]);
  });

  it("does not count EOB pages toward the bill", async () => {
    const chunks = await splitIntoChunks([await pdfFile(1), await pdfFile(4, "eob")]);
    expect(chunks).toHaveLength(1);
  });

  it("sends a PDF it cannot parse whole, as before", async () => {
    const broken: ExtractionFile = { kind: "bill", mimeType: "application/pdf", bytes: new Uint8Array([0x25]) };
    const files = [broken, img(1), img(2)];
    expect(await splitIntoChunks(files)).toEqual([{ files, pageOffset: 0, pageCount: 3 }]);
  });
});

describe("wholeBillPage", () => {
  it("shifts a page counted within the chunk", () => {
    expect(wholeBillPage(1, { pageOffset: 3, pageCount: 1 })).toBe(4);
    expect(wholeBillPage(2, { pageOffset: 4, pageCount: 2 })).toBe(6);
  });

  it("keeps a page the model already numbered in the whole bill", () => {
    expect(wholeBillPage(4, { pageOffset: 3, pageCount: 1 })).toBe(4);
    expect(wholeBillPage(6, { pageOffset: 4, pageCount: 2 })).toBe(6);
  });

  it("puts any other page on the chunk's first page", () => {
    expect(wholeBillPage(0, { pageOffset: 3, pageCount: 1 })).toBe(4);
    expect(wholeBillPage(-1, { pageOffset: 3, pageCount: 1 })).toBe(4);
    expect(wholeBillPage(9, { pageOffset: 3, pageCount: 1 })).toBe(4);
    expect(wholeBillPage(1.5, { pageOffset: 3, pageCount: 1 })).toBe(4);
  });

  it("leaves the first chunk's pages alone", () => {
    expect(wholeBillPage(1, { pageOffset: 0, pageCount: 1 })).toBe(1);
  });
});

describe("mergeChunkOutputs", () => {
  const base = good as unknown as ModelOutput;
  const out = (over: Partial<ModelOutput>): ModelOutput => ({ ...base, eobLines: [], ...over });
  const rows = (...pages: number[]) => pages.map((sourcePage) => ({ ...base.lineItems[0], sourcePage }));

  it("shifts each part's pages to the whole bill and keeps page order", () => {
    const merged = mergeChunkOutputs([
      { output: out({ lineItems: rows(1, 2) }), pageOffset: 0, pageCount: 2 },
      { output: out({ lineItems: rows(1) }), pageOffset: 2, pageCount: 1 },
      { output: out({ lineItems: rows(1, 4) }), pageOffset: 3, pageCount: 1 },
    ]);
    expect(merged.lineItems.map((i) => i.sourcePage)).toEqual([1, 2, 3, 4, 4]);
  });

  it("uses the largest printed total, so a visit subtotal never replaces the grand total", () => {
    const parts = (a: number | null, b: number | null) => [
      { output: out({ totalBilledCents: a }), pageOffset: 0, pageCount: 1 },
      { output: out({ totalBilledCents: b }), pageOffset: 2, pageCount: 1 },
    ];
    expect(mergeChunkOutputs(parts(500, null)).totalBilledCents).toBe(500);
    expect(mergeChunkOutputs(parts(null, 700)).totalBilledCents).toBe(700);
    expect(mergeChunkOutputs(parts(500, 700)).totalBilledCents).toBe(700);
    expect(mergeChunkOutputs(parts(59800, 48700)).totalBilledCents).toBe(59800);
    expect(mergeChunkOutputs(parts(null, null)).totalBilledCents).toBeNull();
    expect(mergeChunkOutputs(parts(0, null)).totalBilledCents).toBe(0);
  });

  it("takes the first provider and insurance phrase found and the widest service dates", () => {
    const merged = mergeChunkOutputs([
      { output: out({ providerName: "", insuranceStatus: "", serviceStart: "2026-03-02", serviceEnd: "2026-03-04" }), pageOffset: 0, pageCount: 1 },
      { output: out({ providerName: "Clinic A", insuranceStatus: "self pay", serviceStart: "", serviceEnd: "" }), pageOffset: 2, pageCount: 1 },
      { output: out({ providerName: "Clinic B", insuranceStatus: "", serviceStart: "2026-03-01", serviceEnd: "2026-03-09" }), pageOffset: 4, pageCount: 1 },
    ]);
    expect(merged.providerName).toBe("Clinic A");
    expect(merged.insuranceStatus).toBe("self pay");
    expect(merged.serviceStart).toBe("2026-03-01");
    expect(merged.serviceEnd).toBe("2026-03-09");
  });

  it("leaves dates and names blank when no part shows them", () => {
    const blank = out({ providerName: " ", serviceStart: "", serviceEnd: "", insuranceStatus: "" });
    const merged = mergeChunkOutputs([{ output: blank, pageOffset: 0, pageCount: 1 }, { output: blank, pageOffset: 2, pageCount: 1 }]);
    expect([merged.providerName, merged.serviceStart, merged.serviceEnd, merged.insuranceStatus]).toEqual(["", "", "", ""]);
  });

  it("keeps EOB lines from every part", () => {
    const eob = { dateOfService: "", code: "99213", billedCents: 100, allowedCents: null, planPaidCents: null, patientResponsibilityCents: null, denialReason: "" };
    const merged = mergeChunkOutputs([
      { output: out({ eobLines: [eob] }), pageOffset: 0, pageCount: 1 },
      { output: out({ eobLines: [] }), pageOffset: 2, pageCount: 1 },
    ]);
    expect(merged.eobLines).toEqual([eob]);
  });
});
