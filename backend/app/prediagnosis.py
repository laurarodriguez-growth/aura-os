from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Annotated, Any, Literal
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from .auth import CurrentUser, require_diagnose
from .db import get_supabase

router = APIRouter(prefix="/api", tags=["Pre-Diagnóstico AURA"])

SignalState = Literal["controlled", "attention", "strong", "insufficient_data"]
Eligibility = Literal["eligible", "needs_more_info", "not_ready"]


class PublicPrediagnosisIntake(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    company: str = Field(min_length=2, max_length=200)
    sector: str = Field(min_length=2, max_length=160)
    country: str | None = Field(default="PA", max_length=80)
    url: str | None = Field(default=None, max_length=500)
    sales_model: str = Field(min_length=1, max_length=120)
    channels: list[str] = Field(default_factory=list, max_length=12)
    volume: str = Field(min_length=1, max_length=80)
    response: str = Field(min_length=1, max_length=120)
    tracking: str = Field(min_length=1, max_length=160)
    followup: str = Field(min_length=1, max_length=160)
    owner_next_step: str = Field(min_length=1, max_length=80)
    conversion_knowledge: str = Field(min_length=1, max_length=80)
    problem: str = Field(min_length=1, max_length=2000)
    goal: str = Field(min_length=1, max_length=2000)
    urgency: str = Field(min_length=1, max_length=120)
    capacity: str = Field(min_length=1, max_length=120)
    investment: str = Field(min_length=1, max_length=120)
    phone: str = Field(min_length=7, max_length=40)
    email: str | None = Field(default=None, max_length=255)

    signal_demand: SignalState
    signal_response: SignalState
    signal_management: SignalState
    signal_followup: SignalState
    signal_measurement: SignalState
    signal_capacity: SignalState
    probable_leak_area: str = Field(min_length=1, max_length=80)
    secondary_area: str | None = Field(default=None, max_length=80)
    eligibility: Eligibility
    confidence: Literal["preliminary"] = "preliminary"
    next_action: str = Field(min_length=1, max_length=1000)

    source_page: str | None = Field(default=None, max_length=1000)
    form_version: str = Field(default="website-prediagnosis-v2", max_length=80)
    submission_id: str | None = Field(default=None, max_length=120)
    website_confirm: str | None = Field(default=None, max_length=200)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str | None) -> str | None:
        if not value:
            return None
        return value.strip().lower()


class PrediagnosisListFilters(BaseModel):
    eligibility: str | None = None
    zone: str | None = None
    sector: str | None = None
    search: str | None = None


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def _digits(value: str | None) -> str:
    return re.sub(r"\D", "", str(value or ""))


def _normalize_phone(value: str | None) -> str | None:
    digits = _digits(value)
    if not digits:
        return None
    if len(digits) in {7, 8}:
        digits = f"507{digits}"
    if len(digits) < 8 or len(digits) > 15:
        raise HTTPException(status_code=422, detail="Ingresa un WhatsApp válido.")
    return f"+{digits}"


def _normalized_url(value: str | None) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    if raw.startswith("@"):
        return f"https://instagram.com/{raw[1:].strip('/').lower()}"
    candidate = raw if re.match(r"^https?://", raw, re.I) else f"https://{raw}"
    try:
        parsed = urlparse(candidate)
        host = (parsed.hostname or "").lower().removeprefix("www.")
        path = parsed.path.rstrip("/")
        if not host:
            return raw.lower().rstrip("/")
        return f"https://{host}{path}".lower()
    except Exception:
        return raw.lower().rstrip("/")


def _is_instagram(value: str | None) -> bool:
    normalized = _normalized_url(value) or ""
    return "instagram.com/" in normalized


def _first(response: Any) -> dict[str, Any] | None:
    return (response.data or [None])[0]


