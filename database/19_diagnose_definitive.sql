-- Aura Grow Diagnose 2.0 · alcance funcional definitivo
-- Migración aditiva: conserva Focus, pipeline y todos los datos de Diagnose existentes.

create table if not exists public.diagnosis_block_evaluations (
  id uuid primary key default gen_random_uuid(),
  diagnosis_id uuid not null references public.diagnoses(id) on delete cascade,
  block_key text not null,
  score_area text,
  finding text,
  evidence_summary text,
  confidence text not null default 'low' check (confidence in ('low','medium','high')),
  risk text,
  commercial_impact text,
  priority text not null default '30_days' check (priority in ('immediate','30_days','later','do_not_touch')),
  recommendation text,
  requires_validation boolean not null default true,
  next_best_question text,
  visual_status text not null default 'gray' check (visual_status in ('green','yellow','red','gray')),
  internal_score integer check (internal_score is null or internal_score between 0 and 100),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(diagnosis_id, block_key)
);

create index if not exists diagnosis_block_evaluations_diagnosis_idx
  on public.diagnosis_block_evaluations(diagnosis_id, block_key);

alter table public.diagnosis_interview_questions
  add column if not exists block_key text,
  add column if not exists question_type text not null default 'generated'
    check (question_type in ('core','conditional','generated')),
  add column if not exists evidence_status text not null default 'pending'
    check (evidence_status in ('pending','answered','answered_with_evidence','requires_validation','not_applicable')),
  add column if not exists private_note text;

alter table public.diagnosis_evidence
  add column if not exists requirement_key text,
  add column if not exists block_key text,
  add column if not exists anonymized boolean not null default false,
  add column if not exists provided_by text,
  add column if not exists received_at timestamptz not null default now(),
  add column if not exists analysis_purpose text not null default 'Diagnóstico del proceso comercial y de atención',
  add column if not exists access_scope text not null default 'Laura y administradores autorizados'
    check (access_scope in ('Laura y administradores autorizados')),
  add column if not exists validation_status text not null default 'pending_review'
    check (validation_status in ('pending_review','validated','requires_information','discarded')),
  add column if not exists deletion_status text not null default 'retained'
    check (deletion_status in ('retained','scheduled','deleted')),
  add column if not exists deleted_at timestamptz;

alter table public.diagnosis_findings
  add column if not exists confidence text not null default 'medium'
    check (confidence in ('low','medium','high')),
  add column if not exists risk text,
  add column if not exists commercial_impact text,
  add column if not exists requires_validation boolean not null default false,
  add column if not exists visual_status text not null default 'yellow'
    check (visual_status in ('green','yellow','red','gray'));

alter table public.diagnosis_roadmap
  add column if not exists metric text,
  add column if not exists tool text,
  add column if not exists compliance_evidence text,
  add column if not exists dependency text,
  add column if not exists recommendation_group text not null default '30_days'
    check (recommendation_group in ('immediate','30_days','later','do_not_touch'));

alter table public.diagnoses
  add column if not exists implementation_recommended boolean not null default false,
  add column if not exists implementation_scope text,
  add column if not exists implementation_exclusions text,
  add column if not exists implementation_timeline text,
  add column if not exists implementation_deliverables text,
  add column if not exists client_responsibilities text,
  add column if not exists implementation_metric text;

alter table public.diagnosis_reports
  add column if not exists report_type text not null default 'preliminary'
    check (report_type in ('preliminary','final')),
  add column if not exists validation_summary jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'diagnosis_block_evaluations_set_updated_at') then
    create trigger diagnosis_block_evaluations_set_updated_at
      before update on public.diagnosis_block_evaluations
      for each row execute procedure public.set_updated_at();
  end if;
end $$;

alter table public.diagnosis_block_evaluations enable row level security;
grant all on public.diagnosis_block_evaluations to service_role;

comment on table public.diagnosis_block_evaluations is
  'Evaluación estructurada y verificable producida por cada bloque conversacional de Diagnose.';
comment on column public.diagnosis_evidence.access_scope is
  'Las evidencias son sensibles y solo se exponen desde el backend a administradores autorizados.';
