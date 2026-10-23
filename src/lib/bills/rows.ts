import { z } from "zod";
import {
  CodeTypeSchema,
  ConfidenceSchema,
  EobLineSchema,
  ExtractedBillSchema,
  LineItemSchema,
  SourceBoxSchema,
  type EobLine,
  type ExtractedBill,
  type LineItem,
} from "@/lib/types";

/**
 * Mapping between database rows (snake_case, nullable columns) and the
 * validated domain types. Pure and synchronous. Everything read from the
 * database is parsed with Zod here, so a bad row fails loudly instead of
 * reaching the rules.
 */

const nullableNumber = z.number().nullable();

export const LineItemRowSchema = z.object({
  id: z.string(),
  date_of_service: z.string().nullable(),
  code: z.string().nullable(),
  code_type: CodeTypeSchema.nullable(),
  description_raw: z.string().nullable(),
  modifiers: z.array(z.string()).nullable(),
  units: z.number().nullable(),
  unit_price_cents: nullableNumber,
  charge_cents: nullableNumber,
  insurance_paid_cents: nullableNumber,
  patient_owes_cents: nullableNumber,
  source_page: z.number().nullable(),
  source_box: SourceBoxSchema.nullable(),
  confidence: ConfidenceSchema.nullable(),
  user_verified: z.boolean().nullable(),
});

export const EobLineRowSchema = z.object({
  id: z.string(),
  date_of_service: z.string().nullable(),
  code: z.string().nullable(),
  billed_cents: nullableNumber,
  allowed_cents: nullableNumber,
  plan_paid_cents: nullableNumber,
  patient_responsibility_cents: nullableNumber,
  denial_reason: z.string().nullable(),
});

export const BillRowSchema = z.object({
  provider_name: z.string().nullable(),
  service_start: z.string().nullable(),
  service_end: z.string().nullable(),
  total_billed_cents: nullableNumber,
  insurance_status: z.string().nullable(),
  extraction_status: z.string(),
});

export const LINE_ITEM_COLUMNS =
  "id, date_of_service, code, code_type, description_raw, modifiers, units, unit_price_cents, charge_cents, insurance_paid_cents, patient_owes_cents, source_page, source_box, confidence, user_verified";
export const EOB_LINE_COLUMNS =
  "id, date_of_service, code, billed_cents, allowed_cents, plan_paid_cents, patient_responsibility_cents, denial_reason";
export const BILL_COLUMNS =
  "provider_name, service_start, service_end, total_billed_cents, insurance_status, extraction_status";

export function rowToLineItem(input: unknown): LineItem {
  const r = LineItemRowSchema.parse(input);
  return LineItemSchema.parse({
    id: r.id,
    dateOfService: r.date_of_service,
    code: r.code,
    codeType: r.code_type,
    descriptionRaw: r.description_raw ?? "",
    modifiers: r.modifiers ?? [],
    units: r.units ?? 1,
    unitPriceCents: r.unit_price_cents,
    chargeCents: r.charge_cents ?? 0,
    insurancePaidCents: r.insurance_paid_cents,
    patientOwesCents: r.patient_owes_cents,
    sourcePage: r.source_page ?? 1,
    sourceBox: r.source_box,
    // Unknown confidence is treated as the least trusted, so it asks for review.
    confidence: r.confidence ?? "low",
    userVerified: r.user_verified ?? false,
  });
}

export function rowToEobLine(input: unknown): EobLine {
  const r = EobLineRowSchema.parse(input);
  return EobLineSchema.parse({
    id: r.id,
    dateOfService: r.date_of_service,
    code: r.code,
    billedCents: r.billed_cents ?? 0,
    allowedCents: r.allowed_cents,
    planPaidCents: r.plan_paid_cents,
    patientResponsibilityCents: r.patient_responsibility_cents,
    denialReason: r.denial_reason,
  });
}

export function rowsToBill(billRow: unknown, lineRows: unknown[], eobRows: unknown[]): ExtractedBill {
  const b = BillRowSchema.parse(billRow);
  return ExtractedBillSchema.parse({
    providerName: b.provider_name ?? "",
    serviceStart: b.service_start,
    serviceEnd: b.service_end,
    // A null total means the bill printed none; show the sum of the rows instead.
    totalBilledCents: b.total_billed_cents ?? lineRows.map(rowToLineItem).reduce((sum, l) => sum + l.chargeCents, 0),
    totalPrinted: b.total_billed_cents !== null,
    insuranceStatus: b.insurance_status,
    lineItems: lineRows.map(rowToLineItem),
    eobLines: eobRows.map(rowToEobLine),
  });
}

export function lineItemToRow(item: LineItem, ctx: { userId: string; billId: string; index: number }) {
  return {
    bill_id: ctx.billId,
    user_id: ctx.userId,
    sort_order: ctx.index,
    date_of_service: item.dateOfService,
    code: item.code,
    code_type: item.codeType,
    description_raw: item.descriptionRaw,
    modifiers: item.modifiers,
    units: item.units,
    unit_price_cents: item.unitPriceCents,
    charge_cents: item.chargeCents,
    insurance_paid_cents: item.insurancePaidCents,
    patient_owes_cents: item.patientOwesCents,
    source_page: item.sourcePage,
    source_box: item.sourceBox,
    confidence: item.confidence,
    user_verified: false,
  };
}

export function eobLineToRow(line: EobLine, ctx: { userId: string; billId: string; index: number }) {
  return {
    bill_id: ctx.billId,
    user_id: ctx.userId,
    sort_order: ctx.index,
    date_of_service: line.dateOfService,
    code: line.code,
    billed_cents: line.billedCents,
    allowed_cents: line.allowedCents,
    plan_paid_cents: line.planPaidCents,
    patient_responsibility_cents: line.patientResponsibilityCents,
    denial_reason: line.denialReason,
  };
}

export function billToRow(bill: ExtractedBill) {
  return {
    provider_name: bill.providerName,
    service_start: bill.serviceStart,
    service_end: bill.serviceEnd,
    total_billed_cents: bill.totalPrinted ? bill.totalBilledCents : null,
    insurance_status: bill.insuranceStatus,
  };
}
