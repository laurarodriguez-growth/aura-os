# Aura OS · Instalación del selector geográfico

Esta versión reemplaza el campo manual **“Zonas, separadas por coma”** en Generar leads por Google Places Autocomplete.

## Qué incluye

- País, ciudad base y zonas objetivo con datos reales de Google Maps.
- Autocomplete restringido al país y sesgado por la ciudad base.
- Selección múltiple de zonas como chips removibles.
- Modo alternativo de radio: 5, 10, 25 o 50 km.
- Session tokens por sesión de autocomplete.
- Persistencia estructurada de nombre, dirección, `place_id`, latitud, longitud, país, región y ciudad.
- Panamá y Chile activos; la lista se amplía desde `COUNTRIES` sin crear catálogos de zonas.
- Separación de leads y agentes por `operating_country`.
- Compatibilidad con las búsquedas anteriores mediante los campos heredados `city` y `zones`.

## Instalación

1. En Supabase SQL Editor, ejecuta una sola vez:

   `database/21_geographic_targeting.sql`

   Es una migración aditiva. Los leads actuales quedan identificados como Panamá y las cuentas administradoras existentes quedan habilitadas para todos los países.

2. Publica `backend/` en Render usando las mismas variables actuales. No se agrega ninguna clave nueva. `GOOGLE_MAPS_API_KEY` sigue siendo privada en Render.

3. Confirma en Google Cloud que la clave actual tiene habilitada **Places API (New)**. Los endpoints usados son Autocomplete (New), Place Details (New) y Text Search (New).

4. Publica el repositorio completo en GitHub. El workflow existente compila `frontend/` y despliega GitHub Pages.

5. En Aura OS abre **Configuración → Gestión de usuarios** y asigna a cada agente su país operativo:

   - Panamá
   - Chile
   - Todos los países, reservado para supervisión global

## Orden obligatorio

Ejecuta primero el SQL, después despliega el backend y finalmente el frontend. Así la autenticación nunca intentará leer columnas que todavía no existen.

## Validación rápida

1. En Generar leads selecciona Panamá y busca `Ciudad de Panamá`.
2. Escribe `San` en Zonas objetivo y selecciona dos sugerencias.
3. Confirma que aparecen como chips y que pueden eliminarse.
4. Cambia a radio y prueba 10 km.
5. Repite con Chile, por ejemplo `Curicó` y una zona cercana.
6. Genera una búsqueda pequeña y revisa en Base de leads que país, región y ciudad estén completos.
7. Intenta asignar un lead chileno a un agente de Panamá: el backend debe rechazarlo.

## Notas de Google

- El frontend nunca recibe la API key de Google.
- Aura envía el token de sesión desde el primer autocomplete hasta Place Details y lo renueva después de cada selección.
- La atribución de Google Maps se muestra junto a las sugerencias y en el selector.
- Los resultados de Text Search que no correspondan al país elegido se descartan antes de guardarse.
