-- Aura Grow Focus 2.3
-- Gestión de usuarios y desactivación segura.
-- Ejecutar una sola vez en Supabase SQL Editor antes de subir el código.

alter table public.profiles
  add column if not exists is_active boolean not null default true;

update public.profiles
set is_active = true
where is_active is null;

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('admin', 'agent', 'setter'));

create index if not exists profiles_active_role_idx
  on public.profiles(is_active, role);

-- Conserva la creación automática de perfiles para usuarios creados desde Aura Grow.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role, is_active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    'agent',
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
