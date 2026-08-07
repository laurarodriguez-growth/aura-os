from __future__ import annotations

import logging
import math
import re
import unicodedata
from datetime import date, datetime, timedelta, timezone
from difflib import SequenceMatcher
from typing import Annotated, Any
from zoneinfo import ZoneInfo

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .auditor import audit_website
from .auth import CurrentUser, get_current_user, require_admin, user_feature_enabled
from .chat_analysis import analyze_chat
from .config import get_settings
from .db import get_supabase
from .diagnose import router as diagnose_router
from .diagnose_definitive import router as diagnose_definitive_router
from .exports import CALL_EXPORT_FIELDS, LEAD_EXPORT_FIELDS, consolidated_rows, csv_response
from .google_places import (
    autocomplete_places, build_queries, is_hard_excluded, place_details, place_to_lead, search_text,
)
from .outcomes import (
    derive_outcome_stage, get_outcome_definition, router as outcomes_router,
    suggested_followup_date,
)
from .models import (
    AdminUserCreate, AdminUserDelete, AdminUserUpdate, CallLogCreate, ChatAnalysisRequest,
    DuplicateLeadMergeRequest, FocusAssignmentRequest, LeadUpdate, ScoringTemplateCreate, SearchJobCreate,
)
from .scoring import (
    SCORING_CATALOG,
    calculate_configured_score,
    get_scoring_preset,
    normalize_manual_scores,
)
from .version import APP_VERSION

settings = get_settings()
logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO))
logger = logging.getLogger("aura-grow")

