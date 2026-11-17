# Unbundle

Unbundle audits medical bills. You upload a photo or PDF of a bill, it reads the line items, runs fixed, tested checks against public Medicare data, and tells you what is worth asking about in plain English or Spanish. You leave with a report and a letter you can take to the billing office.

**Live app:** https://unbundle-phi.vercel.app. To try it without signing in, open the sample bill at https://unbundle-phi.vercel.app/demo. All of its data is made up.

![Unbundle home page, showing the sample bill's two findings](docs/screenshots/home.png)

## The problem

Medical bills are hard to read and harder to check. Duplicate lines, services billed separately that should be billed together, and prices far above what Medicare pays all look the same to someone holding a bill with no way to verify it. Most people pay, or give up, because they cannot tell what is worth disputing and do not know what to say.

## Who it helps

- Patients and families who received a bill they cannot verify, especially people who are uninsured or underinsured, who have the least leverage and the fewest people to ask.
- Spanish-speaking households: the whole app and the dispute letter are available in English and Spanish.
- People who may qualify for financial assistance or a Good Faith Estimate dispute and do not know it.

## How it works

The AI only reads the bill into structured data. It never decides what is wrong. Every finding comes from deterministic code in `src/lib/rules`, and the wording of each finding comes from fixed templates (English and Spanish). The AI has one other job: when you tap "What is this?" on a line, it defines that single billing code in general terms. Only the code is sent for that, never your name, dates or amounts.

```mermaid
flowchart LR
    A[Photo or PDF of bill] --> B[Resized in the browser]
    B --> C[AI reads the bill<br/>into line items]
    C --> D{Zod validation}
    D -- invalid --> X[Rejected or flagged,<br/>never guessed]
    D -- valid --> E[You review and correct<br/>the bill's line items]
    E --> F[Deterministic rules<br/>+ public CMS data]
    F --> G[Findings]
    G --> I[Report and dispute letter from<br/>fixed templates, English or Spanish]
    E -. tap What is this? .-> J[AI defines one<br/>billing code]
```

Why this split matters: model output is validated against a schema, you can review and correct the bill's line items before the report is produced, and the rules are plain functions with unit tests. Amounts read from an optional EOB are used by two rules but are not shown for editing, so those two findings rest on an unreviewed reading. The same bill and the same data always produce the same findings, with no randomness, no clock and no network access.

## Screenshots

These use the made-up sample bill.

Review: you check each row the AI read against the bill and fix anything that is wrong. Rows the AI was unsure about are flagged.

![Review screen with seven rows from the sample bill, three flagged](docs/screenshots/review.png)

Findings: each finding names the check that flagged it, the line involved and the amount at stake.

![Findings report for the sample bill: $322.22 across two findings](docs/screenshots/findings.png)

The same report in Spanish:

![Findings report for the sample bill in Spanish](docs/screenshots/findings-es.png)

## The checks

Ten checks: nine rules that look at the bill, plus an optional Good Faith Estimate comparison for people without insurance. Seven of the nine rules run on every bill. Two (denied, then billed; and balance billing) run only when an EOB is uploaded. The financial assistance estimate is a separate optional step, not a check of the bill.

| Check | What it looks for |
|---|---|
| Duplicate charges | The same service billed more than once on the same day |
| Math errors | Units times price that does not match the amount charged |
| Wrong dates | Charges dated outside the dates of service |
| Unbundling | Services Medicare's NCCI edits say should not be billed together |
| Quantity limits | More units than Medicare's medically unlikely edits (MUE) allow |
| Price outliers | Prices more than 5x the Medicare rate for the same service |
| Vague charges | Lump-sum or unlabeled charges |
| Denied, then billed (needs an EOB) | Lines the insurer denied that were still billed in full |
| Balance billing (needs an EOB) | Bill asks you to pay more than the EOB says you owe for the same service |
| Good Faith Estimate (optional) | Compares an uninsured patient's estimate with the final bill |
| Financial assistance estimate (optional) | Compares household income with HHS poverty guidelines to estimate whether free or discounted care at a California hospital may apply |

Findings are things worth asking about, not certain mistakes.

## Accuracy

Each rule was run against the fixture bills and compared with the findings expected for them (`npm run accuracy`, source `src/lib/accuracy/accuracy.json`, full method in [docs/accuracy.md](docs/accuracy.md)).

| Rule | TP | FP | FN | Precision | Recall |
|---|---:|---:|---:|---:|---:|
| duplicate_charge | 1 | 0 | 0 | 100% | 100% |
| math_error | 1 | 0 | 0 | 100% | 100% |
| date_mismatch | 1 | 0 | 0 | 100% | 100% |
| ncci_unbundling | 2 | 0 | 0 | 100% | 100% |
| mue_exceeded | 1 | 0 | 0 | 100% | 100% |
| price_outlier | 1 | 0 | 0 | 100% | 100% |
| vague_charge | 1 | 0 | 0 | 100% | 100% |
| denied_billed_in_full | 1 | 0 | 0 | 100% | 100% |
| balance_billing | 1 | 0 | 0 | 100% | 100% |
| **overall** | 10 | 0 | 0 | 100% | 100% |

**Read this honestly.** These numbers come from **16 synthetic fixture bills** that I wrote alongside the rules, 6 of them (4 traps and 2 clean bills) designed to catch false alarms. They show the rules behave as designed. They are not a measure of real-world accuracy: every rule has only one or two true cases, and real bills are messier. A finding must match on rule, line item IDs and amount at stake to count as correct. The reading step (AI extraction) is not part of this table.

### Reading accuracy

The reading step was tested separately, on 38 synthetic bill images (made-up bills, not real ones): in the documented run, 37 of 38 were read with every field right (the one miss was a single date on an image with heavy JPEG artifacts), and one rotated photo varies between runs. Details are in [docs/extraction-eval.md](docs/extraction-eval.md). Accuracy on real phone photos of real bills has not been measured yet, which is why the review screen asks you to check every row.

## Data sources

All reference data is public and loaded into Postgres as read-only tables.

| Data | Source | Release |
|---|---|---|
| NCCI procedure-to-procedure edits (practitioner) | CMS | 2026 Q4 |
| NCCI medically unlikely edits (MUE) | CMS | 2026 Q4 |
| Medicare Physician Fee Schedule relative values and GPCI | CMS | RVU26A |
| Poverty guidelines | HHS | 2026 |

## Scope and limits

- NCCI edits are **practitioner** edits only (edit set 1). Hospital outpatient edits are not included.
- Prices and MUE checks cover services on the **Medicare Physician Fee Schedule** only. Hospital facility charges, lab tests and anesthesia are not priced.
- Locality is **Los Angeles** (Medicare locality 18, MAC 01182).
- Medicare rates are a yardstick. They are not what a given hospital or insurer must charge.
- Unbundle is not legal or medical advice.

## Privacy

This summary matches the in-app `/privacy` page.

- Your files are stored in a private folder that only your account can read, write or delete.
- Our upload form resizes photos in your browser before they are uploaded, and re-encoding removes image metadata such as location. This happens in the browser; the server does not enforce it.
- Your files are sent to Anthropic's API only so your bill can be read. Anthropic's published terms say that, by default, your bills are not used to train its models and API data is deleted within 30 days. Those are Anthropic's terms, not ours.
- Deleting a bill removes the bill, its line items and the uploaded files from our storage. A record that a reading was attempted (user id and timestamp, no bill content) is kept until you delete your account.
- There is no retention period: bills and files are kept until you delete them.
- We never sell your information. Data is processed by Anthropic (reading the bill), Supabase (database and storage), Google (sign-in) and the web host.
- Cookies and browser storage: a language cookie (`NEXT_LOCALE`, "en" or "es", one year) only if you choose a language; session cookies from Supabase when you sign in; and your Light or Dark choice in `localStorage` under `unbundle-theme`. There are no analytics, advertising or tracking cookies.
- The sample bill is made up. No real bills are in this repository, and bill contents are never logged.

## Tech stack

Next.js (App Router) and TypeScript, Tailwind and shadcn/ui, Supabase (Google auth, Postgres with row-level security, storage), the Anthropic SDK (extraction and explanations only), Zod at every external boundary, next-intl (English and Spanish), `@react-pdf/renderer` for the report and letter, Vitest for tests.

## Run it locally

You need Node 20 or newer and npm.

### Quick start: the sample bill, no accounts needed

```bash
git clone https://github.com/xK3RO/unbundle.git
cd unbundle
npm install
```

Create a file called `.env.local` in the project folder with these two lines. The sample flow never talks to Supabase, so any values work here:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=any-value
```

Then run:

```bash
npm run dev
```

Open http://localhost:3000/demo and pick a sample bill. With `EXTRACTION_MODE` unset, the app uses a mock reader, so no Anthropic key is needed.

### Full setup: sign-in and real uploads

1. Create a Supabase project. Put its URL and anon (publishable) key in `.env.local` as above.
2. In the Supabase SQL editor, run `supabase/migrations/0001` to `0005` in order. (`0006`, typed-in bills, is a draft until [docs/manual-entry-test.md](docs/manual-entry-test.md) has been run.)
3. Add the service role key to `.env.local` as `SUPABASE_SERVICE_ROLE_KEY`, then load the public reference data:

   ```bash
   node scripts/import-reference.mjs
   node scripts/import-poverty.mjs --confirm
   ```

4. Turn on Google sign-in in Supabase Auth (steps in [docs/DEPLOY.md](docs/DEPLOY.md)).
5. For real bill reading, add `ANTHROPIC_API_KEY` and set `EXTRACTION_MODE=anthropic`. Leave it unset to keep the mock reader.
6. Run `npm run dev` and sign in.

Environment variables (keep the secret ones in `.env.local`, which is never committed):

| Variable | Needed for | Secret? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Always | No |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Always | No (row-level security protects data) |
| `SUPABASE_SERVICE_ROLE_KEY` | Reference-data import scripts; in production only for "Delete my account" | Yes |
| `ANTHROPIC_API_KEY` | Real bill reading and code definitions | Yes |
| `EXTRACTION_MODE` | `mock` (default) or `anthropic` | No |
| `EXPLAIN_MODE` | `mock` (default) or `anthropic` for "What is this?" | No |
| `EXTRACTION_ENABLED` | Kill switch; set `false` to turn reading off | No |

The full list, and how to deploy (Vercel, Supabase Auth, Google OAuth), is in [docs/DEPLOY.md](docs/DEPLOY.md).

Useful commands:

| Command | What it does |
|---|---|
| `npm run dev` / `npm run build` | Run or build the app |
| `npm test` | Unit and component tests (Vitest) |
| `npm run lint` and `npx tsc --noEmit` | Lint and type check |
| `npm run accuracy` | Regenerate the accuracy table (needs `.env.local`) |
| `npm run check:contrast` | Colour contrast guard |
| `npm run test:e2e` | Browser smoke test of the signed-out demo flow (see [docs/e2e.md](docs/e2e.md)) |

## What I would do next

- Test on real, de-identified bills with consent and measure extraction accuracy, not just rule accuracy.
- Add hospital facility edits and outpatient pricing, which is where much of the money is.
- Cover more Medicare localities than Los Angeles.
- Add more languages and a reading-level pass on every explanation.
- Have a billing advocate or patient-rights organisation review the checks and the letter wording.
- Add a CPT/HCPCS reference note on every finding so the user can look up the code themselves.

## License

MIT. See [LICENSE](LICENSE). The CMS and HHS reference data the app loads is public US government data and is not covered by this license.
