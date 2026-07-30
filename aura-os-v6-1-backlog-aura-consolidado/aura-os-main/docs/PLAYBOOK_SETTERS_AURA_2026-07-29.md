# Playbook de Setters — Growth by Laura

Aura usa el mismo guion comercial para todos los setters y personaliza automáticamente cada mensaje con el nombre completo del usuario que inició sesión.

## Fuente del nombre

El nombre se toma de `profiles.full_name`, administrado en Configuración > Usuarios. No se escribe manualmente dentro de cada respuesta.

## Funcionamiento

1. El setter inicia sesión con su cuenta.
2. Registra o importa la respuesta del lead.
3. Aura analiza el contexto y genera el texto usando el nombre del setter activo.
4. La clasificación, outcome, próximo paso y seguimiento se aplican automáticamente.
5. Si se importa un TXT de WhatsApp, Aura también reconoce como mensajes del agente las líneas firmadas con el nombre del setter activo.

Ejemplo: si el perfil activo es `Ana Pérez`, la sugerencia dirá `Soy Ana Pérez, asistente de consultoría de Growth by Laura`.

No requiere cambios SQL porque la plataforma ya conserva el nombre de cada usuario en `profiles.full_name`.
