# IMPLEMENTACIÓN PASO A PASO

Ya completaste:

- proyecto de Supabase;
- tablas de Aura Grow;
- usuario de Laura;
- rol `admin`;
- repositorio `aura-os`.

Ahora sigue este orden exacto.

## Paso 1. Subir estos archivos a GitHub

1. Descomprime el ZIP.
2. En tu repositorio `aura-os`, pulsa **Add file**.
3. Selecciona **Upload files**.
4. Arrastra **el contenido dentro de la carpeta `aura-os`**, no el ZIP cerrado.
5. Espera a que aparezcan las carpetas `frontend`, `backend`, `database`, `.github` y los demás archivos.
6. Abajo, escribe: `Instalar base de Aura OS`.
7. Pulsa **Commit changes**.

La carpeta `.github` puede estar oculta en Windows. Al arrastrar la carpeta completa al navegador normalmente se sube. Si no aparece, revisa la guía `docs/SUBIR_ARCHIVOS_GITHUB.md`.

## Paso 2. Desplegar el backend en Render

1. Abre Render.
2. Pulsa **New +**.
3. Elige **Blueprint**.
4. Conecta GitHub si te lo pide.
5. Selecciona el repositorio `aura-os`.
6. Render detectará `render.yaml`.
7. Confirma la creación del servicio `aura-grow-api`.

Render te pedirá estas variables privadas:

- `SUPABASE_URL`: Project URL de Supabase.
- `SUPABASE_ANON_KEY`: tu publishable key `sb_publishable_...`.
- `SUPABASE_SERVICE_ROLE_KEY`: tu secret key `sb_secret_...`.
- `GOOGLE_MAPS_API_KEY`: la misma API key que usaste con el scraper.
- `ALLOWED_ORIGINS`: `https://laurarodriguez-growth.github.io,http://localhost:5173,http://127.0.0.1:5173`

No publiques ni envíes capturas de la secret key o la clave de Google.

Cuando Render termine, abre:

`https://aura-grow-api.onrender.com/health`

Debe mostrar un JSON con `status: ok`.

## Paso 3. Conectar el frontend

En GitHub abre:

`frontend/public/config.js`

Pulsa el lápiz y reemplaza los tres valores:

```js
window.AURA_CONFIG = {
  SUPABASE_URL: "https://TU-PROYECTO.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_...",
  API_BASE_URL: "https://aura-grow-api.onrender.com"
};
```

Pulsa **Commit changes**.

Nunca pegues aquí la secret key.

## Paso 4. Activar GitHub Pages

1. Repositorio `aura-os`.
2. **Settings**.
3. **Pages**.
4. En `Build and deployment`, elige **GitHub Actions**.
5. Abre la pestaña **Actions**.
6. Espera que `Deploy Aura OS to GitHub Pages` termine en verde.

Tu dirección será:

`https://laurarodriguez-growth.github.io/aura-os/`

## Paso 5. Primera prueba

1. Abre la dirección de Aura OS.
2. Inicia sesión con el correo y contraseña creados en Supabase.
3. Confirma que aparece tu nombre y rol de administradora.
4. Abre **Generar leads**.
5. Haz una prueba con:
   - Nicho: Dental
   - Ciudad: Ciudad de Panamá
   - Zonas: San Francisco, Obarrio
   - Servicios: Implantes dentales, Ortodoncia
   - Máximo: 20
   - Límite Google: 5
6. Pulsa **Iniciar búsqueda**.
7. Revisa los resultados en **Base de leads**.

## Qué no debes hacer todavía

- No crees más tablas.
- No ejecutes nuevamente `01_schema.sql`.
- No agregues AdVision ni Aura Vision todavía.
- No subas claves secretas a GitHub.
- No hagas una búsqueda de cientos de leads en la primera prueba.
