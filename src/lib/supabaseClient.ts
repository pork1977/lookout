"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Returns a browser Supabase client, or null when the project isn't configured.
 *
 * Null is a supported state, not an error: the whole app works without an
 * account — detectors live in IndexedDB — and accounts only add backup and
 * restore. Every caller is expected to handle null and say so in the UI, the
 * same way the labelling step does without an Anthropic key.
 *
 * The anon key is public by design and ships in the bundle. What keeps one
 * account's photos away from another is row-level security in the database, not
 * secrecy of this key.
 */
let client: SupabaseClient | null | undefined;

export function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    client = null;
    return client;
  }

  client = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // No OAuth redirects in this flow, so there's nothing in the URL to read.
      detectSessionInUrl: false,
    },
  });
  return client;
}

export function accountsConfigured(): boolean {
  return getSupabase() !== null;
}
