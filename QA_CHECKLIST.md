# QA mínimo

- [ ] Backend importa/compila.
- [ ] `/api/diagnose/prediagnoses` lista Pre-Diagnósticos y no cae en `/{diagnosis_id}`.
- [ ] `service_role` tiene SELECT/INSERT/UPDATE/DELETE en `prediagnoses`.
- [ ] `anon` y `authenticated` siguen sin acceso directo.
- [ ] Número internacional `+<código><número>` coincide con el mismo lead.
- [ ] Número local + país del formulario coincide con el mismo lead.
- [ ] Número local ambiguo sin país no provoca auto-merge.
- [ ] Cold lead conserva `source`, `owner_id` y actividad previa.
- [ ] Focus muestra `Pre-Diagnóstico AURA: Sí/No`.
- [ ] Diagnose muestra tab Pre-Diagnósticos.
- [ ] Diagnóstico AURA v2 usa Consulta → Respuesta → Seguimiento → Cita → Venta.
- [ ] No hay recomendación automática de software.
- [ ] Prescripciones no ejecuta ningún motor.
- [ ] Mobile / tablet / desktop.
- [ ] CI 5/5 y CodeQL sin alertas nuevas antes del merge.
