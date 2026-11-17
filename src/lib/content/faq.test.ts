import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import es from "../../../messages/es.json";
import {
  FAQ_CHECKED,
  FAQ_GROUPS,
  FAQ_PRIVACY_KEYS,
  FAQ_RELATED,
  FAQ_SOURCES,
} from "./faq";

const root = path.resolve(__dirname, "../../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const both = [
  ["en", en],
  ["es", es],
] as const;
const items = FAQ_GROUPS.flatMap((g) => g.items);

type Answers = Record<string, Record<string, string>>;

/** Every paragraph of every answer in one language, as one string. */
function answerText(messages: typeof en | typeof es): string {
  const a = messages.FAQ.items as unknown as Answers;
  return items
    .flatMap((item) => Object.entries(a[item.id]).map(([, v]) => v))
    .join("\n");
}

describe("faq structure", () => {
  it("has the four agreed groups and twelve questions, in order", () => {
    expect(FAQ_GROUPS.map((g) => g.id)).toEqual(["bill", "noInsurance", "california", "unbundle"]);
    expect(items.map((i) => i.id)).toEqual([
      "itemized",
      "eob",
      "allowed",
      "balanceBill",
      "gfe",
      "gfeDispute",
      "californiaAid",
      "mue",
      "ptp",
      "decides",
      "priceScope",
      "privacy",
    ]);
  });

  it("gives every answer at least one source, with a label in both languages", () => {
    for (const item of items) {
      expect(item.sources.length, item.id).toBeGreaterThan(0);
      for (const key of item.sources) {
        const source = FAQ_SOURCES[key];
        if ("internal" in source) {
          expect(source.href.startsWith("/"), key).toBe(true);
          const dir = path.join(root, "src/app", source.href, "page.tsx");
          expect(fs.existsSync(dir), source.href).toBe(true);
        } else {
          expect(source.href.startsWith("https://"), key).toBe(true);
        }
        for (const [, m] of both) {
          const labels = m.FAQ.sources as Record<string, string>;
          expect(labels[key]?.length, key).toBeGreaterThan(0);
        }
      }
    }
  });

  it("never links a page that redirects away from what it is titled", () => {
    const hrefs = Object.values(FAQ_SOURCES).map((s) => s.href);
    expect(hrefs.some((h) => h.includes("understanding-costs-in-advance"))).toBe(false);
  });

  it("has a question and every paragraph in both languages, and no extras", () => {
    for (const [, m] of both) {
      const a = m.FAQ.items as unknown as Answers;
      for (const item of items) {
        expect(a[item.id].q.length, item.id).toBeGreaterThan(0);
        for (let i = 1; i <= item.paragraphs; i++) {
          expect(a[item.id][`p${i}`]?.length, `${item.id}.p${i}`).toBeGreaterThan(0);
        }
        expect(a[item.id][`p${item.paragraphs + 1}`], `${item.id} extra`).toBeUndefined();
      }
    }
    for (const group of FAQ_GROUPS) {
      expect(en.FAQ.groups[group.id].length).toBeGreaterThan(0);
      expect(es.FAQ.groups[group.id].length).toBeGreaterThan(0);
    }
    for (const key of Object.keys(FAQ_RELATED)) {
      expect(en.FAQ.related[key as keyof typeof FAQ_RELATED].length).toBeGreaterThan(0);
    }
  });

  it("has a not-legal-advice note and a last-checked date", () => {
    expect(en.FAQ.notAdvice).toMatch(/not legal advice/i);
    expect(es.FAQ.notAdvice).toMatch(/no asesoría legal/i);
    expect(FAQ_CHECKED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const page = read("src/app/faq/page.tsx");
    expect(page).toContain("checkedLabel");
    expect(page).toContain('t("notAdvice")');
    // A fixed date formatted in UTC, never the clock.
    expect(page).not.toMatch(/new Date\(\)|Date\.now/);
  });
});

describe("faq claims", () => {
  it("states only figures that the cited pages state", () => {
    const allowed = new Set(["30", "100", "400", "120", "25", "3", "350", "5", "1020"]);
    for (const [name, m] of both) {
      const numbers = answerText(m).match(/\d+/g) ?? [];
      for (const n of numbers) expect(allowed.has(n), `${name}: ${n}`).toBe(true);
    }
  });

  it("keeps the figures as the sources give them", () => {
    const t = answerText(en);
    expect(t).toContain("at least $400 more");
    expect(t).toContain("last 120 calendar days");
    expect(t).toContain("$25 non-refundable");
    expect(t).toContain("within 30 days");
    expect(t).toContain("up to $100");
    expect(t).toContain("350 percent to 400 percent");
    expect(t).toContain("3 business days");
  });

  it("stays away from outcomes it cannot source", () => {
    const banned =
      /credit (report|score)|collections?|lawsuit|\bsue\b|garnish|lien|bankrupt|insurance rates|informe de crédito|puntaje de crédito|cobranza|demanda|embargo/i;
    for (const [name, m] of both) {
      expect(answerText(m), name).not.toMatch(banned);
    }
  });

  it("calls the PTP pairs possible unbundling and says it is our term", () => {
    expect(en.FAQ.items.ptp.p2).toContain("Possible unbundling");
    expect(en.FAQ.items.ptp.p2).toMatch(/our name/i);
    expect(en.FAQ.items.ptp.p2).toMatch(/not a CMS term/i);
    expect(es.FAQ.items.ptp.p2).toContain("Posible desglose indebido");
  });

  it("says the 5x threshold is our own choice, not a legal standard", () => {
    expect(en.FAQ.items.decides.p3).toMatch(/our own choice, not a legal standard/);
    expect(es.FAQ.items.decides.p3).toMatch(/elección propia, no un estándar legal/);
  });

  it("describes the AI's role without saying it explains findings", () => {
    for (const [, m] of both) {
      const d = m.FAQ.items.decides;
      expect(d.p1).toMatch(/fixed|fijas/i);
      expect(d.p2).toMatch(/billing code|código de facturación/);
    }
    for (const [, m] of both) {
      expect(JSON.stringify(m.FAQ)).not.toMatch(
        /explains? (each|every|your|the) findings?|explica (cada|sus|los) hallazgos?(?! ni)/i,
      );
    }
    // The only mention of explaining findings is the denial that the AI does it.
    expect(en.FAQ.items.decides.p2).toContain("does not explain or decide your findings");
    expect(es.FAQ.items.decides.p2).toContain("No explica ni decide sus hallazgos");
  });

  it("does not describe the Good Faith Estimate as required in every case", () => {
    expect(en.FAQ.items.gfe.p2).toContain("in most cases");
    expect(es.FAQ.items.gfe.p2).toContain("en la mayoría de los casos");
  });

  it("tells people to confirm the 120-day date, since CMS pages word it differently", () => {
    expect(en.FAQ.items.gfeDispute.p3).toMatch(/confirm your date with CMS/);
    expect(es.FAQ.items.gfeDispute.p3).toMatch(/confirme su fecha con CMS/);
  });

  it("makes no claim about the California free versus discounted split", () => {
    const t = `${en.FAQ.items.californiaAid.p1} ${en.FAQ.items.californiaAid.p2}`;
    expect(t).not.toMatch(/200|free care is|\bat or below\b/);
    expect(t).toMatch(/hospital's own financial assistance policy/);
  });
});

describe("privacy answer", () => {
  it("reuses the privacy page's own summary text, not a copy of it", () => {
    const privacy = items.find((i) => i.id === "privacy")!;
    expect(privacy.fromPrivacyPage).toBe(true);
    expect(privacy.paragraphs).toBe(0);
    expect(read("src/app/faq/page.tsx")).toContain("<PrivacyAnswer />");
    expect(read("src/components/privacy-answer.tsx")).toContain('getTranslations("Privacy.summary")');
    for (const key of FAQ_PRIVACY_KEYS) {
      expect(en.Privacy.summary[key].length).toBeGreaterThan(0);
      expect(es.Privacy.summary[key].length).toBeGreaterThan(0);
    }
    // No privacy wording of its own in the FAQ messages.
    expect(Object.keys(en.FAQ.items.privacy)).toEqual(["q"]);
    expect(Object.keys(es.FAQ.items.privacy)).toEqual(["q"]);
  });
});

describe("faq wiring", () => {
  it("is linked from the footer and the help page, and in the axe checks", () => {
    expect(read("src/components/site-footer.tsx")).toContain('"/faq"');
    expect(read("src/app/help/page.tsx")).toContain('href="/faq"');
    expect(read("e2e/a11y.e2e.ts")).toContain('"/faq"');
  });

  it("leaves the existing Help questions as they were", () => {
    expect(Object.keys(en.Help.faqs)).toEqual([
      "legal",
      "bills",
      "accuracy",
      "privacy",
      "cost",
      "eob",
      "unbundling",
      "uninsured",
    ]);
  });
});
