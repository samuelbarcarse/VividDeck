import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";

/**
 * Refreshes the Supabase session cookie on every request.
 *
 * Access tokens expire after an hour. Server Components cannot set cookies, so
 * `createServerSupabase` silently swallows the write and a refreshed token is
 * thrown away — meaning that without this file a signed-in user is quietly
 * logged out an hour after their last full page load. That was survivable while
 * every session was anonymous and disposable. It stops being survivable the
 * moment accounts hold likes worth keeping.
 *
 * Named `proxy`, not `middleware`: Next.js 16 renamed the convention. See
 * node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md — the old
 * filename is deprecated, and the `edge` runtime is not supported here.
 *
 * This refreshes tokens; it does not authorize. The Next docs are explicit that
 * proxy is not a session-management or authorization layer, and it is the wrong
 * place to make access decisions: the cookie it reads has not been verified
 * against the auth server. Authorization stays where it already lives — an
 * `auth.getUser()` call inside each route handler and Server Component, plus
 * RLS underneath both.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(items, headers) {
        // Written twice on purpose. The request copy is what any Server
        // Component rendering later in this same pass will read; the response
        // copy is what reaches the browser. Updating only one leaves the render
        // and the client disagreeing about who is signed in.
        items.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        items.forEach(({ name, value, options }) => response.cookies.set(name, value, options));

        // The second argument is easy to miss — @supabase/ssr 0.12 added it and
        // most published examples predate it. These are no-store cache headers,
        // and they are a correctness requirement rather than an optimization: a
        // response that carries Set-Cookie for an auth token must never be
        // cacheable, or a CDN can hand one visitor's session to the next.
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // Do not put code between the client above and this call. `getUser` is what
  // actually performs the refresh, and anything that returns early in between
  // ships a response carrying a stale token.
  await supabase.auth.getUser();

  // Must be returned as-is. Building a fresh NextResponse here would drop the
  // refreshed cookies set above, which fails in a particularly confusing way:
  // sessions work until the exact moment the first token expires.
  return response;
}

export const config = {
  // Everything except static assets. Card art is served from R2 rather than
  // Next, so the usual image-path exclusions are not the point here — skipping
  // the build output is, since a token refresh per chunk request is pure cost.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
