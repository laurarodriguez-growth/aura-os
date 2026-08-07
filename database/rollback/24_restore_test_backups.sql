begin;

alter table if exists archive.backup_test_activities_20260727_v1 set schema public;
alter table if exists archive.backup_test_call_logs_20260727_v1 set schema public;
alter table if exists archive.backup_test_diagnosis_links_20260727_v1 set schema public;
alter table if exists archive.backup_test_leads_20260727_v1 set schema public;
alter table if exists archive.backup_test_search_results_20260727_v1 set schema public;

delete from public.schema_migrations
where version = '20260806_archive_test_backups';

commit;

