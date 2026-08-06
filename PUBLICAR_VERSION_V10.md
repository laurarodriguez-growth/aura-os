# Publicar Aura OS v10

Esta versión incluye:

- selector geográfico sin superposiciones;
- botón **Duplicado** en la tarjeta principal de Focus;
- consolidación segura del historial de dos leads;
- edición de WhatsApp y correo en la ficha completa.

## Publicación correcta

1. Descomprime el ZIP en tu computadora.
2. Sube **el contenido de la carpeta descomprimida** a la raíz del repositorio `aura-os`. No subas el ZIP como un archivo dentro del repositorio.
3. Confirma que se reemplazaron al menos estos archivos:
   - `frontend/src/pages/Focus.jsx`
   - `frontend/src/components/LeadDrawer.jsx`
   - `frontend/src/components/DuplicateLeadDialog.jsx`
   - `frontend/src/components/GeographicSelector.jsx`
   - `frontend/src/styles.css`
   - `backend/app/main.py`
   - `backend/app/models.py`
4. Haz el commit en la rama `main`.
5. En **Actions**, abre únicamente la ejecución nueva de **Deploy Aura OS to GitHub Pages** cuyo commit corresponda a v10. Espera a que finalice en verde.
6. No pulses **Re-run jobs** en una ejecución anterior: una publicación vieja puede sobrescribir la versión nueva aunque ambas aparezcan en verde.
7. En Render, publica el commit nuevo de `main` usando las variables actuales. No agregues una clave nueva.
8. Si aún no lo hiciste, ejecuta `SQL_AURA_OS_DUPLICADOS_CONTACTOS.sql` en Supabase.

## Comprobación

Después de publicar, fuerza la actualización del navegador con `Ctrl + F5` y confirma:

1. La tarjeta principal de Focus muestra **Duplicado** junto a **Ver ficha completa**.
2. La pestaña **Resumen** de la ficha completa muestra **Datos de contacto**.
3. País y Ciudad base aparecen en filas completas y las sugerencias de Google empujan el formulario hacia abajo, sin tapar otros campos.
