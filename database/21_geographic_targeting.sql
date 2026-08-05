-- Aura OS · Selector geográfico y separación operativa por país
-- Migración aditiva: conserva todos los leads, usuarios, búsquedas y diagnósticos existentes.

alter table public.profiles
  add column if not exists operating_country text not null default 'PA';

update public.profiles set operating_country = 'ALL' where role = 'admin';
update public.profiles set operating_country = 'PA'
where role <> 'admin' and (operating_country is null or btrim(operating_country) = '');

alter table public.leads
  add column if not exists country_code text not null default 'PA',
  add column if not exists country_name text not null default 'Panamá',
  add column if not exists region text,
  add column if not exists city text,
  add column if not exists commercial_team text not null default 'PA';

update public.leads
set country_code = 'PA', country_name = 'Panamá', commercial_team = 'PA'
where country_code is null or btrim(country_code) = '';

alter table public.search_jobs
  add column if not exists country_code text not null default 'PA',
  add column if not exists country_name text not null default 'Panamá',
  add column if not exists commercial_team text not null default 'PA',
  add column if not exists base_city jsonb,
  add column if not exists target_locations jsonb not null default '[]'::jsonb,
  add column if not exists search_mode text not null default 'zones',
  add column if not exists radius_km integer;

update public.search_jobs
set country_code = 'PA', country_name = 'Panamá', commercial_team = 'PA'
where country_code is null or btrim(country_code) = '';

create index if not exists profiles_operating_country_idx
  on public.profiles(operating_country) where is_active = true;
create index if not exists leads_country_owner_idx
  on public.leads(country_code, owner_id, status);
create index if not exists leads_country_pending_idx
  on public.leads(country_code, status, do_not_contact, archived);
create index if not exists search_jobs_country_created_idx
  on public.search_jobs(country_code, created_at desc);

comment on column public.profiles.operating_country is
  'Código ISO alpha-2 de la operación permitida; ALL se reserva para administradores globales.';
comment on column public.search_jobs.base_city is
  'Lugar de Google seleccionado como ciudad base: nombre, dirección, place_id, coordenadas, país, región y ciudad.';
comment on column public.search_jobs.target_locations is
  'Zonas seleccionadas desde Google Places Autocomplete, conservadas como objetos estructurados.';
