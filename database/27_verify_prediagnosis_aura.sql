-- Verificación de Pre-Diagnóstico AURA · SOLO LECTURA

-- Tabla + RLS
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public' and tablename = 'prediagnoses';

-- service_role debe tener DELETE, INSERT, SELECT, UPDATE
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'prediagnoses'
  and grantee = 'service_role'
order by privilege_type;

-- anon/authenticated no deben tener privilegios directos
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'prediagnoses'
  and grantee in ('anon', 'authenticated')
order by grantee, privilege_type;

-- Trigger de conservación al fusionar leads
select trigger_name, event_manipulation, action_timing
from information_schema.triggers
where event_object_schema = 'public'
  and event_object_table = 'leads'
  and trigger_name = 'trg_move_prediagnoses_on_lead_merge';

-- Conteo informativo
select count(*) as total_prediagnoses
from public.prediagnoses;
