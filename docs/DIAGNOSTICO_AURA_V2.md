# Diagnóstico AURA v2 — Sistemas de Conversión Comercial

## Objetivo
Actualizar Diagnose para que el Diagnóstico AURA completo confirme con evidencia dónde una oportunidad deja de avanzar en el recorrido:

**Consulta → Respuesta → Seguimiento → Cita → Venta**

El Pre-Diagnóstico detecta señales. El Diagnóstico AURA confirma. La Prescripción Comercial será una fase separada. Focus ejecuta y mide.

## Arquitectura visible de Diagnose
1. **Pre-Diagnósticos** — señales preliminares, elegibilidad, segmentación y remarketing.
2. **Diagnósticos AURA** — evidencia real, hallazgos, riesgo, impacto, prioridades y roadmap.
3. **Prescripciones** — reservado para una fase posterior; no activado en este paquete.

## Bloques del Diagnóstico AURA
- Objetivo, demanda y resultado esperado.
- Cliente y oferta prioritaria.
- Consulta · entrada y siguiente paso.
- Respuesta · velocidad y conducción.
- Seguimiento · responsable, fecha y continuidad.
- Cita · agenda, asistencia y recuperación.
- Venta · resultado y medición.
- Capacidad, equipo y responsabilidades.
- Herramientas, registros y fuente de verdad.
- Automatización, IA y límites.

## Cada evaluación conserva
- Hallazgo.
- Evidencia.
- Confianza.
- Riesgo.
- Impacto comercial.
- Prioridad.
- Recomendación.
- Requiere validación.
- Siguiente mejor pregunta.
- Estado visual: controlado / inconsistente / pérdida probable / sin evidencia.

## Separación comercial
Este paquete elimina del flujo visible del Diagnóstico AURA el precio fijo de implementación y la oferta automática posterior al informe. La prescripción de plan, plataforma, alcance y precio se realizará en una fase separada.

## Compatibilidad
Se conservaron las claves históricas de bloques y áreas de scoring cuando era posible para no romper diagnósticos existentes. La actualización no requiere una migración nueva de base de datos: la migración 19 ya contiene los campos estructurados necesarios para hallazgos, evidencia, riesgo, impacto, prioridad y siguiente pregunta.
