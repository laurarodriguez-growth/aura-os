from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any
from zoneinfo import ZoneInfo

PANAMA_TZ = ZoneInfo("America/Panama")


def _normalize(text: str) -> str:
    value = unicodedata.normalize("NFKD", text or "")
    value = "".join(char for char in value if not unicodedata.combining(char))
    value = value.lower()
    value = re.sub(r"https?://\S+", " ", value)
    value = re.sub(r"[^a-z0-9ñ\s:/.-]", " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


def _excerpt(original: str, normalized_pattern: re.Pattern[str]) -> str:
    # La posición exacta puede cambiar al quitar tildes; devolvemos una línea relevante.
    for line in (original or "").splitlines():
        if normalized_pattern.search(_normalize(line)):
            return line.strip()[:220]
    return (original or "").strip()[:220]


@dataclass(frozen=True)
class Signal:
    key: str
    label: str
    patterns: tuple[str, ...]
    objection: str | None = None
    outcome: str | None = None
    conversation_status: str | None = None
    next_step: str | None = None
    weight: int = 1


SIGNALS: tuple[Signal, ...] = (
    Signal(
        "budget",
        "Restricción de presupuesto",
        (
            r"\b(no|sin) (tenemos|hay|cuento con) (presupuesto|budget|dinero)",
            r"\b(se sale|esta fuera) de (mi|nuestro|el) presupuesto",
            r"\b(muy|demasiado) (caro|costoso)",
            r"\b(ahora|este mes) (estamos|ando) (apretad[oa]s?|cort[oa]s?)",
            r"\b(no podemos|no puedo) (invertir|pagar|gastar)",
            r"\bcuanto (cuesta|sale|vale)",
        ),
        objection="Presupuesto",
        outcome="Objeción identificada",
        conversation_status="conversation_active",
        next_step="Validar presupuesto disponible y presentar el impacto económico antes de hablar de implementación.",
        weight=3,
    ),
    Signal(
        "decision_maker",
        "No se contactó al decisor",
        (
            r"\b(yo|nosotros) no (decido|decidimos|veo|vemos) eso",
            r"\beso lo (ve|maneja|decide) (la|el|mi|nuestro)? ?(doctor|doctora|administracion|gerencia|dueno|encargad[oa])",
            r"\b(la|el) (encargad[oa]|doctor|doctora|dueno|gerente) no esta",
            r"\b(tengo|debo|voy a) (consultar|preguntar|validar|hablar) con",
            r"\bno soy (la|el) (persona|encargad[oa]|responsable)",
        ),
        objection="No se contactó al decisor",
        outcome="Contacto con intermediario",
        conversation_status="waiting_decision_maker",
        next_step="Identificar al decisor, confirmar su nombre y acordar una fecha concreta para contactarlo.",
        weight=4,
    ),
    Signal(
        "timing",
        "El momento no es inmediato",
        (
            r"\b(mas adelante|despues|otro dia|la proxima semana|el proximo mes)\b",
            r"\b(ahora|hoy) no (puedo|podemos|es buen momento)",
            r"\b(escribeme|llamame|contactame) (manana|luego|despues)",
            r"\bcuando (tenga|tengamos) tiempo",
        ),
        objection="Momento / prioridad",
        outcome="Seguimiento solicitado",
        conversation_status="followup_scheduled",
        next_step="Programar el seguimiento en la fecha indicada y confirmar el compromiso antes de cerrar el hilo.",
        weight=2,
    ),
    Signal(
        "existing_solution",
        "Ya utiliza una solución o proveedor",
        (
            r"\bya (tenemos|uso|usamos|trabajamos con) (un|una|otro|otra)? ?(crm|agencia|proveedor|sistema|software|persona)",
            r"\bnos lo (maneja|lleva) (una|la|un|el)",
            r"\bestamos (contentos|bien) con",
        ),
        objection="Ya utiliza otra solución",
        outcome="Objeción identificada",
        conversation_status="conversation_active",
        next_step="Preguntar qué funciona, qué no funciona y cuándo revisan nuevamente la solución actual.",
        weight=3,
    ),
    Signal(
        "not_interested",
        "Negativa comercial",
        (
            r"\b(no me interesa|no nos interesa|no estamos interesados|no estoy interesad[oa])\b",
            r"\b(no gracias|gracias pero no|prefiero que no)\b",
            r"\bno (quiero|queremos) (recibir|continuar|seguir)",
            r"\bpor favor no (llames|escribas|contactes)",
        ),
        objection="No interesado",
        outcome="No interesado",
        conversation_status="closed",
        next_step="Cerrar la oportunidad y respetar cualquier solicitud de no contacto.",
        weight=5,
    ),
    Signal(
        "wrong_contact",
        "Contacto o número incorrecto",
        (
            r"\bnumero (equivocado|incorrecto)\b",
            r"\bse (equivoco|confundio) de numero",
            r"\baqui no (es|trabaja|queda)",
            r"\bno conozco (esa|ese) (empresa|clinica|persona)",
        ),
        objection="Contacto incorrecto",
        outcome="Número incorrecto",
        conversation_status="closed",
        next_step="Corregir o enriquecer los datos del lead antes de realizar otro intento.",
        weight=5,
    ),
    Signal(
        "request_info",
        "Solicitó información",
        (
            r"\b(enviame|mandame|comparteme|pasa me|pasame) (la|mas|esa|algo de)? ?(informacion|info|propuesta|presentacion|precios|detalles)",
            r"\bpuedes (enviar|mandar|compartir)\b",
            r"\bquiero (ver|conocer|saber) mas\b",
            r"\bde que se trata\b",
        ),
        outcome="Solicitó información",
        conversation_status="conversation_active",
        next_step="Enviar información relevante y acordar explícitamente cuándo se retomará la conversación.",
        weight=3,
    ),
    Signal(
        "meeting",
        "Interés en reunión",
        (
            r"\b(agendemos|coordinemos|hagamos) (una|la)? ?(reunion|llamada|meet|demo)\b",
            r"\b(me|nos) (sirve|funciona|queda bien) (el|la|a las|a la)\b",
            r"\bpuedo (el|la) (lunes|martes|miercoles|jueves|viernes)\b",
            r"\bcuando (puedes|podemos) (hablar|reunirnos|verlo)\b",
        ),
        outcome="Reunión agendada",
        conversation_status="waiting_confirmation",
        next_step="Confirmar fecha, hora, asistentes y enviar el enlace de la reunión.",
        weight=5,
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
        next_step="Convertir el interés en un compromiso concreto: reunión, envío de información o fecha de decisión.",
        weight=4,
    ),
    Signal(
        "waiting_confirmation",
        "Esperando confirmación",
        (
            r"\b(te|le) (confirmo|avisamos|aviso)\b",
            r"\bdejame (revisar|validar|confirmar)\b",
            r"\b(consulto|reviso) y te (digo|aviso|confirmo)\b",
            r"\bpendiente de (confirmar|respuesta|aprobacion)\b",
        ),
        outcome="Esperando confirmación",
        conversation_status="waiting_confirmation",
        next_step="Definir una fecha límite de respuesta y programar el seguimiento.",
        weight=2,
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


def _suggest_followup(normalized: str, today: date) -> str | None:
    if re.search(r"\bmanana\b", normalized):
        return (today + timedelta(days=1)).isoformat()
    if re.search(r"\bpasado manana\b", normalized):
        return (today + timedelta(days=2)).isoformat()
    if re.search(r"\bproxima semana\b", normalized):
        return (today + timedelta(days=7)).isoformat()
    for name, weekday in DAY_NAMES.items():
        if re.search(rf"\b{name}\b", normalized):
            delta = (weekday - today.weekday()) % 7
            if delta == 0:
                delta = 7
            return (today + timedelta(days=delta)).isoformat()
    return None


def analyze_chat(transcript: str, *, channel: str | None = None, today: date | None = None) -> dict[str, Any]:
    original = transcript or ""
    normalized = _normalize(original)
    if len(normalized) < 3:
        return {
            "method": "local_semantic_rules_v1",
            "confidence": 0,
            "summary": "No hay suficiente texto para analizar.",
            "signals": [],
            "suggestion": {
                "activity_type": "response_received",
                "conversation_status": "response_received",
                "outcome_stage": "provisional",
                "outcome": "Respondió",
                "objection": "",
                "next_step": "",
                "followup_date": None,
                "is_final_outcome": False,
            },
            "warning": "Aura no modificará el lead hasta que confirmes o edites la sugerencia.",
        }

    matches: list[dict[str, Any]] = []
    for signal in SIGNALS:
        for pattern_text in signal.patterns:
            pattern = re.compile(pattern_text, re.IGNORECASE)
            if pattern.search(normalized):
                matches.append({
                    "key": signal.key,
                    "label": signal.label,
                    "weight": signal.weight,
                    "objection": signal.objection,
                    "outcome": signal.outcome,
                    "conversation_status": signal.conversation_status,
                    "next_step": signal.next_step,
                    "evidence": _excerpt(original, pattern),
                })
                break

    # Evitar que "envíame información" se trate como reunión o interés fuerte por sí sola.
    keys = {item["key"] for item in matches}
    priority = [
        "wrong_contact",
        "not_interested",
        "meeting",
        "positive_interest",
        "decision_maker",
        "budget",
        "existing_solution",
        "waiting_confirmation",
        "timing",
        "request_info",
    ]
    primary = next((next(item for item in matches if item["key"] == key) for key in priority if key in keys), None)

    if primary:
        outcome = primary.get("outcome") or "Respondió"
        conversation_status = primary.get("conversation_status") or "conversation_active"
        objection = primary.get("objection") or ""
        next_step = primary.get("next_step") or "Continuar la conversación y acordar un próximo paso concreto."
    else:
        outcome = "Respondió"
        conversation_status = "conversation_active"
        objection = ""
        next_step = "Responder, calificar la necesidad y acordar un próximo paso concreto."

    final = conversation_status == "closed" or outcome in {"No interesado", "Número incorrecto", "No califica", "Venta"}
    stage = "final" if final else "provisional"
    followup = _suggest_followup(normalized, today or date.today())
    total_weight = sum(int(item["weight"]) for item in matches)
    confidence = min(96, 48 + total_weight * 7 + min(12, len(normalized) // 80)) if matches else 42

    labels = [item["label"] for item in matches[:3]]
    summary = (
        "Aura detectó " + ", ".join(label.lower() for label in labels) + "."
        if labels
        else "Aura detectó una respuesta, pero no encontró una objeción o compromiso suficientemente explícito."
    )

    return {
        "method": "local_semantic_rules_v1",
        "confidence": confidence,
        "summary": summary,
        "signals": matches,
        "suggestion": {
            "activity_type": "response_received",
            "conversation_status": conversation_status,
            "outcome_stage": stage,
            "outcome": outcome,
            "objection": objection,
            "next_step": next_step,
            "followup_date": followup,
            "is_final_outcome": final,
            "awaiting_response": conversation_status in {"waiting_decision_maker", "waiting_confirmation", "followup_scheduled"},
            "channel": channel or "WhatsApp",
        },
        "warning": "Este análisis usa reglas semánticas locales y contexto lingüístico. Confirma o edita la sugerencia antes de guardarla.",
    }
