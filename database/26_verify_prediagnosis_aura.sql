-- Verificación de solo lectura para Pre-Diagnóstico AURA.

select
  to_regclass('public.prediagnoses') as prediagnoses_table,
  (select count(*) from information_schema.columns where table_schema='public' and table_name='prediagnoses') as columns_count;

select indexname
from pg_indexes
where schemaname='public' and tablename='prediagnoses'
order by indexname;

select relrowsecurity
from pg_class
where oid='public.prediagnoses'::regclass;

select grantee, privilege_type
from information_schema.role_table_grants
where table_schema='public' and table_name='prediagnoses'
order by grantee, privilege_type;
