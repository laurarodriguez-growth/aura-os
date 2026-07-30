-- Aura OS · Backlog ligero de aprendizaje de Aura
-- Migración aditiva. No modifica ni elimina leads, usuarios, interacciones o playbooks.
-- Ejecutar una sola vez en Supabase: SQL Editor > New query > Run.

create extension if not exists pgcrypto;

create table if not exists public.aura_learning_backlog (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete set null,
  setter_id uuid references public.profiles(id) on delete set null,
  setter_name text not null default 'Usuario',

  lead_message text not null,
  previous_context text,
  interpretation text not null,
  suggested_response text,
  classification jsonb not null default '{}'::jsonb,
  confidence integer not null default 0 check (confidence between 0 and 100),
  rule_key text,
  playbook_version text,
  analysis_method text,
  outcome text,
  analysis_payload jsonb not null default '{}'::jsonb,

  source_call_log_id uuid references public.call_logs(id) on delete set null,
  suggestion_used boolean not null default false,
  suggestion_used_at timestamptz,

  result_call_log_id uuid references public.call_logs(id) on delete set null,
  result_summary text,
  result_outcome text,
  result_commercial_status text,
  result_conversation_status text,
  result_payload jsonb not null default '{}'::jsonb,
  result_observed_at timestamptz,

  evaluation text check (
    evaluation is null
    or evaluation in ('worked', 'needs_adjustment', 'incorrect')
  ),
  problem_type text check (
    problem_type is null
    or problem_type in (
      'incorrect_interpretation',
      'unnatural_text',
      'too_long',
      'incorrect_classification',
      'incorrect_followup',
      'context_not_recognized',
      'missing_playbook_case',
      'other'
    )
  ),
  expected_interpretation text,
  expected_response text,
  review_notes text,
  review_status text not null default 'pending_review' check (
    review_status in (
      'pending_review',
      'approved_good_example',
      'needs_new_rule',
      'rule_updated',
      'discarded'
    )
  ),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists aura_learning_backlog_created_idx
  on public.aura_learning_backlog(created_at desc);

create index if not exists aura_learning_backlog_setter_idx
  on public.aura_learning_backlog(setter_id, created_at desc);

create index if not exists aura_learning_backlog_lead_idx
  on public.aura_learning_backlog(lead_id, created_at desc);

create index if not exists aura_learning_backlog_review_idx
  on public.aura_learning_backlog(review_status, problem_type, created_at desc);

create index if not exists aura_learning_backlog_outcome_idx
  on public.aura_learning_backlog(outcome, confidence, created_at desc);

drop trigger if exists aura_learning_backlog_set_updated_at
  on public.aura_learning_backlog;

create trigger aura_learning_backlog_set_updated_at
before update on public.aura_learning_backlog
for each row execute procedure public.set_updated_at();

-- El navegador no consulta esta tabla directamente. Solo el backend con service_role
-- puede leerla o modificarla después de validar el rol administrador.
alter table public.aura_learning_backlog enable row level security;
revoke all on public.aura_learning_backlog from anon, authenticated;
grant all on public.aura_learning_backlog to service_role;

comment on table public.aura_learning_backlog is
'Casos revisables de análisis de Aura. No modifica automáticamente el playbook.';

comment on column public.aura_learning_backlog.suggestion_used is
'Indica que el setter copió la respuesta sugerida desde Aura OS.';

comment on column public.aura_learning_backlog.result_observed_at is
'Fecha de la primera interacción posterior observada para este análisis.';

-- Verificación visible al finalizar la ejecución.
select
  to_regclass('public.aura_learning_backlog') as installed_table,
  count(*) as existing_cases
from public.aura_learning_backlog;