def _evaluate_payload(payload: PublicPrediagnosisIntake) -> dict[str, Any]:
    rank = {"controlled": 0, "attention": 1, "strong": 2, "insufficient_data": -1}

    demand = "attention" if payload.volume == "0 a 20" else "controlled"
    response = (
        "insufficient_data" if payload.response == "No sabemos"
        else "controlled" if payload.response == "Menos de 15 minutos"
        else "attention" if payload.response == "15 a 60 minutos"
        else "strong"
    )
    if payload.tracking == "No se registran" or payload.owner_next_step == "No":
        management = "strong"
    elif payload.tracking in {"Solo en WhatsApp o Instagram", "Excel o notas"} or payload.owner_next_step in {"La mayoría", "Algunas"}:
        management = "attention"
    elif payload.owner_next_step == "No sabemos":
        management = "insufficient_data"
    else:
        management = "controlled"
    followup = "controlled" if payload.followup == "Existe una secuencia definida" else "strong" if payload.followup == "No se da seguimiento" else "attention"
    measurement = "controlled" if payload.conversion_knowledge == "Sí, lo medimos" else "attention" if payload.conversion_knowledge == "Tenemos una estimación" else "strong"
    capacity = "insufficient_data" if payload.capacity == "No lo sabemos" else "controlled" if payload.capacity == "Sí" else "attention" if payload.capacity == "Sí, pero con dificultad" else "strong"

    signals = {
        "demanda": {"state": demand, "zone": "Consulta"},
        "respuesta": {"state": response, "zone": "Respuesta"},
        "gestion": {"state": management, "zone": "Gestión"},
        "seguimiento": {"state": followup, "zone": "Seguimiento"},
        "medicion": {"state": measurement, "zone": "Medición"},
        "capacidad": {"state": capacity, "zone": "Capacidad"},
    }
    tie_order = ["Seguimiento", "Respuesta", "Gestión", "Medición", "Capacidad", "Consulta"]
    ranked = sorted(
        [item for item in signals.values() if rank[item["state"]] >= 1],
        key=lambda item: (-rank[item["state"]], tie_order.index(item["zone"])),
    )
    probable = ranked[0]["zone"] if ranked else "Gestión"
    secondary = next((item["zone"] for item in ranked if item["zone"] != probable), None)
    unknowns = sum(1 for item in signals.values() if item["state"] == "insufficient_data")
    strong_count = sum(1 for item in signals.values() if item["state"] == "strong")
    attention_count = sum(1 for item in signals.values() if item["state"] == "attention")
    enough_volume = payload.volume != "0 a 20"

    if payload.capacity == "No":
        eligibility: Eligibility = "not_ready"
    elif unknowns >= 2:
        eligibility = "needs_more_info"
    elif enough_volume and (strong_count >= 1 or attention_count >= 2):
        eligibility = "eligible"
    elif not enough_volume and strong_count == 0:
        eligibility = "not_ready"
    elif strong_count == 0 and attention_count == 0:
        eligibility = "not_ready"
    else:
        eligibility = "needs_more_info"

    if eligibility == "eligible":
        next_action = "Revisar evidencia real en un Diagnóstico AURA completo."
    elif eligibility == "needs_more_info":
        next_action = "Completar contexto con Laura antes de decidir si conviene avanzar al Diagnóstico AURA completo."
    elif payload.capacity == "No":
        next_action = "Ordenar primero la capacidad operativa antes de ampliar o automatizar el proceso."
    else:
        next_action = "Mantener un registro básico y revisar nuevamente cuando exista más volumen o una pérdida repetida que pueda comprobarse."

    return {
        "signals": signals,
        "probable_leak_area": probable,
        "secondary_area": secondary,
        "eligibility": eligibility,
        "confidence": "preliminary",
        "next_action": next_action,
    }


def _match_existing_lead(payload: PublicPrediagnosisIntake) -> tuple[dict[str, Any] | None, str | None]:
    db = get_supabase()
    phone = _normalize_phone(payload.phone)
    email = payload.email
    normalized_url = _normalized_url(payload.url)

    if phone:
        lead = _first(db.table("leads").select("*").eq("whatsapp_phone", phone).limit(1).execute())
        if not lead:
            digits = _digits(phone)
            candidates = db.table("leads").select("*").limit(1000).execute().data or []
            lead = next((item for item in candidates if _digits(item.get("phone")) == digits), None)
        if lead:
            return lead, "phone"

    if email:
        candidates = db.table("leads").select("*").limit(1000).execute().data or []
        lead = next((item for item in candidates if str(item.get("email") or "").strip().lower() == email), None)
        if lead:
            return lead, "email"

    if normalized_url:
        column = "instagram_url" if _is_instagram(payload.url) else "website"
        candidates = db.table("leads").select("*").limit(1000).execute().data or []
        lead = next((item for item in candidates if _normalized_url(item.get(column)) == normalized_url), None)
        if lead:
            return lead, column

    return None, None


