# Aura OS · Icono oficial para Chrome/PWA · v6.1

Este paquete corrige el favicon y el icono de instalación de Aura OS usando exclusivamente el logo oficial que ya existía en el proyecto: la **A con órbita y destello**.

## Cambios incluidos

- Nuevo favicon SVG versionado.
- Favicon PNG de 32 × 32 como respaldo.
- Iconos PWA de 192 × 192 y 512 × 512.
- Iconos `maskable` separados de 192 × 192 y 512 × 512.
- Apple Touch Icon de 180 × 180.
- Nuevo manifiesto versionado: `manifest-v3.webmanifest`.
- Actualización del Service Worker y cambio del nombre de caché.
- Registro del Service Worker con `updateViaCache: 'none'` y URL versionada.
- Rutas verificadas para GitHub Pages bajo `/aura-os/`.

## Archivos principales

```text
frontend/index.html
frontend/src/main.jsx
frontend/public/sw.js
frontend/public/manifest-v3.webmanifest
frontend/public/aura-os-favicon-v3.svg
frontend/public/aura-os-favicon-v3-32.png
frontend/public/icons/aura-os-app-v3-192.png
frontend/public/icons/aura-os-app-v3-512.png
frontend/public/icons/aura-os-maskable-v3-192.png
frontend/public/icons/aura-os-maskable-v3-512.png
frontend/public/icons/aura-os-apple-touch-v3-180.png
```

## Instalación

1. Sube todo el contenido de `aura-os-main` a la raíz del repositorio y reemplaza los archivos actuales.
2. Espera a que GitHub Actions termine en verde.
3. Abre Aura OS desde la URL normal de GitHub Pages.
4. Presiona `F12` en Chrome.
5. Ve a **Application → Storage → Clear site data**.
6. Ve a **Application → Service Workers → Unregister** si todavía aparece el worker anterior.
7. Cierra todas las pestañas de Aura OS.
8. Abre `chrome://restart` para reiniciar Chrome.
9. Abre Aura OS nuevamente y revisa **Application → Manifest**.
10. Abre **Instalar la app**. Debe mostrar la A oficial con órbita y destello.

Si Aura OS ya estaba instalada, desinstálala antes de volver a instalarla.

## SQL

No requiere SQL.

## Validaciones realizadas

- JSON del manifest válido.
- Service Worker con sintaxis válida.
- JSX de `main.jsx` validado.
- Iconos PNG verificados en sus tamaños reales.
- Rutas del manifest, favicon, Service Worker e iconos respondieron correctamente bajo `/aura-os/` en una prueba HTTP local.
