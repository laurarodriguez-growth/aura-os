-- Usa este archivo solamente para convertir un usuario existente en administrador.
-- Reemplaza el UUID por el que muestra Supabase Authentication.

update public.profiles
set full_name = 'Laura Rodriguez', role = 'admin'
where id = 'REEMPLAZA-CON-UUID-REAL';

select id, full_name, role
from public.profiles
where id = 'REEMPLAZA-CON-UUID-REAL';
