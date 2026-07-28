-- Aura Grow Diagnose 1.1 · análisis de evidencias y entrevista al decisor
-- Migración aditiva. No elimina ni modifica datos existentes.

create table if not exists public.diagnosis_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  diagnosis_id uuid not null references public.diagnoses(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  engine_version text not null default 'aura-local-rules-v1',
  status text not null default 'completed' check (status in ('processing','completed','failed')),
  summary text,
  evidence_count integer not null default 0,
  extracted_text_chars integer not null default 0,
  signals jsonb not null default '[]'::jsonb,
  assessment_suggestions jsonb not null default '[]'::jsonb,
  limitations jsonb not null default '[]'::jsonb,
  evidence_context jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists diagnosis_analysis_runs_diagnosis_idx
  on public.diagnosis_analysis_runs(diagnosis_id, created_at desc);

create table if not exists public.diagnosis_interview_questions (
  id uuid primary key default gen_random_uuid(),
  diagnosis_id uuid not null references public.diagnoses(id) on delete cascade,
  analysis_run_id uuid references public.diagnosis_analysis_runs(id) on delete set null,
  question_key text not null,
  section text not null default 'general' check (section in ('general','icp','conversion','process','automation')),
  question text not null,
  rationale text,
  priority text not null default 'medium' check (priority in ('low','medium','high','critical')),
  status text not null default 'pending' check (status in ('pending','answered','not_applicable')),
  answer text,
  answered_by uuid references public.profiles(id) on delete set null,
  answered_at timestamptz,
  source text not null default 'analysis' check (source in ('analysis','manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(diagnosis_id, question_key)
);

create index if not exists diagnosis_interview_questions_queue_idx
  on public.diagnosis_interview_questions(diagnosis_id, status, priority, created_at);

alter table public.diagnosis_analysis_runs enable row level security;
alter table public.diagnosis_interview_questions enable row level security;

grant all on public.diagnosis_analysis_runs to service_role;
grant all on public.diagnosis_interview_questions to service_role;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'diagnosis_interview_questions_set_updated_at') then
    create trigger diagnosis_interview_questions_set_updated_at
      before update on public.diagnosis_interview_questions
      for each row execute procedure public.set_updated_at();
  end if;
end $$;

comment on table public.diagnosis_analysis_runs is 'Borradores generados por Aura al analizar evidencias y respuestas de entrevista.';
comment on table public.diagnosis_interview_questions is 'Preguntas sugeridas para completar el diagnóstico con el decisor.';
