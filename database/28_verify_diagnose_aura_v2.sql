-- Diagnóstico AURA v2 · verificación de solo lectura
-- NO modifica datos ni estructura.

-- 1. Confirmar tablas base que reutiliza Diagnose.
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'diagnoses',
    'diagnosis_block_evaluations',
    'diagnosis_interview_questions',
    'diagnosis_evidence',
    'diagnosis_findings',
    'diagnosis_roadmap',
    'diagnosis_reports',
    'prediagnoses'
  )
order by table_name;

-- 2. Confirmar que diagnosis_block_evaluations ya soporta la estructura necesaria.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'diagnosis_block_evaluations'
  and column_name in (
    'block_key', 'score_area', 'finding', 'evidence_summary', 'confidence',
    'risk', 'commercial_impact', 'priority', 'recommendation',
    'requires_validation', 'next_best_question', 'visual_status'
  )
order by ordinal_position;

-- 3. Confirmar estructura de hallazgos.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'diagnosis_findings'
  and column_name in (
    'evidence', 'confidence', 'risk', 'commercial_impact',
    'requires_validation', 'visual_status'
  )
order by ordinal_position;

-- 4. Conteos de control. No altera datos.
select 'diagnoses' as entity, count(*) as total from public.diagnoses
union all
select 'prediagnoses', count(*) from public.prediagnoses;
