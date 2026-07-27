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

## Seguridad

Nunca subas estas claves a GitHub:

- `SUPABASE_SERVICE_ROLE_KEY` o `sb_secret_...`
- `GOOGLE_MAPS_API_KEY`

La publishable key de Supabase sí está diseñada para usarse en el navegador, siempre con RLS correctamente configurado.
