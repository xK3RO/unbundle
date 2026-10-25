import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { getLocale, getTranslations } from "next-intl/server";
import { SignInButton } from "@/components/sign-in-button";
import { Skeleton } from "@/components/ui/skeleton";
import { PendingLink } from "@/components/pending-link";
import { buttonVariants } from "@/components/ui/button";
import { routeMetadata } from "@/lib/metadata";
import { isSignedIn } from "@/lib/supabase/signed-in";
import { formatCents } from "@/lib/money";

const CHECKS = [
  "duplicates",
  "math",
  "dates",
  "unbundling",
  "quantity",
  "outliers",
  "vague",
  "denied",
  "balance",
] as const;

const STEPS = ["upload", "review", "letter"] as const;

/** Findings from the "clinic visit" demo scenario, so the preview matches /demo. */
const PREVIEW_FINDINGS = [
  { ruleId: "price_outlier", code: "71046", atStakeCents: 28722 },
  { ruleId: "vague_charge", code: null, atStakeCents: 3500 },
] as const;

const HERO_BUTTONS = "mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5";

/**
 * The hero buttons depend on the session, which is request-time data, so they
 * stream in behind their own Suspense and the rest of the page is untouched.
 */
async function HeroActions() {
  await connection();
  const [t, signedIn] = await Promise.all([getTranslations("Home"), isSignedIn()]);

  return (
    <div className={HERO_BUTTONS}>
      {signedIn ? (
        <PendingLink
          href="/dashboard"
          className={buttonVariants({ size: "lg" })}
          pendingLabel={t("openDashboardPending")}
        >
          {t("openDashboard")}
        </PendingLink>
      ) : (
        <SignInButton>{t("signIn")}</SignInButton>
      )}
      <PendingLink
        href="/demo"
        className={buttonVariants({ variant: "quiet", size: "lg" })}
        pendingLabel={t("trySamplePending")}
      >
        {t("trySample")}
      </PendingLink>
    </div>
  );
}

/** A small, static picture of the findings report beside the hero text. */
async function HeroPreview() {
  const [t, r] = await Promise.all([getTranslations("Home"), getTranslations("Report")]);
  const total = PREVIEW_FINDINGS.reduce((sum, f) => sum + f.atStakeCents, 0);

  return (
    <figure className="rounded-surface bg-card p-5 shadow-xl shadow-black/5 ring-1 ring-border sm:p-6">
      <p className="text-meta font-medium text-muted-foreground">{t("preview.label")}</p>
      <div className="mt-3 rounded-control bg-brand p-4 text-brand-foreground">
        <p className="text-meta opacity-90">{r("totalLabel")}</p>
        <p className="font-heading text-5xl font-light tracking-tight tabular-nums">{formatCents(total)}</p>
        <p className="text-meta opacity-90">{r("totalCount", { count: PREVIEW_FINDINGS.length })}</p>
      </div>
      <ul className="mt-3 flex flex-col gap-2">
        {PREVIEW_FINDINGS.map((f) => (
          <li
            key={f.ruleId}
            className="flex items-center justify-between gap-4 rounded-control bg-muted px-4 py-3"
          >
            <span className="flex min-w-0 items-center gap-3">
              <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-warning" />
              <span className="min-w-0">
                <span className="block font-medium">{r(`rules.${f.ruleId}`)}</span>
                <span className="block font-mono text-meta text-muted-foreground">
                  {f.code ?? r("finding.noCode")}
                </span>
              </span>
            </span>
            <span className="font-semibold tabular-nums">{formatCents(f.atStakeCents)}</span>
          </li>
        ))}
      </ul>
      <figcaption className="mt-3 text-meta text-muted-foreground">{t("preview.caption")}</figcaption>
    </figure>
  );
}

/** Neutral placeholders: never a sign-in button before the session is known. */
function HeroActionsSkeleton() {
  return (
    <div aria-hidden="true" className={HERO_BUTTONS}>
      <Skeleton className="h-12 w-full sm:w-48" />
      <Skeleton className="h-12 w-full sm:w-36" />
    </div>
  );
}