app = FastAPI(
    title=settings.app_name,
    version=APP_VERSION,
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
    openapi_url=None if settings.is_production else "/openapi.json",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

app.include_router(diagnose_definitive_router)
app.include_router(diagnose_router)
app.include_router(outcomes_router)


STATUSES = [
    "Nuevo", "Investigando", "Listo para contactar", "Contactado", "Seguimiento 1", "Seguimiento 2",
    "Respondió", "Interesado", "Reunión agendada", "Propuesta enviada", "Diagnóstico vendido",
    "Implementación vendida", "No interesado", "No califica", "Descartado",
]

PENDING_STATUSES = ["Nuevo", "Investigando", "Listo para contactar"]
CLOSED_STATUSES = ["Descartado", "No interesado", "No califica", "Implementación vendida"]
LEAD_CAPACITY_MAX = 100
LEAD_GENERATION_UNLOCK_AT = 50
CALL_LOG_PAGE_SIZES = [25, 50, 100]
CONVERSATION_STATUSES = [
    "not_started", "waiting_response", "response_received", "conversation_active",
    "waiting_decision_maker", "waiting_confirmation", "followup_scheduled", "closed",
]
OUTCOME_STAGES = ["pending", "provisional", "final"]
ACTIVE_CONVERSATION_STATUSES = {
    "response_received", "conversation_active", "waiting_decision_maker", "waiting_confirmation",
}
FOCUS_CLOSED_STATUSES = ["Descartado", "No interesado", "No califica", "Implementación vendida"]
PANAMA_TZ = ZoneInfo("America/Panama")
COUNTRIES = {
    "PA": {"code": "PA", "name": "Panamá", "timezone": "America/Panama"},
    "CL": {"code": "CL", "name": "Chile", "timezone": "America/Santiago"},
}
COUNTRY_DIAL_CODES = {"PA": "507", "CL": "56"}
GENERIC_BUSINESS_NAME_TOKENS = {
    "clinica", "clinic", "centro", "dental", "odontologico", "odontologica", "medico", "medica",
    "spa", "restaurant", "restaurante", "vina", "vinas", "eventos", "turismo", "the", "de", "del",
}

PIPELINE_STAGES = [
    {"key": "new", "label": "Nuevos", "description": "Sin primer contacto"},
    {"key": "contacted", "label": "Contactados", "description": "Primer mensaje enviado"},
    {"key": "responded", "label": "Respondieron", "description": "Conversación abierta"},
    {"key": "interested", "label": "Interesados", "description": "Necesidad confirmada"},
    {"key": "meeting_booked", "label": "Reunión agendada", "description": "Llamada de 15 minutos"},
    {"key": "diagnosis_sold", "label": "Diagnóstico vendido", "description": "Diagnóstico Premium cerrado"},
    {"key": "proposal_sent", "label": "Propuesta enviada", "description": "Implementación presentada"},
    {"key": "implementation_sold", "label": "Implementación vendida", "description": "Cliente ganado"},
    {"key": "closed", "label": "Cerrados", "description": "No interesado, no califica o descartado"},
]


def panama_today() -> date:
    return datetime.now(PANAMA_TZ).date()


def _parse_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed
    except (TypeError, ValueError):
        return None


def _parse_date(value: Any) -> date | None:
    if not value:
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def _pipeline_stage(lead: dict[str, Any]) -> str:
    """Map the operational fields to Growth by Laura's real commercial journey."""
    status = str(lead.get("status") or "Nuevo")
    conversation_status = str(lead.get("conversation_status") or "not_started")

    # Won stages must be resolved before generic closed conversation states.
    if status == "Implementación vendida":
        return "implementation_sold"
    if status == "Diagnóstico vendido":
        return "diagnosis_sold"
    if status == "Propuesta enviada":
        return "proposal_sent"
    if status == "Reunión agendada":
        return "meeting_booked"
    if status == "Interesado":
        return "interested"
    if status in {"No interesado", "No califica", "Descartado"}:
        return "closed"
    if status == "Respondió" or conversation_status in ACTIVE_CONVERSATION_STATUSES:
        return "responded"
    if (
        status in {"Contactado", "Seguimiento 1", "Seguimiento 2"}
        or int(lead.get("contact_attempts") or 0) > 0
        or conversation_status in {"waiting_response", "followup_scheduled"}
    ):
        return "contacted"
    return "new"


def _response_due_state(value: Any, now_local: datetime) -> tuple[str, int]:
    due = _parse_datetime(value)
    if not due:
        return "none", 0
    due_local = due.astimezone(PANAMA_TZ)
    delta_seconds = int((now_local - due_local).total_seconds())
    if delta_seconds >= 0:
        return "overdue", max(0, delta_seconds // 3600)
    if due_local.date() == now_local.date():
        return "today", 0
    return "future", 0


def _focus_priority(lead: dict[str, Any], today: date) -> dict[str, Any] | None:
    if lead.get("archived") or lead.get("excluded_reason") or lead.get("do_not_contact"):
        return None
    if str(lead.get("status") or "") in FOCUS_CLOSED_STATUSES:
        return None

    now_local = datetime.now(PANAMA_TZ)
    followup = _parse_date(lead.get("next_followup_date"))
    last_contact = _parse_datetime(lead.get("last_contact_date"))
    last_contact_local = last_contact.astimezone(PANAMA_TZ).date() if last_contact else None
    contacted_today = last_contact_local == today
    due_state = "none"
    days_overdue = 0
    if followup:
        if followup < today:
            due_state = "overdue"
            days_overdue = (today - followup).days
        elif followup == today:
            due_state = "today"
        elif followup <= today + timedelta(days=3):
            due_state = "soon"
        else:
            due_state = "future"

    conversation_status = str(lead.get("conversation_status") or "not_started")
    response_due_state, response_overdue_hours = _response_due_state(lead.get("response_due_at"), now_local)
    status = str(lead.get("status") or "Nuevo")
    status_points = {
        "Nuevo": 10,
        "Investigando": 9,
        "Listo para contactar": 16,
        "Contactado": 12,
        "Seguimiento 1": 20,
        "Seguimiento 2": 25,
        "Respondió": 32,
        "Interesado": 42,
        "Reunión agendada": 22,
        "Propuesta enviada": 36,
        "Diagnóstico vendido": 24,
    }.get(status, 8)
    score = status_points
    reasons: list[str] = []

    conversation_points = {
        "response_received": 60,
        "conversation_active": 48,
        "waiting_confirmation": 40,
        "waiting_decision_maker": 34,
        "followup_scheduled": 22,
        "waiting_response": -18 if response_due_state not in {"overdue", "today"} else 20,
        "not_started": 4,
    }.get(conversation_status, 0)
    score += conversation_points
    conversation_labels = {
        "response_received": "El lead respondió: atender ahora",
        "conversation_active": "Conversación activa",
        "waiting_confirmation": "Esperando confirmación",
        "waiting_decision_maker": "Pendiente del decisor",
        "followup_scheduled": "Seguimiento acordado",
        "waiting_response": "Esperando respuesta",
    }
    if conversation_status in conversation_labels:
        reasons.append(conversation_labels[conversation_status])

    if response_due_state == "overdue" and conversation_status == "waiting_response":
        score += 35 + min(12, response_overdue_hours // 4)
        reasons.append("Ya venció el tiempo de espera")
    elif response_due_state == "today" and conversation_status == "waiting_response":
        score += 16
        reasons.append("La respuesta se espera hoy")

    if due_state == "overdue":
        score += 45 + min(days_overdue, 10)
        reasons.append(f"Seguimiento vencido hace {days_overdue} día{'s' if days_overdue != 1 else ''}")
    elif due_state == "today":
        score += 40
        reasons.append("Seguimiento programado para hoy")
    elif due_state == "soon":
        score += 14
        reasons.append("Seguimiento próximo")

    tier = str(lead.get("final_tier") or "Descartar")
    tier_points = {"A": 20, "B": 12, "C": 5}.get(tier, 0)
    score += tier_points
    if tier_points:
        reasons.append(f"Lead Tier {tier}")

    attempts = int(lead.get("contact_attempts") or 0)
    if attempts == 0:
        score += 12
        reasons.append("Aún no ha sido contactado")
    elif attempts <= 2:
        score += 5
    elif attempts >= 5:
        score -= min(18, (attempts - 4) * 4)
        reasons.append(f"Ya tiene {attempts} intentos")

    outcome = str(lead.get("outcome") or "")
    outcome_points = {
        "Solicitó información": 22,
        "Interesado": 28,
        "Respondió": 18,
        "Contacto con intermediario": 12,
        "Esperando confirmación": 18,
        "Seguimiento solicitado": 14,
        "Recepción": 6,
        "Seguimiento": 14,
        "Reunión agendada": 20,
        "No respondió": 4,
        "Buzón de voz": 2,
    }.get(outcome, 0)
    configured_outcome_adjustment = lead.get("outcome_priority_adjustment")
    if configured_outcome_adjustment is None:
        configured_outcome_adjustment = outcome_points
    score += int(configured_outcome_adjustment or 0)
    if int(configured_outcome_adjustment or 0) >= 14:
        reasons.append(f"Último resultado: {outcome}")

    if last_contact_local:
        inactive_days = max(0, (today - last_contact_local).days)
        if inactive_days >= 3 and conversation_status != "waiting_response":
            freshness = min(12, inactive_days)
            score += freshness
            reasons.append(f"Sin actividad hace {inactive_days} días")

    has_phone = bool(lead.get("phone"))
    has_whatsapp = bool(lead.get("whatsapp_url") or lead.get("whatsapp_phone"))
    if has_phone and has_whatsapp:
        score += 5
    elif has_phone or has_whatsapp:
        score += 2

    if conversation_status == "response_received":
        action = "Responder al lead ahora"
        channel = "WhatsApp" if has_whatsapp else "Llamada"
    elif conversation_status == "conversation_active":
        action = "Continuar la conversación"
        channel = "WhatsApp" if has_whatsapp else "Llamada"
    elif conversation_status == "waiting_decision_maker":
        action = "Contactar o confirmar al decisor"
        channel = "Llamada" if has_phone else "WhatsApp"
    elif conversation_status == "waiting_confirmation":
        action = "Confirmar el próximo paso"
        channel = "WhatsApp" if has_whatsapp else "Llamada"
    elif conversation_status == "waiting_response":
        if response_due_state in {"overdue", "today"} or due_state in {"overdue", "today"}:
            action = "Dar seguimiento por falta de respuesta"
            channel = "WhatsApp" if has_whatsapp else "Llamada"
        else:
            action = "Esperar respuesta"
            channel = "WhatsApp" if has_whatsapp else "Llamada"
    elif status in {"Interesado", "Respondió"}:
        action = "Agendar o confirmar reunión" if status == "Interesado" else "Dar seguimiento inmediato"
        channel = "WhatsApp" if has_whatsapp else "Llamada"
    elif status == "Propuesta enviada":
        action = "Dar seguimiento a la propuesta"
        channel = "WhatsApp" if has_whatsapp else "Llamada"
    elif due_state in {"overdue", "today"}:
        action = "Completar seguimiento"
        channel = "WhatsApp" if has_whatsapp and outcome in {"No respondió", "Buzón de voz", "Solicitó información"} else "Llamada"
    elif attempts == 0:
        action = "Realizar primer contacto"
        channel = "Llamada" if has_phone else "WhatsApp"
    else:
        action = "Dar seguimiento al lead"
        channel = "WhatsApp" if has_whatsapp else "Llamada"

    level = "Alta" if score >= 80 else "Media" if score >= 50 else "Normal"
    return {
        **lead,
        "priority_score": max(0, score),
        "priority_level": level,
        "priority_reasons": reasons[:5],
        "recommended_action": action,
        "recommended_channel": channel,
        "due_state": due_state,
        "days_overdue": days_overdue,
        "response_due_state": response_due_state,
        "response_overdue_hours": response_overdue_hours,
        "contacted_today": contacted_today,
    }


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _first(response: Any) -> dict[str, Any] | None:
    return (response.data or [None])[0]


def _missing_column_from_error(exc: Exception, table: str) -> str | None:
    message = str(exc)
    patterns = (
        rf"Could not find the ['\"](?P<column>[A-Za-z0-9_]+)['\"] column of ['\"]{re.escape(table)}['\"]",
        rf"column ['\"](?P<column>[A-Za-z0-9_]+)['\"] of relation ['\"]{re.escape(table)}['\"] does not exist",
        rf"column {re.escape(table)}\.(?P<column>[A-Za-z0-9_]+) does not exist",
    )
    for pattern in patterns:
        match = re.search(pattern, message, flags=re.IGNORECASE)
        if match:
            return match.group("column")
    return None


def _insert_row_compatible(
    db: Any,
    table: str,
    row: dict[str, Any],
    *,
    protected_columns: set[str] | None = None,
) -> tuple[Any, dict[str, Any], list[str]]:
    # Retry without only the optional column PostgREST reports as absent.
    current = dict(row)
    protected = protected_columns or set()
    removed: list[str] = []
    for _ in range(len(current) + 1):
        try:
            return db.table(table).insert(current).execute(), current, removed
        except Exception as exc:
            missing = _missing_column_from_error(exc, table)
            if not missing or missing not in current or missing in protected:
                raise
            removed.append(missing)
            current.pop(missing, None)
            logger.warning("Columna opcional ausente en %s: %s. Reintentando guardado.", table, missing)
    raise RuntimeError(f"No se pudo insertar en {table} después de ajustar el esquema")


def _update_row_compatible(
    db: Any,
    table: str,
    row: dict[str, Any],
    match_column: str,
    match_value: Any,
) -> tuple[Any | None, dict[str, Any], list[str]]:
    current = dict(row)
    removed: list[str] = []
    for _ in range(len(current) + 1):
        if not current:
            return None, current, removed
        try:
            response = db.table(table).update(current).eq(match_column, match_value).execute()
            return response, current, removed
        except Exception as exc:
            missing = _missing_column_from_error(exc, table)
            if not missing or missing not in current:
                raise
            removed.append(missing)
            current.pop(missing, None)
            logger.warning("Columna opcional ausente en %s: %s. Reintentando actualización.", table, missing)
    raise RuntimeError(f"No se pudo actualizar {table} después de ajustar el esquema")


def _fetch_all(table: str, columns: str = "*", filters: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    db = get_supabase()
    rows: list[dict[str, Any]] = []
    start = 0
    page_size = 1000
    while True:
        query = db.table(table).select(columns).range(start, start + page_size - 1)
        for key, value in (filters or {}).items():
            query = query.eq(key, value)
        response = query.execute()
        batch = response.data or []
        rows.extend(batch)
        if len(batch) < page_size:
            break
        start += page_size
    return rows


def _count(builder: Any) -> int:
    response = builder.execute()
    return int(response.count or 0)


def _profile_map() -> dict[str, str]:
    profiles = _fetch_all("profiles", "id,full_name")
    return {str(item["id"]): item.get("full_name") or "Usuario" for item in profiles}


def _normalized_country(value: str | None, fallback: str = "PA") -> str:
    code = str(value or fallback).strip().upper()
    return code if re.fullmatch(r"[A-Z]{2}|ALL", code) else fallback


def _distance_km(lat_a: float, lon_a: float, lat_b: float, lon_b: float) -> float:
    radius = 6371.0088
    phi_a, phi_b = math.radians(lat_a), math.radians(lat_b)
    delta_phi = math.radians(lat_b - lat_a)
    delta_lambda = math.radians(lon_b - lon_a)
    haversine = math.sin(delta_phi / 2) ** 2 + math.cos(phi_a) * math.cos(phi_b) * math.sin(delta_lambda / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(haversine))


def _normalized_business_name(value: str | None) -> str:
    decomposed = unicodedata.normalize("NFKD", str(value or "").lower())
    ascii_name = "".join(char for char in decomposed if not unicodedata.combining(char))
    tokens = re.findall(r"[a-z0-9]+", ascii_name)
    meaningful = [token for token in tokens if token not in GENERIC_BUSINESS_NAME_TOKENS]
    return " ".join(meaningful or tokens)


def _business_name_similarity(first: str | None, second: str | None) -> float:
    normalized_first = _normalized_business_name(first)
    normalized_second = _normalized_business_name(second)
    if not normalized_first or not normalized_second:
        return 0.0
    if normalized_first == normalized_second:
        return 1.0
    return SequenceMatcher(None, normalized_first, normalized_second).ratio()


def _normalize_whatsapp_phone(value: str | None, country_code: str | None) -> tuple[str | None, str | None]:
    raw = str(value or "").strip()
    if not raw:
        return None, None
    digits = re.sub(r"\D", "", raw)
    if digits.startswith("00"):
        digits = digits[2:]
    country = _normalized_country(country_code)
    dial_code = COUNTRY_DIAL_CODES.get(country)
    if dial_code and raw[0] != "+" and not digits.startswith(dial_code):
        expected_local_lengths = {"PA": {7, 8}, "CL": {9}}
        if len(digits) in expected_local_lengths.get(country, set()):
            digits = f"{dial_code}{digits}"
    if len(digits) < 8 or len(digits) > 15:
        raise HTTPException(
            status_code=422,
            detail="Ingresa un WhatsApp válido con código de país, por ejemplo +507 o +56.",
        )
    return f"+{digits}", f"https://wa.me/{digits}"


def _assert_country_access(user: CurrentUser, country_code: str | None) -> None:
    lead_country = _normalized_country(country_code)
    allowed = _normalized_country(user.operating_country, "ALL" if user.role == "admin" else "PA")
    if user.role != "admin" and allowed != "ALL" and lead_country != allowed:
        raise HTTPException(
            status_code=403,
            detail="Este lead pertenece a otra operación y no está disponible para tu equipo.",
        )


def _is_fresh_new_lead(lead: dict[str, Any]) -> bool:
    return (
        not lead.get("archived")
        and not lead.get("excluded_reason")
        and not lead.get("do_not_contact")
        and str(lead.get("status") or "") == "Nuevo"
        and int(lead.get("contact_attempts") or 0) == 0
        and str(lead.get("conversation_status") or "not_started") == "not_started"
    )


def _assert_lead_work_access(lead: dict[str, Any], user: CurrentUser) -> None:
    _assert_country_access(user, lead.get("country_code"))
    owner_id = str(lead.get("owner_id") or "")
    if not owner_id:
        raise HTTPException(
            status_code=409,
            detail="Este lead está sin asignar. Debe repartirse antes de registrar una acción.",
        )
    if owner_id != user.id:
        owner_name = _profile_map().get(owner_id, "otro setter")
        raise HTTPException(
            status_code=409,
            detail=f"Este lead está asignado a {owner_name}. Reasígnalo antes de trabajarlo.",
        )


def _base_lead_count_query(country_code: str | None = None) -> Any:
    query = (
        get_supabase().table("leads")
        .select("id", count="exact")
        .eq("archived", False)
        .is_("excluded_reason", "null")
    )
    if country_code:
        query = query.eq("country_code", _normalized_country(country_code))
    return query


def _pending_lead_count(country_code: str | None = None) -> int:
    return _count(
        _base_lead_count_query(country_code)
        .in_("status", PENDING_STATUSES)
        .eq("do_not_contact", False)
    )


def _lead_capacity_snapshot(country_code: str | None = None) -> dict[str, Any]:
    country = _normalized_country(country_code) if country_code else None
    pending = _pending_lead_count(country)
    available = max(0, LEAD_CAPACITY_MAX - pending)
    enabled = pending <= LEAD_GENERATION_UNLOCK_AT and available > 0
    return {
        "pending_leads": pending,
        "capacity_max": LEAD_CAPACITY_MAX,
        "unlock_at": LEAD_GENERATION_UNLOCK_AT,
        "available_slots": available,
        "generation_enabled": enabled,
        "max_new_leads": available if enabled else 0,
        "message": (
            f"Puedes generar hasta {available} leads nuevos."
            if enabled
            else f"Tienes {pending} leads pendientes. Trabaja la base hasta dejarla en {LEAD_GENERATION_UNLOCK_AT} o menos."
        ),
        "country_code": country,
    }


def _safe_search_term(value: str | None) -> str:
    if not value:
        return ""
    allowed = []
    for char in value.strip():
        if char.isalnum() or char in " áéíóúÁÉÍÓÚñÑ@._+-":
            allowed.append(char)
    return "".join(allowed).strip()[:160]


def _call_log_query(
    *,
    search: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    channel: str | None = None,
    outcome: str | None = None,
    conversation_status: str | None = None,
    outcome_stage: str | None = None,
    agent_id: str | None = None,
    count: str | None = None,
) -> Any:
    db = get_supabase()
    query = db.table("call_log_enriched").select("*", count=count)
    safe = _safe_search_term(search)
    if safe:
        pattern = f"*{safe}*"
        query = query.or_(
            ",".join(
                [
                    f"business_name.ilike.{pattern}",
                    f"agent_name.ilike.{pattern}",
                    f"contact_name.ilike.{pattern}",
                    f"contact_title.ilike.{pattern}",
                    f"notes.ilike.{pattern}",
                    f"objection.ilike.{pattern}",
                    f"outcome.ilike.{pattern}",
                    f"conversation_status.ilike.{pattern}",
                    f"outcome_stage.ilike.{pattern}",
                    f"activity_type.ilike.{pattern}",
                    f"transcript.ilike.{pattern}",
                    f"next_step.ilike.{pattern}",
                    f"channel.ilike.{pattern}",
                ]
            )
        )
    if date_from:
        query = query.gte("occurred_at", f"{date_from.isoformat()}T00:00:00Z")
    if date_to:
        query = query.lte("occurred_at", f"{date_to.isoformat()}T23:59:59.999999Z")
    if channel:
        query = query.eq("channel", channel)
    if outcome:
        query = query.eq("outcome", outcome)
    if conversation_status:
        query = query.eq("conversation_status", conversation_status)
    if outcome_stage:
        query = query.eq("outcome_stage", outcome_stage)
    if agent_id:
        query = query.eq("agent_id", agent_id)
    return query


def _fetch_filtered_call_logs(
    *,
    search: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    channel: str | None = None,
    outcome: str | None = None,
    conversation_status: str | None = None,
    outcome_stage: str | None = None,
    agent_id: str | None = None,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    start = 0
    page_size = 1000
    while True:
        response = (
            _call_log_query(
                search=search,
                date_from=date_from,
                date_to=date_to,
                channel=channel,
                outcome=outcome,
                conversation_status=conversation_status,
                outcome_stage=outcome_stage,
                agent_id=agent_id,
            )
            .order("occurred_at", desc=True)
            .range(start, start + page_size - 1)
            .execute()
        )
        batch = response.data or []
        rows.extend(batch)
        if len(batch) < page_size:
            break
        start += page_size
    return rows


def _job_scoring(job: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    preset = get_scoring_preset(str(job.get("niche") or "Dental"))
    rules = job.get("scoring_rules") or preset["rules"]
    thresholds = job.get("scoring_thresholds") or preset["thresholds"]
    return list(rules), dict(thresholds)


def _log_activity(lead_id: str, user_id: str, event_type: str, description: str, metadata: dict[str, Any] | None = None) -> None:
    try:
        get_supabase().table("activities").insert(
            {
                "lead_id": lead_id,
                "user_id": user_id,
                "event_type": event_type,
                "description": description,
                "metadata": metadata or {},
            }
        ).execute()
    except Exception:
        logger.exception("No se pudo registrar actividad")




def _model_value(value: Any, key: str, default: Any = None) -> Any:
    if isinstance(value, dict):
        return value.get(key, default)
    return getattr(value, key, default)


def _iso_value(value: Any) -> str | None:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _auth_user_from_response(response: Any) -> Any:
    user_obj = _model_value(response, "user")
    if user_obj is not None:
        return user_obj
    data = _model_value(response, "data")
    if data is not None:
        nested = _model_value(data, "user")
        return nested or data
    return response


def _list_auth_users() -> list[Any]:
    response = get_supabase().auth.admin.list_users(page=1, per_page=1000)
    if isinstance(response, list):
        return response
    users = _model_value(response, "users")
    if users is not None:
        return list(users)
    data = _model_value(response, "data")
    if isinstance(data, dict):
        return list(data.get("users") or [])
    return []


def _is_auth_user_banned(auth_user: Any) -> bool:
    banned_until = _parse_datetime(_model_value(auth_user, "banned_until"))
    return bool(banned_until and banned_until > datetime.now(timezone.utc))


def _user_activity_counts(user_id: str) -> dict[str, int]:
    db = get_supabase()
    calls = _count(db.table("call_logs").select("id", count="exact").eq("agent_id", user_id).limit(1))
    assigned = _count(db.table("leads").select("id", count="exact").eq("owner_id", user_id).limit(1))
    searches = _count(db.table("search_jobs").select("id", count="exact").eq("created_by", user_id).limit(1))
    return {"call_logs": calls, "assigned_leads": assigned, "search_jobs": searches}


def _active_admin_count() -> int:
    rows = (
        get_supabase().table("profiles")
        .select("id", count="exact")
        .eq("role", "admin")
        .eq("is_active", True)
        .execute()
    )
    return int(rows.count or 0)


def _feature_access_map(feature_key: str) -> dict[str, bool]:
    try:
        rows = (
            get_supabase().table("user_feature_access")
            .select("user_id,enabled")
            .eq("feature_key", feature_key)
            .execute()
            .data or []
        )
    except Exception:
        return {}
    return {str(row.get("user_id")): bool(row.get("enabled")) for row in rows}


def _set_user_feature(user_id: str, feature_key: str, enabled: bool, granted_by: str) -> None:
    now = utcnow_iso()
    get_supabase().table("user_feature_access").upsert({
        "user_id": user_id,
        "feature_key": feature_key,
        "enabled": bool(enabled),
        "granted_by": granted_by if enabled else None,
        "granted_at": now if enabled else None,
        "updated_at": now,
    }, on_conflict="user_id,feature_key").execute()


def _admin_user_rows() -> list[dict[str, Any]]:
    profile_rows = _fetch_all("profiles", "id,full_name,role,is_active,operating_country,created_at,updated_at")
    profile_map = {str(row["id"]): row for row in profile_rows}
    diagnose_access = _feature_access_map("diagnose")
    items: list[dict[str, Any]] = []
    for auth_user in _list_auth_users():
        user_id = str(_model_value(auth_user, "id") or "")
        if not user_id:
            continue
        profile = profile_map.get(user_id, {})
        banned = _is_auth_user_banned(auth_user)
        active = bool(profile.get("is_active", True)) and not banned
        activity = _user_activity_counts(user_id)
        items.append({
            "id": user_id,
            "email": _model_value(auth_user, "email") or "",
            "full_name": profile.get("full_name") or _model_value(_model_value(auth_user, "user_metadata", {}), "full_name") or "Usuario",
            "role": profile.get("role") or "agent",
            "operating_country": _normalized_country(profile.get("operating_country"), "ALL" if profile.get("role") == "admin" else "PA"),
            "is_active": active,
            "banned_until": _iso_value(_model_value(auth_user, "banned_until")),
            "last_sign_in_at": _iso_value(_model_value(auth_user, "last_sign_in_at")),
            "created_at": _iso_value(_model_value(auth_user, "created_at")) or profile.get("created_at"),
            "call_logs": activity["call_logs"],
            "assigned_leads": activity["assigned_leads"],
            "search_jobs": activity["search_jobs"],
            "can_delete": sum(activity.values()) == 0,
            "diagnose_enabled": diagnose_access.get(user_id, False),
        })
    return sorted(items, key=lambda item: (not item["is_active"], item["full_name"].lower()))

@app.get("/health")
def health() -> dict[str, str | bool]:
    return {
        "status": "ok",
        "service": settings.app_name,
        "version": APP_VERSION,
        "outcome_library": True,
        "chat_txt_import": True,
        "sales_guidance": True,
    }


def _readiness_payload() -> dict[str, str | bool]:
    try:
        # The response is discarded; readiness only proves that Supabase answers.
        get_supabase().table("profiles").select("id").limit(1).execute()
    except Exception as exc:
        logger.warning("Supabase readiness check failed: %s", type(exc).__name__)
        raise HTTPException(status_code=503, detail="Dependencia de datos no disponible") from exc
    return {
        "status": "ready",
        "version": APP_VERSION,
        "outcome_library": True,
        "chat_analysis": True,
        "chat_txt_import": True,
        "sales_guidance": True,
    }


@app.get("/ready")
def readiness() -> dict[str, str | bool]:
    return _readiness_payload()


@app.get("/api/system/readiness")
def system_readiness() -> dict[str, str | bool]:
    return _readiness_payload()


@app.get("/api/me")
def me(user: Annotated[CurrentUser, Depends(get_current_user)]) -> dict[str, Any]:
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
        "operating_country": user.operating_country,
        "features": {"diagnose": user_feature_enabled(user.id, "diagnose")},
    }


@app.get("/api/profiles")
def profiles(user: Annotated[CurrentUser, Depends(get_current_user)]) -> list[dict[str, Any]]:
    response = (
        get_supabase().table("profiles")
        .select("id,full_name,role,is_active,operating_country")
        .eq("is_active", True)
        .order("full_name")
        .execute()
    )
    return response.data or []


@app.get("/api/admin/users")
def admin_list_users(user: Annotated[CurrentUser, Depends(require_admin)]) -> list[dict[str, Any]]:
    return _admin_user_rows()


@app.post("/api/admin/users", status_code=201)
def admin_create_user(
    payload: AdminUserCreate,
    user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    email = payload.email.strip().lower()
    if "@" not in email:
        raise HTTPException(status_code=422, detail="Escribe un correo válido")

    db = get_supabase()
    created_id: str | None = None
    try:
        response = db.auth.admin.create_user({
            "email": email,
            "password": payload.password,
            "email_confirm": True,
            "user_metadata": {"full_name": payload.full_name.strip()},
        })
        created = _auth_user_from_response(response)
        created_id = str(_model_value(created, "id") or "")
        if not created_id:
            raise RuntimeError("Supabase no devolvió el ID del usuario")
        db.table("profiles").upsert({
            "id": created_id,
            "full_name": payload.full_name.strip(),
            "role": payload.role,
            "operating_country": _normalized_country(payload.operating_country, "ALL" if payload.role == "admin" else "PA"),
            "is_active": True,
            "updated_at": utcnow_iso(),
        }).execute()
        _set_user_feature(created_id, "diagnose", payload.diagnose_enabled, user.id)
    except Exception as exc:
        if created_id:
            try:
                db.auth.admin.delete_user(created_id)
            except Exception:
                logger.exception("No se pudo limpiar el usuario incompleto %s", created_id)
        message = str(exc)
        if "already" in message.lower() or "registered" in message.lower():
            raise HTTPException(status_code=409, detail="Ya existe un usuario con ese correo") from exc
        raise HTTPException(status_code=400, detail=f"No se pudo crear el usuario: {message}") from exc

    return next((item for item in _admin_user_rows() if item["id"] == created_id), {"id": created_id})


@app.patch("/api/admin/users/{target_user_id}")
def admin_update_user(
    target_user_id: str,
    payload: AdminUserUpdate,
    user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    db = get_supabase()
    profile_response = db.table("profiles").select("id,role,is_active,operating_country").eq("id", target_user_id).limit(1).execute()
    target = _first(profile_response)
    if not target:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    values = payload.model_dump(exclude_none=True)
    diagnose_enabled = values.pop("diagnose_enabled", None)
    next_role = values.get("role")
    if target_user_id == user.id and next_role and next_role != "admin":
        raise HTTPException(status_code=400, detail="No puedes quitarte tu propio rol de administradora")
    if target.get("role") == "admin" and next_role and next_role != "admin" and _active_admin_count() <= 1:
        raise HTTPException(status_code=400, detail="Aura Grow debe conservar al menos una administradora activa")

    profile_update: dict[str, Any] = {"updated_at": utcnow_iso()}
    if "full_name" in values:
        profile_update["full_name"] = values["full_name"].strip()
    if "role" in values:
        profile_update["role"] = values["role"]
    if "operating_country" in values:
        profile_update["operating_country"] = _normalized_country(values["operating_country"])
    if len(profile_update) > 1:
        db.table("profiles").update(profile_update).eq("id", target_user_id).execute()

    password = values.get("password")
    if password:
        try:
            db.auth.admin.update_user_by_id(target_user_id, {"password": password})
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"No se pudo actualizar la contraseña: {exc}") from exc

    if diagnose_enabled is not None:
        _set_user_feature(target_user_id, "diagnose", diagnose_enabled, user.id)

    return next((item for item in _admin_user_rows() if item["id"] == target_user_id), {"id": target_user_id})


@app.post("/api/admin/users/{target_user_id}/deactivate")
def admin_deactivate_user(
    target_user_id: str,
    user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    if target_user_id == user.id:
        raise HTTPException(status_code=400, detail="No puedes desactivar tu propia cuenta")
    db = get_supabase()
    target = _first(db.table("profiles").select("id,role,is_active").eq("id", target_user_id).limit(1).execute())
    if not target:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    if target.get("role") == "admin" and target.get("is_active") is not False and _active_admin_count() <= 1:
        raise HTTPException(status_code=400, detail="Aura Grow debe conservar al menos una administradora activa")
    try:
        db.auth.admin.update_user_by_id(target_user_id, {"ban_duration": "876000h"})
        db.table("profiles").update({"is_active": False, "updated_at": utcnow_iso()}).eq("id", target_user_id).execute()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"No se pudo desactivar el acceso: {exc}") from exc
    return {"ok": True, "is_active": False}


@app.post("/api/admin/users/{target_user_id}/reactivate")
def admin_reactivate_user(
    target_user_id: str,
    user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    db = get_supabase()
    target = _first(db.table("profiles").select("id").eq("id", target_user_id).limit(1).execute())
    if not target:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    try:
        db.auth.admin.update_user_by_id(target_user_id, {"ban_duration": "none"})
        db.table("profiles").update({"is_active": True, "updated_at": utcnow_iso()}).eq("id", target_user_id).execute()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"No se pudo reactivar el acceso: {exc}") from exc
    return {"ok": True, "is_active": True}


@app.delete("/api/admin/users/{target_user_id}")
def admin_delete_user(
    target_user_id: str,
    payload: AdminUserDelete,
    user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    if payload.confirmation.strip().upper() != "ELIMINAR":
        raise HTTPException(status_code=422, detail="Escribe ELIMINAR para confirmar")
    if target_user_id == user.id:
        raise HTTPException(status_code=400, detail="No puedes eliminar tu propia cuenta")

    db = get_supabase()
    target = _first(db.table("profiles").select("id,role,is_active").eq("id", target_user_id).limit(1).execute())
    if not target:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    if target.get("role") == "admin" and _active_admin_count() <= 1:
        raise HTTPException(status_code=400, detail="Aura Grow debe conservar al menos una administradora activa")

    activity = _user_activity_counts(target_user_id)
    if sum(activity.values()) > 0:
        raise HTTPException(
            status_code=409,
            detail=(
                "Este usuario ya tiene historial comercial. Desactívalo para conservar agentes, llamadas y métricas. "
                f"Actividad: {activity['call_logs']} contactos, {activity['assigned_leads']} leads asignados y {activity['search_jobs']} búsquedas."
            ),
        )
    try:
        db.auth.admin.delete_user(target_user_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"No se pudo eliminar el usuario: {exc}") from exc
    return {"ok": True}


@app.get("/api/config")
def public_config(user: Annotated[CurrentUser, Depends(get_current_user)]) -> dict[str, Any]:
    return {
        "statuses": STATUSES,
        "pending_statuses": PENDING_STATUSES,
        "max_api_budget_per_job": settings.max_api_budget_per_job,
        "google_cache_days": settings.google_cache_days,
        "website_cache_days": settings.website_cache_days,
        "lead_capacity_max": LEAD_CAPACITY_MAX,
        "lead_generation_unlock_at": LEAD_GENERATION_UNLOCK_AT,
        "call_log_page_sizes": CALL_LOG_PAGE_SIZES,
        "conversation_statuses": CONVERSATION_STATUSES,
        "outcome_stages": OUTCOME_STAGES,
        "countries": list(COUNTRIES.values()),
    }


@app.get("/api/lead-capacity")
def lead_capacity(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    country_code: str | None = Query(default=None, min_length=2, max_length=2),
) -> dict[str, Any]:
    selected = _normalized_country(country_code or (None if user.operating_country == "ALL" else user.operating_country)) if (country_code or user.operating_country != "ALL") else None
    if selected:
        _assert_country_access(user, selected)
    return _lead_capacity_snapshot(selected)


@app.get("/api/places/autocomplete")
def places_autocomplete(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    input: str = Query(min_length=2, max_length=120),
    country_code: str = Query(min_length=2, max_length=2),
    place_type: str = Query(default="zone", pattern="^(city|zone)$"),
    session_token: str = Query(min_length=8, max_length=120),
    latitude: float | None = Query(default=None, ge=-90, le=90),
    longitude: float | None = Query(default=None, ge=-180, le=180),
) -> dict[str, Any]:
    code = _normalized_country(country_code)
    _assert_country_access(user, code)
    try:
        suggestions = autocomplete_places(
            input_text=input.strip(), country_code=code, session_token=session_token,
            place_type=place_type, latitude=latitude, longitude=longitude,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"suggestions": suggestions, "attribution": "Google Maps"}


@app.get("/api/places/details/{place_id}")
def places_details(
    place_id: str,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session_token: str = Query(min_length=8, max_length=120),
    country_code: str = Query(min_length=2, max_length=2),
) -> dict[str, Any]:
    code = _normalized_country(country_code)
    _assert_country_access(user, code)
    try:
        details = place_details(place_id=place_id, session_token=session_token)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    if _normalized_country(details.get("country_code"), "") != code:
        raise HTTPException(status_code=422, detail="La ubicación no pertenece al país seleccionado")
    return details


@app.get("/api/scoring/catalog")
def scoring_catalog(user: Annotated[CurrentUser, Depends(get_current_user)]) -> dict[str, Any]:
    return {
        "catalog": SCORING_CATALOG,
        "operators": {
            "is_true": "Sí / detectado",
            "is_false": "No / no detectado",
            "gte": "Mayor o igual que",
            "lte": "Menor o igual que",
            "equals": "Igual a",
            "contains": "Contiene",
            "not_contains": "No contiene",
        },
    }


@app.get("/api/scoring/preset")
def scoring_preset(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    niche: str = Query(default="Dental"),
) -> dict[str, Any]:
    return get_scoring_preset(niche)


@app.get("/api/scoring/templates")
def list_scoring_templates(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    niche: str | None = None,
    country: str | None = None,
) -> list[dict[str, Any]]:
    query = get_supabase().table("scoring_templates").select("*").order("is_default", desc=True).order("updated_at", desc=True)
    if niche:
        query = query.eq("niche", niche)
    if country:
        query = query.eq("country", country)
    return query.execute().data or []


@app.post("/api/scoring/templates")
def save_scoring_template(
    payload: ScoringTemplateCreate,
    user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    db = get_supabase()
    if payload.is_default:
        db.table("scoring_templates").update({"is_default": False}).eq("niche", payload.niche).eq("country", payload.country).execute()
    row = {
        "created_by": user.id,
        "name": payload.name.strip(),
        "niche": payload.niche,
        "country": payload.country,
        "rules": [rule.model_dump(mode="json") for rule in payload.rules],
        "thresholds": payload.thresholds.model_dump(mode="json"),
        "is_default": payload.is_default,
        "updated_at": utcnow_iso(),
    }
    response = db.table("scoring_templates").upsert(row, on_conflict="created_by,name").execute()
    return _first(response) or row


@app.delete("/api/scoring/templates/{template_id}")
def delete_scoring_template(
    template_id: str,
    user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, bool]:
    get_supabase().table("scoring_templates").delete().eq("id", template_id).execute()
    return {"deleted": True}


@app.post("/api/search-jobs")
def create_search_job(
    payload: SearchJobCreate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> dict[str, Any]:
    country_code = _normalized_country(payload.country_code)
    _assert_country_access(user, country_code)
    country_name = payload.country_name.strip() or COUNTRIES.get(country_code, {}).get("name") or country_code
    capacity = _lead_capacity_snapshot(country_code)
    if not capacity["generation_enabled"]:
        raise HTTPException(status_code=409, detail=capacity["message"])

    effective_max_results = min(payload.max_results, int(capacity["max_new_leads"]))
    if effective_max_results < 1:
        raise HTTPException(status_code=409, detail="La base ya alcanzó su capacidad operativa de leads pendientes.")

    budget = min(payload.api_request_budget, settings.max_api_budget_per_job)
    base_city = payload.base_city.model_dump(mode="json") if payload.base_city else None
    target_locations = [item.model_dump(mode="json") for item in payload.target_locations]
    city_name = (base_city or {}).get("name") or payload.city.strip()
    zone_names = [item["formatted_address"] for item in target_locations] or payload.zones
    queries = build_queries(
        payload.niche,
        city_name,
        zone_names,
        payload.services,
        country_name=country_name,
        search_mode=payload.search_mode,
    )
    if not queries:
        raise HTTPException(status_code=400, detail="No se pudieron generar consultas")

    preset = get_scoring_preset(payload.niche)
    scoring_rules = [rule.model_dump(mode="json") for rule in payload.scoring_rules]
    scoring_thresholds = payload.scoring_thresholds.model_dump(mode="json")
    template_name = payload.scoring_template_name

    if user.role != "admin" and payload.scoring_mode == "manual":
        raise HTTPException(status_code=403, detail="Solo la administradora puede crear scoring manual")

    if payload.scoring_mode == "template":
        if not payload.scoring_template_id:
            raise HTTPException(status_code=400, detail="Selecciona una plantilla de scoring")
        template = _first(
            get_supabase().table("scoring_templates").select("*").eq("id", payload.scoring_template_id).limit(1).execute()
        )
        if not template:
            raise HTTPException(status_code=404, detail="Plantilla de scoring no encontrada")
        scoring_rules = template.get("rules") or []
        scoring_thresholds = template.get("thresholds") or preset["thresholds"]
        template_name = template.get("name")
    elif user.role != "admin":
        # Los setters generan con la configuración aprobada; el backend ignora reglas manipuladas desde el navegador.
        scoring_rules = preset["rules"]
        scoring_thresholds = preset["thresholds"]
        template_name = preset["name"]
    elif payload.scoring_mode == "automatic" and not scoring_rules:
        scoring_rules = preset["rules"]
        scoring_thresholds = preset["thresholds"]
        template_name = template_name or preset["name"]
    elif payload.scoring_mode == "manual" and not scoring_rules:
        raise HTTPException(status_code=400, detail="Agrega al menos una regla de scoring manual")

    row = {
        "created_by": user.id,
        "niche": payload.niche,
        "country_code": country_code,
        "country_name": country_name,
        "commercial_team": country_code,
        "base_city": base_city,
        "target_locations": target_locations,
        "search_mode": payload.search_mode,
        "radius_km": payload.radius_km,
        "city": city_name,
        "zones": [item["name"] for item in target_locations] or payload.zones,
        "services": payload.services,
        "max_results": effective_max_results,
        "pending_at_start": int(capacity["pending_leads"]),
        "new_leads_added": 0,
        "api_request_budget": budget,
        "scoring_mode": payload.scoring_mode,
        "scoring_template_id": payload.scoring_template_id,
        "scoring_template_name": template_name,
        "scoring_rules": scoring_rules,
        "scoring_thresholds": scoring_thresholds,
        "api_requests_used": 0,
        "status": "queued",
        "phase": "discovery",
        "queries": queries,
        "query_index": 0,
        "current_page_token": None,
        "audit_offset": 0,
        "total_discovered": 0,
        "total_audited": 0,
        "cache_hits_google": 0,
        "cache_hits_web": 0,
    }
    response = get_supabase().table("search_jobs").insert(row).execute()
    return _first(response) or row


@app.get("/api/search-jobs")
def list_search_jobs(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    limit: int = Query(default=20, ge=1, le=100),
) -> list[dict[str, Any]]:
    query = get_supabase().table("search_jobs").select("*").order("created_at", desc=True).limit(limit)
    if user.role != "admin":
        query = query.eq("created_by", user.id)
    return query.execute().data or []


@app.get("/api/search-jobs/{job_id}")
def get_search_job(job_id: str, user: Annotated[CurrentUser, Depends(get_current_user)]) -> dict[str, Any]:
    query = get_supabase().table("search_jobs").select("*").eq("id", job_id).limit(1)
    if user.role != "admin":
        query = query.eq("created_by", user.id)
    job = _first(query.execute())
    if not job:
        raise HTTPException(status_code=404, detail="Búsqueda no encontrada")
    return job


def _job_result_count(job_id: str) -> int:
    builder = get_supabase().table("search_results").select("id", count="exact").eq("job_id", job_id).limit(1)
    return _count(builder)


def _upsert_discovered_place(
    job: dict[str, Any],
    place: dict[str, Any],
    query_text: str,
    from_cache: bool,
) -> tuple[str | None, bool]:
    db = get_supabase()
    place_id = place.get("id")
    if not place_id:
        return None, False

    existing = _first(db.table("leads").select("id").eq("place_id", place_id).limit(1).execute())
    lead_data = place_to_lead(place, job["niche"], query_text)
    expected_country = _normalized_country(job.get("country_code"))
    actual_country = _normalized_country(lead_data.get("country_code"), "")
    if actual_country != expected_country:
        return None, False
    if job.get("search_mode") == "radius" and job.get("radius_km"):
        center = job.get("base_city") or {}
        location = place.get("location") or {}
        if None in {center.get("latitude"), center.get("longitude"), location.get("latitude"), location.get("longitude")}:
            return None, False
        if _distance_km(
            float(center["latitude"]), float(center["longitude"]),
            float(location["latitude"]), float(location["longitude"]),
        ) > float(job["radius_km"]):
            return None, False
    exclusion = is_hard_excluded(place, job["niche"])
    is_new_pending = existing is None and not exclusion

    lead_data["excluded_reason"] = exclusion
    lead_data["country_code"] = expected_country
    lead_data["country_name"] = lead_data.pop("country", None) or job.get("country_name")
    lead_data["commercial_team"] = job.get("commercial_team") or expected_country
    matched_zone = next(
        (
            item for item in (job.get("target_locations") or [])
            if str(item.get("name") or "").lower() in query_text.lower()
            or str(item.get("formatted_address") or "").lower() in query_text.lower()
        ),
        None,
    )
    lead_data["zone"] = (matched_zone or {}).get("name")
    rules, thresholds = _job_scoring(job)
    lead_data.update(calculate_configured_score(lead_data, rules, thresholds))
    lead_data["scoring_mode"] = job.get("scoring_mode") or "automatic"
    lead_data["scoring_template_id"] = job.get("scoring_template_id")
    lead_data["scoring_template_name"] = job.get("scoring_template_name")
    lead_data["scoring_rules"] = rules
    lead_data["scoring_thresholds"] = thresholds
    lead_data["scoring_job_id"] = job.get("id")
    lead_data.update(normalize_manual_scores(lead_data, thresholds))

    # Solo se actualizan datos públicos y scoring. El trabajo comercial nunca se sobrescribe.
    db.table("leads").upsert(lead_data, on_conflict="place_id").execute()
    lead = _first(db.table("leads").select("id").eq("place_id", place_id).limit(1).execute())
    if not lead:
        return None, False
    lead_id = lead["id"]
    db.table("search_results").upsert(
        {
            "job_id": job["id"],
            "lead_id": lead_id,
            "query_text": query_text,
            "from_google_cache": from_cache,
            "is_new_lead": is_new_pending,
            "scoring_template_name": job.get("scoring_template_name"),
            "scoring_rules": rules,
            "scoring_thresholds": thresholds,
            "auto_score": lead_data.get("auto_score", 0),
            "auto_tier": lead_data.get("auto_tier", "Descartar"),
        },
        on_conflict="job_id,lead_id",
    ).execute()
    return lead_id, is_new_pending


@app.post("/api/search-jobs/{job_id}/step")
def step_search_job(
    job_id: str,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> dict[str, Any]:
    db = get_supabase()
    job = _first(db.table("search_jobs").select("*").eq("id", job_id).limit(1).execute())
    if not job:
        raise HTTPException(status_code=404, detail="Búsqueda no encontrada")
    if user.role != "admin" and job.get("created_by") != user.id:
        raise HTTPException(status_code=403, detail="Solo puedes procesar búsquedas creadas por tu usuario")
    if job.get("status") in {"completed", "failed", "cancelled"}:
        return job

    try:
        if job.get("status") == "queued":
            db.table("search_jobs").update({"status": "running", "started_at": utcnow_iso()}).eq("id", job_id).execute()
            job["status"] = "running"

        if job.get("phase") == "discovery":
            queries: list[str] = job.get("queries") or []
            query_index = int(job.get("query_index") or 0)
            total = _job_result_count(job_id)
            new_leads_added = int(job.get("new_leads_added") or 0)
            budget_used = int(job.get("api_requests_used") or 0)
            budget = int(job.get("api_request_budget") or 0)
            capacity_reached = _pending_lead_count(job.get("country_code")) >= LEAD_CAPACITY_MAX

            if capacity_reached or new_leads_added >= int(job.get("max_results") or 0) or query_index >= len(queries) or budget_used >= budget:
                updated = {
                    "phase": "audit",
                    "current_page_token": None,
                    "total_discovered": total,
                    "updated_at": utcnow_iso(),
                }
                db.table("search_jobs").update(updated).eq("id", job_id).execute()
                return get_search_job(job_id, user)

            query_text = queries[query_index]
            base_city = job.get("base_city") or {}
            response, from_cache = search_text(
                query=query_text,
                page_token=job.get("current_page_token"),
                country_code=_normalized_country(job.get("country_code")),
                latitude=base_city.get("latitude"),
                longitude=base_city.get("longitude"),
                radius_meters=(float(job.get("radius_km")) * 1000) if job.get("search_mode") == "radius" and job.get("radius_km") else None,
            )
            if not from_cache:
                budget_used += 1
            places = response.get("places") or []
            for place in places:
                if new_leads_added >= int(job["max_results"]):
                    break
                if _pending_lead_count(job.get("country_code")) >= LEAD_CAPACITY_MAX:
                    capacity_reached = True
                    break
                _, was_new_pending = _upsert_discovered_place(job, place, query_text, from_cache)
                if was_new_pending:
                    new_leads_added += 1

            total = _job_result_count(job_id)
            next_token = response.get("nextPageToken")
            if next_token and new_leads_added < int(job["max_results"]) and budget_used < budget:
                next_query_index = query_index
            else:
                next_query_index = query_index + 1
                next_token = None

            updated = {
                "query_index": next_query_index,
                "current_page_token": next_token,
                "api_requests_used": budget_used,
                "cache_hits_google": int(job.get("cache_hits_google") or 0) + (1 if from_cache else 0),
                "total_discovered": total,
                "new_leads_added": new_leads_added,
                "updated_at": utcnow_iso(),
            }
            if capacity_reached or new_leads_added >= int(job["max_results"]) or next_query_index >= len(queries) or budget_used >= budget:
                updated["phase"] = "audit"
                updated["current_page_token"] = None
            db.table("search_jobs").update(updated).eq("id", job_id).execute()
            return get_search_job(job_id, user)

        if job.get("phase") == "audit":
            offset = int(job.get("audit_offset") or 0)
            batch_size = max(1, settings.audit_batch_size)
            results = (
                db.table("search_results")
                .select("lead_id")
                .eq("job_id", job_id)
                .order("created_at")
                .range(offset, offset + batch_size - 1)
                .execute()
                .data
                or []
            )
            if not results:
                db.table("search_jobs").update(
                    {"status": "completed", "phase": "completed", "completed_at": utcnow_iso(), "updated_at": utcnow_iso()}
                ).eq("id", job_id).execute()
                return get_search_job(job_id, user)

            cache_hits = int(job.get("cache_hits_web") or 0)
            audited_count = 0
            for item in results:
                lead = _first(db.table("leads").select("*").eq("id", item["lead_id"]).limit(1).execute())
                if not lead:
                    audited_count += 1
                    continue
                update_data: dict[str, Any] = {}
                if lead.get("website") and not lead.get("excluded_reason"):
                    audit, from_cache = audit_website(lead["website"], lead["niche"])
                    if from_cache:
                        cache_hits += 1
                    update_data.update(audit)
                    # Do not erase a value Google or an earlier audit already found.
                    for field in ("email", "instagram_url", "whatsapp_url", "whatsapp_phone"):
                        if not update_data.get(field) and lead.get(field):
                            update_data[field] = lead[field]
                else:
                    update_data["website_status"] = "sin_web" if not lead.get("website") else "excluido"
                    update_data["pages_audited"] = []

                merged = dict(lead)
                merged.update(update_data)
                rules, thresholds = _job_scoring(job)
                score = calculate_configured_score(merged, rules, thresholds)
                existing_flags = list(update_data.get("quality_flags") or [])
                score["quality_flags"] = list(dict.fromkeys(existing_flags + list(score.get("quality_flags") or [])))
                update_data.update(score)
                update_data["scoring_mode"] = job.get("scoring_mode") or "automatic"
                update_data["scoring_template_id"] = job.get("scoring_template_id")
                update_data["scoring_template_name"] = job.get("scoring_template_name")
                update_data["scoring_rules"] = rules
                update_data["scoring_thresholds"] = thresholds
                update_data["scoring_job_id"] = job.get("id")
                update_data.update(normalize_manual_scores({**merged, **score, **update_data}, thresholds))
                update_data["last_web_audit_at"] = utcnow_iso()
                db.table("leads").update(update_data).eq("id", lead["id"]).execute()
                db.table("search_results").update({
                    "scoring_template_name": job.get("scoring_template_name"),
                    "scoring_rules": rules,
                    "scoring_thresholds": thresholds,
                    "auto_score": score.get("auto_score", 0),
                    "auto_tier": score.get("auto_tier", "Descartar"),
                }).eq("job_id", job_id).eq("lead_id", lead["id"]).execute()
                audited_count += 1

            new_offset = offset + len(results)
            total_results = _job_result_count(job_id)
            updated_job = {
                "audit_offset": new_offset,
                "total_audited": min(total_results, int(job.get("total_audited") or 0) + audited_count),
                "cache_hits_web": cache_hits,
                "updated_at": utcnow_iso(),
            }
            if new_offset >= total_results:
                updated_job.update({"status": "completed", "phase": "completed", "completed_at": utcnow_iso()})
            db.table("search_jobs").update(updated_job).eq("id", job_id).execute()
            return get_search_job(job_id, user)

        raise HTTPException(status_code=400, detail="Fase de búsqueda desconocida")
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Falló el paso de búsqueda %s", job_id)
        db.table("search_jobs").update(
            {"status": "failed", "error_message": str(exc)[:1000], "updated_at": utcnow_iso()}
        ).eq("id", job_id).execute()
        raise HTTPException(status_code=500, detail=f"La búsqueda falló: {str(exc)[:300]}") from exc


@app.get("/api/focus/assignment")
def focus_assignment_overview(
    user: Annotated[CurrentUser, Depends(require_admin)],
    country_code: str | None = Query(default=None, min_length=2, max_length=2),
    niche: str | None = Query(default=None, min_length=1, max_length=120),
) -> dict[str, Any]:
    profiles = [
        row for row in _fetch_all("profiles", "id,full_name,role,is_active,operating_country")
        if row.get("is_active") is not False and str(row.get("role") or "agent") in {"admin", "setter", "agent"}
    ]
    leads = _fetch_all("leads")
    new_leads = [lead for lead in leads if _is_fresh_new_lead(lead)]
    all_unassigned = [lead for lead in new_leads if not lead.get("owner_id")]

    country_counts: dict[str, int] = {}
    for lead in all_unassigned:
        code = _normalized_country(lead.get("country_code"))
        country_counts[code] = country_counts.get(code, 0) + 1
    available_countries = [{
        "code": code,
        "name": COUNTRIES.get(code, {}).get("name") or code,
        "count": country_counts[code],
    } for code in COUNTRIES if code in country_counts]
    available_countries.extend({
        "code": code,
        "name": code,
        "count": count,
    } for code, count in sorted(country_counts.items()) if code not in COUNTRIES)

    selected_country = _normalized_country(country_code) if country_code else (
        available_countries[0]["code"] if available_countries else "PA"
    )
    country_unassigned = [
        lead for lead in all_unassigned
        if _normalized_country(lead.get("country_code")) == selected_country
    ]
    niche_counts: dict[str, int] = {}
    for lead in country_unassigned:
        lead_niche = str(lead.get("niche") or "Sin nicho").strip() or "Sin nicho"
        niche_counts[lead_niche] = niche_counts.get(lead_niche, 0) + 1
    available_niches = [
        {"name": name, "count": count}
        for name, count in sorted(niche_counts.items(), key=lambda item: (-item[1], item[0].casefold()))
    ]
    selected_niche = str(niche or "").strip() or (available_niches[0]["name"] if available_niches else "")
    unassigned = [
        lead for lead in country_unassigned
        if str(lead.get("niche") or "Sin nicho").strip().casefold() == selected_niche.casefold()
    ] if selected_niche else []

    assigned_counts: dict[str, int] = {}
    for lead in new_leads:
        if _normalized_country(lead.get("country_code")) != selected_country:
            continue
        if selected_niche and str(lead.get("niche") or "Sin nicho").strip().casefold() != selected_niche.casefold():
            continue
        owner_id = str(lead.get("owner_id") or "")
        if owner_id:
            assigned_counts[owner_id] = assigned_counts.get(owner_id, 0) + 1

    setters = [{
        "id": str(profile.get("id") or ""),
        "full_name": profile.get("full_name") or "Usuario",
        "role": profile.get("role") or "agent",
        "operating_country": _normalized_country(profile.get("operating_country"), "ALL" if profile.get("role") == "admin" else "PA"),
        "new_leads": assigned_counts.get(str(profile.get("id") or ""), 0),
    } for profile in profiles if profile.get("id") and _normalized_country(
        profile.get("operating_country"), "ALL" if profile.get("role") == "admin" else "PA",
    ) in {"ALL", selected_country}]
    setters.sort(key=lambda item: (item["new_leads"], item["full_name"].lower()))

    unassigned.sort(key=lambda item: (
        int(item.get("final_score") or 0),
        str(item.get("created_at") or ""),
    ), reverse=True)
    preview = [{
        "id": item.get("id"),
        "business_name": item.get("business_name") or "Lead sin nombre",
        "final_tier": item.get("final_tier"),
        "final_score": item.get("final_score"),
        "address": item.get("address"),
        "niche": item.get("niche") or "Sin nicho",
        "country_code": _normalized_country(item.get("country_code")),
        "country_name": item.get("country_name") or COUNTRIES.get(
            _normalized_country(item.get("country_code")), {},
        ).get("name") or _normalized_country(item.get("country_code")),
    } for item in unassigned[:100]]

    return {
        "unassigned_count": len(unassigned),
        "total_unassigned_count": len(all_unassigned),
        "unassigned": preview,
        "setters": setters,
        "selected_country_code": selected_country,
        "selected_niche": selected_niche,
        "available_countries": available_countries,
        "available_niches": available_niches,
        "generated_at": datetime.now(PANAMA_TZ).isoformat(),
    }


@app.post("/api/focus/assignment")
def distribute_focus_leads(
    payload: FocusAssignmentRequest,
    user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    db = get_supabase()
    selected_country = _normalized_country(payload.country_code)
    selected_niche = payload.niche.strip()
    if not selected_niche:
        raise HTTPException(status_code=422, detail="Selecciona un nicho para repartir los leads")
    requested_setter_ids = list(dict.fromkeys(str(item).strip() for item in payload.setter_ids if str(item).strip()))
    if not requested_setter_ids:
        raise HTTPException(status_code=422, detail="Selecciona al menos un setter para repartir los leads")

    profile_rows = _fetch_all("profiles", "id,full_name,role,is_active,operating_country")
    profile_map = {
        str(row.get("id")): row for row in profile_rows
        if row.get("id") and row.get("is_active") is not False
    }
    invalid_setters = [setter_id for setter_id in requested_setter_ids if setter_id not in profile_map]
    if invalid_setters:
        raise HTTPException(status_code=422, detail="Uno de los setters seleccionados no está activo")
    incompatible_setters = [
        setter_id for setter_id in requested_setter_ids
        if _normalized_country(
            profile_map[setter_id].get("operating_country"),
            "ALL" if profile_map[setter_id].get("role") == "admin" else "PA",
        ) not in {"ALL", selected_country}
    ]
    if incompatible_setters:
        raise HTTPException(status_code=422, detail="Uno de los setters seleccionados no trabaja el país elegido")

    all_leads = _fetch_all("leads")
    candidates = [
        lead for lead in all_leads
        if _is_fresh_new_lead(lead)
        and not lead.get("owner_id")
        and _normalized_country(lead.get("country_code")) == selected_country
        and str(lead.get("niche") or "Sin nicho").strip().casefold() == selected_niche.casefold()
    ]
    requested_lead_ids = set(str(item).strip() for item in payload.lead_ids if str(item).strip())
    if requested_lead_ids:
        candidates = [lead for lead in candidates if str(lead.get("id") or "") in requested_lead_ids]
    if not candidates:
        return {
            "assigned": 0, "remaining_unassigned": 0, "distribution": [],
            "country_code": selected_country, "niche": selected_niche,
        }

    candidates.sort(key=lambda item: (
        int(item.get("final_score") or 0),
        str(item.get("created_at") or ""),
    ), reverse=True)

    current_load = {setter_id: 0 for setter_id in requested_setter_ids}
    for lead in all_leads:
        owner_id = str(lead.get("owner_id") or "")
        if (
            owner_id in current_load
            and _is_fresh_new_lead(lead)
            and _normalized_country(lead.get("country_code")) == selected_country
            and str(lead.get("niche") or "Sin nicho").strip().casefold() == selected_niche.casefold()
        ):
            current_load[owner_id] += 1

    order = {setter_id: index for index, setter_id in enumerate(requested_setter_ids)}
    assigned = 0
    distribution = {setter_id: 0 for setter_id in requested_setter_ids}
    for lead in candidates:
        lead_country = _normalized_country(lead.get("country_code"))
        eligible_setters = [
            setter_id for setter_id in requested_setter_ids
            if _normalized_country(
                profile_map[setter_id].get("operating_country"),
                "ALL" if profile_map[setter_id].get("role") == "admin" else "PA",
            ) in {"ALL", lead_country}
        ]
        if not eligible_setters:
            continue
        setter_id = min(eligible_setters, key=lambda item: (current_load[item], order[item]))
        response = (
            db.table("leads")
            .update({"owner_id": setter_id, "updated_at": utcnow_iso()})
            .eq("id", lead.get("id"))
            .is_("owner_id", "null")
            .execute()
        )
        if not (response.data or []):
            continue
        assigned += 1
        distribution[setter_id] += 1
        current_load[setter_id] += 1
        order[setter_id] += len(requested_setter_ids)
        _log_activity(
            str(lead.get("id")),
            user.id,
            "lead_assigned",
            f"Lead asignado a {profile_map[setter_id].get('full_name') or 'setter'}",
            {"owner_id": setter_id, "assigned_by": user.id},
        )

    remaining = sum(
        1 for lead in _fetch_all("leads")
        if _is_fresh_new_lead(lead)
        and not lead.get("owner_id")
        and _normalized_country(lead.get("country_code")) == selected_country
        and str(lead.get("niche") or "Sin nicho").strip().casefold() == selected_niche.casefold()
    )
    result_distribution = [{
        "setter_id": setter_id,
        "setter_name": profile_map[setter_id].get("full_name") or "Usuario",
        "assigned": distribution[setter_id],
        "new_total": current_load[setter_id],
    } for setter_id in requested_setter_ids]
    return {
        "assigned": assigned,
        "remaining_unassigned": remaining,
        "country_code": selected_country,
        "niche": selected_niche,
        "distribution": result_distribution,
    }


@app.get("/api/focus")
def aura_focus(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    scope: str = Query(default="mine", pattern="^(mine|all)$"),
    bucket: str = Query(default="new", pattern="^(new|priority|active|waiting|followups)$"),
    work_date: date | None = None,
    limit: int = Query(default=100, ge=1, le=200),
) -> dict[str, Any]:
    today = panama_today()
    selected_date = work_date or today
    leads = _fetch_all("leads")
    profiles = _profile_map()
    global_unassigned = sum(
        1 for lead in leads
        if _is_fresh_new_lead(lead)
        and not lead.get("owner_id")
        and (user.role == "admin" or user.operating_country == "ALL" or _normalized_country(lead.get("country_code")) == _normalized_country(user.operating_country))
    )
    all_items: list[dict[str, Any]] = []

    for lead in leads:
        if user.role != "admin" and user.operating_country != "ALL" and _normalized_country(lead.get("country_code")) != _normalized_country(user.operating_country):
            continue
        owner_id = str(lead.get("owner_id") or "")
        if user.role != "admin" or scope == "mine":
            # Mi cola muestra únicamente leads preasignados al usuario actual.
            # Los leads sin responsable se quedan fuera hasta que un admin los reparta.
            if owner_id != user.id:
                continue
        enriched = _focus_priority(lead, today)
        if not enriched:
            continue
        enriched["owner_name"] = profiles.get(owner_id, "Sin asignar") if owner_id else "Sin asignar"
        enriched["followup_reason"] = (
            lead.get("next_step")
            or lead.get("outcome")
            or lead.get("notes")
            or enriched.get("recommended_action")
            or "Retomar la conversación y definir el próximo paso."
        )
        all_items.append(enriched)

    new_items = [
        item for item in all_items
        if str(item.get("status") or "") == "Nuevo"
        and int(item.get("contact_attempts") or 0) == 0
        and str(item.get("conversation_status") or "not_started") == "not_started"
    ]

    active_items = [
        item for item in all_items
        if item.get("conversation_status") in ACTIVE_CONVERSATION_STATUSES
    ]

    followup_items = [
        item for item in all_items
        if _parse_date(item.get("next_followup_date")) == selected_date
        and item.get("conversation_status") not in ACTIVE_CONVERSATION_STATUSES
    ]

    waiting_items = [
        item for item in all_items
        if item.get("conversation_status") == "waiting_response"
        and int(item.get("contact_attempts") or 0) == 1
        and _parse_date(item.get("next_followup_date")) != today
        and item.get("response_due_state") not in {"overdue", "today"}
    ]

    # Compatibilidad durante despliegues: una versión anterior del frontend puede pedir "priority".
    if bucket == "priority":
        bucket = "new"

    bucket_map = {
        "new": new_items,
        "active": active_items,
        "waiting": waiting_items,
        "followups": followup_items,
    }
    items = bucket_map[bucket]

    if bucket == "followups":
        items.sort(key=lambda item: (
            str(item.get("next_followup_date") or ""),
            str(item.get("business_name") or "").lower(),
        ))
    elif bucket == "waiting":
        items.sort(key=lambda item: (
            str(item.get("waiting_since") or item.get("last_outbound_at") or item.get("updated_at") or ""),
            int(item.get("final_score") or 0),
        ))
    elif bucket == "active":
        items.sort(key=lambda item: (
            str(item.get("last_inbound_at") or item.get("updated_at") or ""),
            int(item.get("priority_score") or 0),
        ), reverse=True)
    else:
        items.sort(key=lambda item: (
            int(item.get("final_score") or 0),
            str(item.get("created_at") or ""),
        ), reverse=True)

    total = len(items)
    selected = items[:limit]
    return {
        "items": selected,
        "total": total,
        "overdue": sum(1 for item in all_items if item.get("due_state") == "overdue"),
        "due_today": sum(1 for item in all_items if item.get("due_state") == "today"),
        "unassigned": global_unassigned,
        "new_leads": len(new_items),
        "priorities": len(new_items),
        "active_conversations": len(active_items),
        "waiting_responses": len(waiting_items),
        "followups": len(followup_items),
        "followup_date": selected_date.isoformat(),
        "bucket": bucket,
        "scope": "all" if user.role == "admin" and scope == "all" else "mine",
        "generated_at": datetime.now(PANAMA_TZ).isoformat(),
    }

@app.get("/api/pipeline")
def pipeline_overview(
    user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    """Private admin-only pipeline aligned to the real commercial flow."""
    profiles = _profile_map()
    items: list[dict[str, Any]] = []
    for lead in _fetch_all("leads"):
        if lead.get("archived") or lead.get("excluded_reason"):
            continue
        owner_id = str(lead.get("owner_id") or "")
        items.append({
            "id": lead.get("id"),
            "business_name": lead.get("business_name") or "Lead sin nombre",
            "address": lead.get("address"),
            "status": lead.get("status") or "Nuevo",
            "conversation_status": lead.get("conversation_status") or "not_started",
            "outcome": lead.get("outcome"),
            "next_step": lead.get("next_step"),
            "next_followup_date": lead.get("next_followup_date"),
            "owner_id": owner_id or None,
            "owner_name": profiles.get(owner_id, "Sin asignar") if owner_id else "Sin asignar",
            "final_tier": lead.get("final_tier"),
            "final_score": int(lead.get("final_score") or 0),
            "contact_attempts": int(lead.get("contact_attempts") or 0),
            "updated_at": lead.get("updated_at"),
            "pipeline_stage": _pipeline_stage(lead),
        })

    stage_order = {stage["key"]: index for index, stage in enumerate(PIPELINE_STAGES)}
    items.sort(key=lambda item: (
        stage_order.get(str(item.get("pipeline_stage")), 999),
        -int(item.get("final_score") or 0),
        str(item.get("business_name") or "").lower(),
    ))
    stage_counts = {stage["key"]: 0 for stage in PIPELINE_STAGES}
    for item in items:
        key = str(item.get("pipeline_stage") or "new")
        stage_counts[key] = stage_counts.get(key, 0) + 1

    return {
        "items": items,
        "stages": PIPELINE_STAGES,
        "stage_counts": stage_counts,
        "total": len(items),
        "generated_at": datetime.now(PANAMA_TZ).isoformat(),
    }


@app.get("/api/leads/view-counts")
def lead_view_counts(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    country_code: str | None = Query(default=None, min_length=2, max_length=2),
) -> dict[str, int]:
    db = get_supabase()

    def base() -> Any:
        query = (
            db.table("leads")
            .select("id", count="exact")
            .eq("archived", False)
            .is_("excluded_reason", "null")
        )
        if user.role != "admin" and user.operating_country != "ALL":
            query = query.eq("country_code", _normalized_country(user.operating_country))
        elif country_code:
            query = query.eq("country_code", _normalized_country(country_code))
        return query

    all_count = _count(base())
    pending = _count(base().in_("status", PENDING_STATUSES).eq("do_not_contact", False))
    worked = _count(base().not_.in_("status", PENDING_STATUSES))
    contacted = _count(base().gt("contact_attempts", 0))
    followup = _count(
        base()
        .not_.is_("next_followup_date", "null")
        .eq("do_not_contact", False)
        .not_.in_("status", CLOSED_STATUSES)
    )
    do_not_contact = _count(base().eq("do_not_contact", True))
    discarded = _count(base().in_("status", ["Descartado", "No califica"]))
    return {
        "all": all_count,
        "pending": pending,
        "worked": worked,
        "contacted": contacted,
        "followup": followup,
        "do_not_contact": do_not_contact,
        "discarded": discarded,
    }


@app.get("/api/leads")
def list_leads(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    search: str | None = None,
    niche: str | None = None,
    status: str | None = None,
    tier: str | None = None,
    owner_id: str | None = None,
    country_code: str | None = Query(default=None, min_length=2, max_length=2),
    followup_due: bool = False,
    include_excluded: bool = False,
    view: str = Query(default="all", pattern="^(all|pending|worked|contacted|followup|do_not_contact|discarded)$"),
    work_state: str | None = Query(default=None, pattern="^(all|pending|worked)$"),
) -> dict[str, Any]:
    db = get_supabase()
    start = (page - 1) * page_size
    query = db.table("leads").select("*", count="exact").eq("archived", False)
    if user.role != "admin" and user.operating_country != "ALL":
        query = query.eq("country_code", _normalized_country(user.operating_country))
    elif country_code:
        query = query.eq("country_code", _normalized_country(country_code))
    if not include_excluded:
        query = query.is_("excluded_reason", "null")

    if work_state and view == "all":
        view = work_state

    safe = _safe_search_term(search)
    if safe:
        pattern = f"*{safe}*"
        query = query.or_(
            ",".join(
                [
                    f"business_name.ilike.{pattern}",
                    f"address.ilike.{pattern}",
                    f"phone.ilike.{pattern}",
                    f"email.ilike.{pattern}",
                    f"decision_maker_name.ilike.{pattern}",
                    f"notes.ilike.{pattern}",
                ]
            )
        )
    if niche:
        query = query.eq("niche", niche)
    if status:
        query = query.eq("status", status)
    if tier:
        query = query.eq("final_tier", tier)
    if owner_id:
        query = query.eq("owner_id", owner_id)

    if view == "pending":
        query = query.in_("status", PENDING_STATUSES).eq("do_not_contact", False)
    elif view == "worked":
        query = query.not_.in_("status", PENDING_STATUSES)
    elif view == "contacted":
        query = query.gt("contact_attempts", 0)
    elif view == "followup":
        query = (
            query.not_.is_("next_followup_date", "null")
            .eq("do_not_contact", False)
            .not_.in_("status", CLOSED_STATUSES)
        )
    elif view == "do_not_contact":
        query = query.eq("do_not_contact", True)
    elif view == "discarded":
        query = query.in_("status", ["Descartado", "No califica"])

    if followup_due:
        query = (
            query.lte("next_followup_date", date.today().isoformat())
            .eq("do_not_contact", False)
            .not_.in_("status", CLOSED_STATUSES)
        )
    response = (
        query.order("final_score", desc=True)
        .order("created_at", desc=True)
        .range(start, start + page_size - 1)
        .execute()
    )
    return {
        "items": response.data or [],
        "total": int(response.count or 0),
        "page": page,
        "page_size": page_size,
        "view": view,
    }


@app.get("/api/leads/{lead_id}/duplicate-candidates")
def duplicate_lead_candidates(
    lead_id: str,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> dict[str, Any]:
    db = get_supabase()
    lead = _first(db.table("leads").select("*").eq("id", lead_id).limit(1).execute())
    if not lead:
        raise HTTPException(status_code=404, detail="Lead no encontrado")
    _assert_country_access(user, lead.get("country_code"))
    if user.role != "admin":
        _assert_lead_work_access(lead, user)

    normalized_name = _normalized_business_name(lead.get("business_name"))
    significant_token = next((token for token in normalized_name.split() if len(token) >= 3), "")
    query = (
        db.table("leads")
        .select(
            "id,business_name,address,zone,city,region,country_code,latitude,longitude,phone,"
            "whatsapp_phone,email,status,outcome,conversation_status,contact_attempts,"
            "first_contact_date,last_contact_date,owner_id,created_at"
        )
        .neq("id", lead_id)
        .eq("archived", False)
        .is_("excluded_reason", "null")
        .eq("country_code", _normalized_country(lead.get("country_code")))
    )
    if user.role != "admin":
        query = query.eq("owner_id", user.id)
    if significant_token:
        query = query.ilike("business_name", f"*{_safe_search_term(significant_token)}*")
    rows = query.order("created_at", desc=False).limit(120).execute().data or []

    candidates: list[dict[str, Any]] = []
    for candidate in rows:
        similarity = _business_name_similarity(lead.get("business_name"), candidate.get("business_name"))
        if similarity < 0.72:
            continue
        distance = None
        try:
            coordinates_present = all(
                lead.get(key) is not None and candidate.get(key) is not None
                for key in ("latitude", "longitude")
            )
            if coordinates_present:
                distance = _distance_km(
                    float(lead["latitude"]),
                    float(lead["longitude"]),
                    float(candidate["latitude"]),
                    float(candidate["longitude"]),
                )
        except (TypeError, ValueError):
            distance = None
        candidates.append({
            **candidate,
            "name_similarity": round(similarity, 3),
            "distance_km": round(distance, 2) if distance is not None else None,
        })

    candidate_ids = [item["id"] for item in candidates]
    history_counts: dict[str, dict[str, int]] = {}
    if candidate_ids:
        logs = (
            db.table("call_logs")
            .select("lead_id,direction")
            .in_("lead_id", candidate_ids)
            .limit(2000)
            .execute()
            .data or []
        )
        for log in logs:
            entry = history_counts.setdefault(str(log.get("lead_id")), {"activities": 0, "responses": 0})
            entry["activities"] += 1
            if log.get("direction") == "Entrante":
                entry["responses"] += 1

    for candidate in candidates:
        counts = history_counts.get(str(candidate["id"]), {"activities": 0, "responses": 0})
        candidate["history_count"] = counts["activities"]
        candidate["response_count"] = counts["responses"]
        distance = candidate.get("distance_km")
        candidate["location_hint"] = (
            "Muy cercano; revisa si es la misma sede"
            if distance is not None and distance <= 0.5
            else "Puede ser otra sucursal"
            if distance is not None and distance > 2
            else "Compara la dirección antes de consolidar"
        )

    candidates.sort(key=lambda item: (
        0 if item["name_similarity"] == 1 else 1,
        item["distance_km"] if item["distance_km"] is not None else 999999,
        -item["name_similarity"],
        -item["response_count"],
    ))
    return {
        "source": {"id": lead["id"], "business_name": lead.get("business_name"), "address": lead.get("address")},
        "items": candidates[:8],
    }


@app.post("/api/leads/{lead_id}/merge-duplicate")
def merge_duplicate_lead(
    lead_id: str,
    payload: DuplicateLeadMergeRequest,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> dict[str, Any]:
    if payload.target_lead_id == lead_id:
        raise HTTPException(status_code=422, detail="Selecciona otro lead para consolidar")
    db = get_supabase()
    source = _first(db.table("leads").select("*").eq("id", lead_id).limit(1).execute())
    target = _first(db.table("leads").select("*").eq("id", payload.target_lead_id).limit(1).execute())
    if not source or source.get("archived"):
        raise HTTPException(status_code=404, detail="El lead que deseas descartar ya no está disponible")
    if not target or target.get("archived") or target.get("excluded_reason"):
        raise HTTPException(status_code=404, detail="El lead que deseas conservar ya no está disponible")
    _assert_country_access(user, source.get("country_code"))
    if user.role != "admin":
        _assert_lead_work_access(source, user)
        _assert_lead_work_access(target, user)
    if _normalized_country(source.get("country_code")) != _normalized_country(target.get("country_code")):
        raise HTTPException(status_code=422, detail="No se pueden consolidar leads de países diferentes")
    if _business_name_similarity(source.get("business_name"), target.get("business_name")) < 0.72:
        raise HTTPException(status_code=422, detail="Los nombres no son suficientemente similares para una consolidación segura")
    try:
        response = db.rpc(
            "merge_duplicate_leads",
            {"p_source_id": lead_id, "p_target_id": payload.target_lead_id, "p_actor_id": user.id},
        ).execute()
    except Exception as exc:
        message = str(exc)
        if "merge_duplicate_leads" in message and ("schema cache" in message.lower() or "function" in message.lower()):
            raise HTTPException(
                status_code=503,
                detail="Falta instalar SQL_AURA_OS_DUPLICADOS_CONTACTOS.sql en Supabase antes de consolidar.",
            ) from exc
        logger.exception("No se pudo consolidar el lead duplicado")
        raise HTTPException(status_code=500, detail="No se pudo consolidar el duplicado sin perder datos") from exc
    rpc_data = response.data
    result = rpc_data if isinstance(rpc_data, dict) else ((rpc_data or [{}])[0] if isinstance(rpc_data, list) else {})
    return {"ok": True, "source_lead_id": lead_id, "target_lead_id": payload.target_lead_id, **result}


@app.get("/api/leads/{lead_id}")
def get_lead(lead_id: str, user: Annotated[CurrentUser, Depends(get_current_user)]) -> dict[str, Any]:
    db = get_supabase()
    lead = _first(db.table("leads").select("*").eq("id", lead_id).limit(1).execute())
    if not lead:
        raise HTTPException(status_code=404, detail="Lead no encontrado")
    _assert_country_access(user, lead.get("country_code"))
    calls = db.table("call_logs").select("*").eq("lead_id", lead_id).order("occurred_at", desc=True).limit(100).execute().data or []
    activities = db.table("activities").select("*").eq("lead_id", lead_id).order("created_at", desc=True).limit(100).execute().data or []
    lead["call_logs"] = calls
    lead["activities"] = activities
    return lead


@app.patch("/api/leads/{lead_id}")
def update_lead(
    lead_id: str,
    payload: LeadUpdate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> dict[str, Any]:
    db = get_supabase()
    lead = _first(db.table("leads").select("*").eq("id", lead_id).limit(1).execute())
    if not lead:
        raise HTTPException(status_code=404, detail="Lead no encontrado")
    _assert_country_access(user, lead.get("country_code"))

    changes = payload.model_dump(exclude_unset=True, mode="json")
    owner_id = str(lead.get("owner_id") or "")
    if user.role != "admin":
        if not owner_id:
            raise HTTPException(status_code=409, detail="Este lead está sin asignar. Debe repartirse antes de editarlo.")
        if owner_id != user.id:
            owner_name = _profile_map().get(owner_id, "otro setter")
            raise HTTPException(status_code=409, detail=f"Este lead está asignado a {owner_name}.")
        if "owner_id" in changes and str(changes.get("owner_id") or "") != owner_id:
            raise HTTPException(status_code=403, detail="Solo un administrador puede reasignar leads")
    if user.role == "admin" and changes.get("owner_id"):
        next_owner = _first(
            db.table("profiles")
            .select("id,role,is_active,operating_country")
            .eq("id", changes["owner_id"])
            .limit(1)
            .execute()
        )
        if not next_owner or next_owner.get("is_active") is False:
            raise HTTPException(status_code=422, detail="El responsable seleccionado no está activo")
        owner_country = _normalized_country(
            next_owner.get("operating_country"), "ALL" if next_owner.get("role") == "admin" else "PA",
        )
        lead_country = _normalized_country(lead.get("country_code"))
        if owner_country not in {"ALL", lead_country}:
            raise HTTPException(status_code=422, detail="El responsable seleccionado pertenece a otra operación")
    if "status" in changes and changes["status"] not in STATUSES:
        raise HTTPException(status_code=400, detail="Estado inválido")
    if "email" in changes:
        email = str(changes.get("email") or "").strip().lower()
        if email and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
            raise HTTPException(status_code=422, detail="Ingresa un correo electrónico válido")
        changes["email"] = email or None
    if "whatsapp_phone" in changes:
        normalized_phone, whatsapp_url = _normalize_whatsapp_phone(
            changes.get("whatsapp_phone"), lead.get("country_code"),
        )
        changes["whatsapp_phone"] = normalized_phone
        changes["whatsapp_url"] = whatsapp_url
    if not changes:
        return lead

    outcome_definition = get_outcome_definition(changes.get("outcome_id"), changes.get("outcome") or lead.get("outcome"))
    if outcome_definition:
        changes["outcome_id"] = outcome_definition["id"]
        changes["outcome"] = outcome_definition["name"]
        if "conversation_status" not in changes and outcome_definition.get("recommended_conversation_status"):
            changes["conversation_status"] = outcome_definition["recommended_conversation_status"]
        if "status" not in changes and outcome_definition.get("recommended_commercial_status") in STATUSES:
            changes["status"] = outcome_definition["recommended_commercial_status"]
        changes["outcome_priority_adjustment"] = int(outcome_definition.get("priority_adjustment") or 0)
        if "next_followup_date" not in changes:
            recommended_date = suggested_followup_date(outcome_definition, panama_today())
            if recommended_date:
                changes["next_followup_date"] = recommended_date.isoformat()
        if outcome_definition.get("code") == "do_not_contact":
            changes["do_not_contact"] = True

    merged = {**lead, **changes}
    changes["outcome_stage"] = derive_outcome_stage(
        merged.get("conversation_status"),
        outcome_definition,
        merged.get("next_followup_date"),
        merged.get("status"),
    )
    if changes["outcome_stage"] == "final":
        changes["final_outcome_at"] = lead.get("final_outcome_at") or utcnow_iso()
    elif lead.get("outcome_stage") == "final":
        changes["final_outcome_at"] = None

    changes.update(normalize_manual_scores(merged))
    changes["updated_at"] = utcnow_iso()
    if changes.get("status") in {"Contactado", "Seguimiento 1", "Seguimiento 2", "Respondió", "Interesado"} and not lead.get("first_contact_date"):
        changes["first_contact_date"] = date.today().isoformat()
    response = db.table("leads").update(changes).eq("id", lead_id).execute()
    _log_activity(lead_id, user.id, "lead_updated", "Lead actualizado", {"changes": changes})
    return _first(response) or {**lead, **changes}

def _default_response_due(channel: str, occurred_at: datetime) -> datetime:
    hours = {
        "Llamada": 4,
        "WhatsApp": 24,
        "Instagram": 36,
        "Email": 48,
        "Otro": 24,
    }.get(channel, 24)
    return occurred_at + timedelta(hours=hours)


def _counts_as_contact_attempt(payload: CallLogCreate) -> bool:
    return (
        payload.direction == "Saliente"
        and payload.activity_type in {"contact_attempt", "call_made", "message_sent", "email_sent", "followup"}
    )


@app.post("/api/chat-analysis")
def chat_analysis(
    payload: ChatAnalysisRequest,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> dict[str, Any]:
    return analyze_chat(
        payload.transcript,
        channel=payload.channel,
        today=panama_today(),
        setter_name=user.full_name,
    )


@app.post("/api/leads/{lead_id}/call-logs")
def create_call_log(
    lead_id: str,
    payload: CallLogCreate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> dict[str, Any]:
    db = get_supabase()
    lead = _first(
        db.table("leads")
        .select("id,status,owner_id,first_contact_date,contact_attempts,conversation_status,outcome_stage")
        .eq("id", lead_id)
        .limit(1)
        .execute()
    )
    if not lead:
        raise HTTPException(status_code=404, detail="Lead no encontrado")
    _assert_lead_work_access(lead, user)

    occurred_at = payload.occurred_at or datetime.now(timezone.utc)
    outcome_definition = get_outcome_definition(payload.outcome_id, payload.outcome)
    outcome_name = outcome_definition.get("name") if outcome_definition else payload.outcome
    outcome_id = (outcome_definition.get("id") if outcome_definition else payload.outcome_id) or None

    first_outbound_wait = (
        int(lead.get("contact_attempts") or 0) == 0
        and _counts_as_contact_attempt(payload)
        and payload.conversation_status in {"not_started", "waiting_response"}
    )

    conversation_status = payload.conversation_status
    if first_outbound_wait:
        # El primer contacto saliente entra siempre en Esperando hasta que haya respuesta
        # o llegue la fecha programada de seguimiento.
        conversation_status = "waiting_response"
    elif outcome_definition and outcome_definition.get("is_terminal"):
        conversation_status = "closed"
    elif conversation_status == "not_started" and outcome_definition and outcome_definition.get("recommended_conversation_status"):
        conversation_status = outcome_definition["recommended_conversation_status"]

    followup_date = payload.followup_date
    if not followup_date:
        followup_date = suggested_followup_date(outcome_definition, panama_today())

    commercial_status = payload.commercial_status or (outcome_definition.get("recommended_commercial_status") if outcome_definition else None)
    if commercial_status not in STATUSES:
        commercial_status = None
    outcome_stage = derive_outcome_stage(conversation_status, outcome_definition, followup_date, commercial_status or lead.get("status"))
    final_outcome = outcome_stage == "final"

    response_due_at = payload.response_due_at
    awaiting_response = conversation_status in {"waiting_response", "waiting_confirmation", "waiting_decision_maker"}
    if awaiting_response and not response_due_at:
        response_due_at = _default_response_due(payload.channel, occurred_at)

    row = payload.model_dump(mode="json")
    # commercial_status guía la actualización del lead, pero no es una columna de call_logs.
    row.pop("commercial_status", None)
    row.update({
        "lead_id": lead_id,
        "agent_id": user.id,
        "occurred_at": occurred_at.isoformat(),
        "response_due_at": response_due_at.isoformat() if response_due_at else None,
        "outcome_id": outcome_id,
        "outcome": outcome_name,
        "conversation_status": conversation_status,
        "outcome_stage": outcome_stage,
        "outcome_priority_adjustment": int(outcome_definition.get("priority_adjustment") or 0) if outcome_definition else None,
        "awaiting_response": awaiting_response,
        "is_final_outcome": final_outcome,
        "followup_date": followup_date.isoformat() if hasattr(followup_date, "isoformat") else followup_date,
    })
    if outcome_definition and not row.get("next_step") and outcome_definition.get("recommended_next_step"):
        row["next_step"] = outcome_definition["recommended_next_step"]

    try:
        response, inserted_row, removed_call_columns = _insert_row_compatible(
            db,
            "call_logs",
            row,
            protected_columns={"lead_id", "occurred_at", "channel", "direction", "outcome"},
        )
    except Exception as exc:
        logger.exception("No se pudo guardar la interacción del lead %s", lead_id)
        raise HTTPException(status_code=400, detail=f"No se pudo guardar la interacción: {exc}") from exc
    call = _first(response) or inserted_row

    attempt_count = int(lead.get("contact_attempts") or 0)
    if _counts_as_contact_attempt(payload):
        try:
            rpc_data = db.rpc("increment_lead_contact_attempts", {"p_lead_id": lead_id}).execute().data
            if isinstance(rpc_data, list):
                attempt_count = int(rpc_data[0]) if rpc_data else attempt_count + 1
            else:
                attempt_count = int(rpc_data or attempt_count + 1)
        except Exception:
            # Algunas instalaciones perdieron la función SQL; el contacto igual debe guardarse.
            attempt_count += 1
            logger.exception("No se pudo ejecutar increment_lead_contact_attempts; se usará el conteo local")

    lead_update: dict[str, Any] = {
        "last_contact_date": row["occurred_at"],
        "owner_id": user.id,
        "contact_attempts": attempt_count,
        "conversation_status": conversation_status,
        "conversation_status_changed_at": row["occurred_at"],
        "outcome_stage": outcome_stage,
    }

    if outcome_name and outcome_name != "Pendiente":
        lead_update["outcome"] = outcome_name
        lead_update["outcome_id"] = outcome_id
        lead_update["outcome_priority_adjustment"] = int(outcome_definition.get("priority_adjustment") or 0) if outcome_definition else None
    if payload.direction == "Entrante" or payload.activity_type == "response_received":
        lead_update["last_inbound_at"] = row["occurred_at"]
        lead_update["waiting_since"] = None
        lead_update["response_due_at"] = None
    elif _counts_as_contact_attempt(payload):
        lead_update["last_outbound_at"] = row["occurred_at"]
    if awaiting_response:
        lead_update["waiting_since"] = row["occurred_at"]
        lead_update["response_due_at"] = row["response_due_at"]
    elif conversation_status != "waiting_response":
        lead_update["waiting_since"] = None
        if conversation_status in ACTIVE_CONVERSATION_STATUSES or conversation_status == "closed":
            lead_update["response_due_at"] = None

    if not lead.get("first_contact_date") and _counts_as_contact_attempt(payload):
        lead_update["first_contact_date"] = panama_today().isoformat()
    if followup_date:
        lead_update["next_followup_date"] = followup_date.isoformat() if hasattr(followup_date, "isoformat") else followup_date
    elif final_outcome:
        lead_update["next_followup_date"] = None
    if final_outcome:
        lead_update["final_outcome_at"] = row["occurred_at"]

    if commercial_status in STATUSES:
        lead_update["status"] = commercial_status
    elif conversation_status in ACTIVE_CONVERSATION_STATUSES:
        lead_update["status"] = "Respondió"
    elif conversation_status == "followup_scheduled":
        lead_update["status"] = "Seguimiento 1"
    elif conversation_status == "waiting_response" and lead.get("status") in {"Nuevo", "Investigando", "Listo para contactar"}:
        lead_update["status"] = "Contactado"
    if outcome_definition and outcome_definition.get("code") == "do_not_contact":
        lead_update["do_not_contact"] = True

    lead_update_warning = ""
    removed_lead_columns: list[str] = []
    try:
        _, _, removed_lead_columns = _update_row_compatible(db, "leads", lead_update, "id", lead_id)
    except Exception:
        # La interacción ya fue guardada. No devolvemos un falso fracaso que invite a duplicarla.
        lead_update_warning = "La interacción se guardó, pero la ficha no pudo actualizar toda la clasificación automáticamente."
        logger.exception("Interacción guardada, pero no se pudo actualizar el lead %s", lead_id)

    description_outcome = outcome_name if outcome_name != "Pendiente" else conversation_status
    _log_activity(
        lead_id,
        user.id,
        "contact_logged",
        f"{payload.channel}: {description_outcome}",
        {
            "call_log_id": call.get("id"),
            "activity_type": payload.activity_type,
            "conversation_status": conversation_status,
            "outcome_stage": outcome_stage,
            "outcome_id": outcome_id,
        },
    )
    if removed_call_columns or removed_lead_columns:
        call["schema_compatibility"] = {
            "call_logs_columns_omitted": removed_call_columns,
            "lead_columns_omitted": removed_lead_columns,
        }
    if lead_update_warning:
        call["save_warning"] = lead_update_warning
    return call


@app.get("/api/call-logs")
def list_call_logs(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    search: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    channel: str | None = None,
    outcome: str | None = None,
    conversation_status: str | None = None,
    outcome_stage: str | None = None,
    agent_id: str | None = None,
) -> dict[str, Any]:
    if page_size not in CALL_LOG_PAGE_SIZES:
        raise HTTPException(status_code=400, detail="El tamaño de página debe ser 25, 50 o 100.")
    start = (page - 1) * page_size
    effective_agent_id = user.id if user.role != "admin" else agent_id
    response = (
        _call_log_query(
            search=search,
            date_from=date_from,
            date_to=date_to,
            channel=channel,
            outcome=outcome,
            conversation_status=conversation_status,
            outcome_stage=outcome_stage,
            agent_id=effective_agent_id,
            count="exact",
        )
        .order("occurred_at", desc=True)
        .range(start, start + page_size - 1)
        .execute()
    )
    return {
        "items": response.data or [],
        "total": int(response.count or 0),
        "page": page,
        "page_size": page_size,
        "page_sizes": CALL_LOG_PAGE_SIZES,
    }


@app.get("/api/followups")
def followups(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    through: date | None = None,
) -> list[dict[str, Any]]:
    target = (through or date.today()).isoformat()
    query = (
        get_supabase().table("leads").select("*")
        .lte("next_followup_date", target)
        .not_.in_("status", ["Descartado", "No interesado", "No califica", "Implementación vendida"])
        .eq("archived", False)
        .order("next_followup_date")
    )
    if user.role != "admin":
        query = query.eq("owner_id", user.id)
        if user.operating_country != "ALL":
            query = query.eq("country_code", _normalized_country(user.operating_country))
    response = query.limit(500).execute()
    return response.data or []


@app.get("/api/dashboard")
def dashboard(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    date_from: date | None = None,
    date_to: date | None = None,
    agent_id: str | None = None,
    status: str | None = None,
    tier: str | None = None,
    outcome: str | None = None,
) -> dict[str, Any]:
    """Rendimiento comercial con actividad del periodo y conversión histórica verificada.

    La tasa principal solo usa contactos salientes y respuestas humanas registradas en
    ``call_logs``. Los estados históricos sin interacción entrante se muestran aparte
    como datos inferidos pendientes de normalización.
    """
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=400, detail="La fecha inicial no puede ser posterior a la fecha final.")
    if user.role != "admin":
        agent_id = user.id

    today = panama_today()
    now_local = datetime.now(PANAMA_TZ)
    profiles = _fetch_all("profiles", "id,full_name,role")
    profile_names = {str(item.get("id")): item.get("full_name") or "Usuario" for item in profiles}

    raw_leads = _fetch_all("leads")
    active_leads = [
        item for item in raw_leads
        if not item.get("archived") and not item.get("excluded_reason")
        and (user.role == "admin" or user.operating_country == "ALL" or _normalized_country(item.get("country_code")) == _normalized_country(user.operating_country))
    ]

    def local_date(value: Any) -> date | None:
        parsed = _parse_datetime(value)
        if parsed:
            return parsed.astimezone(PANAMA_TZ).date()
        return _parse_date(value)

    def within_period(value: Any) -> bool:
        item_date = local_date(value)
        if not item_date:
            return not date_from and not date_to
        if date_from and item_date < date_from:
            return False
        if date_to and item_date > date_to:
            return False
        return True

    # Los filtros comerciales delimitan la cartera. El responsable actual se usa para
    # métricas operativas del periodo; la conversión histórica se atribuye al setter
    # que registró el primer contacto saliente.
    analysis_leads = active_leads
    if status:
        analysis_leads = [item for item in analysis_leads if str(item.get("status") or "") == status]
    if tier:
        analysis_leads = [item for item in analysis_leads if str(item.get("final_tier") or "") == tier]
    if outcome:
        analysis_leads = [item for item in analysis_leads if str(item.get("outcome") or "") == outcome]

    portfolio_leads = analysis_leads
    if agent_id:
        portfolio_leads = [item for item in portfolio_leads if str(item.get("owner_id") or "") == agent_id]

    saved_leads = [item for item in portfolio_leads if within_period(item.get("capture_date") or item.get("created_at"))]
    portfolio_ids = {str(item.get("id")) for item in portfolio_leads if item.get("id")}
    analysis_ids = {str(item.get("id")) for item in analysis_leads if item.get("id")}
    lead_map = {str(item.get("id")): item for item in active_leads if item.get("id")}

    raw_calls = _fetch_all("call_logs")
    calls: list[dict[str, Any]] = []
    for item in raw_calls:
        lead_id = str(item.get("lead_id") or "")
        if lead_id not in portfolio_ids:
            continue
        if agent_id and str(item.get("agent_id") or "") != agent_id:
            continue
        if not within_period(item.get("occurred_at")):
            continue
        calls.append(item)
    calls.sort(key=lambda item: str(item.get("occurred_at") or ""), reverse=True)

    outgoing_activity_types = {"contact_attempt", "call_made", "message_sent", "email_sent"}
    automated_outcomes = {
        "respuesta automática fuera de horario",
        "bot pidió nombre y motivo",
        "whatsapp abrió flujo de paciente",
    }

    def normalized_outcome(item: dict[str, Any]) -> str:
        return str(item.get("outcome") or "").strip().lower()

    def is_automated_response(item: dict[str, Any]) -> bool:
        return normalized_outcome(item) in automated_outcomes

    def is_response(item: dict[str, Any]) -> bool:
        """Respuesta humana registrada; excluye bots y respuestas automáticas."""
        incoming = (
            str(item.get("direction") or "").strip().lower() == "entrante"
            or str(item.get("activity_type") or "").strip().lower() == "response_received"
        )
        return bool(incoming and not is_automated_response(item))

    def is_outbound_contact(item: dict[str, Any]) -> bool:
        direction = str(item.get("direction") or "").strip().lower()
        activity_type = str(item.get("activity_type") or "").strip().lower()
        return bool(direction == "saliente" or activity_type in outgoing_activity_types)

    def lead_summary(item: dict[str, Any]) -> dict[str, Any]:
        owner_id = str(item.get("owner_id") or "")
        return {
            "lead_id": item.get("id"),
            "business_name": item.get("business_name") or "Lead sin nombre",
            "zone": item.get("zone") or item.get("address"),
            "status": item.get("status") or "Nuevo",
            "tier": item.get("final_tier") or "Descartar",
            "score": int(item.get("final_score") or 0),
            "outcome": item.get("outcome"),
            "owner_id": item.get("owner_id"),
            "owner_name": profile_names.get(owner_id, "Sin asignar"),
            "next_followup_date": item.get("next_followup_date"),
            "last_activity_at": item.get("last_contact_date"),
            "contact_attempts": int(item.get("contact_attempts") or 0),
            "capture_date": item.get("capture_date") or item.get("created_at"),
        }

    call_groups: dict[str, list[dict[str, Any]]] = {}
    for item in calls:
        lead_id = str(item.get("lead_id") or "")
        call_groups.setdefault(lead_id, []).append(item)

    worked_rows: list[dict[str, Any]] = []
    period_contact_rows: list[dict[str, Any]] = []
    period_contacted_ids: set[str] = set()
    period_responded_ids: set[str] = set()

    for lead_id, items in call_groups.items():
        lead = lead_map.get(lead_id)
        if not lead:
            continue
        summary = lead_summary(lead)
        latest = items[0]
        worked_rows.append({
            **summary,
            "activity_count": len(items),
            "last_activity_at": latest.get("occurred_at"),
            "channel": latest.get("channel"),
            "outcome": latest.get("outcome") or summary.get("outcome"),
            "agent_name": profile_names.get(str(latest.get("agent_id") or ""), "Usuario"),
        })

        outbound = sorted(
            [item for item in items if is_outbound_contact(item) and not is_response(item)],
            key=lambda item: str(item.get("occurred_at") or ""),
        )
        responses = sorted(
            [item for item in items if is_response(item)],
            key=lambda item: str(item.get("occurred_at") or ""),
        )
        if outbound:
            period_contacted_ids.add(lead_id)
            first_outbound = outbound[0]
            period_contact_rows.append({
                **summary,
                "activity_count": len(items),
                "occurred_at": first_outbound.get("occurred_at"),
                "last_activity_at": latest.get("occurred_at"),
                "channel": first_outbound.get("channel"),
                "outcome": first_outbound.get("outcome") or summary.get("outcome"),
                "agent_name": profile_names.get(str(first_outbound.get("agent_id") or ""), "Usuario"),
            })
        if responses:
            period_responded_ids.add(lead_id)

    worked_rows.sort(key=lambda item: str(item.get("last_activity_at") or ""), reverse=True)
    period_contact_rows.sort(key=lambda item: str(item.get("occurred_at") or ""), reverse=True)

    # Conversión histórica verificada y atribución por primer contacto.
    all_time_call_groups: dict[str, list[dict[str, Any]]] = {}
    for item in raw_calls:
        lead_id = str(item.get("lead_id") or "")
        if lead_id in analysis_ids:
            all_time_call_groups.setdefault(lead_id, []).append(item)

    legacy_response_statuses = {
        "Respondió", "Interesado", "Reunión agendada", "Propuesta enviada",
        "Diagnóstico vendido", "Implementación vendida", "No interesado",
    }
    response_rows: list[dict[str, Any]] = []

    for lead in analysis_leads:
        lead_id = str(lead.get("id") or "")
        items = sorted(
            all_time_call_groups.get(lead_id, []),
            key=lambda item: str(item.get("occurred_at") or ""),
        )
        outbound_items = [item for item in items if is_outbound_contact(item) and not is_response(item)]
        response_items = [item for item in items if is_response(item)]

        first_outbound = outbound_items[0] if outbound_items else None
        first_contact_dt = _parse_datetime((first_outbound or {}).get("occurred_at"))
        response_after_contact = [
            item for item in response_items
            if not first_contact_dt
            or ((_parse_datetime(item.get("occurred_at")) or first_contact_dt) >= first_contact_dt)
        ]
        first_response = response_after_contact[0] if response_after_contact else None

        contact_verified = bool(first_outbound)
        legacy_contacted = bool(
            not contact_verified
            and (
                lead.get("first_contact_date")
                or int(lead.get("contact_attempts") or 0) > 0
                or str(lead.get("status") or "") in legacy_response_statuses
            )
        )
        if not contact_verified and not legacy_contacted:
            continue

        first_contact_agent_id = str((first_outbound or {}).get("agent_id") or "")
        attribution_verified = bool(first_outbound and first_contact_agent_id)
        attributed_agent_id = first_contact_agent_id or str(lead.get("owner_id") or "")
        if agent_id and attributed_agent_id != agent_id:
            continue

        verified_responded = bool(first_response and contact_verified)
        inferred_responded = bool(
            not verified_responded
            and (
                str(lead.get("status") or "") in legacy_response_statuses
                or str(lead.get("conversation_status") or "") in ACTIVE_CONVERSATION_STATUSES
            )
        )

        first_contact_at = (first_outbound or {}).get("occurred_at") or lead.get("first_contact_date")
        first_response_at = (first_response or {}).get("occurred_at")
        response_time_minutes = None
        contact_dt = _parse_datetime(first_contact_at)
        response_dt = _parse_datetime(first_response_at)
        if contact_dt and response_dt and response_dt >= contact_dt:
            response_time_minutes = int((response_dt - contact_dt).total_seconds() // 60)

        over_24h = bool(
            contact_verified
            and not verified_responded
            and contact_dt
            and now_local - contact_dt.astimezone(PANAMA_TZ) >= timedelta(hours=24)
        )
        latest = items[-1] if items else None
        summary = lead_summary(lead)
        response_status = "Verificada" if verified_responded else "Inferida" if inferred_responded else "Sin respuesta"
        response_rows.append({
            **summary,
            "responded": verified_responded,
            "verified_response": verified_responded,
            "inferred_response": inferred_responded,
            "response_status": response_status,
            "response_label": response_status,
            "contact_verified": contact_verified,
            "legacy_contact": legacy_contacted,
            "first_contact_at": first_contact_at,
            "first_response_at": first_response_at,
            "response_time_minutes": response_time_minutes,
            "over_24h": over_24h,
            "activity_count": len(items),
            "last_activity_at": (latest or {}).get("occurred_at") or summary.get("last_activity_at"),
            "channel": (first_outbound or latest or {}).get("channel"),
            "outcome": (latest or {}).get("outcome") or summary.get("outcome"),
            "agent_id": attributed_agent_id or None,
            "agent_name": profile_names.get(attributed_agent_id, "Sin atribuir"),
            "attribution_verified": attribution_verified,
        })

    response_rows.sort(
        key=lambda item: (
            bool(item.get("verified_response")),
            bool(item.get("inferred_response")),
            str(item.get("first_response_at") or item.get("first_contact_at") or ""),
        ),
        reverse=True,
    )

    overdue_leads = []
    for item in portfolio_leads:
        followup = _parse_date(item.get("next_followup_date"))
        if not followup or followup > today:
            continue
        if str(item.get("status") or "") in CLOSED_STATUSES:
            continue
        overdue_leads.append({
            **lead_summary(item),
            "days_overdue": max(0, (today - followup).days),
        })
    overdue_leads.sort(key=lambda item: str(item.get("next_followup_date") or ""))

    meeting_calls = [
        item for item in calls
        if item.get("appointment_booked") or str(item.get("outcome") or "") == "Reunión agendada"
    ]
    sale_calls = [
        item for item in calls
        if str(item.get("outcome") or "") == "Venta" or float(item.get("sale_amount") or 0) > 0
    ]

    def call_detail(item: dict[str, Any]) -> dict[str, Any]:
        lead = lead_map.get(str(item.get("lead_id") or ""), {})
        summary = lead_summary(lead) if lead else {
            "lead_id": item.get("lead_id"),
            "business_name": "Lead no disponible",
            "status": "—",
            "tier": "—",
            "owner_name": "Sin asignar",
            "next_followup_date": None,
        }
        return {
            **summary,
            "activity_id": item.get("id"),
            "occurred_at": item.get("occurred_at"),
            "last_activity_at": item.get("occurred_at"),
            "channel": item.get("channel"),
            "outcome": item.get("outcome"),
            "notes": item.get("notes") or item.get("next_step"),
            "appointment_booked": bool(item.get("appointment_booked")),
            "sale_amount": float(item.get("sale_amount") or 0),
            "agent_name": profile_names.get(str(item.get("agent_id") or ""), "Usuario"),
            "contacted": is_response(item),
        }

    verified_contact_rows = [item for item in response_rows if item.get("contact_verified")]
    verified_response_rows = [item for item in verified_contact_rows if item.get("verified_response")]
    inferred_response_rows = [item for item in response_rows if item.get("inferred_response")]
    legacy_contact_rows = [item for item in response_rows if item.get("legacy_contact")]
    no_response_24h_rows = [item for item in verified_contact_rows if item.get("over_24h")]
    verified_contacted = len(verified_contact_rows)
    verified_responded = len(verified_response_rows)
    verified_response_rate = round((verified_responded / verified_contacted * 100), 1) if verified_contacted else 0
    response_times = [int(item["response_time_minutes"]) for item in verified_response_rows if item.get("response_time_minutes") is not None]
    average_response_minutes = round(sum(response_times) / len(response_times)) if response_times else None

    meeting_leads = {str(item.get("lead_id") or "") for item in meeting_calls if item.get("lead_id")}
    revenue = sum(float(item.get("sale_amount") or 0) for item in sale_calls)

    status_counts: dict[str, int] = {name: 0 for name in STATUSES}
    for item in saved_leads:
        item_status = str(item.get("status") or "Nuevo")
        status_counts[item_status] = status_counts.get(item_status, 0) + 1

    activity_by_day: list[dict[str, Any]] = []
    period_end = date_to or today
    period_start = date_from or (period_end - timedelta(days=6))
    if (period_end - period_start).days > 30:
        period_start = period_end - timedelta(days=29)
    call_days: dict[str, int] = {}
    for item in calls:
        item_date = local_date(item.get("occurred_at"))
        if item_date:
            key = item_date.isoformat()
            call_days[key] = call_days.get(key, 0) + 1
    cursor = period_start
    while cursor <= period_end:
        activity_by_day.append({"date": cursor.isoformat(), "count": call_days.get(cursor.isoformat(), 0)})
        cursor += timedelta(days=1)

    recent_calls = [call_detail(item) for item in calls[:20]]
    saved_rows = [lead_summary(item) for item in saved_leads]
    saved_rows.sort(key=lambda item: str(item.get("capture_date") or ""), reverse=True)

    distinct_statuses = sorted({str(item.get("status") or "") for item in active_leads if item.get("status")})
    distinct_tiers = [name for name in ["A", "B", "C", "Descartar"] if any(str(item.get("final_tier") or "") == name for item in active_leads)]
    distinct_outcomes = sorted({str(item.get("outcome") or "") for item in active_leads if item.get("outcome")})

    detail_limit = 250
    return {
        "generated_at": utcnow_iso(),
        "total_leads": len(saved_leads),
        "portfolio_total": len(saved_leads),
        "tier_a": sum(1 for item in saved_leads if item.get("final_tier") == "A"),
        "tier_b": sum(1 for item in saved_leads if item.get("final_tier") == "B"),
        "followups_due": len(overdue_leads),
        "worked_leads": len(worked_rows),
        "contact_activities": len(calls),
        "contacted_period": len(period_contacted_ids),
        "responded_period": len(period_responded_ids),
        "verified_contacted": verified_contacted,
        "verified_responded": verified_responded,
        "verified_response_rate": verified_response_rate,
        "average_response_minutes": average_response_minutes,
        "inferred_responses": len(inferred_response_rows),
        "legacy_contacts": len(legacy_contact_rows),
        "no_response_24h": len(no_response_24h_rows),
        # Compatibilidad con el frontend anterior durante un despliegue parcial.
        "connected": verified_responded,
        "contacted_global": verified_contacted,
        "responded_global": verified_responded,
        "response_rate": verified_response_rate,
        "contact_rate": verified_response_rate,
        "meetings": len(meeting_calls),
        "sales": len(sale_calls),
        "revenue": revenue,
        "meeting_rate": round((len(meeting_leads) / len(worked_rows) * 100), 1) if worked_rows else 0,
        "status_counts": status_counts,
        "activity_by_day": activity_by_day,
        "recent_calls": recent_calls,
        "details": {
            "saved": saved_rows[:detail_limit],
            "worked": worked_rows[:detail_limit],
            "overdue": overdue_leads[:detail_limit],
            "contacts_period": period_contact_rows[:detail_limit],
            "responses": response_rows[:detail_limit],
            "contacts": response_rows[:detail_limit],
            "meetings": [call_detail(item) for item in meeting_calls[:detail_limit]],
            "sales": [call_detail(item) for item in sale_calls[:detail_limit]],
        },
        "detail_totals": {
            "saved": len(saved_rows),
            "worked": len(worked_rows),
            "overdue": len(overdue_leads),
            "contacts_period": len(period_contact_rows),
            "responses": len(response_rows),
            "contacts": len(response_rows),
            "meetings": len(meeting_calls),
            "sales": len(sale_calls),
        },
        "response_breakdown": {
            "contacted": verified_contacted,
            "verified": verified_responded,
            "responded": verified_responded,
            "inferred": len(inferred_response_rows),
            "without_response": max(0, verified_contacted - verified_responded),
            "over_24h": len(no_response_24h_rows),
            "legacy_contacts": len(legacy_contact_rows),
        },
        "filter_options": {
            "profiles": profiles,
            "statuses": distinct_statuses or STATUSES,
            "tiers": distinct_tiers or ["A", "B", "C", "Descartar"],
            "outcomes": distinct_outcomes,
        },
    }

@app.get("/api/export/leads")
def export_leads(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    worked_only: bool = False,
) -> Any:
    leads = _fetch_all("leads")
    if user.role != "admin":
        leads = [
            lead for lead in leads
            if str(lead.get("owner_id") or "") == user.id
            and (user.operating_country == "ALL" or _normalized_country(lead.get("country_code")) == _normalized_country(user.operating_country))
        ]
    if worked_only:
        leads = [lead for lead in leads if int(lead.get("contact_attempts") or 0) > 0 or lead.get("status") not in {"Nuevo", "Investigando"}]
    filename = f"aura-grow_leads_{'trabajados' if worked_only else 'completos'}_{date.today().isoformat()}.csv"
    return csv_response(leads, LEAD_EXPORT_FIELDS, filename)


@app.get("/api/export/call-logs")
def export_call_logs(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    search: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    channel: str | None = None,
    outcome: str | None = None,
    conversation_status: str | None = None,
    outcome_stage: str | None = None,
    agent_id: str | None = None,
) -> Any:
    effective_agent_id = user.id if user.role != "admin" else agent_id
    calls = _fetch_filtered_call_logs(
        search=search,
        date_from=date_from,
        date_to=date_to,
        channel=channel,
        outcome=outcome,
        conversation_status=conversation_status,
        outcome_stage=outcome_stage,
        agent_id=effective_agent_id,
    )
    filtered = any([search, date_from, date_to, channel, outcome, conversation_status, outcome_stage, agent_id])
    suffix = "filtrado_" if filtered else ""
    return csv_response(
        calls,
        CALL_EXPORT_FIELDS,
        f"aura-grow_call_log_{suffix}{date.today().isoformat()}.csv",
    )


@app.get("/api/export/consolidated")
def export_consolidated(user: Annotated[CurrentUser, Depends(get_current_user)]) -> Any:
    leads = _fetch_all("leads")
    calls = _fetch_all("call_logs")
    if user.role != "admin":
        leads = [
            lead for lead in leads
            if str(lead.get("owner_id") or "") == user.id
            and (user.operating_country == "ALL" or _normalized_country(lead.get("country_code")) == _normalized_country(user.operating_country))
        ]
        lead_ids = {str(lead.get("id")) for lead in leads}
        calls = [call for call in calls if str(call.get("lead_id") or "") in lead_ids and str(call.get("agent_id") or "") == user.id]
    rows, fields = consolidated_rows(leads, calls)
    return csv_response(rows, fields, f"aura-grow_metricas_consolidadas_{date.today().isoformat()}.csv")


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Any, exc: Exception) -> JSONResponse:
    logger.exception("Error no controlado")
    return JSONResponse(status_code=500, content={"detail": "Ocurrió un error interno"})
