# Fix: clasificación automática para Maikol

## Nuevo flujo

1. Maikol registra una acción o pega/sube la respuesta del lead.
2. Al presionar **Analizar con Aura**, Aura aplica automáticamente:
   - estado comercial;
   - estado de conversación;
   - outcome;
   - objeción;
   - próximo paso;
   - próximo seguimiento.
3. Maikol revisa la respuesta sugerida y presiona **Guardar y continuar**.
4. Solo se abre **Ajustar manualmente** cuando Aura necesita una corrección.

## Seguimientos rápidos

Ahora están disponibles:

- Hoy
- Mañana
- En 3 días
- En 7 días
- Fecha personalizada

## Ficha del lead

La pestaña **Clasificación** fue reemplazada por **Resumen**. Los datos aparecen como lectura automática. Los selectores manuales quedaron ocultos dentro de **Corregir clasificación manualmente**.

## Instalación

Reemplazar los archivos incluidos en el fix conservando las mismas rutas. No requiere SQL ni migraciones.
