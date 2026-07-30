-- Growth Lead Finder
-- Execute this entire file in Supabase: SQL Editor > New query > Run.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'agent' check (role in ('admin', 'agent')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    'agent'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  place_id text unique,
  capture_date timestamptz not null default now(),
  niche text not null,
  business_name text not null,
  address text,
  zone text,
  phone text,
  website text,
  instagram_url text,
  whatsapp_url text,
  whatsapp_phone text,
  email text,
  maps_url text,
  rating numeric(3,2),
  review_count integer not null default 0,
  primary_type text,
  types text[] not null default '{}',
  business_status text,
  latitude double precision,
  longitude double precision,

  high_ticket_services text[] not null default '{}',
  doctor_names text[] not null default '{}',
  doctor_count_estimate integer not null default 0,
  doctor_count_confidence text not null default 'sin_evidencia',
  branch_addresses text[] not null default '{}',
  branch_count_estimate integer not null default 0,
  branch_count_confidence text not null default 'sin_evidencia',

  form_found boolean not null default false,
  booking_found boolean not null default false,
  booking_tools text[] not null default '{}',
  crm_visible boolean not null default false,
  crm_tools text[] not null default '{}',
  chat_found boolean not null default false,
  chat_tools text[] not null default '{}',
  cms_tools text[] not null default '{}',
  meta_pixel_found boolean not null default false,
  google_tag_found boolean not null default false,
  google_analytics_found boolean not null default false,
  tiktok_pixel_found boolean not null default false,
  linkedin_insight_found boolean not null default false,
  promotional_language_found boolean not null default false,
  generic_whatsapp_cta_found boolean not null default false,

  decision_maker_candidate text,
  decision_maker_confidence text not null default 'sin_evidencia',
  pages_audited text[] not null default '{}',
  website_status text,
  website_response_ms integer,
  mobile_friendly_signal boolean not null default false,
  https_enabled boolean not null default false,

  fit_score integer not null default 0,
  high_ticket_score integer not null default 0,
  capacity_score integer not null default 0,
  demand_score integer not null default 0,
  leakage_score integer not null default 0,
  auto_score integer not null default 0,
  auto_tier text not null default 'Descartar',
  manual_ads_score integer not null default 0 check (manual_ads_score between 0 and 8),
  manual_volume_score integer not null default 0 check (manual_volume_score between 0 and 6),
  manual_followup_score integer not null default 0 check (manual_followup_score between 0 and 8),
  manual_decision_maker_score integer not null default 0 check (manual_decision_maker_score between 0 and 8),
  manual_score integer not null default 0,
  final_score integer not null default 0,
  final_tier text not null default 'Descartar',
  score_reasons text[] not null default '{}',
  quality_flags text[] not null default '{}',
  excluded_reason text,

  decision_maker_name text,
  decision_maker_title text,
  decision_maker_link text,
  status text not null default 'Nuevo',
  owner_id uuid references public.profiles(id) on delete set null,
  first_contact_date date,
  last_contact_date timestamptz,
  next_followup_date date,
  outcome text,
  notes text,
  do_not_contact boolean not null default false,
  contact_attempts integer not null default 0,
  source text,
  archived boolean not null default false,

  last_google_fetch_at timestamptz,
  last_web_audit_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists leads_status_idx on public.leads(status);
create index if not exists leads_final_tier_idx on public.leads(final_tier);
create index if not exists leads_owner_idx on public.leads(owner_id);
create index if not exists leads_followup_idx on public.leads(next_followup_date);
create index if not exists leads_niche_idx on public.leads(niche);
create index if not exists leads_business_name_idx on public.leads using gin (to_tsvector('simple', coalesce(business_name, '')));

create table if not exists public.call_logs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  agent_id uuid references public.profiles(id) on delete set null,
  occurred_at timestamptz not null default now(),
  channel text not null default 'Llamada',
  direction text not null default 'Saliente',
  duration_seconds integer,
  outcome text not null,
  contact_name text,
  contact_title text,
  objection text,
  notes text,
  next_step text,
  followup_date date,
  appointment_booked boolean not null default false,
  sale_amount numeric(12,2),
  created_at timestamptz not null default now()
);