def _create_inbound_lead(payload: PublicPrediagnosisIntake) -> dict[str, Any]:
    db = get_supabase()
    normalized_phone = _normalize_phone(payload.phone)
    normalized_url = _normalized_url(payload.url)
    is_instagram = _is_instagram(payload.url)
    row = {
        "business_name": payload.company.strip(),
        "niche": payload.sector.strip(),
        "source": "Pre-Diagnóstico AURA",
        "status": "Nuevo",
        "phone": payload.phone.strip(),
        "whatsapp_phone": normalized_phone,
        "whatsapp_url": f"https://wa.me/{_digits(normalized_phone)}" if normalized_phone else None,
        "email": payload.email,
        "website": None if is_instagram else normalized_url,
        "instagram_url": normalized_url if is_instagram else None,
        "country_code": "PA",
        "country_name": "Panamá",
        "commercial_team": "PA",
        "notes": "Lead inbound creado al completar el Pre-Diagnóstico AURA.",
    }
    created = db.table("leads").insert(row).execute().data or []
    if not created:
        raise HTTPException(status_code=500, detail="No se pudo registrar el lead en Aura.")
    return created[0]


def _update_missing_lead_contacts(lead: dict[str, Any], payload: PublicPrediagnosisIntake) -> None:
    changes: dict[str, Any] = {}
    normalized_phone = _normalize_phone(payload.phone)
    normalized_url = _normalized_url(payload.url)
    if normalized_phone and not lead.get("whatsapp_phone"):
        changes["whatsapp_phone"] = normalized_phone
        changes["whatsapp_url"] = f"https://wa.me/{_digits(normalized_phone)}"
    if payload.email and not lead.get("email"):
        changes["email"] = payload.email
    if normalized_url:
        if _is_instagram(payload.url) and not lead.get("instagram_url"):
            changes["instagram_url"] = normalized_url
        elif not _is_instagram(payload.url) and not lead.get("website"):
            changes["website"] = normalized_url
    if changes:
        changes["updated_at"] = _utcnow()
        get_supabase().table("leads").update(changes).eq("id", lead["id"]).execute()


