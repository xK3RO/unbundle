import { notFound } from "next/navigation";
import { Info } from "lucide-react";
import { z } from "zod";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { loadBill, stepHref, type BillSource } from "@/lib/bills/source";
import { Skeleton } from "@/components/ui/skeleton";
import { BillSteps } from "@/components/bill-steps";
import { DeleteBillButton } from "@/components/delete-bill-button";
import { isSummaryStatement, summarizeConfidence } from "@/lib/bills/extraction-confidence";
import { getSourceFileForBill } from "@/lib/bills/source-file-server";
import { readEntryMethod } from "@/lib/bills/entry-method";
import { formatCents } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { ReviewTable } from "./review-table";

// The request locale is request-time data, so callers render this inside
// Suspense and the page shell stays static.
export async function ReviewView({ source }: { source: BillSource }) {
  // The bundled fixture served at /bills/demo has no rows to save to.
  const persisted = source.kind === "bill" && z.uuid().safeParse(source.id).success;

  // Independent reads run together: the rows, the entry method (typed-in bills
  // have no reading to correct and no position on the file), and the original
  // file's signed URL (signed per request with the user-scoped client; never
  // cached or stored). Each is scoped to the caller by RLS and an explicit
  // user check, so a bill that is not theirs still ends in notFound().
  const [bill, locale, t, entryMethod, panelSource] = await Promise.all([
    loadBill(source),
    getLocale(),
    getTranslations("Review"),
    persisted ? readEntryMethod(await createClient(), source.id) : null,
    source.kind === "demo"
      ? ({ kind: "demo" } as const)
      : persisted
        ? getSourceFileForBill(source.id)
        : ({ kind: "unavailable" } as const),
  ]);
  if (!bill) notFound();

  const manual = entryMethod === "manual";
  const confidence = summarizeConfidence(bill.lineItems);
  const summaryOnly = isSummaryStatement(bill, manual);

  return (
    <NextIntlClientProvider>
      <main
        lang={locale}
        className="mx-auto flex w-full max-w-[96rem] flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10"
      >
        <header className="flex flex-col gap-4">
          <BillSteps current="review" />
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-semibold sm:text-4xl">{t("title")}</h1>
            <p className="max-w-2xl text-muted-foreground sm:text-lg">
              {t(manual ? "manual.subtitle" : "subtitle")}
            </p>
            <p className="text-base font-medium">
              {t(manual ? "manual.rowsEntered" : "rowsRead", { count: confidence.rowCount })}
            </p>
          </div>
          {manual && persisted ? (
            <div
              role="note"
              className="flex max-w-2xl flex-col gap-3 rounded-lg border bg-muted p-4 text-base sm:flex-row sm:items-center sm:justify-between"
            >
              <p className="flex items-start gap-3">
                <Info aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                {t("manual.banner")}
              </p>
              <Link
                href={`/bills/${source.id}/enter`}
                className="font-medium text-primary underline underline-offset-4 hover:no-underline"
              >
                {t("manual.editLines")}
              </Link>
            </div>
          ) : null}
          {summaryOnly ? (
            <div
              role="note"
              className="flex max-w-2xl flex-col gap-3 rounded-lg border bg-muted p-4 text-base"
            >
              <p className="flex items-start gap-3">
                <Info aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                {t("summaryStatement", { total: formatCents(bill.totalBilledCents) })}
              </p>
              {persisted ? (
                <Link
                  href={`/bills/${source.id}/letter?type=itemized`}
                  className="font-medium text-primary underline underline-offset-4 hover:no-underline"
                >
                  {t("summaryStatementLink")}
                </Link>
              ) : null}
            </div>
          ) : null}
          {confidence.low && !manual ? (
            <p
              role="note"
              className="flex max-w-2xl items-start gap-3 rounded-lg border bg-muted p-4 text-base"
            >
              <Info aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              {t("lowConfidenceNote")}
            </p>
          ) : null}
        </header>
        <ReviewTable
          bill={bill}
          reportHref={stepHref(source, "report")}
          demo={source.kind === "demo"}
          billId={persisted ? source.id : undefined}
          source={panelSource}
          manual={manual}
        />
        {persisted ? (
          <div className="flex">
            <DeleteBillButton billId={source.id} size="sm" />
          </div>
        ) : null}
      </main>
    </NextIntlClientProvider>
  );
}

export function ReviewSkeleton() {
  return (
    <main
      aria-busy="true"
      className="mx-auto flex w-full max-w-[96rem] flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10"
    >
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-10 w-full max-w-md" />
      <Skeleton className="h-44 w-full" />
      <Skeleton className="h-96 w-full" />
    </main>
  );
}
