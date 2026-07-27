-- Verification after schema.sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'profiles','leads','call_logs','activities','search_jobs','search_results','search_cache','website_cache'
  )
order by table_name;

select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in ('handle_new_user','set_updated_at','increment_lead_contact_attempts')
order by routine_name;

select id, full_name, role, created_at
from public.profiles
order by created_at;
