-- Aura Grow: biblioteca administrable de outcomes.
-- Migración aditiva. No elimina leads, actividades, usuarios ni diagnósticos.

create extension if not exists pgcrypto;

create table if not exists public.outcome_library (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null unique,
  category text not null default 'General',
  description text,
  color text not null default '#B6FF2E',
  recommended_conversation_status text,
  recommended_commercial_status text,
  followup_delay_days integer check (followup_delay_days is null or followup_delay_days between 0 and 3650),
  recommended_next_step text,
  priority_adjustment integer not null default 0 check (priority_adjustment between -100 and 100),
  is_terminal boolean not null default false,
  available_for_action boolean not null default false,
  available_for_response boolean not null default true,
  available_for_classification boolean not null default true,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outcome_library_conversation_status_check check (
    recommended_conversation_status is null or recommended_conversation_status in (
      'not_started','waiting_response','response_received','conversation_active',
      'waiting_decision_maker','waiting_confirmation','followup_scheduled','closed'
    )
  )
);

alter table public.outcome_library
  add column if not exists priority_adjustment integer not null default 0
  check (priority_adjustment between -100 and 100);

alter table public.leads
  add column if not exists outcome_id uuid references public.outcome_library(id) on delete set null;

alter table public.leads
  add column if not exists outcome_priority_adjustment integer
  check (outcome_priority_adjustment is null or outcome_priority_adjustment between -100 and 100);

alter table public.call_logs
  add column if not exists outcome_id uuid references public.outcome_library(id) on delete set null;

alter table public.call_logs
  add column if not exists outcome_priority_adjustment integer
  check (outcome_priority_adjustment is null or outcome_priority_adjustment between -100 and 100);

create index if not exists leads_outcome_id_idx on public.leads(outcome_id);
create index if not exists call_logs_outcome_id_idx on public.call_logs(outcome_id);
create index if not exists outcome_library_active_sort_idx on public.outcome_library(is_active, sort_order, name);

create or replace function public.set_outcome_library_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_outcome_library_updated_at on public.outcome_library;
create trigger trg_outcome_library_updated_at
before update on public.outcome_library
for each row execute function public.set_outcome_library_updated_at();

