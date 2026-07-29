from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
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
from .exports import CALL_EXPORT_FIELDS, LEAD_EXPORT_FIELDS, consolidated_rows, csv_response
from .google_places import build_queries, is_hard_excluded, place_to_lead, search_text
from .models import (
    AdminUserCreate, AdminUserDelete, AdminUserUpdate, CallLogCreate, ChatAnalysisRequest, LeadUpdate,
    ScoringTemplateCreate, SearchJobCreate,
)
from .scoring import (
    SCORING_CATALOG,
    calculate_configured_score,
    get_scoring_preset,
    normalize_manual_scores,
)

settings = get_settings()
logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO))
logger = logging.getLogger("aura-grow")

app = FastAPI(title=settings.app_name, version="3.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

app.include_router(diagnose_router)


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
    score += outcome_points
    if outcome_points >= 14:
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


def _base_lead_count_query() -> Any:
    return (
        get_supabase().table("leads")
        .select("id", count="exact")
        .eq("archived", False)
        .is_("excluded_reason", "null")
    )


def _pending_lead_count() -> int:
    return _count(
        _base_lead_count_query()
        .in_("status", PENDING_STATUSES)
        .eq("do_not_contact", False)
    )


def _lead_capacity_snapshot() -> dict[str, Any]:
    pending = _pending_lead_count()
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
    profile_rows = _fetch_all("profiles", "id,full_name,role,is_active,created_at,updated_at")
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
def health() -> dict[str, str]:
    return {"status": "ok", "service": settings.app_name}


@app.get("/api/me")
def me(user: Annotated[CurrentUser, Depends(get_current_user)]) -> dict[str, Any]:
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
        "features": {"diagnose": user_feature_enabled(user.id, "diagnose")},
    }


@app.get("/api/profiles")
def profiles(user: Annotated[CurrentUser, Depends(get_current_user)]) -> list[dict[str, Any]]:
    response = (
        get_supabase().table("profiles")
        .select("id,full_name,role,is_active")
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
    profile_response = db.table("profiles").select("id,role,is_active").eq("id", target_user_id).limit(1).execute()
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
    }


@app.get("/api/lead-capacity")
def lead_capacity(user: Annotated[CurrentUser, Depends(get_current_user)]) -> dict[str, Any]:
    return _lead_capacity_snapshot()


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
) -> list[dict[str, Any]]:
    query = get_supabase().table("scoring_templates").select("*").order("is_default", desc=True).order("updated_at", desc=True)
    if niche:
        query = query.eq("niche", niche)
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
    capacity = _lead_capacity_snapshot()
    if not capacity["generation_enabled"]:
        raise HTTPException(status_code=409, detail=capacity["message"])

    effective_max_results = min(payload.max_results, int(capacity["max_new_leads"]))
    if effective_max_results < 1:
        raise HTTPException(status_code=409, detail="La base ya alcanzó su capacidad operativa de leads pendientes.")

    budget = min(payload.api_request_budget, settings.max_api_budget_per_job)
    queries = build_queries(payload.niche, payload.city, payload.zones, payload.services)
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
        "city": payload.city,
        "zones": payload.zones,
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
    exclusion = is_hard_excluded(place, job["niche"])
    is_new_pending = existing is None and not exclusion

    lead_data = place_to_lead(place, job["niche"], query_text)
    lead_data["excluded_reason"] = exclusion
    lead_data["zone"] = None
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
            capacity_reached = _pending_lead_count() >= LEAD_CAPACITY_MAX

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
            response, from_cache = search_text(query=query_text, page_token=job.get("current_page_token"))
            if not from_cache:
                budget_used += 1
            places = response.get("places") or []
            for place in places:
                if new_leads_added >= int(job["max_results"]):
                    break
                if _pending_lead_count() >= LEAD_CAPACITY_MAX:
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


