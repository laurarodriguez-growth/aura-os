# Duplicados y datos de contacto

Esta versión agrega dos mejoras al flujo de leads sin modificar Focus, Diagnose, scoring ni las reglas de país y permisos.

## 1. Instalar la migración necesaria

En Supabase abre **SQL Editor**, crea una consulta nueva y ejecuta completo:

`database/22_duplicate_lead_merge.sql`

La migración es aditiva: conserva los leads y el historial existente. Agrega la trazabilidad de fusiones y una operación atómica para consolidar duplicados.

## 2. Publicar la aplicación

Publica `backend/` en Render y `frontend/` con el flujo actual. No se agrega ninguna variable de entorno ni clave. `GOOGLE_MAPS_API_KEY` continúa siendo privada en Render.

## 3. Uso en Focus

1. Abre el lead principal y pulsa **Duplicado**.
2. Aura busca negocios con nombre igual o similar dentro del mismo país y ordena los resultados por cercanía.
3. Revisa la dirección, distancia, resultado anterior y actividad de cada candidato.
4. Si puede tratarse de otra sucursal, Aura lo advierte. La fusión nunca se ejecuta automáticamente.
5. Selecciona el lead correcto, confirma y pulsa **Consolidar y descartar actual**.

La operación mantiene como lead principal el candidato elegido, mueve su historial de llamadas y actividades, completa datos faltantes y archiva el lead actual con referencia al destino. Los leads de países distintos no se pueden consolidar.

## 4. Editar WhatsApp y correo

Abre la ficha completa del lead. En **Datos de contacto** puedes editar:

- WhatsApp, con normalización internacional para Panamá y Chile;
- correo electrónico, con validación de formato.

Guarda con el botón habitual de la ficha. Los accesos rápidos de WhatsApp y correo se actualizan con los datos guardados.

## Validación rápida después de publicar

1. Entra con un setter y confirma que solo vea leads asignados y de su país.
2. Edita WhatsApp y correo en una ficha, guarda y vuelve a abrirla.
3. Usa **Duplicado** en dos leads de prueba del mismo país.
4. Confirma que el lead descartado desaparezca de Focus y que el elegido conserve el historial combinado.
5. Abre Diagnose y verifica que siga funcionando normalmente.