create index if not exists call_logs_lead_idx on public.call_logs(lead_id);
create index if not exists call_logs_agent_idx on public.call_logs(agent_id);
create index if not exists call_logs_occurred_idx on public.call_logs(occurred_at desc);
create index if not exists call_logs_outcome_idx on public.call_logs(outcome);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  description text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists activities_lead_idx on public.activities(lead_id, created_at desc);

create table if not exists public.search_jobs (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references public.profiles(id) on delete set null,
  niche text not null,
  city text not null,
  zones text[] not null default '{}',
  services text[] not null default '{}',
  max_results integer not null default 100,
  api_request_budget integer not null default 30,
  api_requests_used integer not null default 0,
  status text not null default 'queued',
  phase text not null default 'discovery',
  queries jsonb not null default '[]'::jsonb,
  query_index integer not null default 0,
  current_page_token text,
  audit_offset integer not null default 0,
  total_discovered integer not null default 0,
  total_audited integer not null default 0,
  cache_hits_google integer not null default 0,
  cache_hits_web integer not null default 0,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists search_jobs_created_idx on public.search_jobs(created_at desc);

create table if not exists public.search_results (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.search_jobs(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  query_text text,
  from_google_cache boolean not null default false,
  created_at timestamptz not null default now(),
  unique(job_id, lead_id)
);

create index if not exists search_results_job_idx on public.search_results(job_id, created_at);

create table if not exists public.search_cache (
  cache_key text primary key,
  request_payload jsonb not null,
  response_payload jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists search_cache_expiry_idx on public.search_cache(expires_at);

create table if not exists public.website_cache (
  cache_key text primary key,
  url text not null,
  payload jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists website_cache_expiry_idx on public.website_cache(expires_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute procedure public.set_updated_at();

drop trigger if exists leads_set_updated_at on public.leads;
create trigger leads_set_updated_at before update on public.leads
for each row execute procedure public.set_updated_at();

drop trigger if exists search_jobs_set_updated_at on public.search_jobs;
create trigger search_jobs_set_updated_at before update on public.search_jobs
for each row execute procedure public.set_updated_at();

create or replace function public.increment_lead_contact_attempts(p_lead_id uuid)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  new_count integer;
begin
  update public.leads
  set contact_attempts = contact_attempts + 1,
      updated_at = now()
  where id = p_lead_id
  returning contact_attempts into new_count;
  return coalesce(new_count, 0);
end;
$$;

-- Security model:
-- The browser uses Supabase only for Auth. Business data is accessed through the FastAPI backend,
-- which validates the user's JWT and uses the service role key on the server.
alter table public.profiles enable row level security;
alter table public.leads enable row level security;
alter table public.call_logs enable row level security;
alter table public.activities enable row level security;
alter table public.search_jobs enable row level security;
alter table public.search_results enable row level security;
alter table public.search_cache enable row level security;
alter table public.website_cache enable row level security;

-- Users can only read their own profile directly from the browser.
drop policy if exists "Users read own profile" on public.profiles;
create policy "Users read own profile"
on public.profiles for select
to authenticated
using (auth.uid() = id);

-- No direct client policies are created for operational tables.
-- The service_role key bypasses RLS and MUST remain only in Render environment variables.

grant usage on schema public to authenticated;
grant select on public.profiles to authenticated;
grant all on all tables in schema public to service_role;
grant execute on function public.increment_lead_contact_attempts(uuid) to service_role;

-- Helpful view for reporting in Supabase itself.
create or replace view public.lead_metrics as
select
  l.id,
  l.business_name,
  l.niche,
  l.final_tier,
  l.status,
  l.owner_id,
  l.capture_date,
  count(c.id) as total_contactos,
  count(c.id) filter (where c.channel = 'Llamada') as llamadas,
  count(c.id) filter (where c.channel = 'WhatsApp') as whatsapps,
  count(c.id) filter (where c.appointment_booked or c.outcome = 'Reunión agendada') as reuniones,
  count(c.id) filter (where c.outcome = 'Venta' or coalesce(c.sale_amount, 0) > 0) as ventas,
  coalesce(sum(c.sale_amount), 0) as ingreso_atribuido,
  min(c.occurred_at) as primer_contacto,
  max(c.occurred_at) as ultimo_contacto
from public.leads l
left join public.call_logs c on c.lead_id = l.id
group by l.id;
