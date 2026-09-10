"use client";

import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "../database.types";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../env";
import { captchaToken } from "../turnstile";

export function createClient() {
  return createBrowserClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);
}

/**
 * Swiping has to work on first load with no signup wall, so every visitor gets
 * an anonymous session. Upgrading to email later preserves the same user id,
 * which is what carries their swipe history across.
 *
 * The CAPTCHA is only solved on the branch that actually creates a user. A
 * returning visitor resumes their session above and is never challenged, so the
 * cost is paid once per person rather than once per page load — which matters,
 * because this is the last thing standing between the deck and a first paint.
 */
export async function ensureSession() {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session;

  // undefined when CAPTCHA is not configured, or when the challenge could not
  // be completed. Both are passed through to Supabase rather than handled here;
  // it owns the decision. See lib/turnstile.ts for why this never throws.
  const token = await captchaToken();

  const { data: signedIn, error } = await supabase.auth.signInAnonymously(
    token ? { options: { captchaToken: token } } : undefined,
  );
  if (error) throw error;
  return signedIn.session;
}
