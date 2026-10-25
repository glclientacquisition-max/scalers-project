/**
 * In-memory Supabase for the step-up tables. Supports the chains stepUpStore/adminAudit use:
 * select/eq/is/in/gte/or/order/limit/maybeSingle/single, insert/update/upsert/delete (+select), rpc.
 */
import { randomUUID } from "node:crypto";
import { H } from "./state.mjs";

const rows = (t) => (H.db[t] ??= []);

class Query {
  constructor(table) { this.table = table; this.op = "select"; this.filters = []; this.payload = null; this.wantRows = false; this.one = null; this.limitN = null; this.orderBy = null; }
  select() { if (this.op !== "select") this.wantRows = true; return this; }
  insert(p) { this.op = "insert"; this.payload = Array.isArray(p) ? p : [p]; return this; }
  update(p) { this.op = "update"; this.payload = p; return this; }
  upsert(p, o = {}) { this.op = "upsert"; this.payload = p; this.conflict = o.onConflict || "id"; return this; }
  delete() { this.op = "delete"; return this; }
  eq(c, v) { this.filters.push((r) => r[c] === v); return this; }
  is(c, v) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
  in(c, vs) { this.filters.push((r) => vs.includes(r[c])); return this; }
  gte(c, v) { this.filters.push((r) => String(r[c]) >= String(v)); return this; }
  or() { return this; }
  order(c, o = {}) { this.orderBy = { c, asc: o.ascending !== false }; return this; }
  limit(n) { this.limitN = n; return this; }
  maybeSingle() { this.one = "maybe"; return this; }
  single() { this.one = "single"; return this; }
  match(r) { return this.filters.every((f) => f(r)); }
  run() {
    const t = rows(this.table);
    const now = new Date().toISOString();
    let out = [];
    if (this.op === "insert") {
      for (const p of this.payload) { const r = { id: randomUUID(), created_at: now, ...p }; t.push(r); out.push(r); }
    } else if (this.op === "update") {
      for (const r of t) if (this.match(r)) { Object.assign(r, this.payload); out.push(r); }
    } else if (this.op === "upsert") {
      const k = this.conflict; const hit = t.find((r) => r[k] === this.payload[k]);
      if (hit) Object.assign(hit, this.payload); else t.push({ created_at: now, ...this.payload });
    } else if (this.op === "delete") {
      for (let i = t.length - 1; i >= 0; i -= 1) if (this.match(t[i])) t.splice(i, 1);
    } else {
      out = t.filter((r) => this.match(r));
      if (this.orderBy) { const { c, asc } = this.orderBy; out = [...out].sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (asc ? 1 : -1)); }
      if (this.limitN != null) out = out.slice(0, this.limitN);
    }
    out = out.map((r) => ({ ...r }));
    if (this.one) {
      if (this.one === "single" && out.length !== 1) return { data: null, error: { message: "not single" } };
      return { data: out[0] ?? null, error: null };
    }
    return { data: this.op === "select" || this.wantRows ? out : null, error: null };
  }
  then(res, rej) { try { res(this.run()); } catch (e) { rej(e); } }
}

export function getSupabaseAdmin() {
  return {
    from: (t) => new Query(t),
    async rpc() { return { data: null, error: null }; },
  };
}
