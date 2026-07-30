# Seguridad

## Puede estar en GitHub

- Supabase Project URL.
- Supabase publishable key `sb_publishable_...`.
- Dirección pública de Render.

## Nunca debe estar en GitHub

- Supabase secret key `sb_secret_...`.
- Legacy `service_role` key.
- Google Maps API key.
- Contraseñas de usuarios.

## Dónde van los secretos

Solo en Render, dentro de **Environment Variables**.

El archivo `backend/.env.example` contiene nombres y ejemplos, no claves reales.
