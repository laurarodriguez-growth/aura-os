begin;

create table if not exists public.schema_migrations (
  version text primary key,
  description text not null,
  checksum text,
  applied_at timestamptz not null default now()
);
alter table public.schema_migrations enable row level security;
revoke all on table public.schema_migrations from public, anon, authenticated;
grant select, insert, update, delete on table public.schema_migrations to service_role;

alter view public.lead_metrics set (security_invoker = true);
revoke all on table public.lead_metrics from public, anon, authenticated;
grant select on table public.lead_metrics to service_role;

revoke execute on function public.increment_lead_contact_attempts(uuid)
  from public, anon, authenticated;
grant execute on function public.increment_lead_contact_attempts(uuid)
  to service_role;

alter function public.handle_new_user() set search_path = '';
revoke execute on function public.handle_new_user()
  from public, anon, authenticated, service_role;
alter function public.set_outcome_library_updated_at() set search_path = '';
alter function public.set_updated_at() set search_path = '';

revoke all on table
  public.diagnoses,
  public.diagnosis_analysis_runs,
  public.diagnosis_assessments,
  public.diagnosis_block_evaluations,
  public.diagnosis_evidence,
  public.diagnosis_findings,
  public.diagnosis_interview_questions,
  public.diagnosis_reports,
  public.diagnosis_roadmap
from public, anon, authenticated;

grant all on table
  public.diagnoses,
  public.diagnosis_analysis_runs,
  public.diagnosis_assessments,
  public.diagnosis_block_evaluations,
  public.diagnosis_evidence,
  public.diagnosis_findings,
  public.diagnosis_interview_questions,
  public.diagnosis_reports,
  public.diagnosis_roadmap
to service_role;

insert into public.schema_migrations (version, description, checksum)
values (
  '20260806_security_hardening',
  'Restrict public views, RPCs, trigger functions and Diagnose tables',
  'repo:database/23_security_hardening.sql'
)
on conflict (version) do update
set description = excluded.description,
    checksum = excluded.checksum;

commit;

