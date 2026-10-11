const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { it } = require('node:test');

const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261011000000_team_invites.sql'), 'utf8');

it('is additive: no table/column drops or truncates', () => {
  assert.doesNotMatch(sql, /drop\s+table|drop\s+column|truncate/i);
});
it('defines roles, one-owner index, invites, audit and atomic RPCs', () => {
  for (const needle of [
    "check (role in ('owner', 'admin', 'staff', 'viewer'))",
    "set role = 'staff' where role = 'member'",
    'tenant_members_one_owner',
    'create table if not exists public.tenant_invites',
    'token_hash text not null unique',
    "interval '7 days'",
    'create table if not exists public.tenant_member_audit',
    'function public.tenant_seats_used',
    'function public.create_tenant_invite',
    'function public.accept_tenant_invite',
    'function public.transfer_tenant_ownership',
    "raw_user_meta_data->>'invite', '') = 'true'",
  ]) assert.ok(sql.includes(needle), needle);
});
it('seat count includes pending invites and locks the tenant row', () => {
  assert.match(sql, /tenant_invites\s+where tenant_id = p_tenant and status = 'pending' and expires_at > now\(\)/);
  assert.match(sql, /from public\.tenants where id = p_tenant for update/);
});
it('tightens RLS with restrictive policies (owner/admin settings, viewer read-only)', () => {
  assert.match(sql, /tenants_update_admin_only on public\.tenants\s+as restrictive for update/);
  assert.match(sql, /as restrictive for update to authenticated using \(public\.member_can_write/);
  assert.match(sql, /'owner', 'admin', 'staff'\)/);
});
it('privileged RPCs are service-role only', () => {
  assert.match(sql, /revoke all on function public\.accept_tenant_invite\(text, uuid\) from public, authenticated/);
});