insert into public.outcome_library (
  code, name, category, description, color,
  recommended_conversation_status, recommended_commercial_status,
  followup_delay_days, recommended_next_step, priority_adjustment, is_terminal,
  available_for_action, available_for_response, available_for_classification, sort_order
)
values
  ('pending', 'Pendiente', 'Pendiente', 'Todavía no existe un resultado comercial.', '#94A3B8', 'waiting_response', 'Contactado', 1, 'Esperar respuesta y retomar según el canal.', 0, false, true, false, true, 10),
  ('no_response_first_message', 'No respondió al primer mensaje', 'Sin respuesta', 'Primer mensaje enviado sin respuesta.', '#FACC15', 'waiting_response', 'Seguimiento 1', 1, 'Realizar follow-up en 24 horas.', 4, false, true, true, true, 20),
  ('no_response_call', 'No respondió a la llamada', 'Sin respuesta', 'Llamada realizada sin conexión.', '#FACC15', 'waiting_response', 'Seguimiento 1', 1, 'Intentar WhatsApp o un segundo canal.', 4, false, true, true, true, 30),
  ('outside_hours_auto_reply', 'Respuesta automática fuera de horario', 'Automatización', 'Se recibió una respuesta automática fuera del horario de atención.', '#38BDF8', 'followup_scheduled', 'Seguimiento 1', 1, 'Contactar dentro del horario con el mensaje corregido.', 6, false, true, true, true, 40),
  ('bot_requested_name_reason', 'Bot pidió nombre y motivo', 'Automatización', 'El bot solicitó identificación o motivo antes de llegar a una persona.', '#38BDF8', 'followup_scheduled', 'Seguimiento 1', 1, 'Enviar un follow-up corto solicitando al encargado.', 6, false, true, true, true, 50),
  ('voicemail', 'Buzón de voz', 'Sin respuesta', 'La llamada llegó al buzón de voz.', '#FACC15', 'waiting_response', 'Seguimiento 1', 1, 'Intentar nuevamente o usar WhatsApp.', 3, false, true, true, true, 60),
  ('reception', 'Recepción', 'Intermediario', 'Se contactó recepción, no al decisor.', '#A78BFA', 'waiting_decision_maker', 'Seguimiento 1', 1, 'Solicitar el nombre y horario del decisor.', 10, false, true, true, true, 70),
  ('wrong_whatsapp_flow', 'WhatsApp abrió flujo de paciente', 'Canal incorrecto', 'El canal abrió una experiencia diseñada para pacientes.', '#FB923C', 'followup_scheduled', 'Seguimiento 1', 1, 'Aclarar el error y retomar como contacto comercial.', 7, false, true, true, true, 80),
  ('contact_intermediary', 'Contacto con intermediario', 'Intermediario', 'Respondió una persona que no toma la decisión.', '#A78BFA', 'waiting_decision_maker', 'Seguimiento 1', 1, 'Solicitar contacto o disponibilidad del decisor.', 14, false, false, true, true, 90),
  ('referral', 'Referido a otro contacto', 'Referido', 'La persona compartió otro contacto o canal.', '#22D3EE', 'followup_scheduled', 'Seguimiento 1', 0, 'Crear o actualizar el contacto referido y escribirle.', 18, false, false, true, true, 100),
  ('responded', 'Respondió', 'Respuesta', 'La empresa respondió y la conversación debe calificarse.', '#22D3EE', 'response_received', 'Respondió', 1, 'Calificar la necesidad y acordar el siguiente paso.', 25, false, false, true, true, 105),
  ('requested_information', 'Solicitó información', 'Interés', 'Pidió detalles antes de decidir.', '#86EFAC', 'conversation_active', 'Respondió', 1, 'Enviar información concreta y acordar seguimiento.', 24, false, false, true, true, 110),
  ('followup_requested', 'Seguimiento solicitado', 'Seguimiento', 'Pidió ser contactado en otro momento.', '#C4B5FD', 'followup_scheduled', 'Seguimiento 1', 1, 'Retomar en la fecha acordada.', 18, false, false, true, true, 120),
  ('waiting_confirmation', 'Esperando confirmación', 'Seguimiento', 'La conversación continúa pendiente de una confirmación.', '#C4B5FD', 'waiting_confirmation', 'Seguimiento 1', 1, 'Confirmar la decisión o el horario acordado.', 28, false, false, true, true, 130),
  ('objection_identified', 'Objeción identificada', 'Objeción', 'Existe una objeción que requiere manejo.', '#FB923C', 'conversation_active', 'Respondió', 2, 'Responder la objeción y validar el siguiente paso.', 16, false, false, true, true, 140),
  ('decision_maker_unavailable', 'Decisor no disponible', 'Decisor', 'La persona responsable no estaba disponible.', '#A78BFA', 'waiting_decision_maker', 'Seguimiento 1', 1, 'Contactar en el horario indicado.', 12, false, true, true, true, 150),
  ('has_provider', 'Ya tiene proveedor', 'Objeción', 'La empresa ya trabaja con otra solución o proveedor.', '#94A3B8', 'followup_scheduled', 'Seguimiento 2', 60, 'Mantener en nurture y revisar en 60 días.', 4, false, false, true, true, 160),
  ('interested', 'Interesado', 'Interés', 'Existe interés comercial explícito.', '#B6FF2E', 'conversation_active', 'Interesado', 1, 'Acordar reunión o siguiente paso concreto.', 35, false, false, true, true, 170),
  ('meeting_booked', 'Reunión agendada', 'Conversión', 'Se confirmó una reunión.', '#B6FF2E', 'closed', 'Reunión agendada', null, 'Preparar la reunión y confirmar asistencia.', 30, true, false, true, true, 180),
  ('not_interested', 'No interesado', 'Cierre', 'La empresa rechazó continuar.', '#F87171', 'closed', 'No interesado', null, 'Cerrar la oportunidad y conservar el historial.', -100, true, false, true, true, 190),
  ('not_qualified', 'No califica', 'Cierre', 'La oportunidad no cumple los criterios comerciales.', '#F87171', 'closed', 'No califica', null, 'Cerrar la oportunidad con la razón documentada.', -100, true, false, true, true, 200),
  ('invalid_number', 'Número incorrecto o inválido', 'Datos inválidos', 'El número no corresponde o no permite contacto.', '#EF4444', 'closed', 'No califica', null, 'Buscar otro canal; si no existe, descartar.', -100, true, true, true, true, 210),
  ('do_not_contact', 'No contactar', 'Cierre', 'La empresa pidió no recibir más contactos.', '#EF4444', 'closed', 'Descartado', null, 'No insistir. Conservar el historial.', -100, true, false, true, true, 220),
  ('sale', 'Venta', 'Conversión', 'La oportunidad se convirtió en cliente.', '#B6FF2E', 'closed', 'Implementación vendida', null, 'Iniciar onboarding y registrar el monto.', -100, true, false, true, true, 230)
on conflict (code) do update set
  name = excluded.name,
  category = excluded.category,
  description = excluded.description,
  color = excluded.color,
  recommended_conversation_status = excluded.recommended_conversation_status,
  recommended_commercial_status = excluded.recommended_commercial_status,
  followup_delay_days = excluded.followup_delay_days,
  recommended_next_step = excluded.recommended_next_step,
  priority_adjustment = excluded.priority_adjustment,
  is_terminal = excluded.is_terminal,
  available_for_action = excluded.available_for_action,
  available_for_response = excluded.available_for_response,
  available_for_classification = excluded.available_for_classification,
  sort_order = excluded.sort_order,
  updated_at = now();

-- Vincula históricos por nombre, sin alterar el texto guardado.
update public.leads l
set outcome_id = o.id
from public.outcome_library o
where l.outcome_id is null
  and l.outcome is not null
  and lower(trim(l.outcome)) = lower(trim(o.name));

update public.call_logs c
set outcome_id = o.id
from public.outcome_library o
where c.outcome_id is null
  and c.outcome is not null
  and lower(trim(c.outcome)) = lower(trim(o.name));

update public.leads l
set outcome_priority_adjustment = o.priority_adjustment
from public.outcome_library o
where l.outcome_id = o.id
  and l.outcome_priority_adjustment is null;

update public.call_logs c
set outcome_priority_adjustment = o.priority_adjustment
from public.outcome_library o
where c.outcome_id = o.id
  and c.outcome_priority_adjustment is null;

revoke all on public.outcome_library from anon, authenticated;
grant all on public.outcome_library to service_role;

comment on table public.outcome_library is
'Catálogo administrable de resultados comerciales. El setter selecciona; Aura calcula la madurez internamente.';
comment on column public.outcome_library.priority_adjustment is
'Ajuste opcional que se suma al Momentum de Focus cuando este outcome queda activo en el lead.';

comment on column public.outcome_library.is_terminal is
'Cuando es true, Aura clasifica el outcome como final y cierra la conversación.';