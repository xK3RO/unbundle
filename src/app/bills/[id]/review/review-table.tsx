"use client";

import { Fragment, useEffect, useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowUp, Check, ChevronDown, CircleHelp, FileText, Loader2, RotateCcw, ScanSearch, TriangleAlert, CircleCheck } from "lucide-react";
import { updateLineItemAction } from "@/app/bills/actions";
import { Badge } from "@/components/ui/badge";
import { PendingLink } from "@/components/pending-link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatCents } from "@/lib/money";
import { checkRowsAgainstTotal } from "@/lib/bills/total-check";
import type { ExtractedBill, LineItem } from "@/lib/types";
import {
  parseDate,
  parseModifiers,
  parseMoney,
  parseOptionalMoney,
  parseOptionalText,
  parseRequiredText,
  parseUnits,
} from "./fields";
import { isExplainableCode } from "@/lib/explain/validate";
import { ExplainPanel } from "./explain-disclosure";
import { IconTip } from "@/components/icon-tip";
import { SourcePanel, type PanelSource } from "./source-panel";
import { FieldInput } from "@/components/field-input";
import { useIsPhone } from "@/lib/use-is-phone";
import { ReviewCards } from "./review-cards";
import { Skeleton } from "@/components/ui/skeleton";

function needsAttention(item: LineItem) {
  return item.confidence === "low" && !item.userVerified;
}

const COLUMN_COUNT = 8;

function Missing({ children }: { children: React.ReactNode }) {
  return <span className="text-muted-foreground italic">{children}</span>;
}

type SaveState = "idle" | "saving" | "saved" | "failed";

