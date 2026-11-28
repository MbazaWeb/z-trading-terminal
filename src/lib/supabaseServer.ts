import { createClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client with elevated privileges.
 *
 * Uses the service role key which bypasses Row Level Security (RLS).
 * NEVER import this in client-side code — the service role key must
 * stay server-only.
 *
 * Set SUPABASE_SERVICE_ROLE_KEY in your environment (Vercel project settings
 * or .env locally).
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn(
    "[supabase:server] NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set. " +
      "Server-side Supabase operations will not work.",
  );
}

export const supabaseAdmin = createClient(
  supabaseUrl ?? "https://placeholder.supabase.co",
  supabaseServiceKey ?? "placeholder-service-key",
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);
