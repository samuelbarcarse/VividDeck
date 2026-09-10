function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing environment variable ${name}. Copy web/.env.local.example to web/.env.local.`);
  }
  return value;
}

export const SUPABASE_URL = required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
export const SUPABASE_ANON_KEY = required("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
export const R2_PUBLIC_URL = required("NEXT_PUBLIC_R2_PUBLIC_URL", process.env.NEXT_PUBLIC_R2_PUBLIC_URL);

/**
 * Cloudflare Turnstile site key. Optional, and the only variable here that is.
 *
 * Absent means no CAPTCHA, which is what keeps local development and any
 * environment set up before the key exists working unchanged. It is deliberately
 * not `required`: the enforcement lives in Supabase, which either demands a
 * valid token or does not, so a missing key here can never be the difference
 * between protected and unprotected — only between a clear rejection and a
 * confusing one. See lib/turnstile.ts.
 *
 * Written out in full rather than read from a variable: Next.js replaces
 * `process.env.NEXT_PUBLIC_*` by literal text substitution at build time, so an
 * indirect lookup would compile to undefined.
 */
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? null;
