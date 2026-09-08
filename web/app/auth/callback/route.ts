import { NextResponse } from "next/server";

import { createServerSupabase } from "@/lib/supabase/server";

/**
 * OAuth return leg. Google sends the browser here with a one-time code, which
 * is exchanged for a session and written to cookies.
 *
 * For a visitor who was already swiping anonymously this is the tail end of
 * `linkIdentity`, not a fresh sign-in: the same `auth.users` row gains a Google
 * identity and stops being anonymous. That is the whole reason the upgrade path
 * is worth building — the user id never changes, so every existing swipe and
 * the accumulated taste vector carry across without a migration.
 */

/** Where to send the browser back to, rejecting anything that leaves this site. */
function safeNext(raw: string | null): string {
  // An unvalidated `next` is an open redirect, and an open redirect on the auth
  // callback is the useful kind for an attacker: the link genuinely points at
  // this domain and only bounces after the session cookie is set. Protocol-
  // relative (`//evil.com`) and backslash (`/\evil.com`) forms are the ones that
  // slip past a naive "starts with /" check, so both are rejected here.
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/liked";
  return raw;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get("next"));

  // Behind Vercel the request URL is the internal one, so the forwarded host is
  // what the user's browser actually typed. Falling back to url.origin keeps
  // local development working.
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  const origin = forwardedHost ? `${forwardedProto}://${forwardedHost}` : url.origin;

  const fail = (reason: string) => NextResponse.redirect(`${origin}/liked?auth_error=${encodeURIComponent(reason)}`);

  // Google reports refusals here rather than by failing the request.
  const oauthError = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (oauthError) return fail(oauthError);

  const code = url.searchParams.get("code");
  if (!code) return fail("No sign-in code was returned.");

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return fail(error.message);

  return NextResponse.redirect(`${origin}${next}`);
}
