# Aura OS

Sistema operativo de crecimiento de Laura Rodriguez.

## Módulo activo: Aura Grow

Aura Grow integra:

- generación de leads con Google Places;
- caché y deduplicación por `place_id`;
- auditoría web e ICP scoring;
- base permanente de leads;
- pipeline y seguimientos;
- Call Log;
- exportaciones CSV y métricas.

## Arquitectura sin suscripción obligatoria

- `frontend/`: React + Vite, publicado con GitHub Pages.
- `backend/`: FastAPI, desplegado en Render.
- `database/`: esquema PostgreSQL ya instalado en Supabase.
- `.github/workflows/`: construcción automática del frontend.

## Empieza aquí

Abre [START_HERE.md](START_HERE.md) y sigue los pasos en orden.

Para instalar el alcance definitivo de Diagnose, abre
[README_INSTALACION_DIAGNOSE_2.md](README_INSTALACION_DIAGNOSE_2.md).

Para instalar el selector geográfico y la separación por país, abre
[README_SELECTOR_GEOGRAFICO.md](README_SELECTOR_GEOGRAFICO.md).

Para instalar la consolidación segura de duplicados y la edición de WhatsApp y correo, abre
[README_DUPLICADOS_CONTACTOS.md](README_DUPLICADOS_CONTACTOS.md).

Para publicar la versión consolidada sin reactivar una compilación anterior, abre
[PUBLICAR_VERSION_V10.md](PUBLICAR_VERSION_V10.md).

Para instalar el reparto por país y nicho, abre
[PUBLICAR_VERSION_V11.md](PUBLICAR_VERSION_V11.md).

## Seguridad

Nunca subas estas claves a GitHub:

- `SUPABASE_SERVICE_ROLE_KEY` o `sb_secret_...`
- `GOOGLE_MAPS_API_KEY`
- `GEMINI_API_KEY`

La publishable key de Supabase sí está diseñada para usarse en el navegador, siempre con RLS correctamente configurado.
