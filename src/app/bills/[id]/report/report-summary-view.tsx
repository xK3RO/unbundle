import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getLocale, getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { PrintButton } from "@/components/print-button";
import { Skeleton } from "@/components/ui/skeleton";
import { loadFindings, stepHref, type BillSource } from "@/lib/bills/source";
import { ManualEntryNote } from "./manual-note";
import { formatCents } from "@/lib/money";
import { buildReport } from "./report-model";

/** One printable page: who, how much, what was flagged, and the disclaimer. */
export async function ReportSummaryView({ source }: { source: BillSource }) {
  // Findings depend on live reference data, so never prerender them.
  await connection();
  const result = await loadFindings(source);
  if (!result) notFound();
  const { bill, findings } = result;
  const report = buildReport(bill, findings);

  const [locale, t, tr] = await Promise.all([
    getLocale(),
    getTranslations("Report.summary"),
    getTranslations("Report"),
  ]);
  const day = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" });
  const formatDay = (iso: string) => day.format(new Date(`${iso}T00:00:00Z`));
  const serviceDates =
    bill.serviceStart && bill.serviceEnd
      ? bill.serviceStart === bill.serviceEnd
        ? formatDay(bill.serviceStart)
        : t("dateRange", { start: formatDay(bill.serviceStart), end: formatDay(bill.serviceEnd) })
      : t("datesUnknown");

  return (
    <main
      lang={locale}
      className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 py-8 sm:px-6 sm:py-10 print:max-w-none print:gap-3 print:p-0"
    >
      <div className="flex flex-wrap gap-3 print:hidden">
        <PrintButton label={t("print")} />
        <Link href={stepHref(source, "report")} className={buttonVariants({ variant: "outline" })}>
          {t("backToReport")}
        </Link>
      </div>

      <header className="flex flex-col gap-1 border-b pb-3">
        <p className="text-sm font-medium text-muted-foreground">{t("kicker")}</p>
        <h1 className="text-2xl font-semibold sm:text-3xl">{t("title")}</h1>
      </header>

      <ManualEntryNote source={source} />

      <dl className="grid gap-3 sm:grid-cols-3">
        <div>
          <dt className="text-sm text-muted-foreground">{t("provider")}</dt>
          <dd className="font-semibold">{bill.providerName || t("providerUnknown")}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">{t("serviceDates")}</dt>
          <dd className="font-semibold">{serviceDates}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">{t("totalBilled")}</dt>
          <dd className="font-semibold tabular-nums">{formatCents(bill.totalBilledCents)}</dd>
          {!bill.totalPrinted && <dd className="text-sm text-muted-foreground">{t("totalFromRows")}</dd>}
        </div>
      </dl>

      <section className="rounded-lg border p-4">
        <p className="text-sm text-muted-foreground">{tr("totalLabel")}</p>
        <p className="text-3xl font-semibold tabular-nums">{formatCents(report.totalAtStakeCents)}</p>
        <p className="text-muted-foreground">{tr("totalCount", { count: report.findings.length })}</p>
      </section>

      {report.findings.length === 0 ? (
        <p>{tr("empty.title")}</p>
      ) : (
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{tr("listLabel")}</caption>
          <thead>
            <tr className="border-b">
              <th scope="col" className="py-2 pr-2">{t("columns.finding")}</th>
              <th scope="col" className="py-2 pr-2">{t("columns.codes")}</th>
              <th scope="col" className="py-2 pr-2">{t("columns.confidence")}</th>
              <th scope="col" className="py-2 text-right">{t("columns.amount")}</th>
            </tr>
          </thead>
          <tbody>
            {report.findings.map(({ finding, lineItems }) => (
              <tr key={finding.id} className="border-b align-top break-inside-avoid">
                <td className="py-2 pr-2 font-medium">{tr(`rules.${finding.ruleId}`)}</td>
                <td className="py-2 pr-2 font-mono">
                  {lineItems.map((li) => li.code ?? tr("finding.noCode")).join(", ")}
                </td>
                <td className="py-2 pr-2">{tr("finding.confidence", { level: finding.confidence })}</td>
                <td className="py-2 text-right tabular-nums">{formatCents(finding.amountAtStakeCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="text-sm text-muted-foreground">{tr("honest")}</p>
      <p className="border-t pt-3 text-sm text-muted-foreground">{tr("disclaimer")}</p>
    </main>
  );
}

export function ReportSummarySkeleton() {
  return (
    <main aria-busy="true" className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 py-8 sm:px-6">
      <Skeleton className="h-10 w-48" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-40 w-full" />
    </main>
  );
}
