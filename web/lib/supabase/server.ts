import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "../database.types";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../env";

export async function createServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(items) {
        try {
          items.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot set cookies; middleware refreshes the session.
        }
      },
    },
  });
}
