# Aura OS explicado sin tecnicismos

## Aura OS

Es la plataforma completa. En el futuro alojará varios módulos.

## Aura Grow

Es el primer módulo y el único que estamos construyendo ahora. Sus secciones son:

- Dashboard
- Generar leads
- Base de leads
- Pipeline
- Seguimientos
- Call Log
- Exportaciones

## Supabase

Es la memoria. Guarda usuarios, leads, notas, llamadas, estados y métricas.

## Render

Es el trabajador privado. Usa la clave de Google, audita páginas y conversa con Supabase sin mostrar las claves secretas.

## React y GitHub Pages

React construye las pantallas. GitHub Pages publica esas pantallas gratis en el navegador.

## El flujo

```text
Tú haces clic en Generar leads
        ↓
React envía la orden al backend de Render
        ↓
Render consulta Google Places y revisa el caché
        ↓
Render guarda los leads en Supabase
        ↓
React muestra los resultados
```
