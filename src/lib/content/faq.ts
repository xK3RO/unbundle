/**
 * The FAQ, as data. Every answer names its sources. Wording lives in the FAQ
 * messages (en and es); the numbers they state are checked against the
 * sources in faq.test.ts. When a source is replaced, update `checked` here.
 */

export interface FaqSource {
  href: string;
  /** Pages on this site open in the same tab; everything else is external. */
  internal?: boolean;
}

export const FAQ_SOURCES = {
  statute: { href: "https://www.law.cornell.edu/uscode/text/42/1395b-7" },
  cmsBasics: { href: "https://www.cms.gov/files/document/nsa-health-insurance-basics.pdf" },
  cmsNoInsurance: {
    href: "https://www.cms.gov/initiatives/your-patient-rights/medical-bill-rights/know-your-rights/without-insurance",
  },
  cmsDispute: { href: "https://www.cms.gov/medical-bill-rights/help/dispute-a-bill" },
  hcaiLaws: {
    href: "https://hcai.ca.gov/affordability/hospital-fair-billing-program/laws-and-regulations/",
  },
  cmsMue: {
    href: "https://www.cms.gov/medicare/coding-billing/national-correct-coding-initiative-ncci-edits/medicare-ncci-medically-unlikely-edits",
  },
  cmsPtp: {
    href: "https://www.cms.gov/medicare/coding-billing/national-correct-coding-initiative-ncci-edits/medicare-ncci-procedure-procedure-ptp-edits",
  },
  methodology: { href: "/methodology", internal: true },
  about: { href: "/about", internal: true },
  privacy: { href: "/privacy", internal: true },
} as const satisfies Record<string, FaqSource>;

export type FaqSourceKey = keyof typeof FAQ_SOURCES;

/** Same-site tools an answer points to, separate from its sources. */
export const FAQ_RELATED = {
  checker: { href: "/rights/check" },
} as const;
export type FaqRelatedKey = keyof typeof FAQ_RELATED;

export const FAQ_CHECKED = "2026-10-13";

export interface FaqItem {
  id: string;
  /** Number of paragraphs (p1..pN) in the messages. The privacy answer reuses the Privacy page's own text instead. */
  paragraphs: number;
  sources: readonly FaqSourceKey[];
  related?: readonly FaqRelatedKey[];
  /** Paragraphs come from the Privacy summary messages, unchanged. */
  fromPrivacyPage?: boolean;
}

export interface FaqGroup {
  id: "bill" | "noInsurance" | "california" | "unbundle";
  items: readonly FaqItem[];
}

export const FAQ_GROUPS: readonly FaqGroup[] = [
  {
    id: "bill",
    items: [
      { id: "itemized", paragraphs: 3, sources: ["statute"] },
      { id: "eob", paragraphs: 2, sources: ["cmsBasics"] },
      { id: "allowed", paragraphs: 2, sources: ["cmsBasics"] },
      { id: "balanceBill", paragraphs: 2, sources: ["cmsBasics"] },
    ],
  },
  {
    id: "noInsurance",
    items: [
      { id: "gfe", paragraphs: 2, sources: ["cmsNoInsurance"] },
      {
        id: "gfeDispute",
        paragraphs: 3,
        sources: ["cmsDispute", "cmsNoInsurance"],
        related: ["checker"],
      },
    ],
  },
  {
    id: "california",
    // Pending the owner's read of the HCAI page; cut this entry if it is not confirmed.
    items: [{ id: "californiaAid", paragraphs: 2, sources: ["hcaiLaws"] }],
  },
  {
    id: "unbundle",
    items: [
      { id: "mue", paragraphs: 2, sources: ["cmsMue"] },
      { id: "ptp", paragraphs: 3, sources: ["cmsPtp"] },
      { id: "decides", paragraphs: 3, sources: ["methodology", "about"] },
      { id: "priceScope", paragraphs: 2, sources: ["methodology"] },
      { id: "privacy", paragraphs: 0, sources: ["privacy"], fromPrivacyPage: true },
    ],
  },
];

/** Keys of Privacy.summary used verbatim for the privacy answer, in order. */
export const FAQ_PRIVACY_KEYS = ["files", "anthropic", "delete", "sell", "storage"] as const;
