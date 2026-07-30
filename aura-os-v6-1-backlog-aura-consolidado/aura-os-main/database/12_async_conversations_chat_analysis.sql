-- Aura Grow: conversaciones asíncronas + análisis local de chats.
-- Migración aditiva: no borra leads, usuarios, llamadas ni diagnósticos.

alter table public.leads
  add column if not exists conversation_status text not null default 'not_started',
  add column if not exists conversation_status_changed_at timestamptz,
  add column if not exists outcome_stage text not null default 'pending',
  add column if not exists final_outcome_at timestamptz,
  add column if not exists last_inbound_at timestamptz,
  add column if not exists last_outbound_at timestamptz,
  add column if not exists waiting_since timestamptz,
  add column if not exists response_due_at timestamptz;

alter table public.call_logs
  add column if not exists activity_type text not null default 'contact_attempt',
  add column if not exists conversation_status text not null default 'not_started',
  add column if not exists outcome_stage text not null default 'provisional',
  add column if not exists transcript text,
  add column if not exists analysis jsonb not null default '{}'::jsonb,
  add column if not exists awaiting_response boolean not null default false,
  add column if not exists response_due_at timestamptz,
  add column if not exists is_final_outcome boolean not null default false;

-- Clasificación inicial conservadora para registros existentes.
update public.leads
set
  conversation_status = case
    when status in ('Descartado','No interesado','No califica','Implementación vendida') then 'closed'
    when status in ('Respondió','Interesado','Reunión agendada','Propuesta enviada','Diagnóstico vendido') then 'conversation_active'
    when contact_attempts > 0 then 'waiting_response'
    else 'not_started'
  end,
  outcome_stage = case
    when status in ('Descartado','No interesado','No califica','Implementación vendida') then 'final'
    when contact_attempts > 0 then 'provisional'
    else 'pending'
  end,
  conversation_status_changed_at = coalesce(conversation_status_changed_at, updated_at, now()),
  waiting_since = case
    when contact_attempts > 0 and status not in ('Respondió','Interesado','Reunión agendada','Propuesta enviada','Diagnóstico vendido','Descartado','No interesado','No califica','Implementación vendida')
      then coalesce(waiting_since, last_contact_date, updated_at)
    else waiting_since
  end
where conversation_status = 'not_started' or conversation_status is null;

create index if not exists leads_conversation_status_idx
  on public.leads(conversation_status, response_due_at, next_followup_date)
  where archived = false and do_not_contact = false;

create index if not exists call_logs_conversation_status_idx
  on public.call_logs(conversation_status, occurred_at desc);

create index if not exists call_logs_outcome_stage_idx
  on public.call_logs(outcome_stage, occurred_at desc);

create index if not exists call_logs_activity_type_idx
  on public.call_logs(activity_type, occurred_at desc);

-- Ampliar la vista conservando el orden de sus columnas existentes.
create or replace view public.call_log_enriched as
select
  c.id,
  c.lead_id,
  c.agent_id,
  c.occurred_at,
  c.channel,
  c.direction,
  c.duration_seconds,
  c.outcome,
  c.contact_name,
  c.contact_title,
  c.objection,
  c.notes,
  c.next_step,
  c.followup_date,
  c.appointment_booked,
  c.sale_amount,
  c.created_at,
  l.business_name,
  coalesce(p.full_name, 'Usuario') as agent_name,
  c.activity_type,
  c.conversation_status,
  c.outcome_stage,
  c.transcript,
  c.analysis,
  c.awaiting_response,
  c.response_due_at,
  c.is_final_outcome
from public.call_logs c
join public.leads l on l.id = c.lead_id
left join public.profiles p on p.id = c.agent_id;

revoke all on public.call_log_enriched from anon, authenticated;
grant select on public.call_log_enriched to service_role;

comment on column public.leads.conversation_status is
'Estado actual del hilo comercial; permite trabajar varios leads mientras otros esperan respuesta.';
comment on column public.leads.outcome_stage is
'pending, provisional o final. Evita cerrar prematuramente una conversación asíncrona.';
comment on column public.call_logs.transcript is
'Transcripción o resumen opcional usado por el motor semántico local.';
