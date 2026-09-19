import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  getSupabaseAnonKey,
  getSupabaseUrl,
  normalizeSupabaseUrl,
} from "../dashboard/src/lib/supabase/env.ts";

const KEYS = [
  "SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
] as const;

const saved: Record<string, string | undefined> = {};
for (const key of KEYS) saved[key] = process.env[key];

function clearAuthEnv() {
  for (const key of KEYS) delete process.env[key];
}

describe("resolve Supabase Auth env", () => {
  afterEach(() => {
    for (const key of KEYS) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("strips rest suffixes", () => {
    assert.equal(
      normalizeSupabaseUrl("https://example.supabase.co/rest/v1/"),
      "https://example.supabase.co"
    );
  });

  it("uses SUPABASE_URL when NEXT_PUBLIC is blank", () => {
    clearAuthEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "  ";
    process.env.SUPABASE_URL = "https://example.supabase.co/";
    assert.equal(getSupabaseUrl(), "https://example.supabase.co");
  });

  it("falls back to publishable key when anon is blank", () => {
    clearAuthEnv();
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "";
    process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_example";
    assert.equal(getSupabaseAnonKey(), "sb_publishable_example");
  });

  it("throws when url and key are missing", () => {
    clearAuthEnv();
    assert.throws(() => getSupabaseUrl(), /SUPABASE_URL/);
    assert.throws(() => getSupabaseAnonKey(), /SUPABASE_ANON_KEY/);
  });
});
