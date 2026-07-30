-- Verificación de Aura Grow Diagnose V1.
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'diagnoses','diagnosis_assessments','diagnosis_evidence','diagnosis_findings',
    'diagnosis_roadmap','focus_tasks','diagnosis_reports'
  )
order by table_name;

select id, name, public, file_size_limit
from storage.buckets
where id = 'diagnose-evidence';


select
  ufa.user_id,
  u.email,
  p.full_name,
  ufa.feature_key,
  ufa.enabled
from public.user_feature_access ufa
join auth.users u on u.id = ufa.user_id
left join public.profiles p on p.id = ufa.user_id
where ufa.feature_key = 'diagnose'
order by p.full_name nulls last, u.email;
