-- Aura Grow V2 completa
-- Agrega scoring editable, plantillas, snapshot por búsqueda y la vista enriquecida del Call Log.
-- Es una migración aditiva: no borra leads, llamadas, notas ni usuarios.
-- Ejecutar una sola vez en Supabase > SQL Editor > New query > Run.

create table if not exists public.scoring_templates (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references public.profiles(id) on delete set null,
  name text not null,
  niche text not null,
  country text not null default 'Panamá',
  rules jsonb not null default '[]'::jsonb,
  thresholds jsonb not null default '{"A":70,"B":50,"C":30}'::jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(created_by, name)
);

create index if not exists scoring_templates_niche_idx
on public.scoring_templates(niche, country, is_default desc);

alter table public.search_jobs
  add column if not exists new_leads_added integer not null default 0,
  add column if not exists pending_at_start integer not null default 0,
  add column if not exists scoring_mode text not null default 'automatic',
  add column if not exists scoring_template_id uuid,
  add column if not exists scoring_template_name text,
  add column if not exists scoring_rules jsonb not null default '[]'::jsonb,
  add column if not exists scoring_thresholds jsonb not null default '{"A":70,"B":50,"C":30}'::jsonb;

alter table public.leads
  add column if not exists scoring_mode text not null default 'automatic',
  add column if not exists scoring_template_id uuid,
  add column if not exists scoring_template_name text,
  add column if not exists scoring_rules jsonb not null default '[]'::jsonb,
  add column if not exists scoring_thresholds jsonb not null default '{"A":70,"B":50,"C":30}'::jsonb,
  add column if not exists scoring_job_id uuid;

alter table public.search_results
  add column if not exists is_new_lead boolean not null default false,
  add column if not exists scoring_template_name text,
  add column if not exists scoring_rules jsonb not null default '[]'::jsonb,
  add column if not exists scoring_thresholds jsonb not null default '{"A":70,"B":50,"C":30}'::jsonb,
  add column if not exists auto_score integer not null default 0,
  add column if not exists auto_tier text not null default 'Descartar';

alter table public.scoring_templates enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'scoring_templates_set_updated_at'
      and tgrelid = 'public.scoring_templates'::regclass
      and not tgisinternal
  ) then
    create trigger scoring_templates_set_updated_at
    before update on public.scoring_templates
    for each row execute procedure public.set_updated_at();
  end if;
end
$$;

grant all on public.scoring_templates to service_role;

-- El navegador no accede directamente a estas plantillas.
-- FastAPI en Render usa la service role key y valida que el usuario sea admin.

-- Call Log enriquecido para búsqueda, filtros y exportación.
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
  coalesce(p.full_name, 'Usuario') as agent_name
from public.call_logs c
join public.leads l on l.id = c.lead_id
left join public.profiles p on p.id = c.agent_id;

revoke all on public.call_log_enriched from anon, authenticated;
grant select on public.call_log_enriched to service_role;

create index if not exists call_logs_channel_idx on public.call_logs(channel);
create index if not exists call_logs_followup_idx on public.call_logs(followup_date);
create index if not exists leads_pending_capacity_idx
on public.leads(status, do_not_contact, archived)
where excluded_reason is null;
create index if not exists leads_contact_attempts_idx on public.leads(contact_attempts);

comment on view public.call_log_enriched is
'Vista del Call Log con nombre del negocio y agente. Se consulta únicamente desde FastAPI con service role.';

-- Aura Focus no necesita una tabla nueva: calcula la prioridad con los datos ya guardados.
-- Este índice acelera la cola por responsable, estado, seguimiento y último contacto.
create index if not exists leads_aura_focus_idx
on public.leads(owner_id, status, next_followup_date, last_contact_date, final_tier)
where archived = false and do_not_contact = false and excluded_reason is null;

comment on index public.leads_aura_focus_idx is
'Acelera Aura Focus sin duplicar ni mover los leads de la base permanente.';
