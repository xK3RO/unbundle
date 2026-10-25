import { z } from "zod";
import { EobLineSchema } from "./eob-line";
import { LineItemSchema } from "./line-item";

export const ExtractedBillSchema = z.object({
  providerName: z.string(),
  serviceStart: z.iso.date().nullable(),
  serviceEnd: z.iso.date().nullable(),
  totalBilledCents: z.number().int(),
  /** False when the bill printed no total and totalBilledCents is the sum of the rows. */
  totalPrinted: z.boolean().default(true),
  insuranceStatus: z.string().nullable(),
  lineItems: z.array(LineItemSchema),
  eobLines: z.array(EobLineSchema).default([]),
});

export type ExtractedBill = z.infer<typeof ExtractedBillSchema>;
