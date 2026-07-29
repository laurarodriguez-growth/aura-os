select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name in ('leads','call_logs')
  and column_name in (
    'conversation_status','outcome_stage','response_due_at','last_inbound_at','last_outbound_at',
    'activity_type','transcript','analysis','awaiting_response','is_final_outcome'
  )
order by table_name, column_name;

select table_name
from information_schema.views
where table_schema = 'public' and table_name = 'call_log_enriched';
