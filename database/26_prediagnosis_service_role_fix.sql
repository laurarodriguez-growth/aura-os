-- Aura OS · Pre-Diagnóstico AURA
-- Fix aditivo posterior a la migración 25.
-- La migración 25 ya fue aplicada. Este archivo NO la reejecuta.

begin;

grant select, insert, update, delete
on table public.prediagnoses
to service_role;

commit;
