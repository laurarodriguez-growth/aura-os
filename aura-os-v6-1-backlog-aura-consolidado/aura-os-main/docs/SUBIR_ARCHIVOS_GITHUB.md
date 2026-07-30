# Cómo subir el proyecto desde el navegador

1. Descomprime `Aura_OS_Aura_Grow_React.zip`.
2. Abre la carpeta descomprimida `aura-os`.
3. Selecciona todas las carpetas y archivos internos.
4. Arrástralos a GitHub después de pulsar **Add file → Upload files**.

Debes ver en la raíz del repositorio:

```text
.github/
backend/
database/
docs/
frontend/
.gitignore
README.md
START_HERE.md
render.yaml
```

No debe quedar así:

```text
aura-os/aura-os/frontend
```

Si ocurre, subiste la carpeta exterior completa dentro del repositorio. GitHub necesita que `frontend` y `backend` estén directamente en la primera pantalla del repositorio.

## Si `.github` no aparece

Windows puede ocultar carpetas que empiezan por punto. Usa una de estas opciones:

- activa **Ver → Mostrar → Elementos ocultos** en el Explorador de archivos;
- arrastra la carpeta completa `aura-os` al área de carga y verifica que GitHub mantenga la estructura;
- crea manualmente el archivo desde GitHub con este nombre:
  `.github/workflows/deploy-pages.yml`
  y pega el contenido del archivo incluido en el ZIP.