@app.get("/api/focus")
def aura_focus(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    scope: str = Query(default="mine", pattern="^(mine|all)$"),
    bucket: str = Query(default="priority", pattern="^(priority|active|waiting|followups)$"),
    limit: int = Query(default=100, ge=1, le=200),
) -> dict[str, Any]:
    today = panama_today()
    leads = _fetch_all("leads")
    profiles = _profile_map()
    all_items: list[dict[str, Any]] = []

    for lead in leads:
        owner_id = str(lead.get("owner_id") or "")
        if user.role != "admin" or scope == "mine":
            if owner_id and owner_id != user.id:
                continue
        enriched = _focus_priority(lead, today)
        if not enriched:
            continue
        enriched["owner_name"] = profiles.get(owner_id, "Sin asignar") if owner_id else "Sin asignar"
        all_items.append(enriched)

    active_items = [item for item in all_items if item.get("conversation_status") in ACTIVE_CONVERSATION_STATUSES]
    waiting_items = [item for item in all_items if item.get("conversation_status") == "waiting_response"]
    followup_items = [item for item in all_items if item.get("due_state") in {"overdue", "today"} or item.get("response_due_state") in {"overdue", "today"}]
    priority_items = [
        item for item in all_items
        if not (
            item.get("conversation_status") == "waiting_response"
            and item.get("response_due_state") not in {"overdue", "today"}
            and item.get("due_state") not in {"overdue", "today"}
        )
        and not (
            item.get("contacted_today")
            and item.get("conversation_status") not in ACTIVE_CONVERSATION_STATUSES
            and item.get("due_state") not in {"overdue", "today"}
            and item.get("response_due_state") not in {"overdue", "today"}
        )
    ]

    bucket_map = {
        "priority": priority_items,
        "active": active_items,
        "waiting": waiting_items,
        "followups": followup_items,
    }
    items = bucket_map[bucket]
    items.sort(
        key=lambda item: (
            int(item.get("priority_score") or 0),
            int(item.get("final_score") or 0),
            str(item.get("updated_at") or ""),
        ),
        reverse=True,
    )
    total = len(items)
    selected = items[:limit]
    return {
        "items": selected,
        "total": total,
        "overdue": sum(1 for item in all_items if item.get("due_state") == "overdue" or item.get("response_due_state") == "overdue"),
        "due_today": sum(1 for item in all_items if item.get("due_state") == "today" or item.get("response_due_state") == "today"),
        "unassigned": sum(1 for item in all_items if not item.get("owner_id")),
        "active_conversations": len(active_items),
        "waiting_responses": len(waiting_items),
        "followups": len(followup_items),
        "priorities": len(priority_items),
        "bucket": bucket,
        "scope": "all" if user.role == "admin" and scope == "all" else "mine",
        "generated_at": datetime.now(PANAMA_TZ).isoformat(),
    }


@app.get("/api/leads/view-counts")
def lead_view_counts(user: Annotated[CurrentUser, Depends(get_current_user)]) -> dict[str, int]:
    db = get_supabase()

    def base() -> Any:
        return (
            db.table("leads")
            .select("id", count="exact")
            .eq("archived", False)
            .is_("excluded_reason", "null")
        )

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
    followup_due: bool = False,
    include_excluded: bool = False,
    view: str = Query(default="all", pattern="^(all|pending|worked|contacted|followup|do_not_contact|discarded)$"),
    work_state: str | None = Query(default=None, pattern="^(all|pending|worked)$"),
) -> dict[str, Any]:
    db = get_supabase()
    start = (page - 1) * page_size
    query = db.table("leads").select("*", count="exact").eq("archived", False)
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


@app.get("/api/leads/{lead_id}")
def get_lead(lead_id: str, user: Annotated[CurrentUser, Depends(get_current_user)]) -> dict[str, Any]:
    db = get_supabase()
    lead = _first(db.table("leads").select("*").eq("id", lead_id).limit(1).execute())
    if not lead:
        raise HTTPException(status_code=404, detail="Lead no encontrado")
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
    changes = payload.model_dump(exclude_unset=True, mode="json")
    if "status" in changes and changes["status"] not in STATUSES:
        raise HTTPException(status_code=400, detail="Estado inválido")
    if not changes:
        return lead
    merged = {**lead, **changes}
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
    return analyze_chat(payload.transcript, channel=payload.channel, today=panama_today())


