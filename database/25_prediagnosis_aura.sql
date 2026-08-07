-- Aura OS · Pre-Diagnóstico AURA
-- Migración aditiva. No elimina ni renombra datos existentes.

begin;

create table if not exists public.prediagnoses (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  submission_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  name text not null,
  company text not null,
  sector text not null,
  country_code text not null default 'PA',
  website_or_instagram text,
  sales_model text not null,
  channels text[] not null default '{}',
  monthly_inquiries text not null,
  first_response_time text not null,
  current_record_method text not null,
  follow_up_method text not null,
  has_owner_and_next_step text not null,
  knows_conversion text not null,
  perceived_problem text not null,
  desired_result text not null,
  urgency text not null,
  capacity text not null,
  investment_intent text not null,
  contact_phone text,
  contact_email text,

  signal_demand text not null check (signal_demand in ('controlled','attention','strong','insufficient_data')),
  signal_response text not null check (signal_response in ('controlled','attention','strong','insufficient_data')),
  signal_management text not null check (signal_management in ('controlled','attention','strong','insufficient_data')),
  signal_followup text not null check (signal_followup in ('controlled','attention','strong','insufficient_data')),
  signal_measurement text not null check (signal_measurement in ('controlled','attention','strong','insufficient_data')),
  signal_capacity text not null check (signal_capacity in ('controlled','attention','strong','insufficient_data')),

  probable_leak_area text not null,
  secondary_area text,
  eligibility text not null check (eligibility in ('eligible','needs_more_info','not_ready')),
  confidence text not null default 'preliminary' check (confidence = 'preliminary'),
  next_action text not null,

  source_page text,
  form_version text not null default 'website-prediagnosis-v2',
  match_method text,
  raw_payload jsonb not null default '{}'::jsonb
);

create index if not exists prediagnoses_lead_created_idx on public.prediagnoses(lead_id, created_at desc);
create index if not exists prediagnoses_eligibility_created_idx on public.prediagnoses(eligibility, created_at desc);
create index if not exists prediagnoses_zone_created_idx on public.prediagnoses(probable_leak_area, created_at desc);
create index if not exists prediagnoses_sector_created_idx on public.prediagnoses(sector, created_at desc);

alter table public.prediagnoses enable row level security;
revoke all on table public.prediagnoses from anon, authenticated;

comment on table public.prediagnoses is 'Lecturas preliminares del Pre-Diagnóstico AURA vinculadas a un lead único. Diagnose conserva el análisis; Focus muestra la señal comercial.';
comment on column public.prediagnoses.match_method is 'Método usado para vincular la evaluación al lead: phone, email, website, instagram_url o created.';
comment on column public.prediagnoses.confidence is 'Siempre preliminary. Un Pre-Diagnóstico no sustituye el Diagnóstico AURA completo.';

-- Si dos leads se consolidan con la RPC existente, conserva también los Pre-Diagnósticos
-- en la ficha destino sin modificar la función histórica de merge.
create or replace function public.move_prediagnoses_on_lead_merge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.merged_into_lead_id is not null
     and new.merged_into_lead_id is distinct from old.merged_into_lead_id then
    update public.prediagnoses
    set lead_id = new.merged_into_lead_id, updated_at = now()
    where lead_id = new.id;
  end if;
  return new;
end;
$$;

create or replace trigger trg_move_prediagnoses_on_lead_merge
after update of merged_into_lead_id on public.leads
for each row
when (new.merged_into_lead_id is not null)
execute function public.move_prediagnoses_on_lead_merge();

revoke all on function public.move_prediagnoses_on_lead_merge() from public, anon, authenticated;

commit;
