// Server-only: this module holds the Supabase secret key (CLAUDE.md hard rule 9).
// The secret key maps to the service_role Postgres role and bypasses RLS, so
// it must never reach a browser. Importing this file from a Client Component
// fails the build.
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// One client per server process, created on the first call to getSupabase().
// Nothing runs at import time, so `npm run build` does not need the variables.
let client: SupabaseClient | undefined;

export function getSupabase(): SupabaseClient {
  if (!client) {
    // `!value` is true for both undefined (unset) and "" (empty).
    // The messages name the variable and never include its value.
    const url = process.env.SUPABASE_URL;
    if (!url) {
      throw new Error("SUPABASE_URL is not set");
    }
    // The new-style secret key (sb_secret_...), never the legacy service_role
    // JWT (CLAUDE.md hard rule 4, SPEC §8).
    const key = process.env.SUPABASE_SECRET_KEY;
    if (!key) {
      throw new Error("SUPABASE_SECRET_KEY is not set");
    }

    // createClient(supabaseUrl, supabaseKey, options). For a server-side
    // client with no user session, the docs' example turns off token refresh
    // and session storage.
    // Source: https://supabase.com/docs/reference/javascript/initializing
    // Secret key passed to createClient in server code only:
    // Source: https://supabase.com/docs/guides/api/api-keys
    client = createClient(url, key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return client;
}
