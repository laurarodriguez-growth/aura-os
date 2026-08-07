# Esquema y migraciones

`01_schema.sql` es el baseline original de Aura OS. Los archivos numerados posteriores forman una secuencia acumulativa y deben aplicarse en orden numérico. Los archivos `*_verify_*` son comprobaciones de solo lectura.

Desde `23_security_hardening.sql`, cada cambio estructural registra su versión en `public.schema_migrations`. Las migraciones nuevas deben ser:

- idempotentes o fallar antes de modificar parcialmente el esquema;
- ejecutadas dentro de una transacción cuando PostgreSQL lo permita;
- libres de datos personales, credenciales y valores de producción;
- acompañadas de una prueba y, cuando el cambio sea destructivo, una reversión explícita;
- verificadas primero en un proyecto de staging vacío.

El estado estructural vigente se reconstruye aplicando `01_schema.sql` y después los archivos numéricos hasta `24_archive_test_backups.sql`. Las tablas archivadas solo existen si estaban presentes en el entorno de origen; no forman parte del baseline funcional.

