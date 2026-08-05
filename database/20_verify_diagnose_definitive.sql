-- Verificación de Aura Grow Diagnose 2.0. No modifica datos.

select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name = 'diagnosis_block_evaluations';

select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'diagnosis_block_evaluations')
    or (table_name = 'diagnosis_evidence' and column_name in (
      'requirement_key','block_key','anonymized','provided_by','received_at',
      'analysis_purpose','access_scope','validation_status','deletion_status','deleted_at'
    ))
    or (table_name = 'diagnosis_interview_questions' and column_name in (
      'block_key','question_type','evidence_status','private_note'
    ))
    or (table_name = 'diagnosis_reports' and column_name in ('report_type','validation_summary'))
  )
order by table_name, column_name;

select trigger_name
from information_schema.triggers
where event_object_schema = 'public'
  and event_object_table = 'diagnosis_block_evaluations';