@app.post("/api/leads/{lead_id}/call-logs")
def create_call_log(
    lead_id: str,
    payload: CallLogCreate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> dict[str, Any]:
    db = get_supabase()
    lead = _first(
        db.table("leads")
        .select("id,status,first_contact_date,contact_attempts,conversation_status")
        .eq("id", lead_id)
        .limit(1)
        .execute()
    )
    if not lead:
        raise HTTPException(status_code=404, detail="Lead no encontrado")

    occurred_at = payload.occurred_at or datetime.now(timezone.utc)
    response_due_at = payload.response_due_at
    if payload.awaiting_response and not response_due_at:
        response_due_at = _default_response_due(payload.channel, occurred_at)

    row = payload.model_dump(mode="json")
    row["lead_id"] = lead_id
    row["agent_id"] = user.id
    row["occurred_at"] = occurred_at.isoformat()
    row["response_due_at"] = response_due_at.isoformat() if response_due_at else None
    row["is_final_outcome"] = bool(payload.is_final_outcome or payload.outcome_stage == "final")
    if row["is_final_outcome"]:
        row["outcome_stage"] = "final"
    response = db.table("call_logs").insert(row).execute()
    call = _first(response) or row

    attempt_count = int(lead.get("contact_attempts") or 0)
    if _counts_as_contact_attempt(payload):
        rpc_data = db.rpc("increment_lead_contact_attempts", {"p_lead_id": lead_id}).execute().data
        if isinstance(rpc_data, list):
            attempt_count = int(rpc_data[0]) if rpc_data else attempt_count + 1
        else:
            attempt_count = int(rpc_data or attempt_count + 1)

    lead_update: dict[str, Any] = {
        "last_contact_date": row["occurred_at"],
        "owner_id": user.id,
        "contact_attempts": attempt_count,
        "conversation_status": payload.conversation_status,
        "conversation_status_changed_at": row["occurred_at"],
        "outcome_stage": row["outcome_stage"],
    }

    if payload.outcome and payload.outcome != "Pendiente":
        lead_update["outcome"] = payload.outcome
    if payload.direction == "Entrante" or payload.activity_type == "response_received":
        lead_update["last_inbound_at"] = row["occurred_at"]
        lead_update["waiting_since"] = None
        lead_update["response_due_at"] = None
    elif _counts_as_contact_attempt(payload):
        lead_update["last_outbound_at"] = row["occurred_at"]
    if payload.awaiting_response:
        lead_update["waiting_since"] = row["occurred_at"]
        lead_update["response_due_at"] = row["response_due_at"]
    elif payload.conversation_status != "waiting_response":
        lead_update["waiting_since"] = None
        if payload.conversation_status in ACTIVE_CONVERSATION_STATUSES or payload.conversation_status == "closed":
            lead_update["response_due_at"] = None

    if not lead.get("first_contact_date") and _counts_as_contact_attempt(payload):
        lead_update["first_contact_date"] = panama_today().isoformat()
    if payload.followup_date:
        lead_update["next_followup_date"] = payload.followup_date.isoformat()

    if row["is_final_outcome"]:
        lead_update["final_outcome_at"] = row["occurred_at"]

    outcome_status = {
        "Respondió": "Respondió",
        "Solicitó información": "Respondió",
        "Interesado": "Interesado",
        "Reunión agendada": "Reunión agendada",
        "No interesado": "No interesado",
        "No califica": "No califica",
        "Número incorrecto": "No califica",
        "Venta": "Implementación vendida",
    }.get(payload.outcome)
    if outcome_status:
        lead_update["status"] = outcome_status
    elif payload.conversation_status in ACTIVE_CONVERSATION_STATUSES:
        lead_update["status"] = "Respondió"
    elif payload.conversation_status == "followup_scheduled":
        lead_update["status"] = "Seguimiento 1"
    elif payload.conversation_status == "waiting_response" and lead.get("status") in {"Nuevo", "Investigando", "Listo para contactar"}:
        lead_update["status"] = "Contactado"

    db.table("leads").update(lead_update).eq("id", lead_id).execute()
    description_outcome = payload.outcome if payload.outcome != "Pendiente" else payload.conversation_status
    _log_activity(
        lead_id,
        user.id,
        "contact_logged",
        f"{payload.channel}: {description_outcome}",
        {
            "call_log_id": call.get("id"),
            "activity_type": payload.activity_type,
            "conversation_status": payload.conversation_status,
            "outcome_stage": row["outcome_stage"],
        },
    )
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
    response = (
        get_supabase().table("leads").select("*")
        .lte("next_followup_date", target)
        .not_.in_("status", ["Descartado", "No interesado", "No califica", "Implementación vendida"])
        .eq("archived", False)
        .order("next_followup_date")
        .limit(500)
        .execute()
    )
    return response.data or []


@app.get("/api/dashboard")
def dashboard(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    date_from: date | None = None,
    date_to: date | None = None,
) -> dict[str, Any]:
    db = get_supabase()
    total = _count(
        db.table("leads").select("id", count="exact").eq("archived", False).is_("excluded_reason", "null")
    )
    tier_a = _count(
        db.table("leads").select("id", count="exact").eq("archived", False).is_("excluded_reason", "null").eq("final_tier", "A")
    )
    tier_b = _count(
        db.table("leads").select("id", count="exact").eq("archived", False).is_("excluded_reason", "null").eq("final_tier", "B")
    )
    due = _count(
        db.table("leads").select("id", count="exact").eq("archived", False).lte("next_followup_date", date.today().isoformat())
        .not_.in_("status", ["Descartado", "No interesado", "No califica", "Implementación vendida"])
    )
    status_counts: dict[str, int] = {}
    for status_name in STATUSES:
        status_counts[status_name] = _count(
            db.table("leads").select("id", count="exact").eq("archived", False).eq("status", status_name)
        )

    call_query = db.table("call_logs").select("*").order("occurred_at", desc=True).limit(5000)
    if date_from:
        call_query = call_query.gte("occurred_at", f"{date_from.isoformat()}T00:00:00Z")
    if date_to:
        call_query = call_query.lte("occurred_at", f"{date_to.isoformat()}T23:59:59Z")
    calls = call_query.execute().data or []
    non_contact = {"No respondió", "Buzón de voz", "Número incorrecto", "Pendiente"}
    connected = sum(
        1 for item in calls
        if item.get("direction") == "Entrante"
        or item.get("activity_type") == "response_received"
        or item.get("outcome") not in non_contact
    )
    meetings = sum(1 for item in calls if item.get("appointment_booked") or item.get("outcome") == "Reunión agendada")
    sales = sum(1 for item in calls if item.get("outcome") == "Venta" or float(item.get("sale_amount") or 0) > 0)
    revenue = sum(float(item.get("sale_amount") or 0) for item in calls)
    worked_leads = len({item.get("lead_id") for item in calls if item.get("lead_id")})

    return {
        "total_leads": total,
        "tier_a": tier_a,
        "tier_b": tier_b,
        "followups_due": due,
        "worked_leads": worked_leads,
        "contact_activities": len(calls),
        "connected": connected,
        "meetings": meetings,
        "sales": sales,
        "revenue": revenue,
        "contact_rate": round((connected / len(calls) * 100), 1) if calls else 0,
        "meeting_rate": round((meetings / worked_leads * 100), 1) if worked_leads else 0,
        "status_counts": status_counts,
        "recent_calls": calls[:10],
    }


@app.get("/api/export/leads")
def export_leads(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    worked_only: bool = False,
) -> Any:
    leads = _fetch_all("leads")
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
    calls = _fetch_filtered_call_logs(
        search=search,
        date_from=date_from,
        date_to=date_to,
        channel=channel,
        outcome=outcome,
        conversation_status=conversation_status,
        outcome_stage=outcome_stage,
        agent_id=agent_id,
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
    rows, fields = consolidated_rows(leads, calls)
    return csv_response(rows, fields, f"aura-grow_metricas_consolidadas_{date.today().isoformat()}.csv")


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Any, exc: Exception) -> JSONResponse:
    logger.exception("Error no controlado")
    return JSONResponse(status_code=500, content={"detail": "Ocurrió un error interno"})
