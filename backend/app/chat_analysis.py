from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any


def _normalize(text: str) -> str:
    value = unicodedata.normalize("NFKD", text or "")
    value = "".join(char for char in value if not unicodedata.combining(char))
    value = value.lower()
    value = re.sub(r"https?://\S+", " ", value)
    value = re.sub(r"[^a-z0-9ñ\s:/.-]", " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


def _excerpt(original: str, normalized_pattern: re.Pattern[str]) -> str:
    for line in (original or "").splitlines():
        if normalized_pattern.search(_normalize(line)):
            return line.strip()[:220]
    return (original or "").strip()[:220]


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
    objection: str | None = None
    weight: int = 1


SIGNALS: tuple[Signal, ...] = (
    Signal(
        "do_not_contact",
        "Solicitud expresa de no contacto",
        (
            r"\b(no me escriban|no me escribas|no nos contacten|no volver a contactar|no llamar|no llames|no contactes|eliminar mi numero)\b",
            r"\bpor favor no (llames|escribas|contactes)\b",
        ),
        outcome="No contactar",
        conversation_status="closed",
        commercial_status="Descartado",
        next_step="No insistir y conservar el historial.",
        recommended_reply="Entendido. Gracias por indicarlo; no volveremos a contactarles por este medio.",
        reasoning="La persona pidió explícitamente detener el contacto. Aura recomienda cerrar el lead y respetar la solicitud.",
        objection="No contactar",
        weight=6,
    ),
    Signal(
        "wrong_contact",
        "Contacto o número incorrecto",
        (
            r"\bnumero (equivocado|incorrecto|invalido)\b",
            r"\bse (equivoco|confundio) de numero\b",
            r"\baqui no (es|trabaja|queda)\b",
            r"\bno conozco (esa|ese) (empresa|clinica|persona|negocio)\b",
        ),
        outcome="Número incorrecto o inválido",
        conversation_status="closed",
        commercial_status="No califica",
        next_step="Buscar otro canal; si no existe, descartar.",
        recommended_reply="Gracias por avisarnos. Disculpe la molestia; actualizaremos nuestros datos.",
        reasoning="El canal no corresponde al negocio o a la persona buscada. No conviene seguir insistiendo en este contacto.",
        objection="Contacto incorrecto",
        weight=6,
    ),
    Signal(
        "outside_hours_auto_reply",
        "Respuesta automática fuera de horario",
        (
            r"\bfuera de (nuestro )?horario\b",
            r"\bhorario de atencion\b",
            r"\ben este momento estamos cerrados\b",
            r"\bte responderemos (pronto|en horario)\b",
        ),
        outcome="Respuesta automática fuera de horario",
        conversation_status="followup_scheduled",
        commercial_status="Seguimiento 1",
        next_step="Contactar dentro del horario con el mensaje corregido.",
        recommended_reply="Hola 😊 Retomo mi mensaje dentro de su horario de atención. Mi nombre es Maikol y escribo de parte de Laura Rodriguez. ¿Podría indicarme quién gestiona las consultas y su seguimiento en la empresa?",
        reasoning="La respuesta provino de una automatización y no representa interés ni rechazo. El lead debe seguir abierto y retomarse dentro del horario.",
        weight=4,
    ),
    Signal(
        "bot_requested_name_reason",
        "Bot pidió nombre y motivo",
        (
            r"\b(indica|indiquenos|escribe|compartenos) (tu|su)? ?nombre\b",
            r"\b(cual es|indica|indiquenos) el motivo\b",
            r"\bpara poder ayudarte.*nombre\b",
            r"\bselecciona una opcion\b",
        ),
        outcome="Bot pidió nombre y motivo",
        conversation_status="followup_scheduled",
        commercial_status="Seguimiento 1",
        next_step="Responder al bot y solicitar a la persona encargada.",
        recommended_reply="Hola 😊 Mi nombre es Maikol y escribo de parte de Laura Rodriguez. Estamos realizando una revisión breve de cómo las empresas gestionan y dan seguimiento a sus consultas. ¿Podría indicarme quién es la persona encargada de este proceso?",
        reasoning="Todavía no respondió una persona. Aura recomienda completar el filtro del bot y pedir directamente al responsable del proceso.",
        weight=4,
    ),
    Signal(
        "patient_flow",
        "WhatsApp abrió un flujo para pacientes",
        (
            r"\b(agendar|reservar) (una )?cita\b",
            r"\bselecciona (el|un) servicio\b",
            r"\bmotivo de (tu|su) consulta medica\b",
            r"\bdatos del paciente\b",
        ),
        outcome="WhatsApp abrió flujo de paciente",
        conversation_status="followup_scheduled",
        commercial_status="Seguimiento 1",
        next_step="Aclarar que es una consulta comercial y pedir al encargado.",
        recommended_reply="Hola 😊 Disculpe, el sistema abrió el flujo de pacientes. Mi consulta es comercial: escribo de parte de Laura Rodriguez para conocer cómo gestionan y dan seguimiento a las consultas que reciben. ¿Con quién podría conversar sobre ese proceso?",
        reasoning="El canal es correcto, pero la conversación entró por el flujo equivocado. Debe corregirse el contexto antes de continuar.",
        weight=4,
    ),
    Signal(
        "referral",
        "Compartió o indicó otro contacto",
        (
            r"\b(escribele|contacta|habla) (a|con)\b",
            r"\bte paso (el|su) (numero|contacto)\b",
            r"\bcomunicate con\b",
            r"\bla persona encargada es\b",
        ),
        outcome="Referido a otro contacto",
        conversation_status="followup_scheduled",
        commercial_status="Seguimiento 1",
        next_step="Crear o actualizar el contacto referido y escribirle.",
        recommended_reply="Muchas gracias. ¿Podría compartirme el nombre, el contacto y el mejor horario para escribirle a la persona encargada?",
        reasoning="La conversación no terminó: el contacto actual redirigió la oportunidad. Aura recomienda crear el referido y continuar con él.",
        weight=5,
    ),
    Signal(
        "sale",
        "Acuerdo de compra o implementación",
        (
            r"\b(aceptamos|aprobamos) la propuesta\b",
            r"\bqueremos contratar\b",
            r"\bvamos a empezar\b",
            r"\bprocedamos con (la|el)\b",
        ),
        outcome="Venta",
        conversation_status="closed",
        commercial_status="Implementación vendida",
        next_step="Iniciar onboarding y registrar el monto.",
        recommended_reply="Excelente, gracias por la confianza. El siguiente paso es coordinar el inicio, responsables y documentación necesaria para la implementación.",
        reasoning="La persona confirmó la compra o el inicio. Aura recomienda cerrar la etapa comercial y abrir el onboarding.",
        weight=7,
    ),
    Signal(
        "not_qualified",
        "El caso no califica",
        (
            r"\bno somos (empresa|negocio|clinica)\b",
            r"\bno recibimos consultas\b",
            r"\bno tenemos equipo comercial\b",
            r"\besto no aplica para nosotros\b",
        ),
        outcome="No califica",
        conversation_status="closed",
        commercial_status="No califica",
        next_step="Cerrar la oportunidad con la razón documentada.",
        recommended_reply="Gracias por aclararlo. Entiendo que la solución no aplica a su operación actual; cierro el contacto para no hacerles perder tiempo.",
        reasoning="La necesidad o el perfil mínimo no existe. Mantener el lead abierto distorsionaría el pipeline.",
        objection="No califica",
        weight=6,
    ),
    Signal(
        "not_interested",
        "Negativa comercial",
        (
            r"\b(no me interesa|no nos interesa|no estamos interesados|no estoy interesad[oa])\b",
            r"\b(no gracias|gracias pero no|prefiero que no)\b",
            r"\bno (quiero|queremos) (continuar|seguir)\b",
        ),
        outcome="No interesado",
        conversation_status="closed",
        commercial_status="No interesado",
        next_step="Cerrar la oportunidad y conservar el historial.",
        recommended_reply="Entiendo, gracias por responder. No insistiremos. Quedo disponible si más adelante desean revisar el proceso.",
        reasoning="La persona rechazó continuar. Aura recomienda cerrar el lead sin confundirlo con falta de respuesta.",
        objection="No interesado",
        weight=6,
    ),
    Signal(
        "meeting",
        "Reunión coordinada o solicitada",
        (
            r"\b(agendemos|coordinemos|hagamos) (una|la)? ?(reunion|llamada|meet|demo)\b",
            r"\b(me|nos) (sirve|funciona|queda bien) (el|la|a las|a la)\b",
            r"\bpuedo (el|la) (lunes|martes|miercoles|jueves|viernes)\b",
            r"\bcuando (puedes|podemos) (hablar|reunirnos|verlo)\b",
            r"\bconfirmado para\b",
        ),
        outcome="Reunión agendada",
        conversation_status="waiting_confirmation",
        commercial_status="Reunión agendada",
        next_step="Confirmar fecha, hora, asistentes y enviar el enlace.",
        recommended_reply="Perfecto 😊 Confirmemos fecha, hora y quiénes participarán. En cuanto quede validado, les envío el enlace de la reunión.",
        reasoning="Existe intención concreta de reunirse. Aura recomienda convertirla en un compromiso operativo con fecha, hora y asistentes.",
        weight=7,
    ),
    Signal(
        "positive_interest",
        "Interés comercial",
        (
            r"\b(me interesa|nos interesa|suena interesante|me gusta|nos gusta)\b",
            r"\b(esto|eso) (nos|me) puede (servir|ayudar|funcionar)\b",
            r"\bquiero (probar|avanzar|hacerlo|contratar)\b",
            r"\bcomo (seguimos|avanzamos|empezamos)\b",
        ),
        outcome="Interesado",
        conversation_status="conversation_active",
        commercial_status="Interesado",
        next_step="Acordar reunión o siguiente paso concreto.",
        recommended_reply="Excelente 😊 Para aterrizarlo a su caso, propongo una llamada breve de 15 minutos para revisar el proceso actual y definir el primer paso. ¿Qué horario les funciona mejor?",
        reasoning="La persona mostró interés, pero todavía falta convertirlo en una acción concreta. Aura recomienda pedir un compromiso claro.",
        weight=6,
    ),
    Signal(
        "decision_maker",
        "No se contactó al decisor",
        (
            r"\b(yo|nosotros) no (decido|decidimos|veo|vemos) eso\b",
            r"\beso lo (ve|maneja|decide) (la|el|mi|nuestro)? ?(doctor|doctora|administracion|gerencia|dueno|encargad[oa])\b",
            r"\b(la|el) (encargad[oa]|doctor|doctora|dueno|gerente) no esta\b",
            r"\b(tengo|debo|voy a) (consultar|preguntar|validar|hablar) con\b",
            r"\bno soy (la|el) (persona|encargad[oa]|responsable)\b",
        ),
        outcome="Contacto con intermediario",
        conversation_status="waiting_decision_maker",
        commercial_status="Seguimiento 1",
        next_step="Identificar al decisor y acordar cuándo contactarlo.",
        recommended_reply="Gracias. ¿Podría indicarme el nombre de la persona encargada y el mejor horario para contactarla? Así no les envío información genérica.",
        reasoning="La persona respondió, pero no tiene autoridad sobre el proceso. Aura recomienda identificar al decisor antes de presentar la solución.",
        objection="No se contactó al decisor",
        weight=5,
    ),
    Signal(
        "budget",
        "Restricción o duda de presupuesto",
        (
            r"\b(no|sin) (tenemos|hay|cuento con) (presupuesto|budget|dinero)\b",
            r"\b(se sale|esta fuera) de (mi|nuestro|el) presupuesto\b",
            r"\b(muy|demasiado) (caro|costoso)\b",
            r"\b(no podemos|no puedo) (invertir|pagar|gastar)\b",
            r"\bcuanto (cuesta|sale|vale)\b",
        ),
        outcome="Objeción identificada",
        conversation_status="conversation_active",
        commercial_status="Respondió",
        next_step="Validar presupuesto y explicar impacto antes de hablar de implementación.",
        recommended_reply="Entiendo. Para no proponer algo fuera de contexto, ¿qué rango tendría sentido para ustedes si la solución reduce tareas manuales o recupera oportunidades que hoy se pierden?",
        reasoning="Existe una objeción económica, no un rechazo definitivo. Aura recomienda entender el rango y conectar la inversión con el impacto.",
        objection="Presupuesto",
        weight=4,
    ),
    Signal(
        "existing_solution",
        "Ya utiliza una solución o proveedor",
        (
            r"\bya (tenemos|uso|usamos|trabajamos con) (un|una|otro|otra)? ?(crm|agencia|proveedor|sistema|software|persona)\b",
            r"\bnos lo (maneja|lleva) (una|la|un|el)\b",
            r"\bestamos (contentos|bien) con\b",
        ),
        outcome="Ya tiene proveedor",
        conversation_status="followup_scheduled",
        commercial_status="Seguimiento 2",
        next_step="Preguntar qué funciona y qué todavía les cuesta; revisar en nurture.",
        recommended_reply="Perfecto. No busco reemplazar algo que ya funciona. ¿Hay algún punto del proceso actual que todavía les cueste, por ejemplo seguimiento, velocidad de respuesta o visibilidad de resultados?",
        reasoning="Tener proveedor no elimina necesariamente la necesidad. Aura recomienda explorar brechas sin confrontar la solución actual.",
        objection="Ya utiliza otra solución",
        weight=4,
    ),
    Signal(
        "waiting_confirmation",
        "Quedó una confirmación pendiente",
        (
            r"\b(te|le) (confirmo|avisamos|aviso)\b",
            r"\bdejame (revisar|validar|confirmar)\b",
            r"\b(consulto|reviso) y te (digo|aviso|confirmo)\b",
            r"\bpendiente de (confirmar|respuesta|aprobacion)\b",
        ),
        outcome="Esperando confirmación",
        conversation_status="waiting_confirmation",
        commercial_status="Seguimiento 1",
        next_step="Definir una fecha límite y programar seguimiento.",
        recommended_reply="Perfecto, quedo pendiente. Para no dejarlo abierto, ¿les parece bien que retome la conversación en la fecha acordada si todavía no tengo confirmación?",
        reasoning="La persona no rechazó; pidió tiempo para validar. Aura recomienda fijar cuándo se retomará para evitar un seguimiento indefinido.",
        weight=3,
    ),
    Signal(
        "timing",
        "Pidió retomar después",
        (
            r"\b(mas adelante|despues|otro dia|la proxima semana|el proximo mes)\b",
            r"\b(ahora|hoy) no (puedo|podemos|es buen momento)\b",
            r"\b(escribeme|llamame|contactame) (manana|luego|despues)\b",
            r"\bcuando (tenga|tengamos) tiempo\b",
        ),
        outcome="Seguimiento solicitado",
        conversation_status="followup_scheduled",
        commercial_status="Seguimiento 1",
        next_step="Retomar en la fecha acordada.",
        recommended_reply="Claro. ¿Qué día les funciona mejor para retomarlo? Así lo dejo agendado y no les escribo fuera de contexto.",
        reasoning="La conversación sigue abierta, pero el momento no es inmediato. Aura recomienda convertir el 'después' en una fecha concreta.",
        objection="Momento / prioridad",
        weight=3,
    ),
    Signal(
        "request_info",
        "Solicitó información",
        (
            r"\b(enviame|mandame|comparteme|pasa me|pasame) (la|mas|esa|algo de)? ?(informacion|info|propuesta|presentacion|precios|detalles)\b",
            r"\bpuedes (enviar|mandar|compartir)\b",
            r"\bquiero (ver|conocer|saber) mas\b",
            r"\bde que se trata\b",
        ),
        outcome="Solicitó información",
        conversation_status="conversation_active",
        commercial_status="Respondió",
        next_step="Enviar información concreta y acordar seguimiento.",
        recommended_reply="Claro 😊 Para enviarle algo relevante y no genérico, primero quisiera confirmar algo: ¿actualmente el seguimiento de las consultas se realiza manualmente o utilizan algún sistema?",
        reasoning="La persona abrió la conversación, pero enviar una presentación genérica puede enfriarla. Aura recomienda hacer una pregunta de calificación antes de enviar material.",
        weight=4,
    ),
)


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


def _suggest_followup(normalized: str, today: date) -> str | None:
    if re.search(r"\bpasado manana\b", normalized):
        return (today + timedelta(days=2)).isoformat()
    if re.search(r"\bmanana\b", normalized):
        return (today + timedelta(days=1)).isoformat()
    if re.search(r"\b(en|dentro de) 3 dias\b", normalized):
        return (today + timedelta(days=3)).isoformat()
    if re.search(r"\b(en|dentro de) 7 dias\b|\bproxima semana\b", normalized):
        return (today + timedelta(days=7)).isoformat()
    for name, weekday in DAY_NAMES.items():
        if re.search(rf"\b{name}\b", normalized):
            delta = (weekday - today.weekday()) % 7
            if delta == 0:
                delta = 7
            return (today + timedelta(days=delta)).isoformat()
    return None


def _default_result(channel: str | None, today: date) -> dict[str, Any]:
    followup = (today + timedelta(days=1)).isoformat()
    suggestion = {
        "activity_type": "response_received",
        "conversation_status": "response_received",
        "outcome_stage": "provisional",
        "outcome": "Respondió",
        "objection": "",
        "next_step": "Responder, calificar la necesidad y acordar un próximo paso concreto.",
        "followup_date": followup,
        "is_final_outcome": False,
        "awaiting_response": False,
        "channel": channel or "WhatsApp",
        "commercial_status": "Respondió",
    }
    return {
        "method": "local_semantic_rules_v2",
        "confidence": 48,
        "summary": "Hubo respuesta, pero Aura no detectó una objeción, compromiso o cierre suficientemente explícito.",
        "recommended_reply": "Gracias por responder 😊 Para entender mejor el contexto, ¿cómo gestionan actualmente las consultas y el seguimiento de las personas que no compran o no agendan en el primer contacto?",
        "reasoning": "La conversación está abierta, pero todavía falta información para decidir el siguiente paso. Aura recomienda hacer una pregunta de calificación.",
        "signals": [],
        "classification": {
            "commercial_status": suggestion["commercial_status"],
            "conversation_status": suggestion["conversation_status"],
            "conversation_status_label": STATUS_LABELS[suggestion["conversation_status"]],
            "outcome": suggestion["outcome"],
            "next_step": suggestion["next_step"],
            "followup_date": suggestion["followup_date"],
        },
        "suggestion": suggestion,
        "warning": "Respuesta sugerida por Aura. Revísala antes de enviarla y confirma la clasificación antes de guardar.",
    }


def analyze_chat(transcript: str, *, channel: str | None = None, today: date | None = None) -> dict[str, Any]:
    original = transcript or ""
    normalized = _normalize(original)
    current_date = today or date.today()

    if len(normalized) < 3:
        empty = _default_result(channel, current_date)
        empty.update({
            "confidence": 0,
            "summary": "No hay suficiente texto para analizar.",
            "recommended_reply": "",
            "reasoning": "Pega una respuesta, un resumen o el TXT del chat para que Aura pueda proponer qué decir y cómo clasificarlo.",
        })
        return empty

    matches: list[dict[str, Any]] = []
    for signal in SIGNALS:
        for pattern_text in signal.patterns:
            pattern = re.compile(pattern_text, re.IGNORECASE)
            if pattern.search(normalized):
                matches.append({
                    "key": signal.key,
                    "label": signal.label,
                    "weight": signal.weight,
                    "outcome": signal.outcome,
                    "conversation_status": signal.conversation_status,
                    "commercial_status": signal.commercial_status,
                    "next_step": signal.next_step,
                    "recommended_reply": signal.recommended_reply,
                    "reasoning": signal.reasoning,
                    "objection": signal.objection,
                    "evidence": _excerpt(original, pattern),
                })
                break

    keys = {item["key"] for item in matches}
    if "do_not_contact" in keys:
        matches = [item for item in matches if item["key"] not in {"not_interested", "positive_interest"}]
    elif "not_interested" in keys:
        matches = [item for item in matches if item["key"] != "positive_interest"]
    keys = {item["key"] for item in matches}
    priority = [signal.key for signal in SIGNALS]
    primary = next((next(item for item in matches if item["key"] == key) for key in priority if key in keys), None)

    if not primary:
        return _default_result(channel, current_date)

    conversation_status = primary["conversation_status"]
    outcome = primary["outcome"]
    commercial_status = primary["commercial_status"]
    final = conversation_status == "closed" or outcome in {
        "No contactar", "No interesado", "Número incorrecto o inválido", "No califica", "Venta",
    }
    stage = "final" if final else "provisional"
    followup = None if final else _suggest_followup(normalized, current_date)
    if not final and not followup:
        followup = (current_date + timedelta(days=1)).isoformat()

    total_weight = sum(int(item["weight"]) for item in matches)
    confidence = min(97, 52 + total_weight * 6 + min(12, len(normalized) // 90))
    secondary_labels = [item["label"].lower() for item in matches if item["key"] != primary["key"]][:1]
    summary = f"Aura detectó {primary['label'].lower()}"
    if secondary_labels:
        summary += f" y {secondary_labels[0]}"
    summary += "."

    suggestion = {
        "activity_type": "response_received",
        "conversation_status": conversation_status,
        "outcome_stage": stage,
        "outcome": outcome,
        "objection": primary.get("objection") or "",
        "next_step": primary["next_step"],
        "followup_date": followup,
        "is_final_outcome": final,
        "awaiting_response": conversation_status in {
            "waiting_response", "waiting_decision_maker", "waiting_confirmation", "followup_scheduled",
        },
        "channel": channel or "WhatsApp",
        "commercial_status": commercial_status,
    }

    return {
        "method": "local_semantic_rules_v2",
        "confidence": confidence,
        "summary": summary,
        "recommended_reply": primary["recommended_reply"],
        "reasoning": primary["reasoning"],
        "signals": matches,
        "classification": {
            "commercial_status": commercial_status,
            "conversation_status": conversation_status,
            "conversation_status_label": STATUS_LABELS.get(conversation_status, conversation_status),
            "outcome": outcome,
            "next_step": primary["next_step"],
            "followup_date": followup,
        },
        "suggestion": suggestion,
        "warning": "Respuesta sugerida por Aura. Revísala antes de enviarla y confirma la clasificación antes de guardar.",
    }
