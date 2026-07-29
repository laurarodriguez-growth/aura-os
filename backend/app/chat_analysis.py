from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any


def _normalize(text: str) -> str:
    value = unicodedata.normalize("NFKD", text or "")
    value = "".join(char for char in value if not unicodedata.combining(char))
    value = value.lower()
    value = re.sub(r"https?://\S+", " ", value)
    value = re.sub(r"[^a-z0-9ñ\s:/@.,+()-]", " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


_BASE_AGENT_HINTS = ("maikol", "laura", "growth by laura", "aura os", "aura grow")
_EXPORT_PATTERNS = (
    re.compile(r"^\s*\[[^\]]+\]\s*([^:]{1,80}):\s*(.*)$"),
    re.compile(r"^\s*\d{1,2}[/. -]\d{1,2}[/. -]\d{2,4}[^-]{0,40}-\s*([^:]{1,80}):\s*(.*)$"),
)


def _parse_messages(text: str) -> list[tuple[str, str]]:
    messages: list[list[str]] = []
    for raw_line in (text or "").splitlines():
        line = raw_line.strip("\ufeff")
        parsed = None
        for pattern in _EXPORT_PATTERNS:
            match = pattern.match(line)
            if match:
                parsed = (match.group(1).strip(), match.group(2).strip())
                break
        if parsed:
            messages.append([parsed[0], parsed[1]])
        elif messages and line.strip():
            messages[-1][1] = f"{messages[-1][1]} {line.strip()}".strip()
    return [(sender, message) for sender, message in messages if message]


def _setter_name(value: str | None) -> str:
    return re.sub(r'\s+', ' ', (value or '').strip()) or 'Growth by Laura'


def _setter_first_name(value: str | None) -> str:
    full_name = _setter_name(value)
    return full_name if full_name == 'Growth by Laura' else full_name.split(' ', 1)[0]


def _personalize_setter_text(value: str, setter_name: str | None) -> str:
    full_name = _setter_name(setter_name)
    first_name = _setter_first_name(full_name)
    return re.sub(r'\bMaikol\b', first_name, re.sub(r'\bMaikol Brown\b', full_name, value or ''))


def _agent_hints(setter_name: str | None) -> tuple[str, ...]:
    full_name = _normalize(_setter_name(setter_name))
    first_name = full_name.split(' ', 1)[0] if full_name else ''
    dynamic = tuple(item for item in (full_name, first_name if len(first_name) >= 4 else '') if item)
    return tuple(dict.fromkeys((*_BASE_AGENT_HINTS, *dynamic)))


def _is_agent_sender(sender: str, setter_name: str | None = None) -> bool:
    normalized_sender = _normalize(sender)
    return any(hint in normalized_sender for hint in _agent_hints(setter_name))


def _analysis_context(text: str, setter_name: str | None = None) -> tuple[str, str]:
    messages = _parse_messages(text)
    if not messages:
        return text or "", ""
    lead_index = len(messages) - 1
    while lead_index >= 0 and _is_agent_sender(messages[lead_index][0], setter_name):
        lead_index -= 1
    if lead_index < 0:
        lead_index = len(messages) - 1
    previous_agent_message = ""
    for index in range(lead_index - 1, -1, -1):
        if _is_agent_sender(messages[index][0], setter_name):
            previous_agent_message = messages[index][1]
            break
    return messages[lead_index][1], previous_agent_message


def _analysis_scope(text: str, setter_name: str | None = None) -> str:
    return _analysis_context(text, setter_name)[0]


def _next_business_day(current_date: date, delay_days: int = 1) -> date:
    candidate = current_date + timedelta(days=max(0, delay_days))
    while candidate.weekday() >= 5:
        candidate += timedelta(days=1)
    return candidate


def _excerpt(original: str, normalized_pattern: re.Pattern[str], setter_name: str | None = None) -> str:
    scope = _analysis_scope(original, setter_name)
    for line in (scope or "").splitlines():
        if normalized_pattern.search(_normalize(line)):
            return line.strip()[:220]
    return (scope or original or "").strip()[:220]


@dataclass(frozen=True)
class Signal:
    key: str
    label: str
    patterns: tuple[str, ...]
    outcome: str
    conversation_status: str
    commercial_status: str
    next_step: str
    recommended_reply: str
    reasoning: str
    objection: str = ""
    priority: int = 0
    confidence: int = 70
    followup_delay_days: int | None = 1
    is_terminal: bool = False
    appointment_booked: bool = False
    followup_mode: str = ""


SIGNALS: tuple[Signal, ...] = (

    Signal(
        key='maikol_outside_hours',
        label='respuesta automática fuera de horario',
        patterns=(
            r'\b(fuera de|fuera del) (nuestro )?horario\b',
            r'\bhorario de atencion\b',
            r'\ben este momento estamos (cerrados|fuera de servicio)\b',
            r'\bte responderemos (pronto|en horario|cuando regresemos)\b',
            r'\bnuestro horario es de\b',
        ),
        outcome='Respuesta automática fuera de horario',
        conversation_status='followup_scheduled',
        commercial_status='Contactado',
        next_step='Retomar el próximo día hábil entre 9:15 a. m. y 10:30 a. m.',
        recommended_reply='Hola 😊 Retomo mi mensaje dentro de su horario de atención. Soy Maikol Brown, asistente de consultoría de Growth by Laura. Vimos una posible oportunidad relacionada con el seguimiento de sus consultas por WhatsApp. ¿Con quién podría conversar sobre marketing, ventas o gestión de pacientes?',
        reasoning='Respondió una automatización, no una persona. El lead sigue abierto y debe retomarse dentro del horario de atención.',
        priority=140,
        confidence=98,
        followup_delay_days=1,
        followup_mode='next_business_day',
    ),
    Signal(
        key='maikol_bot_name_reason',
        label='bot solicitó nombre y motivo',
        patterns=(
            r'\b(indica|indiquenos|escribe|compartenos|ingresa) (tu|su)? ?nombre\b',
            r'\b(cual es|indica|indiquenos|escribe) (el )?motivo\b',
            r'\b(nombre completo|motivo de contacto|motivo de la consulta)\b',
            r'\bpara poder ayudarte.*\bnombre\b',
        ),
        outcome='Bot pidió nombre y motivo',
        conversation_status='waiting_decision_maker',
        commercial_status='Contactado',
        next_step='Responder al bot y solicitar a la persona encargada.',
        recommended_reply='Hola 😊 Soy Maikol Brown, asistente de consultoría de Growth by Laura. Motivo: queremos compartirles una observación breve sobre su proceso de atención por WhatsApp que podría ayudarles a convertir más consultas en citas. ¿Con quién podría conversarlo?',
        reasoning='El bot está filtrando el contacto. Maikol debe identificarse con transparencia y pedir una sola derivación.',
        priority=139,
        confidence=98,
    ),
    Signal(
        key='maikol_patient_flow',
        label='flujo automático de paciente',
        patterns=(
            r'^\s*quiero agendar una cita\s*[.!]*$',
            r'^\s*quiero mas informacion\s*[.!]*$',
            r'\b(agendar|reservar|confirmar) (una )?(cita|consulta)\b',
            r'\bselecciona (el|un) (servicio|tratamiento|especialidad)\b',
            r'\bdatos del paciente\b',
        ),
        outcome='WhatsApp abrió flujo de paciente',
        conversation_status='waiting_response',
        commercial_status='Contactado',
        next_step='Borrar el texto de paciente, aclarar el motivo comercial y confirmar si el seguimiento es manual o utiliza un sistema.',
        recommended_reply='Hola 😊 Gracias por responder. No escribo como paciente. Soy Maikol Brown, asistente de consultoría de Growth by Laura. Estamos conversando con clínicas para entender cómo organizan y dan seguimiento a las personas que consultan por WhatsApp. Quería hacerles una pregunta breve: ¿actualmente ese seguimiento lo realizan manualmente o utilizan algún sistema?',
        reasoning='WhatsApp abrió un flujo de paciente. Maikol debe borrar el texto predeterminado, aclarar que no escribe como paciente y hacer la pregunta sobre el sistema de seguimiento.',
        priority=138,
        confidence=97,
    ),
    Signal(
        key='maikol_auto_welcome',
        label='respuesta automática de bienvenida',
        patterns=(
            r'\bgracias por (comunicarte|comunicarse|contactarnos|escribirnos)\b',
            r'\bhemos recibido (tu|su) (mensaje|consulta|solicitud)\b',
            r'\buno de (nuestros|nuestro) (asesores|agentes|representantes) (te|le) respondera\b',
            r'\bbienvenid[oa]s? a\b',
            r'\btu mensaje ha sido recibido\b',
        ),
        outcome='Respondió',
        conversation_status='waiting_response',
        commercial_status='Contactado',
        next_step='Confirmar si el seguimiento de consultas es manual o utiliza un sistema.',
        recommended_reply='Hola 😊 Gracias por responder. No escribo como paciente. Soy Maikol Brown, asistente de consultoría de Growth by Laura. Estamos conversando con clínicas para entender cómo organizan y dan seguimiento a las personas que consultan por WhatsApp. Quería hacerles una pregunta breve: ¿actualmente ese seguimiento lo realizan manualmente o utilizan algún sistema?',
        reasoning='La bienvenida automática no es una respuesta comercial humana. El script actualizado pide aclarar que no se escribe como paciente y abrir con una sola pregunta sobre el seguimiento.',
        priority=137,
        confidence=96,
    ),
    Signal(
        key='maikol_send_info_here',
        label='solicitud de enviar información por el mismo chat',
        patterns=(
            r'\b(puede|puedes|pueden|pueden ustedes) (enviar|mandar|compartir)(nos|me)? (la|esa|mas)? ?(informacion|info|detalles) (por aqui|aqui|por este medio)\b',
            r'\benvie(n)? (la|esa|mas)? ?(informacion|info|detalles) (por aqui|aqui|por este medio)\b',
            r'\bmandalo por aqui\b',
            r'\b(puede|puedes|pueden) enviar(la|lo)? por aqui\b',
        ),
        outcome='Solicitó información',
        conversation_status='conversation_active',
        commercial_status='Respondió',
        next_step='Confirmar si el seguimiento es manual o si utilizan un sistema.',
        recommended_reply='Claro 😊 Laura realiza un diagnóstico del proceso de atención y seguimiento comercial. Revisa cómo reciben las consultas, cómo las califican, qué seguimiento realizan y en qué puntos podrían estar perdiéndose oportunidades. Luego entrega recomendaciones concretas para mejorar el proceso. No es un servicio de manejo de redes ni publicidad. ¿Actualmente el seguimiento de las personas que consultan por WhatsApp se realiza manualmente o utilizan algún sistema?',
        reasoning='El lead abrió la conversación, pero todavía falta una sola pregunta de diagnóstico antes de enviar información.',
        priority=136,
        confidence=97,
    ),
    Signal(
        key='maikol_no_system',
        label='seguimiento manual o sin sistema',
        patterns=(
            r'\b(no tenemos|no usamos|no utilizamos|no contamos con) (ningun )?(sistema|crm|software|plataforma|automatizacion)\b',
            r'\b(se hace|lo hacemos|es|todo es) manual\b',
            r'\bdepende de (una persona|alguien|recepcion|la recepcionista)\b',
            r'\b(lo llevamos|usamos) (en )?(excel|google sheets|una libreta|papel|whatsapp)\b',
        ),
        outcome='Respondió',
        conversation_status='conversation_active',
        commercial_status='Respondió',
        next_step='Registrar que el proceso es manual y observar la siguiente respuesta antes de avanzar.',
        recommended_reply='Entiendo 😊 Probablemente el seguimiento depende de que alguien recuerde responder, retomar conversaciones y confirmar citas. Justamente ayudamos a los negocios a organizar ese proceso para que menos consultas se pierdan y más personas terminen agendando.',
        reasoning='Se confirmó una operación manual. El script actualizado explica brevemente la brecha sin agregar otra pregunta en ese mismo mensaje.',
        objection='Proceso manual',
        priority=135,
        confidence=97,
    ),
    Signal(
        key='maikol_uses_system',
        label='ya utiliza un sistema',
        patterns=(
            r'\b(si|sí),? (tenemos|usamos|utilizamos|contamos con) (un|una|el|la)? ?(sistema|crm|software|plataforma|automatizacion|bot|chatbot)\b',
            r'\b(tenemos|usamos|utilizamos|trabajamos con) (kommo|hubspot|zoho|salesforce|monday|trello|whatsapp business)\b',
            r'\bya (tenemos|usamos|utilizamos) (un|una|el|la)? ?(sistema|crm|software|plataforma)\b',
            r'\bya esta (automatizado|sistematizado)\b',
        ),
        outcome='Objeción identificada',
        conversation_status='conversation_active',
        commercial_status='Respondió',
        next_step='Identificar qué sistema utilizan y quién supervisa el proceso.',
        recommended_reply='Perfecto 😊 Eso ya es un buen avance. Muchas veces el problema no es tener o no una herramienta, sino cómo se utiliza para dar seguimiento, recuperar conversaciones y convertir consultas en citas. ¿Qué sistema utilizan actualmente y quién supervisa este proceso?',
        reasoning='Tener sistema no cierra la oportunidad. El script pide identificar la herramienta y al responsable.',
        objection='Ya utiliza sistema o CRM',
        priority=134,
        confidence=96,
    ),
    Signal(
        key='maikol_decision_maker_present',
        label='apareció la persona encargada',
        patterns=(
            r'\b(yo soy|soy) (la|el)? ?(encargad[oa]|responsable|administrador[a]?|gerente)\b',
            r'\b(yo|conmigo) (lo manejo|lo veo|me encargo|puede hablar|puedes hablar)\b',
            r'\bhabla conmigo\b',
            r'\bese tema lo (veo|manejo) yo\b',
        ),
        outcome='Respondió',
        conversation_status='conversation_active',
        commercial_status='Respondió',
        next_step='Confirmar si miden cuántas consultas se convierten en citas o clientes.',
        recommended_reply='Hola, mucho gusto 😊 Soy Maikol Brown, asistente de consultoría de Growth by Laura. Estuvimos revisando brevemente su proceso de atención y detectamos una posible oportunidad relacionada con el seguimiento de las consultas que reciben por WhatsApp. ¿Actualmente tienen una forma clara de saber cuántas consultas terminan convirtiéndose en citas o clientes?',
        reasoning='Ya apareció el responsable. El script pasa de derivación a una sola pregunta de medición.',
        priority=133,
        confidence=96,
    ),
    Signal(
        key='maikol_not_measuring',
        label='no mide conversión de consultas',
        patterns=(
            r'\b(no medimos|no lo medimos|no llevamos metricas|no tenemos metricas)\b',
            r'\bno (sabemos|se) cuantas? (consultas|personas|conversaciones) (terminan|se convierten|agendan)\b',
            r'\bno llevamos (ese|un) control\b',
            r'\bno tenemos forma de saber\b',
            r'\bno calculamos (la )?conversion\b',
        ),
        outcome='Interesado',
        conversation_status='conversation_active',
        commercial_status='Interesado',
        next_step='Ofrecer dos horarios cerrados para una llamada de 15 minutos.',
        recommended_reply='Entiendo. Eso suele hacer que muchas oportunidades se pierdan sin que el negocio pueda identificar exactamente dónde ocurrió. Laura está realizando revisiones breves de procesos comerciales para detectar posibles fugas en atención, seguimiento y conversión. Podríamos mostrarle en una llamada de 15 minutos qué observamos y qué mejora puntual podría aplicar. Laura tiene disponibilidad [OPCIÓN 1] o [OPCIÓN 2]. ¿Cuál de esos dos horarios le funciona mejor?',
        reasoning='La falta de medición confirma una brecha concreta. El siguiente paso es ofrecer dos horarios, no pedir disponibilidad abierta.',
        objection='No mide conversión',
        priority=132,
        confidence=97,
        followup_delay_days=0,
    ),
    Signal(
        key='maikol_metric_provided',
        label='compartió el indicador que utiliza',
        patterns=(
            r'\b(medimos|calculamos|revisamos|seguimos) (por|con|la|el) (porcentaje|tasa|numero|cantidad|dashboard|reporte)\b',
            r'\b(tasa|porcentaje) de conversion\b',
            r'\b(consultas|leads|mensajes).*(citas|ventas|clientes).*(porcentaje|tasa|reporte|dashboard)\b',
            r'\b(kpi|indicador) (es|principal|que usamos)\b',
        ),
        outcome='Interesado',
        conversation_status='conversation_active',
        commercial_status='Interesado',
        next_step='Relacionar el indicador con el hallazgo y ofrecer dos horarios.',
        recommended_reply='Gracias. Lo que observamos parece estar más relacionado con [TIEMPO DE RESPUESTA / SEGUIMIENTO / RECUPERACIÓN DE CONVERSACIONES / CLARIDAD DEL PRÓXIMO PASO]. Laura podría mostrarle el hallazgo en una llamada breve de 15 minutos. Tiene disponibilidad [OPCIÓN 1] o [OPCIÓN 2]. ¿Cuál le funciona mejor?',
        reasoning='El lead ya explicó cómo mide. Aura deja marcado el espacio que Maikol debe adaptar al hallazgo real antes de copiar.',
        priority=131,
        confidence=92,
        followup_delay_days=0,
    ),
    Signal(
        key='maikol_yes_measuring',
        label='sí mide la conversión',
        patterns=(
            r'\b(si|sí),? (medimos|lo medimos|llevamos metricas|tenemos metricas|llevamos control)\b',
            r'\btenemos (un )?(reporte|dashboard|control) de conversion\b',
            r'\bsabemos cuantas? (consultas|personas) (agendan|se convierten)\b',
        ),
        outcome='Respondió',
        conversation_status='conversation_active',
        commercial_status='Respondió',
        next_step='Preguntar qué indicador utilizan para medir la conversión.',
        recommended_reply='Perfecto 😊 Eso ya los coloca por delante de muchos negocios. Para entender mejor, ¿qué indicador utilizan actualmente para medir la conversión de consultas en citas o ventas?',
        reasoning='La empresa sí mide. El script pide identificar el indicador antes de proponer la llamada.',
        priority=130,
        confidence=94,
    ),
    Signal(
        key='maikol_information_request',
        label='pidió más información',
        patterns=(
            r'\b(enviame|mandame|comparteme|pasame|envie|mande) (la|mas|esa|algo de)? ?(informacion|info|propuesta|presentacion|detalles)\b',
            r'\bquiero (ver|conocer|saber) mas\b',
            r'\bde que se trata\b',
            r'\bcomo funciona\b',
        ),
        outcome='Solicitó información',
        conversation_status='conversation_active',
        commercial_status='Respondió',
        next_step='Identificar si el reto principal es responder, dar seguimiento o lograr citas.',
        recommended_reply='Claro 😊 Para enviarte algo realmente útil y no una presentación genérica, quisiera confirmar algo primero: ¿el principal reto que tienen actualmente está en responder las consultas, dar seguimiento o lograr que las personas agenden?',
        reasoning='El script evita enviar presentaciones genéricas y utiliza una sola pregunta para ubicar el problema principal.',
        priority=129,
        confidence=96,
    ),
    Signal(
        key='maikol_price_request',
        label='preguntó el precio',
        patterns=(
            r'\bcuanto (cuesta|sale|vale|cobran)\b',
            r'\b(cual es|cuales son) (el|los|su|sus) (precio|precios|tarifa|tarifas|planes)\b',
            r'\bque precio tiene\b',
            r'\b(enviame|mandame|envienos) (los|el)? ?(precios|tarifas|planes|cotizacion)\b',
        ),
        outcome='Solicitó información',
        conversation_status='conversation_active',
        commercial_status='Interesado',
        next_step='Aclarar que la primera conversación es gratuita y ofrecer dos horarios.',
        recommended_reply='La primera conversación de 15 minutos no tiene costo. Es únicamente para mostrarles la observación y determinar si vale la pena realizar una evaluación más completa. Si después identificamos que podemos ayudarles, Laura les explicará las opciones disponibles. ¿Les funciona mejor [OPCIÓN 1] o [OPCIÓN 2]?',
        reasoning='Según el script, Maikol no cotiza por chat: explica el propósito de la llamada inicial y ofrece dos horarios.',
        objection='Precio',
        priority=128,
        confidence=97,
        followup_delay_days=0,
    ),
    Signal(
        key='maikol_existing_owner',
        label='ya cuenta con una persona encargada',
        patterns=(
            r'\bya (tenemos|contamos con|hay) (una persona|alguien|un encargado|una encargada|un equipo|personal)\b',
            r'\b(eso|el seguimiento|las consultas|whatsapp) (lo|las) (maneja|lleva|ve|atiende) (recepcion|la recepcionista|administracion|una persona|nuestro equipo|alguien)\b',
            r'\btenemos (quien|a alguien que) (responda|atienda|maneje|lleve)\b',
            r'\bya hay (encargado|encargada|responsable)\b',
            r'\btenemos (una recepcionista|un recepcionista|un asistente|una asistente) que (se encarga|lo maneja|lo lleva|responde)\b',
        ),
        outcome='Objeción identificada',
        conversation_status='conversation_active',
        commercial_status='Respondió',
        next_step='Confirmar si esa persona también supervisa seguimiento y conversión.',
        recommended_reply='Perfecto 😊 Justamente no buscamos reemplazar a la persona encargada. La revisión sirve para darle una segunda mirada al proceso y detectar posibles oportunidades de mejora. ¿Esa persona supervisa también el seguimiento y la conversión de las consultas?',
        reasoning='La frase aclara que ya existe un responsable, pero no necesariamente rechaza la conversación.',
        objection='Ya cuenta con encargado',
        priority=127,
        confidence=97,
    ),
    Signal(
        key='maikol_not_interested',
        label='rechazo comercial explícito',
        patterns=(
            r'\b(no me interesa|no nos interesa|no le interesa|no les interesa|no interesa)\b',
            r'\bno (estoy|estamos|esta|estan) interesad[oa]s?\b',
            r'\b(no gracias|gracias pero no|prefiero que no|por ahora no)\b',
            r'\bno (quiero|queremos|deseo|deseamos) (continuar|seguir|avanzar|recibir informacion)\b',
        ),
        outcome='No interesado',
        conversation_status='closed',
        commercial_status='No interesado',
        next_step='Retirar del seguimiento y conservar el historial.',
        recommended_reply='Entendido 😊 Muchas gracias por responder. Los retiramos del seguimiento. Que tengan un excelente día.',
        reasoning='Existe un rechazo claro. El script indica cerrar con respeto y no seguir calificando.',
        objection='No interesado',
        priority=150,
        confidence=98,
        followup_delay_days=None,
        is_terminal=True,
    ),
    Signal(
        key='maikol_referral',
        label='referencia a otro contacto',
        patterns=(
            r'\b(escrib(e|ele|anle)|contact(a|e|en)|llam(a|e|en)) a (esta|esa|la|el) persona\b',
            r'\b(eso|este tema|marketing|ventas|las consultas) lo maneja (otra persona|[a-zñ ]{2,50})\b',
            r'\b(te|le|les) (paso|comparto|envio|doy) (el )?(numero|contacto|correo)\b',
            r'\bpregunta(le)? si (esta|estan) interesad[oa]s?\b',
            r'\bhabla con [a-zñ ]{2,50}\b',
            r'\bescribele a [a-zñ ]{2,50}\b',
        ),
        outcome='Referido a otro contacto',
        conversation_status='followup_scheduled',
        commercial_status='Seguimiento 1',
        next_step='Crear el referido como lead separado, registrar quién lo compartió y escribirle hoy.',
        recommended_reply='Perfecto, muchas gracias por orientarme 😊 Le escribiré ahora mismo indicando que usted me compartió el contacto.',
        reasoning='El lead original es referidor, no “No califica”. Debe conservarse y crear el nuevo contacto por separado.',
        priority=125,
        confidence=97,
        followup_delay_days=0,
    ),
    Signal(
        key='maikol_meeting_details',
        label='envió datos para crear la reunión',
        patterns=(
            r'\b(correo|email)\s*(?:es|:|=|-)\s*[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b',
            r'^\s*[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\s*$',
            r'\b(nombre|cargo)\b.{0,160}\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b',
        ),
        outcome='Reunión agendada',
        conversation_status='closed',
        commercial_status='Reunión agendada',
        next_step='Crear la reunión en Google Meet y enviar la invitación al correo confirmado.',
        recommended_reply='Gracias 😊 En unos minutos le comparto la invitación de Google Meet.',
        reasoning='El contacto ya entregó el correo y los datos necesarios. El siguiente paso es crear la invitación, no volver a calificar.',
        priority=124,
        confidence=95,
        followup_delay_days=None,
        is_terminal=True,
        appointment_booked=True,
    ),
    Signal(
        key='maikol_time_selected',
        label='eligió uno de los horarios',
        patterns=(
            r'\b(la|el) (primera|segunda|primer|segundo) (opcion|horario)\b',
            r'\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo).*(a las|am|pm|a\. m\.|p\. m\.)\b',
            r'\b(ese|este) horario (me|nos) (funciona|sirve|queda bien)\b',
            r'\b(me|nos) funciona (el|la|a las|a la)\b',
            r'\b(prefiero|elegimos|tomamos) (el|la)\b.*\b(horario|opcion|am|pm|a\. m\.|p\. m\.)\b',
            r'\b(confirmado|confirmada) para\b',
        ),
        outcome='Esperando confirmación',
        conversation_status='waiting_confirmation',
        commercial_status='Interesado',
        next_step='Confirmar día y hora y solicitar nombre, cargo y correo.',
        recommended_reply='Perfecto 😊 Queda confirmado para [DÍA, FECHA Y HORA]. La llamada será por Google Meet y tendrá una duración aproximada de 15 minutos. Para que Laura pueda aprovechar mejor la conversación, ¿me confirma nombre de la persona que participará, cargo y correo electrónico?',
        reasoning='El horario fue elegido, pero todavía faltan los datos para crear la invitación.',
        priority=123,
        confidence=95,
        followup_delay_days=0,
    ),
    Signal(
        key='do_not_contact',
        label='Solicitud expresa de no contacto',
        patterns=(
            '\\b(no me escriban|no me escribas|no nos escriban|no vuelvas a escribir|dejen de escribirme|no me manden mensajes)\\b',
            '\\b(no me contacten|no nos contacten|no volver a contactar|no contactes|no me llames|no nos llamen|no llamar)\\b',
            '\\b(elimina|borra|saquen|quita) (mi|este) (numero|contacto|dato|datos)\\b',
            '\\bno autorizo (el )?contacto\\b',
        ),
        outcome='No contactar',
        conversation_status='closed',
        commercial_status='Descartado',
        next_step='No insistir y conservar el historial.',
        recommended_reply='Entendido. Gracias por indicarlo; no volveremos a contactarles por este medio.',
        reasoning='La persona pidió explícitamente detener el contacto. Aura recomienda cerrar el lead y respetar la solicitud.',
        objection='No contactar',
        priority=170,
        confidence=98,
        followup_delay_days=None,
        is_terminal=True,
        appointment_booked=False,
    ),
    Signal(
        key='wrong_contact',
        label='Contacto o número incorrecto',
        patterns=(
            '\\b(numero|contacto) (equivocado|incorrecto|invalido)\\b',
            '\\bse (equivocaron|equivoco|confundieron|confundio) de numero\\b',
            '\\b(aqui|aca) no (es|trabaja|queda|vive)\\b',
            '\\bno conozco (esa|ese|a esa|a ese) (empresa|clinica|persona|negocio|doctor|doctora)\\b',
            '\\b(ya no usa|no pertenece a) este numero\\b',
        ),
        outcome='Número incorrecto o inválido',
        conversation_status='closed',
        commercial_status='No califica',
        next_step='Buscar otro canal; si no existe, descartar.',
        recommended_reply='Gracias por avisarnos. Disculpe la molestia; actualizaremos nuestros datos.',
        reasoning='El canal no corresponde al negocio o a la persona buscada. No conviene seguir insistiendo en este contacto.',
        objection='Contacto incorrecto',
        priority=99,
        confidence=97,
        followup_delay_days=None,
        is_terminal=True,
        appointment_booked=False,
    ),
    Signal(
        key='business_closed',
        label='Negocio cerrado o fuera de operación',
        patterns=(
            '\\b(cerramos|cerraron|cesamos|suspendimos) (operaciones|el negocio|la clinica|definitivamente)\\b',
            '\\b(negocio|empresa|clinica|local) (cerro|esta cerrado|ya no existe|ya no opera)\\b',
            '\\bya no (operamos|atendemos|estamos funcionando)\\b',
        ),
        outcome='No califica',
        conversation_status='closed',
        commercial_status='No califica',
        next_step='Cerrar la oportunidad y actualizar la base.',
        recommended_reply='Gracias por informarlo. Actualizaremos nuestros datos para no volver a contactarles.',
        reasoning='El negocio ya no opera. Mantenerlo activo distorsionaría la base y el pipeline.',
        objection='Negocio fuera de operación',
        priority=98,
        confidence=97,
        followup_delay_days=None,
        is_terminal=True,
        appointment_booked=False,
    ),
    Signal(
        key='sale',
        label='Acuerdo de compra o implementación',
        patterns=(
            '\\b(aceptamos|aprobamos|confirmamos) (la|su|tu) (propuesta|cotizacion|servicio)\\b',
            '\\b(queremos|vamos a) contratar\\b',
            '\\b(procedamos|avancemos) con (la|el|esto)\\b',
            '\\b(enviame|mandame|envienos) (el )?(contrato|factura|link de pago|enlace de pago)\\b',
            '\\b(ya hicimos|realizamos|se hizo) (el )?pago\\b',
        ),
        outcome='Venta',
        conversation_status='closed',
        commercial_status='Implementación vendida',
        next_step='Iniciar onboarding y registrar el monto.',
        recommended_reply='Excelente, gracias por la confianza. El siguiente paso es coordinar el inicio, responsables y documentación necesaria para la implementación.',
        reasoning='La persona confirmó la compra o el inicio. Aura recomienda cerrar la etapa comercial y abrir el onboarding.',
        objection='',
        priority=97,
        confidence=97,
        followup_delay_days=None,
        is_terminal=True,
        appointment_booked=False,
    ),
    Signal(
        key='meeting_confirmed',
        label='Reunión confirmada',
        patterns=(
            '\\b(reunion|llamada|meet|demo|cita) (agendada|confirmada|coordinada|reservada)\\b',
            '\\b(queda|quedo|esta) (agendado|confirmado|coordinado) para\\b',
            '\\b(confirmado|confirmada) para\\b',
            '\\b(nos vemos|hablamos) (el|la|este|esta|manana)\\b',
            '\\b(ese|este) horario (me|nos) (funciona|sirve|queda bien)\\b',
        ),
        outcome='Reunión agendada',
        conversation_status='closed',
        commercial_status='Reunión agendada',
        next_step='Enviar el enlace, registrar asistentes y confirmar antes de la reunión.',
        recommended_reply='Perfecto 😊 Queda confirmada. Les envío el enlace y los detalles de la reunión para que los tengan a mano.',
        reasoning='La fecha u horario ya fue aceptado. Aura recomienda registrar la reunión como conversión y preparar la confirmación.',
        objection='',
        priority=96,
        confidence=96,
        followup_delay_days=None,
        is_terminal=True,
        appointment_booked=True,
    ),
    Signal(
        key='not_interested',
        label='Negativa comercial explícita',
        patterns=(
            r'\b(no me interesa|no nos interesa|no le interesa|no les interesa|no interesa)\b',
            r'\bno (estoy|estamos|esta|estan|se encuentra|se encuentran) interesad[oa]s?\b',
            r'\b(?:el cliente|la cliente|el negocio|la empresa|ellos|ellas|nosotros|nosotras)?\s*(?:indica|dice|respondio|comenta|menciona|informo|informa)?\s*(?:que )?no (?:esta|estan|estamos|tiene|tienen|hay) (?:interes|interesad[oa]s?)\b',
            r'\bpor (?:el )?momento no (?:esta|estan|estamos|hay|tenemos|tienen) (?:interes|interesad[oa]s?)\b',
            r'\b(sin interes|no hay interes|no tenemos interes|no tienen interes|no es de (nuestro|su) interes)\b',
            r'\b(no gracias|gracias pero no|prefiero que no|paso por ahora|por ahora no)\b',
            r'\bno (quiero|queremos|deseo|deseamos|quiere|quieren) (continuar|seguir|avanzar|recibir informacion)\b',
            r'\bno estamos buscando (eso|ese servicio|una solucion)\b',
            r'\b(rechaza|rechazaron|declina|declinaron) (la )?(propuesta|oferta|conversacion|servicio)\b',
        ),
        outcome='No interesado',
        conversation_status='closed',
        commercial_status='No interesado',
        next_step='Cerrar la oportunidad y conservar el historial.',
        recommended_reply='Entiendo, gracias por responder. No insistiremos. Quedo disponible si más adelante desean revisar el proceso.',
        reasoning='La persona rechazó continuar. Aura recomienda cerrar el lead sin confundirlo con falta de respuesta.',
        objection='No interesado',
        priority=95,
        confidence=96,
        followup_delay_days=None,
        is_terminal=True,
        appointment_booked=False,
    ),
    Signal(
        key='not_qualified',
        label='El caso no califica',
        patterns=(
            '\\bno somos (una )?(empresa|negocio|clinica|centro|consultorio)\\b',
            '\\bno recibimos (consultas|mensajes|clientes|pacientes|prospectos)\\b',
            '\\bno (vendemos|ofrecemos) (servicios|citas|tratamientos)\\b',
            '\\besto no aplica (para nosotros|a nuestro negocio)?\\b',
            '\\bno tenemos (whatsapp|redes|equipo comercial|proceso de ventas)\\b',
        ),
        outcome='No califica',
        conversation_status='closed',
        commercial_status='No califica',
        next_step='Cerrar la oportunidad con la razón documentada.',
        recommended_reply='Gracias por aclararlo. Entiendo que la solución no aplica a su operación actual; cierro el contacto para no hacerles perder tiempo.',
        reasoning='La necesidad o el perfil mínimo no existe. Mantener el lead abierto distorsionaría el pipeline.',
        objection='No califica',
        priority=94,
        confidence=94,
        followup_delay_days=None,
        is_terminal=True,
        appointment_booked=False,
    ),
    Signal(
        key='meeting_cancelled',
        label='Reunión cancelada',
        patterns=(
            '\\b(cancelar|cancelemos|cancela|suspender|suspendamos) (la|el|nuestra)? ?(reunion|llamada|meet|demo|cita)\\b',
            '\\bno (podre|podemos|voy a poder) (asistir|conectarme|estar en la reunion)\\b',
        ),
        outcome='Seguimiento solicitado',
        conversation_status='followup_scheduled',
        commercial_status='Seguimiento 1',
        next_step='Confirmar si desea reprogramar y proponer dos horarios.',
        recommended_reply='Entiendo. ¿Desean que la reprogramemos? Puedo compartirles dos horarios concretos para dejarla coordinada.',
        reasoning='La reunión se canceló, pero no necesariamente la oportunidad. Aura recomienda confirmar si debe reprogramarse.',
        objection='Reunión cancelada',
        priority=92,
        confidence=92,
        followup_delay_days=1,
        is_terminal=False,
        appointment_booked=False,
    ),
    Signal(
        key='meeting_reschedule',
        label='Solicitud de reprogramación',
        patterns=(
            '\\b(reprogramar|reprogramemos|mover|cambiar) (la|el|nuestra)? ?(reunion|llamada|meet|demo|cita|horario)\\b',
            '\\b(otro|otro) horario (me|nos) funciona mejor\\b',
            '\\bpodemos (hacerlo|verlo|hablar) (mas tarde|otro dia|a otra hora)\\b',
        ),
        outcome='Seguimiento solicitado',
        conversation_status='followup_scheduled',
        commercial_status='Seguimiento 1',
        next_step='Ofrecer dos horarios y confirmar el nuevo espacio.',
        recommended_reply='Claro 😊 Tengo disponibilidad en dos horarios. ¿Cuál les funciona mejor para dejar la reunión nuevamente confirmada?',
        reasoning='La intención de reunirse continúa, pero el horario cambió. Aura recomienda cerrar una nueva fecha de inmediato.',
        objection='Reprogramación',
        priority=91,
        confidence=93,
        followup_delay_days=0,
        is_terminal=False,
        appointment_booked=False,
    ),
    Signal(
        key='outside_hours_auto_reply',
        label='Respuesta automática fuera de horario',
        patterns=(
            '\\b(fuera de|fuera del) (nuestro )?horario\\b',
            '\\bhorario de atencion\\b',
            '\\ben este momento estamos (cerrados|fuera de servicio)\\b',
            '\\bte responderemos (pronto|en horario|cuando regresemos)\\b',
            '\\bnuestro horario es de\\b',
        ),
        outcome='Respuesta automática fuera de horario',
        conversation_status='followup_scheduled',
        commercial_status='Seguimiento 1',
        next_step='Contactar dentro del horario con el mensaje corregido.',
        recommended_reply='Hola 😊 Retomo mi mensaje dentro de su horario de atención. Mi nombre es Maikol y escribo de parte de Laura Rodriguez. ¿Podría indicarme quién gestiona las consultas y su seguimiento en la empresa?',
        reasoning='La respuesta provino de una automatización y no representa interés ni rechazo. El lead debe seguir abierto.',
        objection='',
        priority=90,
        confidence=94,
        followup_delay_days=1,
        is_terminal=False,
        appointment_booked=False,
    ),
    Signal(
        key='generic_auto_reply',
        label='Respuesta automática de recepción',
        patterns=(
            '\\bgracias por (comunicarte|comunicarse|contactarnos|escribirnos)\\b.*\\b(en breve|pronto|lo antes posible)\\b',
            '\\bhemos recibido (tu|su) (mensaje|consulta|solicitud)\\b',
            '\\buno de (nuestros|nuestro) (asesores|agentes|representantes) (te|le) respondera\\b',
            '\\btu mensaje ha sido recibido\\b',
        ),
        outcome='Bot pidió nombre y motivo',
        conversation_status='followup_scheduled',
        commercial_status='Seguimiento 1',
        next_step='Esperar la respuesta humana y retomar si no ocurre.',
        recommended_reply='Gracias 😊 Quedo pendiente de la persona encargada. Mi consulta es sobre cómo gestionan y dan seguimiento a las consultas que reciben por sus canales digitales.',
        reasoning='La empresa confirmó recepción mediante una automatización. Aura recomienda no tratarlo como respuesta humana.',
        objection='',
        priority=89,
        confidence=91,
        followup_delay_days=1,
        is_terminal=False,
        appointment_booked=False,
    ),
    Signal(
        key='bot_requested_name_reason',
        label='Bot pidió nombre y motivo',
        patterns=(
            '\\b(indica|indiquenos|escribe|compartenos|ingresa) (tu|su)? ?nombre\\b',
            '\\b(cual es|indica|indiquenos|escribe) (el )?motivo\\b',
            '\\bpara poder ayudarte.*\\bnombre\\b',
            '\\b(nombre completo|motivo de contacto|motivo de la consulta)\\b',
        ),
        outcome='Bot pidió nombre y motivo',
        conversation_status='followup_scheduled',
        commercial_status='Seguimiento 1',
        next_step='Responder al bot y solicitar a la persona encargada.',
        recommended_reply='Hola 😊 Mi nombre es Maikol y escribo de parte de Laura Rodriguez. Estamos realizando una revisión breve de cómo las empresas gestionan y dan seguimiento a sus consultas. ¿Podría indicarme quién es la persona encargada de este proceso?',
        reasoning='Todavía no respondió una persona. Aura recomienda completar el filtro del bot y pedir directamente al responsable.',
        objection='',
        priority=88,
        confidence=94,
        followup_delay_days=0,
        is_terminal=False,
        appointment_booked=False,
    ),
    Signal(
        key='bot_menu',
        label='Bot mostró un menú de opciones',
        patterns=(
            '\\b(selecciona|seleccione|elige|elija) (una|la) opcion\\b',
            '\\b(responde|escribe|marca) (con )?(el )?(numero|número)\\b',
            '\\bmenu (principal|de opciones)\\b',
            '\\bopcion 1\\b.*\\bopcion 2\\b',
        ),
        outcome='Bot pidió nombre y motivo',
        conversation_status='followup_scheduled',
        commercial_status='Seguimiento 1',
        next_step='Elegir la opción más cercana a administración o hablar con un asesor.',
        recommended_reply='Hola 😊 Mi consulta no es para agendar un servicio. Es una consulta comercial sobre su proceso de atención y seguimiento. ¿Podrían comunicarme con administración o con la persona encargada?',
        reasoning='La conversación está detenida en un menú automático. Aura recomienda buscar la ruta hacia una persona o administración.',
        objection='',
        priority=87,
        confidence=93,
        followup_delay_days=0,
        is_terminal=False,
        appointment_booked=False,
    ),
    Signal(
        key='patient_flow',
        label='WhatsApp abrió un flujo para pacientes',
        patterns=(
            '\\b(agendar|reservar|confirmar) (una )?(cita|consulta)\\b',
            '\\bselecciona (el|un) (servicio|tratamiento|especialidad)\\b',
            '\\bmotivo de (tu|su) consulta (medica|dental)?\\b',
            '\\bdatos del paciente\\b',
            '\\bnumero de cedula del paciente\\b',
        ),
        outcome='WhatsApp abrió flujo de paciente',
        conversation_status='followup_scheduled',
        commercial_status='Seguimiento 1',
        next_step='Aclarar que es una consulta comercial y pedir al encargado.',
        recommended_reply='Hola 😊 Disculpe, el sistema abrió el flujo de pacientes. Mi consulta es comercial: escribo de parte de Laura Rodriguez para conocer cómo gestionan y dan seguimiento a las consultas que reciben. ¿Con quién podría conversar sobre ese proceso?',
        reasoning='El canal es correcto, pero la conversación entró por el flujo equivocado. Debe corregirse el contexto antes de continuar.',
        objection='',
        priority=86,
        confidence=94,
        followup_delay_days=0,
        is_terminal=False,
        appointment_booked=False,
    ),
    Signal(
        key='referral',
        label='Compartió o indicó otro contacto',
        patterns=(
            '\\b(escribele|escribale|contacta|contacte|habla|hable) (a|con)\\b',
            '\\b(te|le) paso (el|su|otro) (numero|contacto|correo|email)\\b',
            '\\b(comunicate|comuniquese) con\\b',
            '\\bla persona encargada es\\b',
            '\\beste es (el|su) (numero|contacto|correo)\\b',
        ),
        outcome='Referido a otro contacto',
        conversation_status='followup_scheduled',
        commercial_status='Seguimiento 1',
        next_step='Crear o actualizar el contacto referido y escribirle.',
        recommended_reply='Muchas gracias. ¿Podría compartirme el nombre, el contacto y el mejor horario para escribirle a la persona encargada?',
        reasoning='El contacto actual redirigió la oportunidad. Aura recomienda crear el referido y continuar con él.',
        objection='',
        priority=85,
        confidence=94,
        followup_delay_days=0,
        is_terminal=False,
        appointment_booked=False,
    ),
    Signal(
        key='send_email',
        label='Pidió continuar por correo',
        patterns=(
            '\\b(enviame|mandame|envie|mande|escribeme|escriba) (eso |la informacion |la propuesta )?(al|a mi|por) (correo|email)\\b',
            '\\bmejor por (correo|email)\\b',
            '\\bnuestro correo es\\b',
        ),
        outcome='Referido a otro contacto',
        conversation_status='followup_scheduled',
        commercial_status='Seguimiento 1',
        next_step='Registrar el correo, enviar el mensaje y fijar seguimiento.',
        recommended_reply='Perfecto. ¿Me confirma el correo correcto y a nombre de quién debo dirigir la información? También dejaré programado el seguimiento para no enviarla sin contexto.',
        reasoning='La persona indicó un canal específico. Aura recomienda registrar el dato y mantener un siguiente paso concreto.',
        objection='Canal preferido: correo',
        priority=84,
        confidence=91,
        followup_delay_days=0,
        is_terminal=False,
        appointment_booked=False,
    ),
    Signal(
        key='request_call',
        label='Pidió continuar por llamada',
        patterns=(
            '\\b(llamame|llameme|puedes llamarme|puede llamarme|mejor llamame|mejor por llamada)\\b',
            '\\b(hablemos|conversemos) por (telefono|llamada)\\b',
            '\\bpuedes llamar (hoy|manana|en la tarde|a las)\\b',
        ),
        outcome='Seguimiento solicitado',
        conversation_status='followup_scheduled',
        commercial_status='Seguimiento 1',
        next_step='Confirmar dos horarios y registrar la llamada.',
        recommended_reply='Perfecto 😊 Tengo dos espacios disponibles. ¿Les funciona mejor la primera opción o la segunda?',
        reasoning='La persona aceptó continuar por llamada. Aura recomienda convertirlo en un horario concreto.',
        objection='Canal preferido: llamada',
        priority=83,
        confidence=91,
        followup_delay_days=0,
        is_terminal=False,
        appointment_booked=False,
    ),
    Signal(
        key='decision_maker_unavailable',
        label='Decisor no disponible',
        patterns=(
            '\\b(el|la|nuestro|nuestra) (encargad[oa]|doctor|doctora|dueno|duena|gerente|administrador[oa]) no esta\\b',
            '\\b(regresa|vuelve|estara) (manana|el lunes|la proxima semana|en la tarde)\\b',
            '\\besta (de vacaciones|ocupad[oa]|en reunion|fuera de la oficina)\\b',
        ),
        outcome='Decisor no disponible',
        conversation_status='waiting_decision_maker',
        commercial_status='Seguimiento 1',
        next_step='Contactar en el horario indicado y registrar al decisor.',
        recommended_reply='Gracias. ¿Podría indicarme el nombre de la persona encargada y el mejor día u horario para contactarla?',
        reasoning='La persona responsable existe, pero no está disponible. Aura recomienda fijar cuándo retomar.',
        objection='Decisor no disponible',
        priority=82,
        confidence=93,
        followup_delay_days=1,
        is_terminal=False,
        appointment_booked=False,
    ),
    Signal(
        key='intermediary',
        label='No se contactó al decisor',
        patterns=(
            '\\b(yo|nosotros) no (decido|decidimos|veo|vemos|manejo|manejamos) eso\\b',
            '\\beso lo (ve|maneja|decide) (la|el|mi|nuestro|nuestra)? ?(doctor|doctora|administracion|gerencia|dueno|duena|encargad[oa])\\b',
            '\\bno soy (la|el) (persona|encargad[oa]|responsable|indicad[oa])\\b',
            '\\bdebe hablar con (administracion|gerencia|el doctor|la doctora|el encargado|la encargada)\\b',
        ),
        outcome='Contacto con intermediario',
        conversation_status='waiting_decision_maker',
        commercial_status='Seguimiento 1',
        next_step='Identificar al decisor y acordar cuándo contactarlo.',
        recommended_reply='Gracias. ¿Podría indicarme el nombre de la persona encargada y el mejor horario para contactarla? Así no les envío información genérica.',
        reasoning='La persona respondió, pero no tiene autoridad sobre el proceso. Aura recomienda identificar al decisor.',
        objection='No se contactó al decisor',
        priority=81,
        confidence=92,
        followup_delay_days=1,
        is_terminal=False,
        appointment_booked=False,
    ),
    Signal(
        key='internal_approval',
        label='Requiere aprobación interna',
        patterns=(
            '\\b(tengo|tenemos|debo|debemos|voy|vamos) (que )?(consultar|consultarlo|preguntar|validar|validarlo|revisar|revisarlo|hablar) con\\b',
            '\\b(lo|se lo) (consulto|presento|comento) (a|con) (mi|el|la|los) (socio|socia|jefe|jefa|gerente|gerencia|doctor|doctora|equipo)\\b',
            '\\bnecesito (aprobacion|autorizacion|validacion)\\b',
        ),
        outcome='Esperando confirmación',
        conversation_status='waiting_confirmation',
        commercial_status='Seguimiento 1',
        next_step='Definir cuándo tendrá respuesta y programar seguimiento.',
        recommended_reply='Perfecto. ¿Cuándo cree que podrá validarlo internamente? Así dejo programado el seguimiento para esa fecha.',
        reasoning='La persona no rechazó; necesita una validación interna. Aura recomienda acordar una fecha de respuesta.',
        objection='Aprobación interna',
        priority=80,
        confidence=90,
        followup_delay_days=1,
        is_terminal=False,
        appointment_booked=False,
    ),
    Signal(
        key='existing_internal_owner',
        label='Ya cuenta con una persona o equipo encargado',
        patterns=(
            '\\b(ya tenemos|ya contamos con|ya hay|tenemos|contamos con) (a )?(una persona|alguien|un encargado|una encargada|encargad[oa]|un equipo|un departamento|personal)(?: (para eso|encargad[oa]|que se encarga))?\\b',
            '\\b(eso|el seguimiento|las consultas|los mensajes|whatsapp|las redes) ya lo (maneja|lleva|ve|gestiona|atiende) (una persona|alguien|el encargado|la encargada|recepcion|administracion|nuestro equipo|la secretaria|la recepcionista|nuestra recepcionista|nuestro recepcionista|el community manager|nuestro community manager)\\b',
            '\\b(lo|eso) (hacemos|manejamos|gestionamos|llevamos) (internamente|nosotros mismos|con nuestro equipo)\\b',
            '\\b(tenemos|hay) (recepcionista|secretaria|community manager|equipo comercial|departamento de ventas|departamento de atencion)\\b',
            '\\b(nuestra|nuestro) (recepcionista|secretaria|equipo|administracion) se encarga\\b',
        ),
        outcome='Objeción identificada',
        conversation_status='conversation_active',
        commercial_status='Respondió',
        next_step='Aclarar que no se busca reemplazar al encargado y detectar brechas de seguimiento, medición o herramientas.',
        recommended_reply='Perfecto 😊 No buscamos reemplazar a la persona o al equipo encargado. Lo que revisamos es si el proceso actual permite responder a tiempo, dar seguimiento y medir cuántas consultas se convierten. ¿Hoy llevan ese control en alguna herramienta o depende principalmente del equipo?',
        reasoning='La empresa ya tiene responsables internos, pero eso no confirma que el proceso esté sistematizado ni medido. Aura recomienda explorar brechas sin generar percepción de reemplazo.',
        objection='Ya cuenta con encargado',
        priority=79,
        confidence=92,
        followup_delay_days=1,
        is_terminal=False,
        appointment_booked=False,
    ),
    Signal(
        key='existing_provider',
        label='Ya trabaja con un proveedor o agencia',
        patterns=(
            '\\bya (tenemos|trabajamos con|contratamos|usamos) (una|un|otra|otro)? ?(agencia|proveedor|consultor|consultora|empresa externa)\\b',
            '\\bnos lo (maneja|lleva|gestiona) (una|la|un|el) (agencia|proveedor|consultor|empresa)\\b',
            '\\btenemos contrato con\\b',
            '\\bestamos (contentos|bien|conformes) con (la|el|nuestro|nuestra) (agencia|proveedor|consultor)\\b',
        ),
        outcome='Ya tiene proveedor',
        conversation_status='followup_scheduled',
        commercial_status='Seguimiento 2',
        next_step='Preguntar qué funciona y qué todavía les cuesta; revisar en nurture.',
        recommended_reply='Perfecto. No busco reemplazar algo que ya funciona. ¿Hay algún punto del proceso actual que todavía les cueste, por ejemplo seguimiento, velocidad de respuesta o visibilidad de resultados?',
        reasoning='Tener proveedor no elimina necesariamente la necesidad. Aura recomienda explorar brechas sin confrontar la solución actual.',
        objection='Ya utiliza proveedor',
        priority=78,
        confidence=91,
        followup_delay_days=60,
        is_terminal=False,
        appointment_booked=False,
    ),
    Signal(
        key='existing_system',
        label='Ya utiliza un sistema o CRM',
        patterns=(
            '\\bya (tenemos|usamos|utilizamos|trabajamos con) (un|una|el|la)? ?(crm|sistema|software|plataforma|automatizacion|bot|chatbot)\\b',
            '\\b(usamos|utilizamos|tenemos) (kommo|hubspot|zoho|salesforce|monday|trello|excel|google sheets|whatsapp business)\\b',
            '\\bya esta (automatizado|sistematizado)\\b',
            '\\btenemos todo en (excel|sheets|un sistema|el crm)\\b',
        ),
        outcome='Ya tiene proveedor',
        conversation_status='followup_scheduled',
        commercial_status='Seguimiento 2',
        next_step='Identificar qué cubre el sistema y qué sigue siendo manual.',
        recommended_reply='Perfecto. Para no duplicar lo que ya tienen, ¿qué parte cubre hoy el sistema y qué sigue dependiendo de tareas manuales o del seguimiento de una persona?',
        reasoning='Usar una herramienta no garantiza adopción, integración ni seguimiento efectivo. Aura recomienda identificar la brecha concreta.',
        objection='Ya utiliza sistema o CRM',
        priority=77,
        confidence=91,
        followup_delay_days=30,
        is_terminal=False,
        appointment_booked=False,
    ),
    Signal(
        key='privacy_source',
        label='Pregunta por el origen del contacto o sus datos',
        patterns=(
            '\\b(de donde|como) (sacaste|sacaron|obtuviste|obtuvieron|conseguiste|consiguieron) (mi|nuestro|este) (numero|contacto|dato|datos)\\b',
            '\\bquien (te|les) dio (mi|nuestro) (numero|contacto)\\b',
            '\\bpor que tienes mi numero\\b',
            '\\bcomo encontraste (la empresa|el negocio|nuestro contacto)\\b',
        ),
        outcome='Objeción identificada',
        conversation_status='conversation_active',
        commercial_status='Respondió',
        next_step='Responder con transparencia y confirmar si desea continuar.',
        recommended_reply='Claro. Encontramos el contacto publicado por la empresa en sus canales comerciales. Mi mensaje es de parte de Laura Rodriguez y se relaciona con la gestión de consultas y seguimiento. ¿Le parece bien que le explique brevemente el motivo?',
        reasoning='La persona necesita transparencia antes de continuar. Aura recomienda explicar el origen del contacto sin evadir la pregunta.',
        objection='Privacidad / origen del contacto',
        priority=76,
        confidence=93,
        followup_delay_days=1,
        is_terminal=False,
        appointment_booked=False,
    ),
    Signal(
        key='skepticism',
        label='Desconfianza o percepción de spam',
        patterns=(
            '\\b(esto|eso) (es|parece|se ve como) (spam|estafa|fraude)\\b',
            '\\bno (confio|me da confianza|parece real)\\b',
            '\\bquien eres|quienes son ustedes|de parte de quien\\b',
            '\\bes una llamada de ventas\\b',
        ),
        outcome='Objeción identificada',
        conversation_status='conversation_active',
        commercial_status='Respondió',
        next_step='Identificarse, explicar el motivo y ofrecer una verificación pública.',
        recommended_reply='Entiendo la cautela. Soy Maikol y escribo de parte de Laura Rodriguez, estratega de crecimiento y automatización. Puedo compartirle su página y perfil profesional para que verifique la información antes de continuar.',
        reasoning='La barrera principal es confianza, no necesariamente falta de interés. Aura recomienda validar identidad antes de vender.',
        objection='Confianza / identidad',
        priority=75,
        confidence=92,
        followup_delay_days=1,
        is_terminal=False,
        appointment_booked=False,
    ),
    Signal(
        key='budget',
        label='Restricción de presupuesto',
        patterns=(
            '\\b(no tenemos|no hay|no cuento con|no contamos con|sin) (presupuesto|budget|dinero)\\b',
            '\\b(se sale|esta fuera) de (mi|nuestro|el) presupuesto\\b',
            '\\b(muy|demasiado) (caro|costoso)\\b',
            '\\b(no podemos|no puedo) (invertir|pagar|gastar)\\b',
            '\\bno tenemos presupuesto (ahora|este mes|por el momento)\\b',
        ),
        outcome='Objeción identificada',
        conversation_status='conversation_active',
        commercial_status='Respondió',
        next_step='Validar prioridad, costo del problema y rango viable.',
        recommended_reply='Entiendo. Para no proponer algo fuera de contexto, ¿hoy el problema les está haciendo perder tiempo, citas o consultas? Con eso podemos evaluar si existe un primer paso pequeño que tenga sentido.',
        reasoning='Existe una objeción económica, no un rechazo definitivo. Aura recomienda validar impacto y prioridad antes de hablar de una solución mayor.',
        objection='Presupuesto',
        priority=74,
        confidence=91,
        followup_delay_days=7,
        is_terminal=False,
        appointment_booked=False,
    ),
    Signal(
        key='no_need',
        label='Percibe que no necesita la solución',
        patterns=(
            '\\bno (lo|la) necesitamos\\b',
            '\\b(no tenemos|no hay) (ese problema|problemas con eso|necesidad)\\b',
            '\\b(todo|eso) (funciona|esta) (bien|perfecto)\\b',
            '\\bestamos bien (asi|como estamos)\\b',
            '\\bya lo tenemos resuelto\\b',
        ),
        outcome='Objeción identificada',
        conversation_status='conversation_active',
        commercial_status='Respondió',
        next_step='Validar cómo miden respuesta, seguimiento y conversión antes de cerrar.',
        recommended_reply='Perfecto. Para entenderlo bien, ¿hoy pueden ver con claridad cuánto tardan en responder, cuántas consultas reciben seguimiento y cuántas terminan en cita o venta?',
        reasoning='La empresa percibe que el proceso funciona. Aura recomienda validar con métricas antes de asumir que no existe una brecha.',
        objection='No percibe necesidad',
        priority=73,
        confidence=90,
        followup_delay_days=30,
        is_terminal=False,
        appointment_booked=False,
    ),
    Signal(
        key='busy_now',
        label='No puede atender en este momento',
        patterns=(
            '\\b(ahora|en este momento) (no puedo|no podemos|estoy ocupad[oa]|estamos ocupados|estoy en reunion|estoy atendiendo)\\b',
            '\\bno puedo hablar (ahora|en este momento)\\b',
            '\\bestoy (manejando|trabajando|con un paciente|con un cliente)\\b',
        ),
        outcome='Seguimiento solicitado',
        conversation_status='followup_scheduled',
        commercial_status='Seguimiento 1',
        next_step='Pedir un día u horario concreto para retomar.',
        recommended_reply='Claro, no hay problema. ¿Le funciona mejor que lo retomemos más tarde o mañana en un horario específico?',
        reasoning='La persona no rechazó; únicamente no puede atender ahora. Aura recomienda convertirlo en un seguimiento concreto.',
        objection='No disponible ahora',
        priority=72,
        confidence=89,
        followup_delay_days=1,
        is_terminal=False,
        appointment_booked=False,
    ),
    Signal(
        key='timing',
        label='Pidió retomar después',
        patterns=(
            '\\b(mas adelante|despues|otro dia|la proxima semana|el proximo mes|en unas semanas)\\b',
            '\\b(ahora|hoy) no (es buen momento|podemos verlo|me conviene)\\b',
            '\\b(escribeme|escriba|llamame|llameme|contactame|contactenos) (manana|luego|despues|el lunes|la proxima semana)\\b',
            '\\bcuando (tenga|tengamos) tiempo\\b',
        ),
        outcome='Seguimiento solicitado',
        conversation_status='followup_scheduled',
        commercial_status='Seguimiento 1',
        next_step='Retomar en la fecha acordada.',
        recommended_reply='Claro. ¿Qué día les funciona mejor para retomarlo? Así lo dejo agendado y no les escribo fuera de contexto.',
        reasoning='La conversación sigue abierta, pero el momento no es inmediato. Aura recomienda convertir “después” en una fecha concreta.',
        objection='Momento / prioridad',
        priority=71,
        confidence=90,
        followup_delay_days=1,
        is_terminal=False,
        appointment_booked=False,
    ),
    Signal(
        key='waiting_confirmation',
        label='Quedó una confirmación pendiente',
        patterns=(
            '\\b(te|le|les) (confirmo|confirmamos|avisamos|aviso)\\b',
            '\\bdejame|dejenme\\b.*\\b(revisar|validar|confirmar)\\b',
            '\\b(consulto|reviso|verifico) y (te|le|les) (digo|aviso|confirmo)\\b',
            '\\bpendiente de (confirmar|respuesta|aprobacion|validacion)\\b',
        ),
        outcome='Esperando confirmación',
        conversation_status='waiting_confirmation',
        commercial_status='Seguimiento 1',
        next_step='Definir una fecha límite y programar seguimiento.',
        recommended_reply='Perfecto, quedo pendiente. ¿Les parece bien que retome la conversación mañana si todavía no tengo confirmación?',
        reasoning='La persona pidió tiempo para validar. Aura recomienda fijar cuándo se retomará para evitar un seguimiento indefinido.',
        objection='',
        priority=70,
        confidence=89,
        followup_delay_days=1,
        is_terminal=False,
        appointment_booked=False,
    ),
    Signal(
        key='price_request',
        label='Solicitó precio o planes',
        patterns=(
            '\\bcuanto (cuesta|sale|vale|cobran)\\b',
            '\\b(cual es|cuales son) (el|los|su|sus) (precio|precios|tarifa|tarifas|planes)\\b',
            '\\b(enviame|mandame|comparteme) (los|el)? ?(precios|tarifas|planes|cotizacion)\\b',
            '\\bque precio tiene\\b',
        ),
        outcome='Solicitó información',
        conversation_status='conversation_active',
        commercial_status='Respondió',
        next_step='Aclarar alcance y necesidad antes de cotizar.',
        recommended_reply='Claro. Para indicarle el precio correcto y no enviarle algo genérico, necesito confirmar brevemente cómo gestionan hoy las consultas y qué parte desean mejorar.',
        reasoning='La persona pidió precio, pero falta contexto para cotizar correctamente. Aura recomienda calificar antes de enviar una cifra aislada.',
        objection='Precio',
        priority=69,
        confidence=91,
        followup_delay_days=1,
        is_terminal=False,
        appointment_booked=False,
    ),
    Signal(
        key='proof_request',
        label='Solicitó pruebas, referencias o casos',
        patterns=(
            '\\b(tienen|tienes|puedes enviar|puede enviar) (casos de exito|referencias|testimonios|portafolio|ejemplos|resultados)\\b',
            '\\bquiero ver (casos|resultados|trabajos|clientes)\\b',
            '\\bcon quien han trabajado\\b',
        ),
        outcome='Solicitó información',
        conversation_status='conversation_active',
        commercial_status='Respondió',
        next_step='Compartir evidencia relevante y acordar el siguiente paso.',
        recommended_reply='Claro. Le comparto evidencia relacionada con su tipo de negocio y, después de verla, coordinamos una conversación breve para revisar si aplica a su caso.',
        reasoning='La persona necesita reducir riesgo mediante evidencia. Aura recomienda compartir pruebas específicas, no un portafolio genérico.',
        objection='Prueba / credibilidad',
        priority=68,
        confidence=91,
        followup_delay_days=1,
        is_terminal=False,
        appointment_booked=False,
    ),
    Signal(
        key='request_information',
        label='Solicitó información',
        patterns=(
            '\\b(enviame|mandame|comparteme|pasame|envie|mande) (la|mas|esa|algo de)? ?(informacion|info|propuesta|presentacion|detalles)\\b',
            '\\bpuedes (enviar|mandar|compartir|explicar)\\b',
            '\\bquiero (ver|conocer|saber) mas\\b',
            '\\bde que se trata\\b',
            '\\bcomo funciona\\b',
        ),
        outcome='Solicitó información',
        conversation_status='conversation_active',
        commercial_status='Respondió',
        next_step='Enviar información concreta y acordar seguimiento.',
        recommended_reply='Claro 😊 Para enviarle algo relevante y no genérico, primero quisiera confirmar algo: ¿actualmente el seguimiento de las consultas se realiza manualmente o utilizan algún sistema?',
        reasoning='La persona abrió la conversación, pero enviar una presentación genérica puede enfriarla. Aura recomienda hacer una pregunta de calificación.',
        objection='',
        priority=67,
        confidence=90,
        followup_delay_days=1,
        is_terminal=False,
        appointment_booked=False,
    ),
    Signal(
        key='meeting_requested',
        label='Interés en coordinar una conversación',
        patterns=(
            '\\b(agendemos|coordinemos|hagamos|quiero|quisiera) (agendar |coordinar |hacer )?(una|la)? ?(reunion|llamada|meet|demo)\\b',
            '\\bcuando (puedes|puede|podemos) (hablar|reunirnos|verlo)\\b',
            '\\bpodemos (hablar|coordinar|agendar)\\b',
            '\\bme gustaria (hablar|verlo|una llamada)\\b',
        ),
        outcome='Interesado',
        conversation_status='conversation_active',
        commercial_status='Interesado',
        next_step='Ofrecer dos horarios cerrados y confirmar uno.',
        recommended_reply='Excelente 😊 Laura tiene dos espacios disponibles. ¿Les funciona mejor la primera opción o la segunda?',
        reasoning='Existe intención concreta de conversar, pero todavía falta una fecha confirmada. Aura recomienda ofrecer dos horarios.',
        objection='',
        priority=66,
        confidence=92,
        followup_delay_days=0,
        is_terminal=False,
        appointment_booked=False,
    ),
    Signal(
        key='positive_interest',
        label='Interés comercial',
        patterns=(
            '\\b(me interesa|nos interesa|suena interesante|me gusta|nos gusta)\\b',
            '\\b(esto|eso) (nos|me) puede (servir|ayudar|funcionar)\\b',
            '\\bquiero (probar|avanzar|hacerlo|conocerlo)\\b',
            '\\bcomo (seguimos|avanzamos|empezamos)\\b',
            '\\bcuentame mas\\b',
        ),
        outcome='Interesado',
        conversation_status='conversation_active',
        commercial_status='Interesado',
        next_step='Acordar reunión o siguiente paso concreto.',
        recommended_reply='Excelente 😊 Para aterrizarlo a su caso, propongo una llamada breve de 15 minutos para revisar el proceso actual y definir el primer paso. ¿Les funciona mejor uno de estos dos horarios?',
        reasoning='La persona mostró interés, pero todavía falta convertirlo en una acción concreta. Aura recomienda pedir un compromiso claro.',
        objection='',
        priority=65,
        confidence=90,
        followup_delay_days=1,
        is_terminal=False,
        appointment_booked=False,
    ),
    Signal(
        key='manual_process_pain',
        label='Proceso manual o pérdida de seguimiento',
        patterns=(
            '\\b(todo|el seguimiento|las respuestas|las consultas) (es|se hace|lo hacemos) manual\\b',
            '\\b(no tenemos|no usamos) (crm|sistema|automatizacion|software)\\b',
            '\\b(usamos|llevamos) (excel|google sheets|una libreta|papel|whatsapp)\\b',
            '\\bse (nos )?(pierden|quedan) (mensajes|consultas|clientes|seguimientos)\\b',
            '\\b(no damos|nos cuesta dar|se nos olvida el) seguimiento\\b',
            '\\b(tardamos|demoramos) (mucho )?en responder\\b',
        ),
        outcome='Respondió',
        conversation_status='conversation_active',
        commercial_status='Respondió',
        next_step='Cuantificar el impacto y proponer una revisión breve.',
        recommended_reply='Gracias, eso ayuda a entender el contexto. Aproximadamente, ¿cuántas consultas reciben al mes y qué ocurre hoy con las personas que no compran o no agendan en el primer contacto?',
        reasoning='La persona describió una brecha real de proceso. Aura recomienda cuantificar volumen e impacto antes de presentar la solución.',
        objection='Brecha operativa detectada',
        priority=64,
        confidence=91,
        followup_delay_days=1,
        is_terminal=False,
        appointment_booked=False,
    ),
    Signal(
        key='low_volume',
        label='Bajo volumen de consultas',
        patterns=(
            '\\brecibimos (muy )?pocas (consultas|mensajes|solicitudes|citas)\\b',
            '\\b(no llegan|casi no llegan) (consultas|mensajes|clientes|pacientes)\\b',
            '\\bmenos de (cinco|diez|veinte|5|10|20) (consultas|mensajes)\\b',
            '\\bno tenemos mucho volumen\\b',
        ),
        outcome='Respondió',
        conversation_status='conversation_active',
        commercial_status='Respondió',
        next_step='Validar ticket, origen de consultas y prioridad de crecimiento.',
        recommended_reply='Entiendo. ¿El reto principal es generar más consultas o convertir mejor las pocas que ya reciben? Con eso podemos definir si el diagnóstico aplica.',
        reasoning='El volumen puede ser bajo, pero aún falta validar ticket y prioridad. Aura recomienda no descartar automáticamente.',
        objection='Bajo volumen',
        priority=63,
        confidence=88,
        followup_delay_days=7,
        is_terminal=False,
        appointment_booked=False,
    ),
    Signal(
        key='generic_acknowledgement',
        label='Respuesta breve sin intención explícita',
        patterns=(
            '^\\s*(ok|okay|oki|dale|listo|perfecto|entendido|comprendo|gracias|muchas gracias|bien|bueno)\\s*[.!]*$',
            '^\\s*(ok|perfecto|gracias),? (gracias|entendido|lo reviso)\\s*[.!]*$',
        ),
        outcome='Respondió',
        conversation_status='response_received',
        commercial_status='Respondió',
        next_step='Hacer una pregunta de calificación y acordar el siguiente paso.',
        recommended_reply='Gracias 😊 Para entender mejor el contexto, ¿cómo gestionan actualmente las consultas y el seguimiento de las personas que no compran o no agendan en el primer contacto?',
        reasoning='La persona respondió, pero no expresó interés, objeción ni compromiso. Aura recomienda continuar con una pregunta de calificación.',
        objection='',
        priority=20,
        confidence=64,
        followup_delay_days=1,
        is_terminal=False,
        appointment_booked=False,
    ),
    Signal(
        key='greeting_only',
        label='Saludo sin intención explícita',
        patterns=(
            '^\\s*(hola|buenas|buen dia|buenos dias|buenas tardes|buenas noches|digame|si diga)\\s*[.!]*$',
        ),
        outcome='Respondió',
        conversation_status='response_received',
        commercial_status='Respondió',
        next_step='Presentarse brevemente y confirmar si el seguimiento es manual o utiliza un sistema.',
        recommended_reply='Hola 😊 Soy Maikol Brown, asistente de consultoría de Growth by Laura. Estamos conversando con clínicas para entender cómo organizan y dan seguimiento a las personas que consultan por WhatsApp. Quería hacerles una pregunta breve: ¿actualmente ese seguimiento lo realizan manualmente o utilizan algún sistema?',
        reasoning='La persona abrió la conversación con un saludo. Aura usa el primer contacto actualizado y hace una sola pregunta sobre el sistema de seguimiento.',
        objection='',
        priority=10,
        confidence=58,
        followup_delay_days=1,
        is_terminal=False,
        appointment_booked=False,
    )
,)


DAY_NAMES = {
    "lunes": 0,
    "martes": 1,
    "miercoles": 2,
    "jueves": 3,
    "viernes": 4,
    "sabado": 5,
    "domingo": 6,
}


STATUS_LABELS = {
    "not_started": "No iniciada",
    "waiting_response": "Esperando respuesta",
    "response_received": "Respuesta recibida",
    "conversation_active": "Conversación activa",
    "waiting_decision_maker": "Esperando al decisor",
    "waiting_confirmation": "Esperando confirmación",
    "followup_scheduled": "Seguimiento programado",
    "closed": "Cerrada",
}


def _safe_date(year: int, month: int, day: int) -> date | None:
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _suggest_followup(normalized: str, today: date) -> str | None:
    if re.search(r"\bpasado manana\b", normalized):
        return (today + timedelta(days=2)).isoformat()
    if re.search(r"\bmanana\b", normalized):
        return (today + timedelta(days=1)).isoformat()
    days_match = re.search(r"\b(?:en|dentro de) (\d{1,2}) dias?\b", normalized)
    if days_match:
        days = max(0, min(90, int(days_match.group(1))))
        return (today + timedelta(days=days)).isoformat()
    if re.search(r"\bproxima semana\b", normalized):
        return (today + timedelta(days=7)).isoformat()
    if re.search(r"\bproximo mes\b", normalized):
        return (today + timedelta(days=30)).isoformat()
    numeric_date = re.search(r"\b(?:el )?(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b", normalized)
    if numeric_date:
        day, month = int(numeric_date.group(1)), int(numeric_date.group(2))
        raw_year = numeric_date.group(3)
        year = today.year if not raw_year else int(raw_year)
        if raw_year and year < 100:
            year += 2000
        candidate = _safe_date(year, month, day)
        if candidate and candidate < today and not raw_year:
            candidate = _safe_date(year + 1, month, day)
        if candidate:
            return candidate.isoformat()
    for name, weekday in DAY_NAMES.items():
        if re.search(rf"\b{name}\b", normalized):
            delta = (weekday - today.weekday()) % 7
            if delta == 0:
                delta = 7
            return (today + timedelta(days=delta)).isoformat()
    return None


def _default_result(channel: str | None, today: date, scope: str = "", setter_name: str | None = None) -> dict[str, Any]:
    followup = (today + timedelta(days=1)).isoformat()
    suggestion = {
        "activity_type": "response_received",
        "conversation_status": "response_received",
        "outcome_stage": "provisional",
        "outcome": "Respondió",
        "objection": "",
        "next_step": "Identificar al responsable o formular una sola pregunta de calificación.",
        "followup_date": followup,
        "is_final_outcome": False,
        "awaiting_response": False,
        "appointment_booked": False,
        "channel": channel or "WhatsApp",
        "commercial_status": "Respondió",
    }
    return {
        "method": "aura_setter_playbook_v3",
        "library_version": "2026.07.29.5",
        "confidence": 48,
        "summary": "Hubo respuesta, pero Aura no detectó una intención comercial suficientemente explícita.",
        "recommended_reply": _personalize_setter_text("Gracias por responder 😊 Para orientarme correctamente, ¿usted supervisa el seguimiento de las consultas por WhatsApp o debería conversar con otra persona?", setter_name),
        "reasoning": "La conversación está abierta, pero todavía falta información para decidir el siguiente paso. Aura recomienda hacer una pregunta de calificación.",
        "signals": [],
        "analysis_scope": scope[:500],
        "classification": {
            "commercial_status": suggestion["commercial_status"],
            "conversation_status": suggestion["conversation_status"],
            "conversation_status_label": STATUS_LABELS[suggestion["conversation_status"]],
            "outcome": suggestion["outcome"],
            "next_step": suggestion["next_step"],
            "followup_date": suggestion["followup_date"],
        },
        "suggestion": suggestion,
        "warning": "Respuesta sugerida por Aura. Revísala antes de enviarla. La clasificación ya fue aplicada automáticamente y puedes corregirla en Ajustar manualmente.",
    }


def _contextual_signal_key(scope_normalized: str, previous_agent_normalized: str) -> str | None:
    short_yes = bool(re.fullmatch(r"(si|correcto|exacto|asi es|claro)[,;.!]*", scope_normalized))
    short_no = bool(re.fullmatch(r"(no|negativo|para nada|no lo hacemos)[,;.!]*", scope_normalized))
    short_me = bool(re.fullmatch(r"(yo|conmigo|yo mismo|yo misma)[,;.!]*", scope_normalized))
    if not previous_agent_normalized:
        return None

    asked_measurement = bool(
        re.search(r"(forma clara de saber|cuantas consultas|miden|medir).*(citas|clientes|ventas|conversion)", previous_agent_normalized)
        or re.search(r"(conversion).*(consultas|citas|ventas)", previous_agent_normalized)
    )
    if asked_measurement and short_no:
        return "maikol_not_measuring"
    if asked_measurement and short_yes:
        return "maikol_yes_measuring"

    asked_system = bool(re.search(r"(utilizan|usan|tienen|cuentan con).*(sistema|crm|software|plataforma)", previous_agent_normalized))
    if asked_system and short_no:
        return "maikol_no_system"
    if asked_system and short_yes:
        return "maikol_uses_system"

    asked_responsible = bool(re.search(r"(con quien|quien).*(conversar|hablar|encargad|supervisa|maneja)", previous_agent_normalized))
    if asked_responsible and (short_me or bool(re.fullmatch(r"(soy yo|yo lo manejo|yo me encargo)[,;.!]*", scope_normalized))):
        return "maikol_decision_maker_present"

    asked_owner_scope = bool(re.search(r"esa persona supervisa.*(seguimiento|conversion)", previous_agent_normalized))
    if asked_owner_scope and short_yes:
        return "maikol_decision_maker_present"
    return None


def analyze_chat(
    transcript: str,
    *,
    channel: str | None = None,
    today: date | None = None,
    setter_name: str | None = None,
) -> dict[str, Any]:
    original = transcript or ""
    scope, previous_agent_message = _analysis_context(original, setter_name)
    normalized = _normalize(scope)
    previous_agent_normalized = _normalize(previous_agent_message)
    current_date = today or date.today()

    if len(normalized) < 2:
        empty = _default_result(channel, current_date, scope, setter_name)
        empty.update({
            "confidence": 0,
            "summary": "No hay suficiente texto para analizar.",
            "recommended_reply": "",
            "reasoning": "Pega una respuesta, un resumen o el TXT del chat para que Aura pueda proponer qué decir y cómo clasificarlo.",
        })
        return empty

    matches: list[dict[str, Any]] = []
    contextual_key = _contextual_signal_key(normalized, previous_agent_normalized)
    contextual_signal = next((signal for signal in SIGNALS if signal.key == contextual_key), None)
    if contextual_signal:
        matches.append({
            "key": contextual_signal.key,
            "label": contextual_signal.label,
            "priority": contextual_signal.priority + 1000,
            "confidence": contextual_signal.confidence,
            "order": -1,
            "outcome": contextual_signal.outcome,
            "conversation_status": contextual_signal.conversation_status,
            "commercial_status": contextual_signal.commercial_status,
            "next_step": contextual_signal.next_step,
            "recommended_reply": contextual_signal.recommended_reply,
            "reasoning": contextual_signal.reasoning,
            "objection": contextual_signal.objection,
            "followup_delay_days": contextual_signal.followup_delay_days,
            "is_terminal": contextual_signal.is_terminal,
            "appointment_booked": contextual_signal.appointment_booked,
            "followup_mode": contextual_signal.followup_mode,
            "evidence": scope[:220],
        })

    for index, signal in enumerate(SIGNALS):
        for pattern_text in signal.patterns:
            pattern = re.compile(pattern_text, re.IGNORECASE)
            if pattern.search(normalized):
                if contextual_key == signal.key:
                    break
                matches.append({
                    "key": signal.key,
                    "label": signal.label,
                    "priority": signal.priority,
                    "confidence": signal.confidence,
                    "order": index,
                    "outcome": signal.outcome,
                    "conversation_status": signal.conversation_status,
                    "commercial_status": signal.commercial_status,
                    "next_step": signal.next_step,
                    "recommended_reply": signal.recommended_reply,
                    "reasoning": signal.reasoning,
                    "objection": signal.objection,
                    "followup_delay_days": signal.followup_delay_days,
                    "is_terminal": signal.is_terminal,
                    "appointment_booked": signal.appointment_booked,
                    "followup_mode": signal.followup_mode,
                    "evidence": _excerpt(original, pattern, setter_name),
                })
                break

    if not matches:
        return _default_result(channel, current_date, scope, setter_name)

    matches.sort(key=lambda item: (-int(item["priority"]), int(item["order"])))
    primary = matches[0]
    final = bool(primary["is_terminal"] or primary["conversation_status"] == "closed")
    stage = "final" if final else "provisional"
    followup = None
    if not final:
        followup = _suggest_followup(normalized, current_date)
        if not followup:
            delay = int(primary.get("followup_delay_days") if primary.get("followup_delay_days") is not None else 1)
            if primary.get("followup_mode") == "next_business_day":
                followup = _next_business_day(current_date, delay).isoformat()
            else:
                followup = (current_date + timedelta(days=delay)).isoformat()

    confidence = min(99, int(primary["confidence"]) + min(5, max(0, len(matches) - 1)))
    secondary_labels = [item["label"].lower() for item in matches[1:2]]
    summary = f"Aura detectó {primary['label'].lower()}"
    if secondary_labels:
        summary += f" y también {secondary_labels[0]}"
    summary += "."

    suggestion = {
        "activity_type": "response_received",
        "conversation_status": primary["conversation_status"],
        "outcome_stage": stage,
        "outcome": primary["outcome"],
        "objection": primary.get("objection") or "",
        "next_step": primary["next_step"],
        "followup_date": followup,
        "is_final_outcome": final,
        "awaiting_response": primary["conversation_status"] in {
            "waiting_response", "waiting_decision_maker", "waiting_confirmation", "followup_scheduled",
        },
        "appointment_booked": bool(primary.get("appointment_booked")),
        "channel": channel or "WhatsApp",
        "commercial_status": primary["commercial_status"],
    }

    clean_signals = [
        {key: value for key, value in item.items() if key not in {
            "order", "recommended_reply", "reasoning", "followup_delay_days", "is_terminal", "appointment_booked", "followup_mode",
        }}
        for item in matches[:3]
    ]

    return {
        "method": "aura_setter_playbook_v3",
        "library_version": "2026.07.29.5",
        "confidence": confidence,
        "summary": summary,
        "recommended_reply": _personalize_setter_text(primary["recommended_reply"], setter_name),
        "reasoning": _personalize_setter_text(primary["reasoning"], setter_name),
        "signals": clean_signals,
        "analysis_scope": scope[:500],
        "classification": {
            "commercial_status": primary["commercial_status"],
            "conversation_status": primary["conversation_status"],
            "conversation_status_label": STATUS_LABELS.get(primary["conversation_status"], primary["conversation_status"]),
            "outcome": primary["outcome"],
            "next_step": primary["next_step"],
            "followup_date": followup,
        },
        "suggestion": suggestion,
        "warning": "Respuesta sugerida por Aura. Revísala antes de enviarla. La clasificación ya fue aplicada automáticamente y puedes corregirla en Ajustar manualmente.",
    }