async function Landing() {
  const [locale, t] = await Promise.all([getLocale(), getTranslations("Home")]);

  return (
    <main lang={locale} className="flex flex-col">
      <section className="border-b bg-secondary/40">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-[3fr_2fr] lg:gap-12 lg:py-20">
          <div>
            <h1 className="max-w-3xl text-title leading-[1.15] font-semibold text-balance sm:text-display">
              {t("title")}
            </h1>
            <p className="mt-4 max-w-2xl text-body text-muted-foreground sm:mt-5 sm:text-lead">{t("subtitle")}</p>
            <Suspense fallback={<HeroActionsSkeleton />}>
              <HeroActions />
            </Suspense>
          </div>
          <HeroPreview />
        </div>
      </section>

      <section aria-labelledby="how-title">
        <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
          <h2 id="how-title" className="text-title font-semibold">
            {t("how.title")}
          </h2>
          <ol className="mt-6 grid gap-6 md:grid-cols-3 md:gap-8">
            {STEPS.map((step, index) => (
              <li key={step} className="flex gap-4">
                <span
                  aria-hidden="true"
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary font-heading text-xl font-semibold text-secondary-foreground"
                >
                  {index + 1}
                </span>
                <div>
                  <h3 className="text-lead font-semibold">{t(`how.${step}.title`)}</h3>
                  <p className="mt-1 text-muted-foreground">{t(`how.${step}.body`)}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="checks-title" className="border-y bg-card">
        <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
          <h2 id="checks-title" className="text-title font-semibold">
            {t("checks.title")}
          </h2>
          <p className="mt-2 max-w-2xl text-muted-foreground">{t("checks.intro")}</p>
          <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-3 sm:gap-x-8 sm:gap-y-5 lg:grid-cols-3">
            {CHECKS.map((key) => (
              <li key={key} className="border-t pt-3">
                <h3 className="font-semibold max-sm:text-meta">{t(`checks.${key}.title`)}</h3>
                {/* Phones list the check names only, to keep the page short. */}
                <p className="mt-1 text-meta text-muted-foreground max-sm:hidden">{t(`checks.${key}.body`)}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="trust-title" className="bg-primary text-primary-foreground">
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[3fr_2fr] lg:gap-10">
          <div>
            <h2 id="trust-title" className="text-title leading-tight font-semibold text-balance sm:text-3xl">
              {t("trust.title")}
            </h2>
            <p className="mt-4 text-lead font-medium">{t("trust.subtitle")}</p>
            <p className="mt-3 max-w-xl opacity-90">{t("trust.body")}</p>
            <p className="mt-5 min-h-11">
              <Link href="/about" className="inline-flex min-h-11 items-center font-medium underline underline-offset-4 hover:no-underline">
                {t("trust.aboutLink")}
              </Link>
            </p>
          </div>
          <div className="rounded-surface border border-primary-foreground/30 p-5">
            <h3 className="text-lead font-semibold">{t("trust.privacyTitle")}</h3>
            <ul className="mt-3 flex flex-col gap-2">
              <li>{t("trust.privacy.training")}</li>
              <li>{t("trust.privacy.delete")}</li>
              <li>{t("trust.privacy.sell")}</li>
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}

function LandingSkeleton() {
  return (
    <main aria-busy="true" className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
      <Skeleton className="h-14 w-full max-w-3xl" />
      <Skeleton className="mt-6 h-8 w-full max-w-2xl" />
      <div className="mt-10 flex gap-3">
        <Skeleton className="h-12 w-48" />
        <Skeleton className="h-12 w-48" />
      </div>
    </main>
  );
}

export const generateMetadata = () => routeMetadata("home");

export default function Home() {
  return (
    <Suspense fallback={<LandingSkeleton />}>
      <Landing />
    </Suspense>
  );
}
