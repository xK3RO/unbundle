import { PDFDocument } from "pdf-lib";
import type { ModelOutput } from "./model-schema";
import type { ExtractionFile } from "./types";

/**
 * Multi-page bills are read one page per request, all at once. One request for
 * a 5-page bill ran past the output cap (every row carries a box and a
 * description), and so did two dense pages of about 44 rows each. One such page
 * used about 10,000 tokens (under two-thirds of the cap) and under 30 seconds.
 */
export const PAGES_PER_CHUNK = 1;

/** One request's worth of the bill: its files, the bill page it starts on (0-based) and its bill page count. */
export type BillChunk = { files: ExtractionFile[]; pageOffset: number; pageCount: number };

async function pdfPageCount(bytes: Uint8Array): Promise<number | null> {
  try {
    return (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount();
  } catch {
    return null; // Unreadable here: send it whole and let the API decide, as before.
  }
}

async function pdfPages(bytes: Uint8Array, from: number, to: number): Promise<Uint8Array> {
  const source = await PDFDocument.load(bytes, { updateMetadata: false });
  const out = await PDFDocument.create();
  const indices = Array.from({ length: to - from }, (_, i) => from + i);
  for (const page of await out.copyPages(source, indices)) out.addPage(page);
  return out.save();
}

/**
 * Splits the bill into chunks of at most PAGES_PER_CHUNK pages, in page order.
 * An image is one page; a PDF is split into smaller PDFs. A bill that fits in
 * one chunk comes back as a single chunk with every file, EOB included. For a
 * longer bill the EOB rides with the first chunk only, so its lines are read once.
 */
export async function splitIntoChunks(files: ExtractionFile[]): Promise<BillChunk[]> {
  const bill = files.filter((f) => f.kind === "bill");
  const eob = files.filter((f) => f.kind !== "bill");

  const counts = await Promise.all(
    bill.map((f) => (f.mimeType === "application/pdf" ? pdfPageCount(f.bytes) : Promise.resolve(1))),
  );
  const totalPages = counts.reduce<number>((sum, n) => sum + (n ?? 1), 0);
  if (totalPages <= PAGES_PER_CHUNK || counts.some((n) => n === null)) {
    return [{ files, pageOffset: 0, pageCount: totalPages }];
  }

  const chunks: BillChunk[] = [];
  let pending: ExtractionFile[] = [];
  let pendingStart = 0;
  let page = 0;
  const flush = () => {
    if (pending.length > 0) chunks.push({ files: pending, pageOffset: pendingStart, pageCount: pending.length });
    pending = [];
  };

  for (const [i, file] of bill.entries()) {
    if (file.mimeType !== "application/pdf") {
      if (pending.length === 0) pendingStart = page;
      pending.push(file);
      page += 1;
      if (pending.length === PAGES_PER_CHUNK) flush();
      continue;
    }
    flush();
    const count = counts[i]!;
    for (let from = 0; from < count; from += PAGES_PER_CHUNK) {
      const to = Math.min(from + PAGES_PER_CHUNK, count);
      const bytes = await pdfPages(file.bytes, from, to);
      chunks.push({ files: [{ ...file, bytes }], pageOffset: page + from, pageCount: to - from });
    }
    page += count;
  }
  flush();

  chunks[0] = { ...chunks[0], files: [...chunks[0].files, ...eob] };
  return chunks;
}

/**
 * A row's page in the whole bill. The model is asked to count from 1 within
 * the chunk, but sometimes answers with the page's number in the whole bill
 * (the prompt names it). Either is mapped back into the chunk's pages; anything
 * else is put on the chunk's first page, which for a one-page chunk is exact.
 */
export function wholeBillPage(sourcePage: number, chunk: { pageOffset: number; pageCount: number }): number {
  const { pageOffset, pageCount } = chunk;
  if (sourcePage >= 1 && sourcePage <= pageCount) return pageOffset + sourcePage;
  if (sourcePage > pageOffset && sourcePage <= pageOffset + pageCount) return sourcePage;
  return pageOffset + 1;
}

const firstText = (values: string[]) => values.find((v) => v.trim() !== "") ?? "";
const knownDates = (values: string[]) => values.filter((v) => v.trim() !== "").sort();

/**
 * Joins the chunks' outputs into one, as if the bill had been read in one go:
 * rows and EOB lines in page order with sourcePage mapped to the whole bill,
 * the first provider name and insurance phrase found, the earliest service
 * start and latest service end. The total is the largest one printed: a page
 * read alone can't tell a visit's subtotal from the bill's grand total, and
 * the grand total is never smaller. When no chunk prints one it stays null,
 * and parseModelOutput falls back to adding up the rows.
 */
export function mergeChunkOutputs(parts: { output: ModelOutput; pageOffset: number; pageCount: number }[]): ModelOutput {
  const outputs = parts.map((p) => p.output);
  const totals = outputs.map((o) => o.totalBilledCents).filter((t): t is number => t !== null);
  return {
    providerName: firstText(outputs.map((o) => o.providerName)),
    serviceStart: knownDates(outputs.map((o) => o.serviceStart))[0] ?? "",
    serviceEnd: knownDates(outputs.map((o) => o.serviceEnd)).at(-1) ?? "",
    totalBilledCents: totals.length > 0 ? Math.max(...totals) : null,
    insuranceStatus: firstText(outputs.map((o) => o.insuranceStatus)),
    lineItems: parts.flatMap(({ output, ...chunk }) =>
      output.lineItems.map((item) => ({ ...item, sourcePage: wholeBillPage(item.sourcePage, chunk) })),
    ),
    eobLines: outputs.flatMap((o) => o.eobLines),
  };
}
