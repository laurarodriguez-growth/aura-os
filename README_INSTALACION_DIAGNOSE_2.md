# Instalación · Aura Grow Diagnose 2.0

Esta versión es aditiva: conserva Focus, permisos, pipeline, usuarios, leads y datos anteriores de Diagnose.

## 1. Subir el repositorio

Sube a GitHub el contenido de esta carpeta raíz. Deben quedar visibles `frontend/`, `backend/`, `database/`, `.github/` y `render.yaml`. No subas la carpeta histórica `aura-os-v6-1-backlog-aura-consolidado/` si estás usando el ZIP consolidado entregado con esta actualización.

## 2. Ejecutar una sola migración en Supabase

En Supabase abre **SQL Editor → New query**, copia el contenido de:

`database/19_diagnose_definitive.sql`

Ejecuta **Run** una sola vez. Es una migración aditiva: no borra tablas ni registros.

Después ejecuta:

`database/20_verify_diagnose_definitive.sql`

La verificación debe listar `diagnosis_block_evaluations`, las nuevas columnas de evidencias/preguntas/informes y el trigger de actualización.

## 3. Configurar Gemini para capturas

En Google AI Studio crea una API key de Gemini. En Render abre el servicio `aura-grow-api` y agrega:

- `GEMINI_API_KEY`: clave privada creada en Google AI Studio.
- `GEMINI_VISION_MODEL`: `gemini-3-flash-preview` (ya está declarado como valor predeterminado en `render.yaml`).

No coloques esta clave en `frontend/public/config.js`, GitHub ni capturas.

Sin `GEMINI_API_KEY`, Diagnose sigue funcionando: PDF con texto, DOCX, XLSX, CSV, TXT y páginas públicas se procesan localmente. Las imágenes quedan marcadas para revisión humana en vez de producir un resultado inventado.

El nivel gratuito de Gemini tiene cuotas variables. Si devuelve límite de uso o error, Aura conserva la evidencia y declara la limitación.

## 4. Desplegar

Render desplegará el backend mediante `render.yaml`. GitHub Actions construirá el frontend. Comprueba:

1. `https://aura-grow-api.onrender.com/health` responde con `status: ok`.
2. Aura OS permite iniciar sesión.
3. El usuario de Laura conserva rol `admin` y acceso individual a Diagnose.

## 5. Prueba funcional mínima

1. Crea o abre un diagnóstico.
2. Confirma que aparecen diez bloques conversacionales.
3. Responde una pregunta núcleo y guarda la evaluación del bloque.
4. Comprueba que madurez y cobertura se muestran por separado.
5. Agrega una captura anonimizada, indica proveedor, fecha y finalidad.
6. Agrega un enlace público y pulsa **Analizar evidencias**.
7. Valida que una evidencia no legible quede declarada como limitación.
8. Genera hallazgos desde los bloques y luego el roadmap.
9. Envía una acción del roadmap a Focus y confirma que aparece sin modificar el pipeline.
10. Genera un informe preliminar. El informe final debe permanecer bloqueado mientras falten validaciones.

## Privacidad

Las evidencias se entregan únicamente desde FastAPI a usuarios administradores autorizados. Los archivos viven en el bucket privado `diagnose-evidence`; al eliminarlos, se borra el objeto y se conserva solo un registro de eliminación para auditoría.
