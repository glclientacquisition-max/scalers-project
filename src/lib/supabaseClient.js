// src/lib/supabaseClient.js
// Shared Supabase admin client for the voice engine (service role — server only).

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Accept either the project root URL or a mistaken REST path like
 * https://xxx.supabase.co/rest/v1/ — createClient always appends /rest/v1 itself.
 */
function normalizeSupabaseUrl(raw) {
  if (!raw) return raw;
  let url = String(raw).trim();
  url = url.replace(/\/+$/, '');
  url = url.replace(/\/rest\/v1$/i, '');
  url = url.replace(/\/+$/, '');
  return url;
}

const SUPABASE_URL = normalizeSupabaseUrl(process.env.SUPABASE_URL);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    'ERROR: Missing required environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY'
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

module.exports = { supabase, SUPABASE_URL, normalizeSupabaseUrl };
