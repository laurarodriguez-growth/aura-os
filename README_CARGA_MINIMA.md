# Aura OS — Carga mínima consolidada

## Esta fase incluye
- Pre-Diagnóstico AURA como tab de Diagnose.
- Indicador `Pre-Diagnóstico AURA: Sí/No` en la ficha de Focus.
- Vinculación del Pre-Diagnóstico con leads fríos existentes sin cambiar origen, setter ni historial.
- Matching y deduplicación de teléfono con código de país + número (formato internacional/E.164 cuando es posible).
- Si el teléfono local no tiene país suficiente para normalizarlo, no se fuerza una fusión ambigua.
- Fix del orden de routers detectado por Codex.
- Fix `service_role` mediante migración NUEVA 26.
- Diagnóstico AURA v2 basado en Consulta → Respuesta → Seguimiento → Cita → Venta.
- Prescripciones solo queda preparada como siguiente fase; no se activa el motor.

## Copia
Copia las carpetas `backend/`, `frontend/`, `database/` y `docs/` sobre la rama limpia
`feature/prediagnostico-aura`, preservando las rutas.

## Supabase
- `25_prediagnosis_aura.sql`: YA FUE EJECUTADO. Se incluye solo para historial del repo. NO volver a ejecutarlo.
- Ejecutar después del PR/code review: `26_prediagnosis_service_role_fix.sql`.
- Verificar con `27_verify_prediagnosis_aura.sql`.
- `28_verify_diagnose_aura_v2.sql` es solo lectura.

## No incluido
- __pycache__
- *.pyc
- node_modules
- .env
- MIGRATIONS.md
- Motor de Prescripción Comercial
- despliegues o cambios automáticos de producción
