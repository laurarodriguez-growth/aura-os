-- Verificación de Aura Grow V2 + Aura Focus.
-- Ejecutar después del archivo 04. No modifica datos.

select
  to_regclass('public.scoring_templates') as scoring_templates,
  to_regclass('public.call_log_enriched') as call_log_enriched,
  to_regclass('public.leads_aura_focus_idx') as aura_focus_index;

select
  column_name,
  data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'search_jobs'
  and column_name in (
    'new_leads_added',
    'pending_at_start',
    'scoring_mode',
    'scoring_template_id',
    'scoring_template_name',
    'scoring_rules',
    'scoring_thresholds'
  )
order by column_name;

select
  column_name,
  data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'leads'
  and column_name in (
    'scoring_mode',
    'scoring_template_id',
    'scoring_template_name',
    'scoring_rules',
    'scoring_thresholds',
    'scoring_job_id'
  )
order by column_name;
