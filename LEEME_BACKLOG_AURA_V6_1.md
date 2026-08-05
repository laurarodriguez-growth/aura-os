# Aura OS · Backlog de aprendizaje de Aura v6.1

Esta versión añade un Backlog ligero para revisar los análisis de Aura sin permitir aprendizaje automático autónomo.

## Qué incluye

- Guarda automáticamente cada clic en **Analizar con Aura**.
- Registra:
  - mensaje real del lead;
  - contexto anterior del setter;
  - interpretación;
  - respuesta sugerida;
  - clasificación;
  - confianza;
  - setter y fecha;
  - regla y versión del playbook;
  - resultado de la siguiente respuesta entrante o avance comercial verificable del lead.
- Registra que una sugerencia fue utilizada cuando el setter presiona **Copiar respuesta**.
- Añade **Aura Grow → Control y medición → Backlog de Aura**.
- Protege la ruta, los endpoints y la tabla para uso exclusivo de administración.
- Permite evaluar cada caso como:
  - Sirvió;
  - Necesita ajuste;
  - Incorrecta.
- Permite guardar la interpretación o respuesta correcta y el tipo de problema.
- Incluye los estados:
  - Pendiente de revisar;
  - Aprobado como buen ejemplo;
  - Necesita nueva regla;
  - Regla actualizada;
  - Descartado.
- Incluye filtros por setter, fechas, outcome, confianza, estado y tipo de problema.
- Incluye métricas de análisis, aprobaciones, correcciones, pendientes, precisión y uso de sugerencias.

## Instalación

### 1. Instalar la tabla nueva en Supabase

1. Abre tu proyecto en Supabase.
2. Entra a **SQL Editor**.
3. Crea una consulta nueva.
4. Copia el contenido completo de:

```text
database/18_aura_learning_backlog.sql
```

5. Presiona **Run**.
6. El resultado final debe mostrar:

```text
installed_table = aura_learning_backlog
existing_cases = 0
```

La migración es aditiva. No borra ni cambia leads, usuarios, interacciones, catálogos o diagnósticos.

### 2. Subir la versión consolidada

1. Descomprime el ZIP.
2. Abre la carpeta `aura-os-main`.
3. Sube **todo su contenido** a la raíz del repositorio de Aura OS.
4. Reemplaza los archivos existentes.
5. Espera a que GitHub Actions y Render terminen el despliegue.
6. Recarga Aura OS con `Ctrl + Shift + R` o abre una ventana de incógnito.

## Prueba rápida

1. Entra con una cuenta setter.
2. Abre uno de sus leads.
3. En **Registrar respuesta**, pega un mensaje y presiona **Analizar con Aura**.
4. Copia la respuesta sugerida y guarda la interacción.
5. Entra con la cuenta administradora.
6. Abre **Control y medición → Backlog de Aura**.
7. Confirma que el caso muestra el mensaje, interpretación, clasificación, regla y setter.
8. Márcalo como **Sirvió** o registra una corrección.
9. Guarda una respuesta entrante, reunión, cierre o venta posterior en el mismo lead y confirma que aparece en **Resultado posterior**.

## Cómo se calculan las métricas

- **Análisis realizados:** todos los casos guardados con los filtros activos.
- **Aprobados:** casos marcados como Sirvió.
- **Corregidos:** casos marcados como Necesita ajuste o Incorrecta.
- **Pendientes:** casos con estado Pendiente de revisar.
- **Precisión de clasificación:** casos Sirvió ÷ casos evaluados.
- **Uso de sugerencias:** respuestas copiadas ÷ análisis que tenían respuesta sugerida.

La precisión comienza en 0% mientras no existan casos evaluados. Esto evita presentar como precisión real una cifra sin evidencia.

## Seguridad y aprendizaje

- Los setters no ven la ruta ni pueden abrirla directamente.
- Todos los endpoints de consulta y revisión exigen rol `admin`.
- La tabla no concede acceso directo a `anon` ni `authenticated`.
- Los setters solo pueden registrar el uso de su propia sugerencia.
- Una falla del Backlog nunca impide guardar la interacción comercial.
- Marcar un caso no modifica `chatResponseLibrary.js`, `chat_analysis.py` ni el playbook.
- **Regla actualizada** es un estado documental: significa que una persona autorizada ya aplicó y validó el cambio por separado.

## Archivos principales del cambio

```text
backend/app/aura_backlog.py
backend/app/main.py
backend/app/models.py
backend/app/chat_analysis.py
frontend/src/pages/AuraBacklog.jsx
frontend/src/components/ContactComposer.jsx
frontend/src/components/Layout.jsx
frontend/src/App.jsx
frontend/src/lib/chatResponseLibrary.js
frontend/src/styles.css
database/18_aura_learning_backlog.sql
```
