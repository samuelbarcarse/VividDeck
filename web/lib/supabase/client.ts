"use client";

import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "../database.types";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../env";

export function createClient() {
  return createBrowserClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);
}

/**
 * Swiping has to work on first load with no signup wall, so every visitor gets
 * an anonymous session. Upgrading to email later preserves the same user id,
 * which is what carries their swipe history across.
 */
export async function ensureSession() {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session;

  const { data: signedIn, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return signedIn.session;
}