@router.post("/public/conversion-intake")
def public_conversion_intake(payload: PublicPrediagnosisIntake) -> dict[str, Any]:
    if payload.website_confirm:
        # Honeypot: responder éxito sin persistir para no dar señales a bots.
        return {"ok": True, "duplicate": False, "ignored": True}

    db = get_supabase()
    evaluation = _evaluate_payload(payload)
    if payload.submission_id:
        duplicate = _first(
            db.table("prediagnoses")
            .select("id,lead_id,probable_leak_area,eligibility")
            .eq("submission_id", payload.submission_id)
            .limit(1)
            .execute()
        )
        if duplicate:
            return {"ok": True, "duplicate": True, "prediagnosis_id": duplicate["id"], "lead_id": duplicate["lead_id"]}

    lead, match_method = _match_existing_lead(payload)
    created_lead = False
    if not lead:
        lead = _create_inbound_lead(payload)
        match_method = "created"
        created_lead = True
    else:
        _update_missing_lead_contacts(lead, payload)

    row = {
        "lead_id": lead["id"],
        "submission_id": payload.submission_id,
        "name": payload.name.strip(),
        "company": payload.company.strip(),
        "sector": payload.sector.strip(),
        "country_code": "PA",
        "website_or_instagram": payload.url,
        "sales_model": payload.sales_model,
        "channels": payload.channels,
        "monthly_inquiries": payload.volume,
        "first_response_time": payload.response,
        "current_record_method": payload.tracking,
        "follow_up_method": payload.followup,
        "has_owner_and_next_step": payload.owner_next_step,
        "knows_conversion": payload.conversion_knowledge,
        "perceived_problem": payload.problem,
        "desired_result": payload.goal,
        "urgency": payload.urgency,
        "capacity": payload.capacity,
        "investment_intent": payload.investment,
        "contact_phone": _normalize_phone(payload.phone),
        "contact_email": payload.email,
        "signal_demand": evaluation["signals"]["demanda"]["state"],
        "signal_response": evaluation["signals"]["respuesta"]["state"],
        "signal_management": evaluation["signals"]["gestion"]["state"],
        "signal_followup": evaluation["signals"]["seguimiento"]["state"],
        "signal_measurement": evaluation["signals"]["medicion"]["state"],
        "signal_capacity": evaluation["signals"]["capacidad"]["state"],
        "probable_leak_area": evaluation["probable_leak_area"],
        "secondary_area": evaluation["secondary_area"],
        "eligibility": evaluation["eligibility"],
        "confidence": evaluation["confidence"],
        "next_action": evaluation["next_action"],
        "source_page": payload.source_page,
        "form_version": payload.form_version,
        "match_method": match_method,
        "raw_payload": payload.model_dump(mode="json", exclude={"website_confirm"}),
    }
    created = db.table("prediagnoses").insert(row).execute().data or []
    if not created:
        raise HTTPException(status_code=500, detail="No se pudo guardar el Pre-Diagnóstico en Aura.")
    prediagnosis = created[0]

    db.table("activities").insert({
        "lead_id": lead["id"],
        "user_id": None,
        "event_type": "prediagnosis_completed",
        "description": f"Pre-Diagnóstico AURA completado · {evaluation['probable_leak_area']} · {evaluation['eligibility']}",
        "metadata": {
            "prediagnosis_id": prediagnosis["id"],
            "eligibility": evaluation["eligibility"],
            "probable_leak_area": evaluation["probable_leak_area"],
            "secondary_area": evaluation["secondary_area"],
            "confidence": evaluation["confidence"],
            "match_method": match_method,
        },
    }).execute()

    return {
        "ok": True,
        "duplicate": False,
        "created_lead": created_lead,
        "lead_id": lead["id"],
        "prediagnosis_id": prediagnosis["id"],
        "match_method": match_method,
    }


@router.get("/diagnose/prediagnoses")
def list_prediagnoses(
    user: Annotated[CurrentUser, Depends(require_diagnose)],
    eligibility: str | None = Query(default=None),
    zone: str | None = Query(default=None),
    sector: str | None = Query(default=None),
    search: str | None = Query(default=None),
    page_size: int = Query(default=100, ge=1, le=500),
) -> dict[str, Any]:
    query = get_supabase().table("prediagnoses").select("*,leads(id,business_name,status,source,owner_id,country_code)").order("created_at", desc=True).limit(page_size)
    if eligibility:
        query = query.eq("eligibility", eligibility)
    if zone:
        query = query.eq("probable_leak_area", zone)
    if sector:
        query = query.eq("sector", sector)
    items = query.execute().data or []
    term = str(search or "").strip().lower()
    if term:
        items = [
            item for item in items
            if term in " ".join([
                str(item.get("company") or ""), str(item.get("name") or ""),
                str(item.get("contact_email") or ""), str(item.get("contact_phone") or ""),
                str(item.get("sector") or ""),
            ]).lower()
        ]
    return {"items": items, "total": len(items)}


@router.get("/diagnose/prediagnoses/{prediagnosis_id}")
def get_prediagnosis(
    prediagnosis_id: str,
    user: Annotated[CurrentUser, Depends(require_diagnose)],
) -> dict[str, Any]:
    item = _first(
        get_supabase().table("prediagnoses")
        .select("*,leads(id,business_name,status,source,owner_id,country_code)")
        .eq("id", prediagnosis_id)
        .limit(1)
        .execute()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Pre-Diagnóstico no encontrado")
    return item
