# Publicar Aura OS v11

Esta versión contiene todo lo incluido en v10 y agrega el reparto de leads por **País** y **Nicho**.

## Nuevo flujo de reparto

1. Abre **Repartir leads**.
2. Selecciona el país.
3. Selecciona el nicho disponible dentro de ese país.
4. Aura recalcula el contador y la vista previa.
5. Selecciona los agentes compatibles con el país.
6. Confirma el reparto.

El backend vuelve a validar país, nicho y agentes antes de asignar. Nunca mezcla países ni reparte otro nicho aunque se manipule la petición desde el navegador.

## Instalación local con GitHub Desktop

1. Descomprime el ZIP.
2. En GitHub Desktop selecciona `aura-os`, rama `main`, pulsa **Fetch origin** y luego **Pull origin** si aparece.
3. Abre **Repository → Show in Explorer**.
4. Copia todo el contenido descomprimido dentro de la carpeta local `aura-os` y acepta reemplazar archivos.
5. En GitHub Desktop crea el commit `Instalar Aura OS v11 con reparto por país y nicho`.
6. Pulsa **Push origin**.
7. Espera la ejecución nueva de **Deploy Aura OS to GitHub Pages**. No relances workflows de commits anteriores.
8. En Render usa **Manual Deploy → Deploy latest commit**.
9. Actualiza Aura con `Ctrl + F5`.

Esta mejora no necesita otro SQL ni nuevas variables de entorno.
