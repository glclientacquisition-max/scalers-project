// PR 9 (30 Oct): Add many import log + 10-minute undo.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { IMPORT_UNDO_WINDOW_MS, importSource, undoErrorMessage, undoMinutesLeft } from "../dashboard/src/lib/importUndo.ts";

test("source is one of the four, anything else is paste", () => {
  assert.equal(importSource("url"), "url");
  assert.equal(importSource("photo"), "photo");
  assert.equal(importSource("<script>"), "paste");
});

test("undo window counts down in whole minutes and closes at 10", () => {
  assert.equal(IMPORT_UNDO_WINDOW_MS, 600_000);
  assert.equal(undoMinutesLeft(0, 0), 10);
  assert.equal(undoMinutesLeft(0, 9 * 60_000 + 1), 1);
  assert.equal(undoMinutesLeft(0, 600_000), 0);
});

test("refusals speak owner words", () => {
  assert.match(undoErrorMessage("22023"), /10 minutes/);
  assert.match(undoErrorMessage("40001"), /changed after/);
  assert.match(undoErrorMessage(undefined), /Nothing was changed/);
});

test("SQL: one transaction function, 10 minute guard, service role only, RLS on", () => {
  const sql = fs.readFileSync(new URL("../docs/supabase/kb_import_runs.sql", import.meta.url), "utf8");
  assert.match(sql, /interval '10 minutes'/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on function public\.kb_undo_import\(uuid, uuid\) from public, anon, authenticated/);
  assert.match(sql, /for update/);
  assert.match(sql, /errcode = '40001'/);
});
