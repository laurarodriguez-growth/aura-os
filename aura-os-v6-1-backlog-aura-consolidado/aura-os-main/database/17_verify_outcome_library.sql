select
  count(*) as outcomes_totales,
  count(*) filter (where is_active) as outcomes_activos,
  count(*) filter (where is_terminal) as outcomes_finales
from public.outcome_library;

select
  name,
  category,
  recommended_conversation_status,
  recommended_commercial_status,
  followup_delay_days,
  priority_adjustment,
  is_terminal,
  is_active
from public.outcome_library
order by sort_order, name;

select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name in ('leads', 'call_logs')
  and column_name in ('outcome_id', 'outcome_priority_adjustment')
order by table_name;
