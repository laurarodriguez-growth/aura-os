# Aura OS · versión estable consolidada 6.0

Fecha: 29 de julio de 2026

Este paquete sustituye los fixes parciales v5.4, v5.5, v5.6 y v5.7, e integra la base operativa anterior en un solo proyecto completo.

## Incluye

### Hoy y reparto operativo
- Bandejas únicas: Nuevos, Seguimientos del día, Esperando primer contacto y Conversaciones activas.
- Las cuatro tarjetas funcionan como navegación; no existe una barra duplicada.
- Nuevos conserva las fichas individuales.
- Seguimientos permite buscar por nombre y fecha.
- Pre-reparto de leads antes de entrar en la cola.
- Cada setter trabaja únicamente sus leads asignados.
- El primer contacto mueve el lead a Esperando.
- Una respuesta entrante mueve el lead a Conversaciones activas.

### Registro y Aura
- Clasificación automática al analizar y guardar.
- Ajustar manualmente queda disponible como opción secundaria.
- Seguimiento para Hoy, Mañana, 3 días, 7 días o fecha personalizada.
- Outcome No interesado disponible y con cierre correcto.
- Biblioteca comercial basada en el playbook de Growth by Laura.
- Nombre del setter dinámico desde `profiles.full_name`.
- Guardado de interacciones corregido y compatible con catálogos incompletos.

### Interfaz global
- Encabezado, Menú, Mi cuenta y Cerrar sesión accesibles en computadora, iPad, tablet y teléfono.
- Saludo dinámico en Hoy: `Hola, [nombre]!`.
- El fallback durante la carga es `Usuario`, nunca el nombre de otra persona.

### Pipeline privado
- Pipeline visible únicamente para la administradora.
- Ruta y endpoint protegidos por rol administrador.
- Etapas reales:
  1. Nuevos
  2. Contactados
  3. Respondieron
  4. Interesados
  5. Reunión agendada
  6. Diagnóstico vendido
  7. Propuesta enviada
  8. Implementación vendida
  9. Cerrados

### Rendimiento corregido
- Separa Actividad del periodo de Conversión histórica.
- Contactados del periodo cuenta leads únicos con actividad saliente.
- Tasa de respuesta verificada = respuestas humanas entrantes / contactos salientes registrados.
- Bots y respuestas automáticas no cuentan como respuesta humana.
- Respuestas inferidas por estado se muestran aparte y no inflan la tasa.
- El rendimiento por setter se atribuye al setter que registró el primer contacto, no al responsable actual.
- Muestra tiempo promedio hasta la primera respuesta y contactos sin respuesta después de 24 horas.
- Todas las tarjetas mantienen drill-down hacia la ficha del lead.

### Generación dental
- Odontopediatría y sus variantes se incluyen dentro del filtro Dental.

## Instalación
1. Descomprime el ZIP.
2. Sube el contenido de `aura-os-main` a la raíz del repositorio.
3. Reemplaza los archivos existentes.
4. No ejecutes SQL.
5. Espera el despliegue y recarga con `Ctrl + Shift + R` o abre una ventana de incógnito.

## Validaciones realizadas
- Sintaxis de todos los archivos Python.
- Sintaxis de todos los archivos JS y JSX.
- Balance de llaves CSS.
- Pruebas de personalización por setter.
- Prueba de la fórmula de respuesta verificada y atribución por primer contacto con datos simulados.
- Integridad del ZIP.

El build completo de Vite no pudo ejecutarse en el entorno de preparación porque su registro interno no contiene `@supabase/supabase-js`. La validación de sintaxis sí se completó correctamente.
