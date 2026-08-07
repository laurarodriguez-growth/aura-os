# Rollback

1. No revertir la migración 25 borrando la tabla: puede contener Pre-Diagnósticos reales.
2. Si el código debe revertirse, revertir el commit/PR de esta fase.
3. El fix 26 solo concede permisos a `service_role`; para revocarlo:
   `revoke all on table public.prediagnoses from service_role;`
   Solo hacerlo con autorización y después de confirmar que el backend ya no depende de la tabla.
4. Verificar `/health`, `/ready`, login, Diagnose, Focus y lectura de leads después de cualquier rollback.