export function ReviewTable({
  bill,
  reportHref,
  demo = false,
  billId,
  dashboardHref = "/dashboard",
  source = { kind: "unavailable" },
  manual = false,
}: {
  bill: ExtractedBill;
  reportHref: string;
  /** Sample bill: nothing is saved, and the edits can be reset. */
  demo?: boolean;
  /** A real bill: edits are saved to the database as they are made. */
  billId?: string;
  dashboardHref?: string;
  /** The original bill: a signed image/PDF, the synthetic demo page, or nothing. */
  source?: PanelSource;
  /**
   * The rows were typed in, not read: they carry no position on the bill, so
   * "Show on bill" is hidden, and with no file there is no source panel at all.
   */
  manual?: boolean;
}) {
  const t = useTranslations("Review");
  // Under 640px the rows are shown one at a time instead of as a table.
  const isPhone = useIsPhone();
  const tExplain = useTranslations("Explain");
  const locale = useLocale();
  const [items, setItems] = useState<LineItem[]>(bill.lineItems);
  const helperId = useId();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Below 2xl the original bill lives in a collapsible panel above the table.
  // "Show on bill" opens it and brings it into view; the counter makes a repeat
  // click on the same row scroll again.
  const [sourceOpen, setSourceOpen] = useState(false);
  const [showRequest, setShowRequest] = useState(0);
  const sourceDetails = useRef<HTMLDetailsElement>(null);
  const selectedIndex = items.findIndex((item) => item.id === selectedId);
  const selectedItem = selectedIndex >= 0 ? items[selectedIndex] : null;
  const selectedRow = selectedItem
    ? {
        id: selectedItem.id,
        row: selectedIndex + 1,
        sourcePage: selectedItem.sourcePage,
        sourceBox: selectedItem.sourceBox,
      }
    : null;
  // "What is this?": rows whose answer is open. A row stays in the map once
  // opened (its panel stays mounted, hidden), so reopening does not ask again.
  const [explain, setExplain] = useState<Record<string, boolean>>({});
  const toggleExplain = (id: string) => setExplain((prev) => ({ ...prev, [id]: !prev[id] }));
  // Phones show each row as a compact summary. Rows the AI was unsure about
  // start open; the rest start closed. From lg up the table shows every field,
  // so this only drives the stacked layout.
  const initialOpen = () => new Set(bill.lineItems.filter(needsAttention).map((i) => i.id));
  const [open, setOpen] = useState<Set<string>>(initialOpen);
  const toggleOpen = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  // Remounts the field inputs so half-typed drafts disappear on reset.
  const [resetCount, setResetCount] = useState(0);

  function showOnBill(id: string) {
    setSelectedId(id);
    setSourceOpen(true);
    setShowRequest((n) => n + 1);
  }

  useEffect(() => {
    const el = sourceDetails.current;
    // offsetParent is null while the panel is display:none (2xl and wider,
    // where the side panel is shown instead).
    if (showRequest === 0 || !el || el.offsetParent === null) return;
    el.scrollIntoView({ block: isPhone ? "start" : "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs per request only
  }, [showRequest]);

  // Phones: return from the source panel to the row's card, with focus on the
  // button that opened it.
  function backToRow() {
    const target = selectedId ? document.getElementById(`show-on-bill-${selectedId}`) : null;
    if (!target) return;
    target.scrollIntoView({ block: "center" });
    target.focus({ preventScroll: true });
  }

  function reset() {
    setItems(bill.lineItems);
    setExplain({});
    setOpen(initialOpen());
    setResetCount((n) => n + 1);
  }

  const [saveState, setSaveState] = useState<SaveState>("idle");
  // Saves run one at a time, in edit order, so a slow request can't overwrite a newer one.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const inflight = useRef(0);
  const failed = useRef(false);

  function update(id: string, patch: Partial<LineItem>) {
    const previous = items.find((item) => item.id === id);
    // Optimistic: the screen changes now; a failed save puts the old values back.
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    if (!billId || !previous) return;

    const revert = Object.fromEntries(
      Object.keys(patch).map((key) => [key, previous[key as keyof LineItem]]),
    ) as Partial<LineItem>;

    if (inflight.current === 0) failed.current = false;
    inflight.current += 1;
    setSaveState("saving");

    queue.current = queue.current.then(async () => {
      let ok = false;
      try {
        ok = (await updateLineItemAction(billId, id, patch)).ok;
      } catch {
        ok = false;
      }
      if (!ok) {
        failed.current = true;
        setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...revert } : item)));
      }
      inflight.current -= 1;
      if (inflight.current === 0) setSaveState(failed.current ? "failed" : "saved");
    });
  }

  const verifiedCount = items.filter((i) => i.userVerified).length;
  const attentionCount = items.filter(needsAttention).length;

  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  const formatDay = (iso: string) => dateFormatter.format(new Date(`${iso}T00:00:00Z`));
  const serviceDates =
    bill.serviceStart && bill.serviceEnd
      ? bill.serviceStart === bill.serviceEnd
        ? formatDay(bill.serviceStart)
        : t("serviceDatesRange", {
            start: formatDay(bill.serviceStart),
            end: formatDay(bill.serviceEnd),
          })
      : t("serviceDatesUnknown");

  const progressText = t("progress", { verified: verifiedCount, total: items.length });
  // Recomputed from the rows as edited, so fixing a misread charge clears it.
  const totalCheck = checkRowsAgainstTotal(bill, items);

  const showSource = !(manual && source.kind === "unavailable");
  const sourceDescription = manual ? t("manual.sourceDescription") : t("source.description");

  return (
    <div className={cn("grid grid-cols-1 gap-6", showSource && "2xl:grid-cols-[minmax(0,1fr)_22rem]")}>
      <div className="flex min-w-0 flex-col gap-6">
        <Card>
          <CardContent className="flex flex-col gap-4">
            <dl className="grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-sm font-medium text-muted-foreground">{t("provider")}</dt>
                <dd className="mt-1 font-semibold">{bill.providerName}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">{t("serviceDates")}</dt>
                <dd className="mt-1 font-semibold">{serviceDates}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">{t("totalBilled")}</dt>
                <dd className="mt-1 text-lead font-semibold tabular-nums">
                  {formatCents(bill.totalBilledCents)}
                </dd>
                {!bill.totalPrinted && (
                  <dd className="mt-1 text-sm text-muted-foreground">{t("totalFromRows")}</dd>
                )}
              </div>
            </dl>
            {totalCheck.overTotal || totalCheck.repeatedPage ? (
              <div role="note" className="flex flex-col gap-2 rounded-lg border border-warning-border/50 bg-warning-surface p-3 text-warning-foreground">
                {totalCheck.overTotal ? (
                  <p className="flex items-start gap-2">
                    <TriangleAlert aria-hidden="true" className="mt-1 size-4 shrink-0" />
                    {t("totalCheckOver", {
                      rows: formatCents(totalCheck.overTotal.rowsCents),
                      total: formatCents(totalCheck.overTotal.totalCents),
                    })}
                  </p>
                ) : null}
                {totalCheck.repeatedPage ? (
                  <p className="flex items-start gap-2">
                    <TriangleAlert aria-hidden="true" className="mt-1 size-4 shrink-0" />
                    {t("totalCheckRepeated", {
                      page: totalCheck.repeatedPage.page,
                      earlier: totalCheck.repeatedPage.earlierPage,
                    })}
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="flex flex-col gap-3" aria-live="polite">
              <Progress
                value={verifiedCount}
                max={items.length}
                label={t("progressLabel")}
                valueText={progressText}
              />
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-semibold">{progressText}</span>
                <span className="text-muted-foreground">·</span>
                {attentionCount > 0 ? (
                  <span className="inline-flex items-center gap-1.5 text-warning-foreground">
                    <TriangleAlert aria-hidden="true" className="size-4" />
                    {t("needsAttention", { count: attentionCount })}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-success-foreground">
                    <CircleCheck aria-hidden="true" className="size-4" />
                    {t("allClear")}
                  </span>
                )}
              </p>
              {/* Said once here instead of under every flagged row. */}
              {attentionCount > 0 ? (
                <p className="flex items-start gap-2 text-warning-foreground">
                  <TriangleAlert aria-hidden="true" className="mt-1 size-4 shrink-0" />
                  {t("lowConfidenceSummary")}
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>

        {showSource ? (
          <details
            ref={sourceDetails}
            open={sourceOpen}
            onToggle={(event) => setSourceOpen(event.currentTarget.open)}
            data-walkthrough="source"
            tabIndex={-1}
            className="rounded-surface border bg-card 2xl:hidden"
          >
            <summary className="flex min-h-12 cursor-pointer items-center gap-2 px-4 font-medium">
              <FileText aria-hidden="true" className="size-5 text-muted-foreground" />
              {t("source.title")}
            </summary>
            <div className="px-4 pb-4">
              {isPhone && !manual && selectedRow ? (
                <Button type="button" variant="secondary" onClick={backToRow} className="mb-3">
                  <ArrowUp aria-hidden="true" />
                  {t("phone.backToRow", { row: selectedRow.row })}
                </Button>
              ) : null}
              <p className="mb-4 text-muted-foreground">{sourceDescription}</p>
              <div className="mx-auto max-w-md">
                <SourcePanel
                  source={source}
                  bill={bill}
                  selected={selectedRow}
                  idPrefix="source-inline"
                  manual={manual}
                />
              </div>
            </div>
          </details>
        ) : null}

        {items.length === 0 ? (
          <p className="rounded-surface border border-dashed p-8 text-center text-muted-foreground">
            {t("empty")}
          </p>
        ) : isPhone ? (
          <ReviewCards
            key={resetCount}
            items={items}
            update={update}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onShowOnBill={showOnBill}
            explain={explain}
            onToggleExplain={toggleExplain}
            manual={manual}
            demo={demo}
          />
        ) : (
          <>
            {/* Before hydration a phone can't know it is a phone: the table is
                hidden under 640px and this placeholder fills the gap, so the
                page never goes blank before the cards appear. */}
            <div aria-hidden="true" data-testid="review-skeleton" className="flex flex-col gap-3 sm:hidden">
              <Skeleton className="h-6 w-28 motion-reduce:animate-none" />
              <Skeleton className="h-[34rem] w-full rounded-surface motion-reduce:animate-none" />
              <div className="grid grid-cols-2 gap-3">
                <Skeleton className="h-11 motion-reduce:animate-none" />
                <Skeleton className="h-11 motion-reduce:animate-none" />
              </div>
            </div>
          <Table key={resetCount} className="max-lg:block max-sm:hidden lg:min-w-[60rem]">
            <TableCaption className="sr-only">{t("tableLabel")}</TableCaption>
            <TableHeader className="max-lg:hidden">
              <TableRow className="bg-muted/60">
                <TableHead className="w-40">{t("columns.date")}</TableHead>
                <TableHead className="w-28">{t("columns.code")}</TableHead>
                <TableHead className="min-w-48">{t("columns.description")}</TableHead>
                <TableHead className="w-20">{t("columns.units")}</TableHead>
                <TableHead className="w-32">{t("columns.unitPrice")}</TableHead>
                <TableHead className="w-32">{t("columns.charge")}</TableHead>
                <TableHead className="w-28">{t("columns.modifiers")}</TableHead>
                <TableHead className="w-40">{t("columns.verified")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="max-lg:flex max-lg:flex-col max-lg:gap-4">
              {items.map((item, index) => {
                const row = index + 1;
                const field = (name: string) => t("rowField", { field: name, row });
                const attention = needsAttention(item);
                const isOpen = open.has(item.id);
                // Phones only: a closed row hides its fields (display:none, so
                // they leave the tab order too); lg and up always show them.
                const fieldCell = isOpen ? "" : "max-lg:hidden";
                // On desktop the first visible cell is the second <td>: the first
                // is the phone-only summary and is hidden at lg. A flagged row
                // gets a thin amber marker, a verified one a green marker; the
                // reason is said once above the table.
                const rowTone = attention
                  ? "bg-card max-lg:border-l-4 max-lg:border-l-warning-border lg:[&>td:nth-child(2)]:shadow-[inset_3px_0_0_var(--warning-border)]"
                  : item.userVerified
                    ? "bg-card max-lg:border-l-4 max-lg:border-l-success-border lg:[&>td:nth-child(2)]:shadow-[inset_3px_0_0_var(--success-border)]"
                    : "bg-card";
                const statusBadge = item.userVerified ? (
                  <Badge variant="success">
                    <Check aria-hidden="true" />
                    {t("status.verified")}
                  </Badge>
                ) : attention ? (
                  <Badge variant="warning">
                    <TriangleAlert aria-hidden="true" />
                    {t("status.lowConfidence")}
                  </Badge>
                ) : null;

                return (
                  <Fragment key={item.id}>
                    <TableRow
                      data-confidence={item.confidence}
                      data-verified={item.userVerified}
                      data-selected={item.id === selectedId}
                      onFocusCapture={() => setSelectedId(item.id)}
                      className={cn(
                        "align-top lg:[&>td]:py-1.5 max-lg:grid max-lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] max-lg:gap-x-3 max-lg:gap-y-4 max-lg:[&>td]:min-w-0 max-lg:rounded-surface max-lg:border max-lg:p-3",
                        rowTone,
                      )}
                    >
                      {/* Compact summary: phones and tablets only. The invisible
                          button covers the summary and toggles the fields; the
                          "Show on bill" button sits above it. */}
                      <TableCell className="col-span-2 p-0 lg:hidden">
                        <div className="relative flex items-start gap-2">
                          <div className="flex min-w-0 flex-1 flex-col gap-1 py-1">
                            <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                              <span className="font-medium">{t("rowHeading", { row })}</span>
                              <span aria-hidden="true">·</span>
                              <span>
                                {item.dateOfService ? (
                                  formatDay(item.dateOfService)
                                ) : (
                                  <Missing>{t("missing.date")}</Missing>
                                )}
                                {" · "}
                                {item.code ?? <Missing>{t("missing.code")}</Missing>}
                              </span>
                            </p>
                            <p className="line-clamp-2 font-semibold break-words">
                              {item.descriptionRaw}
                            </p>
                            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums">
                              <span className="font-semibold">{formatCents(item.chargeCents)}</span>
                              {statusBadge}
                            </p>
                            {isOpen ? (
                              <p className="text-sm text-muted-foreground tabular-nums">
                                {t("equation", {
                                  units: item.units,
                                  price:
                                    item.unitPriceCents === null
                                      ? t("missing.price")
                                      : formatCents(item.unitPriceCents),
                                  charge: formatCents(item.chargeCents),
                                })}
                              </p>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            aria-expanded={isOpen}
                            aria-label={t("rowToggle", { row })}
                            onClick={() => toggleOpen(item.id)}
                            className="absolute inset-0 rounded-surface outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                          />
                          <div className="flex shrink-0 flex-col items-center">
                            <span
                              aria-hidden="true"
                              className="flex size-11 items-center justify-center text-muted-foreground"
                            >
                              <ChevronDown
                                className={cn("size-5 transition-transform", isOpen && "rotate-180")}
                              />
                            </span>
                            {manual ? null : (
                              <Button
                                type="button"
                                variant="ghost"
                                aria-label={t("source.showOnBillRow", { row })}
                                aria-pressed={item.id === selectedId}
                                onClick={() => showOnBill(item.id)}
                                className="relative z-10 size-11 px-0"
                              >
                                <ScanSearch aria-hidden="true" />
                              </Button>
                            )}
                          </div>
                        </div>
                      </TableCell>

                      <TableCell className={cn("max-lg:p-0", fieldCell)}>
                        <FieldInput
                          type="date"
                          value={item.dateOfService}
                          format={(v) => v ?? ""}
                          parse={parseDate}
                          onCommit={(v) => update(item.id, { dateOfService: v })}
                          label={field(t("columns.date"))}
                          visibleLabel={t("columns.date")}
                          error={t("errors.date")}
                          placeholder={t("placeholders.date")}
                          className="max-lg:px-1.5"
                        />
                      </TableCell>
                      <TableCell className={cn("max-lg:p-0", fieldCell)}>
                        <FieldInput
                          value={item.code}
                          format={(v) => v ?? ""}
                          parse={parseOptionalText}
                          onCommit={(v) => update(item.id, { code: v })}
                          label={field(t("columns.code"))}
                          visibleLabel={t("columns.code")}
                          error=""
                          placeholder={t("placeholders.code")}
                        />
                      </TableCell>
                      <TableCell className={cn("max-lg:col-span-2 max-lg:p-0", fieldCell)}>
                        <div className="flex flex-col gap-1 lg:flex-row lg:items-start lg:gap-1">
                          <div className="min-w-0 lg:flex-1">
                            <FieldInput
                              value={item.descriptionRaw}
                              format={(v) => v}
                              parse={parseRequiredText}
                              onCommit={(v) => update(item.id, { descriptionRaw: v })}
                              label={field(t("columns.description"))}
                              visibleLabel={t("columns.description")}
                              error={t("errors.description")}
                            />
                          </div>
                          {isExplainableCode(item.code) ? (
                            <IconTip label={tExplain("summary")}>
                              <Button
                                type="button"
                                variant="ghost"
                                aria-label={tExplain("summaryRow", { row })}
                                aria-expanded={explain[item.id] === true}
                                aria-controls={`explain-${item.id}`}
                                onClick={() => toggleExplain(item.id)}
                                className="max-lg:self-start max-lg:px-2 lg:size-11 lg:px-0"
                              >
                                <CircleHelp aria-hidden="true" />
                                <span className="lg:sr-only">{tExplain("summary")}</span>
                              </Button>
                            </IconTip>
                          ) : (
                            // Keeps the description inputs the same width on rows without a code.
                            <span aria-hidden="true" className="size-11 shrink-0 max-lg:hidden" />
                          )}
                        </div>
                      </TableCell>
                      <TableCell className={cn("max-lg:p-0", fieldCell)}>
                        <FieldInput
                          value={item.units}
                          format={String}
                          parse={parseUnits}
                          onCommit={(v) => update(item.id, { units: v })}
                          label={field(t("columns.units"))}
                          visibleLabel={t("columns.units")}
                          error={t("errors.units")}
                          inputMode="numeric"
                        />
                      </TableCell>
                      <TableCell className={cn("max-lg:p-0", fieldCell)}>
                        <FieldInput
                          value={item.unitPriceCents}
                          format={(v) => (v === null ? "" : formatCents(v))}
                          parse={parseOptionalMoney}
                          onCommit={(v) => update(item.id, { unitPriceCents: v })}
                          label={field(t("columns.unitPrice"))}
                          visibleLabel={t("columns.unitPrice")}
                          error={t("errors.money")}
                          inputMode="decimal"
                          className="text-right tabular-nums max-lg:px-2"
                        />
                      </TableCell>
                      <TableCell className={cn("max-lg:p-0", fieldCell)}>
                        <FieldInput
                          value={item.chargeCents}
                          format={formatCents}
                          parse={parseMoney}
                          onCommit={(v) => update(item.id, { chargeCents: v })}
                          label={field(t("columns.charge"))}
                          visibleLabel={t("columns.charge")}
                          error={t("errors.money")}
                          inputMode="decimal"
                          className="text-right tabular-nums max-lg:px-2"
                        />
                      </TableCell>
                      <TableCell className={cn("max-lg:p-0", fieldCell)}>
                        <FieldInput
                          value={item.modifiers}
                          format={(v) => v.join(", ")}
                          parse={parseModifiers}
                          onCommit={(v) => update(item.id, { modifiers: v })}
                          label={field(t("columns.modifiers"))}
                          visibleLabel={t("columns.modifiers")}
                          error={t("errors.modifiers")}
                          placeholder={t("placeholders.modifiers")}
                        />
                      </TableCell>
                      <TableCell className={cn("max-lg:col-span-2 max-lg:p-0", fieldCell)}>
                        <div className="flex items-center gap-3">
                          <label className="flex min-h-11 items-center gap-3">
                            <Checkbox
                              checked={item.userVerified}
                              onCheckedChange={(checked) =>
                                update(item.id, { userVerified: checked === true })
                              }
                              aria-label={t("markVerified", { row })}
                            />
                            <span className="font-medium lg:sr-only">{t("verifyThisRow")}</span>
                          </label>
                          <span className="max-lg:hidden">{statusBadge}</span>
                          {manual ? null : (
                            <span className="ml-auto max-lg:hidden">
                              <IconTip label={t("source.showOnBill")} align="end">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  aria-label={t("source.showOnBillRow", { row })}
                                  aria-pressed={item.id === selectedId}
                                  onClick={() => showOnBill(item.id)}
                                  className="max-lg:px-2 lg:size-11 lg:px-0"
                                >
                                  <ScanSearch aria-hidden="true" />
                                  <span className="lg:sr-only">{t("source.showOnBill")}</span>
                                </Button>
                              </IconTip>
                            </span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    {isExplainableCode(item.code) && item.id in explain ? (
                      <TableRow
                        className={cn(
                          "bg-card hover:bg-card",
                          explain[item.id]
                            ? cn("max-lg:border-0", isOpen ? "max-lg:block" : "max-lg:hidden")
                            : "hidden",
                        )}
                      >
                        <TableCell colSpan={COLUMN_COUNT} className="pt-0 pb-3 max-lg:p-0 max-lg:pb-2">
                          <ExplainPanel
                            id={`explain-${item.id}`}
                            code={item.code!.trim().toUpperCase()}
                            demo={demo}
                          />
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
          </>
        )}
      </div>

      {showSource ? (
        <aside className="hidden 2xl:block" aria-label={t("source.title")}>
          <Card size="sm" data-walkthrough="source" tabIndex={-1} className="sticky top-6">
            <CardHeader>
              <CardTitle>{t("source.title")}</CardTitle>
              <CardDescription>{sourceDescription}</CardDescription>
            </CardHeader>
            <CardContent>
              <SourcePanel
                source={source}
                bill={bill}
                selected={selectedRow}
                idPrefix="source-side"
                manual={manual}
              />
            </CardContent>
          </Card>
        </aside>
      ) : null}

      <section
        aria-label={t("actions.label")}
        className="sticky bottom-0 z-10 -mx-4 border-t bg-background/95 px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] backdrop-blur sm:-mx-6 sm:px-6 sm:pt-3 sm:pb-[calc(0.75rem+env(safe-area-inset-bottom))] 2xl:col-span-2"
      >
        <div className="mx-auto flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          {/* One status line: what blocks continuing, then the autosave note in
              smaller text. */}
          <p className="flex items-start gap-2 text-sm sm:text-base">
            {attentionCount > 0 ? (
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning-foreground sm:size-5" />
            ) : (
              <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success-foreground sm:size-5" />
            )}
            <span>
              <span
                id={helperId}
                aria-live="polite"
                className={cn(
                  "font-medium",
                  attentionCount > 0 ? "text-warning-foreground" : "text-success-foreground",
                )}
              >
                {attentionCount > 0
                  ? t("actions.blocked", { count: attentionCount })
                  : t("actions.ready")}
              </span>
              {billId ? (
                <>
                  {" "}
                  <span
                    role="status"
                    aria-live="polite"
                    className={cn(
                      "inline-flex items-center gap-1 text-xs sm:text-sm",
                      saveState === "failed" ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {saveState === "saving" ? (
                      <Loader2 aria-hidden="true" className="size-3.5 animate-spin motion-reduce:animate-none" />
                    ) : saveState === "saved" ? (
                      <Check aria-hidden="true" className="size-3.5" />
                    ) : null}
                    {saveState === "saving"
                      ? t("saveState.saving")
                      : saveState === "saved"
                        ? t("saveState.saved")
                        : saveState === "failed"
                          ? t("saveState.failed")
                          : t("saveState.autosave")}
                  </span>
                </>
              ) : null}
            </span>
          </p>
          <div className="flex items-center gap-2 sm:gap-3">
            {attentionCount > 0 ? (
              <Button
                type="button"
                disabled
                focusableWhenDisabled
                aria-describedby={helperId}
                className="h-auto min-h-11 min-w-0 flex-1 py-1 leading-tight whitespace-normal max-sm:text-sm sm:flex-none"
              >
                {t("actions.continue")}
              </Button>
            ) : (
              <PendingLink
                href={reportHref}
                aria-describedby={helperId}
                className={cn(buttonVariants(), "h-auto min-h-11 min-w-0 flex-1 py-1 leading-tight whitespace-normal max-sm:text-sm sm:flex-none")}
                pendingLabel={t("actions.continuePending")}
              >
                {t("actions.continue")}
              </PendingLink>
            )}
            {demo ? (
              <Button
                type="button"
                variant="ghost"
                onClick={reset}
                className="h-auto min-h-11 max-w-[45%] shrink-0 px-2 py-1 leading-tight whitespace-normal max-sm:text-sm sm:order-first sm:max-w-none sm:px-3 sm:whitespace-nowrap sm:border sm:border-input"
              >
                <RotateCcw aria-hidden="true" />
                {t("actions.reset")}
              </Button>
            ) : (
              // Edits are already saved; this just leaves the bill in the dashboard.
              <PendingLink
                href={dashboardHref}
                className={cn(
                  buttonVariants({ variant: "ghost" }),
                  "h-auto min-h-11 max-w-[45%] shrink-0 px-2 py-1 leading-tight whitespace-normal max-sm:text-sm sm:order-first sm:max-w-none sm:px-3 sm:whitespace-nowrap sm:border sm:border-input",
                )}
                pendingLabel={t("actions.savePending")}
              >
                {t("actions.save")}
              </PendingLink>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
