-- Aura OS · consolidación segura de leads duplicados
-- Esta migración es aditiva y conserva historiales, respuestas y trazabilidad.

alter table public.leads
  add column if not exists merged_into_lead_id uuid references public.leads(id) on delete set null,
  add column if not exists merged_at timestamptz,
  add column if not exists merged_by uuid references public.profiles(id) on delete set null;

create index if not exists leads_merged_into_idx
  on public.leads(merged_into_lead_id)
  where merged_into_lead_id is not null;

create or replace function public.merge_duplicate_leads(
  p_source_id uuid,
  p_target_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  source_lead public.leads%rowtype;
  target_lead public.leads%rowtype;
  combined_branches text[];
  combined_notes text;
begin
  if p_source_id = p_target_id then
    raise exception 'El lead origen y destino no pueden ser el mismo';
  end if;

  select * into source_lead from public.leads where id = p_source_id for update;
  select * into target_lead from public.leads where id = p_target_id for update;

  if source_lead.id is null or source_lead.archived then
    raise exception 'El lead origen no está disponible';
  end if;
  if target_lead.id is null or target_lead.archived or target_lead.excluded_reason is not null then
    raise exception 'El lead destino no está disponible';
  end if;
  if coalesce(source_lead.country_code, 'PA') <> coalesce(target_lead.country_code, 'PA') then
    raise exception 'No se pueden consolidar leads de países diferentes';
  end if;

  select coalesce(array_agg(distinct branch) filter (where branch is not null and btrim(branch) <> ''), '{}')
  into combined_branches
  from unnest(
    coalesce(target_lead.branch_addresses, '{}')
    || coalesce(source_lead.branch_addresses, '{}')
    || array[source_lead.address]
  ) as branch;

  combined_notes := concat_ws(
    E'\n\n',
    nullif(btrim(target_lead.notes), ''),
    case
      when nullif(btrim(source_lead.notes), '') is null then null
      when btrim(source_lead.notes) = btrim(coalesce(target_lead.notes, '')) then null
      else '[Consolidado desde otra ficha] ' || btrim(source_lead.notes)
    end
  );

  -- Conserva la relación con búsquedas sin violar unique(job_id, lead_id).
  delete from public.search_results source_result
  using public.search_results target_result
  where source_result.lead_id = p_source_id
    and target_result.lead_id = p_target_id
    and source_result.job_id = target_result.job_id;
  update public.search_results set lead_id = p_target_id where lead_id = p_source_id;

  -- Concatena todo el historial operativo en la ficha que se conserva.
  update public.call_logs set lead_id = p_target_id where lead_id = p_source_id;
  update public.activities set lead_id = p_target_id where lead_id = p_source_id;

  if to_regclass('public.diagnoses') is not null then
    execute 'update public.diagnoses set lead_id = $1 where lead_id = $2' using p_target_id, p_source_id;
  end if;
  if to_regclass('public.focus_tasks') is not null then
    execute 'update public.focus_tasks set lead_id = $1 where lead_id = $2' using p_target_id, p_source_id;
  end if;
  if to_regclass('public.aura_learning_backlog') is not null then
    execute 'update public.aura_learning_backlog set lead_id = $1 where lead_id = $2' using p_target_id, p_source_id;
  end if;

  update public.leads
  set
    phone = coalesce(nullif(phone, ''), nullif(source_lead.phone, '')),
    website = coalesce(nullif(website, ''), nullif(source_lead.website, '')),
    instagram_url = coalesce(nullif(instagram_url, ''), nullif(source_lead.instagram_url, '')),
    whatsapp_url = coalesce(nullif(whatsapp_url, ''), nullif(source_lead.whatsapp_url, '')),
    whatsapp_phone = coalesce(nullif(whatsapp_phone, ''), nullif(source_lead.whatsapp_phone, '')),
    email = coalesce(nullif(email, ''), nullif(source_lead.email, '')),
    maps_url = coalesce(nullif(maps_url, ''), nullif(source_lead.maps_url, '')),
    decision_maker_name = coalesce(nullif(decision_maker_name, ''), nullif(source_lead.decision_maker_name, '')),
    decision_maker_title = coalesce(nullif(decision_maker_title, ''), nullif(source_lead.decision_maker_title, '')),
    decision_maker_link = coalesce(nullif(decision_maker_link, ''), nullif(source_lead.decision_maker_link, '')),
    branch_addresses = combined_branches,
    branch_count_estimate = greatest(branch_count_estimate, source_lead.branch_count_estimate, cardinality(combined_branches)),
    notes = nullif(combined_notes, ''),
    owner_id = coalesce(owner_id, source_lead.owner_id),
    status = case
      when status in ('Nuevo', 'Investigando', 'Listo para contactar')
       and source_lead.status not in ('Nuevo', 'Investigando', 'Listo para contactar')
      then source_lead.status else status end,
    conversation_status = case
      when coalesce(conversation_status, 'not_started') = 'not_started'
       and coalesce(source_lead.conversation_status, 'not_started') <> 'not_started'
      then source_lead.conversation_status else conversation_status end,
    outcome = case
      when nullif(outcome, '') is null or outcome = 'Pendiente' then source_lead.outcome else outcome end,
    outcome_id = coalesce(outcome_id, source_lead.outcome_id),
    outcome_stage = case
      when coalesce(outcome_stage, 'pending') = 'pending' then source_lead.outcome_stage else outcome_stage end,
    final_outcome_at = coalesce(final_outcome_at, source_lead.final_outcome_at),
    first_contact_date = case
      when first_contact_date is null then source_lead.first_contact_date
      when source_lead.first_contact_date is null then first_contact_date
      else least(first_contact_date, source_lead.first_contact_date) end,
    last_contact_date = greatest(last_contact_date, source_lead.last_contact_date),
    next_followup_date = case
      when next_followup_date is null then source_lead.next_followup_date
      when source_lead.next_followup_date is null then next_followup_date
      else least(next_followup_date, source_lead.next_followup_date) end,
    response_due_at = case
      when response_due_at is null then source_lead.response_due_at
      when source_lead.response_due_at is null then response_due_at
      else least(response_due_at, source_lead.response_due_at) end,
    do_not_contact = do_not_contact or source_lead.do_not_contact,
    contact_attempts = coalesce(contact_attempts, 0) + coalesce(source_lead.contact_attempts, 0),
    final_score = greatest(final_score, source_lead.final_score),
    final_tier = case when source_lead.final_score > final_score then source_lead.final_tier else final_tier end,
    updated_at = now()
  where id = p_target_id;

  update public.leads
  set
    archived = true,
    excluded_reason = 'Duplicado consolidado en ' || p_target_id::text,
    status = 'Descartado',
    owner_id = null,
    next_followup_date = null,
    response_due_at = null,
    merged_into_lead_id = p_target_id,
    merged_at = now(),
    merged_by = p_actor_id,
    updated_at = now()
  where id = p_source_id;

  insert into public.activities(lead_id, user_id, event_type, description, metadata)
  values (
    p_target_id,
    p_actor_id,
    'lead_merged',
    'Lead duplicado consolidado sin perder el historial',
    jsonb_build_object(
      'source_lead_id', p_source_id,
      'source_business_name', source_lead.business_name,
      'source_address', source_lead.address,
      'target_lead_id', p_target_id
    )
  );

  return jsonb_build_object(
    'target_lead_id', p_target_id,
    'target_business_name', target_lead.business_name,
    'source_business_name', source_lead.business_name
  );
end;
$$;

revoke all on function public.merge_duplicate_leads(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.merge_duplicate_leads(uuid, uuid, uuid) to service_role;

comment on function public.merge_duplicate_leads(uuid, uuid, uuid) is
'Consolida un lead duplicado en otro, mueve historiales relacionados y archiva el origen con trazabilidad.';
