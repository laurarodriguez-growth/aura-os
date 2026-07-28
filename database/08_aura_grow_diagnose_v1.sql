-- Aura Grow Diagnose V1 · acceso individual por usuario

-- Acceso individual por feature. Diagnose no depende del rol del usuario.
create table if not exists public.user_feature_access (
  user_id uuid not null references auth.users(id) on delete cascade,
  feature_key text not null,
  enabled boolean not null default false,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, feature_key),
  constraint user_feature_access_key_check check (feature_key in ('diagnose'))
);

create index if not exists user_feature_access_enabled_idx
  on public.user_feature_access(feature_key, enabled, user_id);

alter table public.user_feature_access enable row level security;
grant all on public.user_feature_access to service_role;

-- Habilitar Diagnose únicamente para Laura en esta instalación inicial.
-- El acceso después se administra por persona desde Mi cuenta → Gestión de usuarios.
insert into public.user_feature_access (user_id, feature_key, enabled, granted_by, granted_at, updated_at)
select id, 'diagnose', true, id, now(), now()
from auth.users
where id = 'aceaef58-0663-4483-ad5f-d77a2162fd87'::uuid
on conflict (user_id, feature_key) do update
set enabled = excluded.enabled,
    granted_by = excluded.granted_by,
    granted_at = excluded.granted_at,
    updated_at = now();

-- Migración aditiva: no borra ni modifica los datos operativos de Focus.
-- Ejecutar una sola vez en Supabase > SQL Editor > New query > Run.

