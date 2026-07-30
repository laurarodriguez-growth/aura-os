select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('diagnosis_analysis_runs','diagnosis_interview_questions')
order by table_name;

select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'diagnosis_interview_questions'
order by ordinal_position;
