# Biblioteca de respuestas de Aura

Versión: 2026.07.29

La biblioteca analiza respuestas comerciales y propone una clasificación, una respuesta y el siguiente paso. No modifica el catálogo SQL ni crea tablas nuevas.

Cobertura actual: 39 intenciones agrupadas en cierres, automatizaciones, canal/ruteo, decisores, objeciones, interés, reuniones y señales operativas.

Reglas de seguridad operativa:

- Las solicitudes de no contacto, números incorrectos y cierres definitivos tienen prioridad máxima.
- Una reunión solo se clasifica como agendada cuando el horario ya fue confirmado.
- “Ya tenemos encargado”, “lo hacemos internamente”, “lo lleva recepción” y equivalentes se clasifican como objeción operativa, no como rechazo.
- “Ya tenemos CRM/sistema” y “ya tenemos proveedor” se separan para sugerir preguntas distintas.
- En TXT exportados de WhatsApp, Aura intenta analizar el último mensaje del contacto y evita tomar como respuesta los mensajes enviados por el setter que tiene la sesión activa.
- Si no existe intención explícita, Aura conserva el estado Respondió y recomienda una pregunta de calificación.

La identidad del setter se obtiene de `profiles.full_name` y se inserta dinámicamente en las respuestas sugeridas. No requiere SQL.
