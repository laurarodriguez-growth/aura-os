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
