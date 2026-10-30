import json,re,hashlib,sys
s=open(sys.argv[1]).read()
r=json.loads(s)['result']
rows=json.loads(re.search(r'<untrusted-data-[^>]+>\n(.*)\n</untrusted-data', r, re.S).group(1))
json.dump(rows,open('prod_rows.json','w'))
def bucket(r):
    o=r['ord']
    if o==30 and ' CHECK ' in r['ddl'].split('add constraint',1)[1][:400]: return 55
    return o
titles={20:'Tables',25:'Columns (no-op when the table already matches)',30:'Primary keys, unique and exclusion constraints',35:'Foreign keys',40:'Indexes',50:'Functions',55:'Check constraints (after functions, some call them)',60:'Views',70:'Triggers',80:'Row level security',85:'Policies',90:'Grants (anon, authenticated, service_role, public)',95:'pg_cron jobs'}
rs=sorted(rows,key=lambda r:(bucket(r),r['nm']))
out=["-- Billing schema baseline, generated from production catalogs on 2026-10-31.",
"-- Reproduces the live billing tables, constraints, indexes, functions, views, triggers, RLS, policies,",
"-- grants and billing pg_cron jobs. Every statement is create-if-missing, create-or-replace or",
"-- drop-then-create, so applying it to a database that already matches production changes nothing.",
"-- Regenerate: scripts/billing-schema/generate.sql. Drift check: scripts/billing-schema/README.md.",
"","set check_function_bodies = off;"]
cur=None
for r in rs:
    b=bucket(r)
    if b!=cur:
        out+=["","-- ============================================================","-- "+titles[b],"-- ============================================================"]; cur=b
    ddl=r['ddl'].rstrip()
    if b==60:
        name=r['nm']; body=ddl.rstrip(';')
        assert '$vdef$' not in body
        ddl=("do $m$ begin\n  execute $vdef$"+body+"$vdef$;\n"
             "exception when invalid_table_definition or feature_not_supported then\n"
             "  -- column list changed: replace the view (fails loudly if another object depends on it)\n"
             "  execute 'drop view public.'||quote_ident('"+name+"');\n"
             "  execute $vdef$"+body+"$vdef$;\nend $m$;")
    out+=["",ddl]
open('baseline.sql','w').write("\n".join(out)+"\n")
objset=open('objset.sql').read()
gen=open('gen.sql').read().replace('\nout as (','\ngen_out as (').replace('select ord, nm, ddl from out order by ord, nm;','select ord, nm, md5(ddl) h from gen_out where ord <> 20')
vals=",\n".join("(%d,'%s','%s')"%(r['ord'],r['nm'].replace("'","''"),hashlib.md5(r['ddl'].encode()).hexdigest()) for r in rows if r['ord']!=20)
verify=f"""do $verify$
declare d text; n int;
begin
  with cur as (
{objset.rstrip()}{gen.rstrip()}
  ), prod(ord, nm, h) as (values
{vals}
  )
  select count(*), string_agg(coalesce(prod.ord, cur.ord)||':'||coalesce(prod.nm, cur.nm)||case when cur.h is null then ' MISSING' when prod.h is null then ' EXTRA' else ' CHANGED' end, '; ' order by 1)
    into n, d
  from prod full join cur on cur.ord = prod.ord and cur.nm = prod.nm
  where cur.h is distinct from prod.h;
  raise exception 'DIFF:% %', n, coalesce(d, 'none');
end $verify$;
"""
open('verify_block.sql','w').write(verify)
open('staging_dryrun.sql','w').write("begin;\n"+open('baseline.sql').read()+"\n"+verify)
open('staging_before.sql','w').write("begin;\n"+verify)
print(len(rows))
