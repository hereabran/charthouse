import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let cached: SupabaseClient | null | undefined

/**
 * Returns a configured server-side Supabase client, or null if env vars
 * are missing — callers must fall back to URL-hash sharing in that case.
 */
export function getSupabase(): SupabaseClient | null {
  if (cached !== undefined) return cached
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    cached = null
    return null
  }
  cached = createClient(url, key, { auth: { persistSession: false } })
  return cached
}

export const SHARES_TABLE = 'helm_playground_shares'
