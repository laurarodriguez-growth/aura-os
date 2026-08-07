begin;

create schema if not exists archive authorization postgres;
revoke all on schema archive from public, anon, authenticated, service_role;

do $archive$
declare
  table_name text;
begin
  foreach table_name in array array[
    'backup_test_activities_20260727_v1',
    'backup_test_call_logs_20260727_v1',
    'backup_test_diagnosis_links_20260727_v1',
    'backup_test_leads_20260727_v1',
    'backup_test_search_results_20260727_v1'
  ]
  loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('alter table public.%I set schema archive', table_name);
    end if;
  end loop;
end
$archive$;

revoke all on all tables in schema archive from public, anon, authenticated, service_role;
comment on schema archive is 'Private production archives; intentionally excluded from the Data API';

insert into public.schema_migrations (version, description, checksum)
values (
  '20260806_archive_test_backups',
  'Move backup_test tables out of the Data API',
  'repo:database/24_archive_test_backups.sql'
)
on conflict (version) do update
set description = excluded.description,
    checksum = excluded.checksum;

commit;