create table if not exists public.diagnoses (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  assigned_to uuid references public.profiles(id) on delete set null,
  company_name text not null,
  industry text,
  website text,
  instagram text,
  whatsapp text,
  city text,
  contact_name text,
  contact_title text,
  objective text,
  declared_problem text,
  executive_summary text,
  status text not null default 'draft' check (status in ('draft','in_progress','completed','archived')),
  overall_score integer not null default 0 check (overall_score between 0 and 100),
  overall_level text not null default 'Sin evaluar',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists diagnoses_status_idx on public.diagnoses(status, updated_at desc);
create index if not exists diagnoses_lead_idx on public.diagnoses(lead_id);
create index if not exists diagnoses_assigned_idx on public.diagnoses(assigned_to, status);

create table if not exists public.diagnosis_assessments (
  id uuid primary key default gen_random_uuid(),
  diagnosis_id uuid not null references public.diagnoses(id) on delete cascade,
  section text not null check (section in ('icp','conversion','process','automation')),
  answers jsonb not null default '[]'::jsonb,
  score integer not null default 0 check (score between 0 and 100),
  level text not null default 'Sin evaluar',
  notes text,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(diagnosis_id, section)
);

create index if not exists diagnosis_assessments_diagnosis_idx
  on public.diagnosis_assessments(diagnosis_id, section);

create table if not exists public.diagnosis_evidence (
  id uuid primary key default gen_random_uuid(),
  diagnosis_id uuid not null references public.diagnoses(id) on delete cascade,
  uploaded_by uuid references public.profiles(id) on delete set null,
  name text not null,
  category text not null default 'General',
  evidence_type text not null default 'note' check (evidence_type in ('file','link','note')),
  storage_path text,
  external_url text,
  notes text,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);

create index if not exists diagnosis_evidence_diagnosis_idx
  on public.diagnosis_evidence(diagnosis_id, created_at desc);

create table if not exists public.diagnosis_findings (
  id uuid primary key default gen_random_uuid(),
  diagnosis_id uuid not null references public.diagnoses(id) on delete cascade,
  source_section text,
  source_key text,
  title text not null,
  description text,
  evidence text,
  impact text not null default 'medium' check (impact in ('low','medium','high','critical')),
  urgency text not null default 'medium' check (urgency in ('low','medium','high','critical')),
  recommendation text,
  status text not null default 'open' check (status in ('open','sent_to_focus','resolved','dismissed')),
  priority integer not null default 50 check (priority between 0 and 100),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists diagnosis_findings_diagnosis_idx
  on public.diagnosis_findings(diagnosis_id, priority desc, created_at desc);
create unique index if not exists diagnosis_findings_source_unique
  on public.diagnosis_findings(diagnosis_id, source_key)
  where source_key is not null;

create table if not exists public.diagnosis_roadmap (
  id uuid primary key default gen_random_uuid(),
  diagnosis_id uuid not null references public.diagnoses(id) on delete cascade,
  finding_id uuid references public.diagnosis_findings(id) on delete set null,
  phase text not null default '7_days' check (phase in ('7_days','30_days','90_days')),
  title text not null,
  description text,
  priority text not null default 'medium' check (priority in ('low','medium','high','critical')),
  owner_id uuid references public.profiles(id) on delete set null,
  due_date date,
  status text not null default 'planned' check (status in ('planned','sent_to_focus','in_progress','completed','cancelled')),
  order_index integer not null default 0,
  focus_task_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists diagnosis_roadmap_diagnosis_idx
  on public.diagnosis_roadmap(diagnosis_id, phase, order_index, created_at);

create table if not exists public.focus_tasks (
  id uuid primary key default gen_random_uuid(),
  diagnosis_id uuid references public.diagnoses(id) on delete cascade,
  roadmap_item_id uuid references public.diagnosis_roadmap(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  assigned_to uuid references public.profiles(id) on delete set null,
  title text not null,
  description text,
  priority text not null default 'medium' check (priority in ('low','medium','high','critical')),
  due_date date,
  status text not null default 'pending' check (status in ('pending','in_progress','completed','dismissed')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists focus_tasks_queue_idx
  on public.focus_tasks(assigned_to, status, due_date, created_at)
  where status in ('pending','in_progress');

create table if not exists public.diagnosis_reports (
  id uuid primary key default gen_random_uuid(),
  diagnosis_id uuid not null references public.diagnoses(id) on delete cascade,
  generated_by uuid references public.profiles(id) on delete set null,
  report_version integer not null default 1,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists diagnosis_reports_diagnosis_idx
  on public.diagnosis_reports(diagnosis_id, created_at desc);

-- Bucket privado para capturas, PDF y documentos del diagnóstico.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'diagnose-evidence',
  'diagnose-evidence',
  false,
  10485760,
  array[
    'image/png','image/jpeg','image/webp','application/pdf','text/plain','text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]::text[]
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types,
  public = false;

-- updated_at automático.
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'user_feature_access_set_updated_at') then
    create trigger user_feature_access_set_updated_at before update on public.user_feature_access
      for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'diagnoses_set_updated_at') then
    create trigger diagnoses_set_updated_at before update on public.diagnoses
    for each row execute procedure public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'diagnosis_assessments_set_updated_at') then
    create trigger diagnosis_assessments_set_updated_at before update on public.diagnosis_assessments
    for each row execute procedure public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'diagnosis_findings_set_updated_at') then
    create trigger diagnosis_findings_set_updated_at before update on public.diagnosis_findings
    for each row execute procedure public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'diagnosis_roadmap_set_updated_at') then
    create trigger diagnosis_roadmap_set_updated_at before update on public.diagnosis_roadmap
    for each row execute procedure public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'focus_tasks_set_updated_at') then
    create trigger focus_tasks_set_updated_at before update on public.focus_tasks
    for each row execute procedure public.set_updated_at();
  end if;
end $$;

alter table public.diagnoses enable row level security;
alter table public.diagnosis_assessments enable row level security;
alter table public.diagnosis_evidence enable row level security;
alter table public.diagnosis_findings enable row level security;
alter table public.diagnosis_roadmap enable row level security;
alter table public.focus_tasks enable row level security;
alter table public.diagnosis_reports enable row level security;

-- Diagnose se consume exclusivamente desde FastAPI con service role.
grant all on public.diagnoses to service_role;
grant all on public.diagnosis_assessments to service_role;
grant all on public.diagnosis_evidence to service_role;
grant all on public.diagnosis_findings to service_role;
grant all on public.diagnosis_roadmap to service_role;
grant all on public.focus_tasks to service_role;
grant all on public.diagnosis_reports to service_role;

comment on table public.diagnoses is 'Diagnósticos vivos de Aura Grow Diagnose.';
comment on table public.focus_tasks is 'Acciones creadas por Diagnose y ejecutadas dentro de Focus.';
