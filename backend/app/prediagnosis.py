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
    country: str | None = Field(default=None, max_length=80)
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


COUNTRY_PHONE_META: dict[str, dict[str, str]] = {
    "AR": {"dial": "54", "name": "Argentina"},
    "BO": {"dial": "591", "name": "Bolivia"},
    "BR": {"dial": "55", "name": "Brasil"},
    "CA": {"dial": "1", "name": "Canadá"},
    "CL": {"dial": "56", "name": "Chile"},
    "CO": {"dial": "57", "name": "Colombia"},
    "CR": {"dial": "506", "name": "Costa Rica"},
    "DO": {"dial": "1", "name": "República Dominicana"},
    "EC": {"dial": "593", "name": "Ecuador"},
    "ES": {"dial": "34", "name": "España"},
    "GT": {"dial": "502", "name": "Guatemala"},
    "HN": {"dial": "504", "name": "Honduras"},
    "MX": {"dial": "52", "name": "México"},
    "NI": {"dial": "505", "name": "Nicaragua"},
    "PA": {"dial": "507", "name": "Panamá"},
    "PE": {"dial": "51", "name": "Perú"},
    "PR": {"dial": "1", "name": "Puerto Rico"},
    "PY": {"dial": "595", "name": "Paraguay"},
    "SV": {"dial": "503", "name": "El Salvador"},
    "US": {"dial": "1", "name": "Estados Unidos"},
    "UY": {"dial": "598", "name": "Uruguay"},
    "VE": {"dial": "58", "name": "Venezuela"},
}

COUNTRY_ALIASES = {
    "argentina": "AR", "bolivia": "BO", "brasil": "BR", "brazil": "BR",
    "canada": "CA", "canadá": "CA", "chile": "CL", "colombia": "CO",
    "costa rica": "CR", "republica dominicana": "DO", "república dominicana": "DO",
    "ecuador": "EC", "espana": "ES", "españa": "ES", "guatemala": "GT",
    "honduras": "HN", "mexico": "MX", "méxico": "MX", "nicaragua": "NI",
    "panama": "PA", "panamá": "PA", "peru": "PE", "perú": "PE",
    "puerto rico": "PR", "paraguay": "PY", "el salvador": "SV",
    "estados unidos": "US", "united states": "US", "usa": "US",
    "uruguay": "UY", "venezuela": "VE",
}


def _normalize_country_code(value: str | None) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    upper = raw.upper()
    if upper in COUNTRY_PHONE_META:
        return upper
    return COUNTRY_ALIASES.get(raw.lower())


def _normalize_phone(value: str | None, country: str | None = None, *, strict: bool = True) -> str | None:
    raw = str(value or "").strip()
    digits = _digits(raw)
    if not digits:
        return None

    # Explicit international number always wins.
    explicit_international = raw.startswith("+") or raw.startswith("00")
    if raw.startswith("00"):
        digits = digits[2:]

    if not explicit_international:
        country_code = _normalize_country_code(country)
        dial = (COUNTRY_PHONE_META.get(country_code or "") or {}).get("dial")
        if not dial:
            if strict:
                raise HTTPException(
                    status_code=422,
                    detail="Incluye el código de país en el WhatsApp o selecciona el país.",
                )
            return None
        if not digits.startswith(dial):
            digits = f"{dial}{digits}"

    if len(digits) < 8 or len(digits) > 15:
        if strict:
            raise HTTPException(status_code=422, detail="Ingresa un WhatsApp válido con código de país.")
        return None
    return f"+{digits}"


def _normalize_existing_lead_phone(lead: dict[str, Any], fallback_country: str | None = None) -> str | None:
    country = lead.get("country_code") or fallback_country
    for field in ("whatsapp_phone", "phone"):
        normalized = _normalize_phone(lead.get(field), country, strict=False)
        if normalized:
            return normalized
    return None

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
    normalized = _normalized_url(value)
    if not normalized:
        return False
    try:
        host = (urlparse(normalized).hostname or "").lower()
    except Exception:
        return False
    return host == "instagram.com" or host.endswith(".instagram.com")


def _first(response: Any) -> dict[str, Any] | None:
    return (response.data or [None])[0]


def _match_existing_lead(payload: PublicPrediagnosisIntake) -> tuple[dict[str, Any] | None, str | None]:
    db = get_supabase()
    phone = _normalize_phone(payload.phone, payload.country)
    email = payload.email
    normalized_url = _normalized_url(payload.url)

    if phone:
        # Exact normalized match first, then normalize legacy/local numbers
        # with each lead's own country context before comparing.
        lead = _first(db.table("leads").select("*").eq("whatsapp_phone", phone).limit(1).execute())
        if not lead:
            candidates = db.table("leads").select("*").limit(1000).execute().data or []
            lead = next(
                (
                    item for item in candidates
                    if _normalize_existing_lead_phone(item, payload.country) == phone
                ),
                None,
            )
        if lead:
            return lead, "phone"

    if email:
        candidates = db.table("leads").select("*").not_.is_("email", "null").limit(500).execute().data or []
        lead = next((item for item in candidates if str(item.get("email") or "").strip().lower() == email), None)
        if lead:
            return lead, "email"

    if normalized_url:
        column = "instagram_url" if _is_instagram(payload.url) else "website"
        candidates = db.table("leads").select("*").not_.is_(column, "null").limit(1000).execute().data or []
        lead = next((item for item in candidates if _normalized_url(item.get(column)) == normalized_url), None)
        if lead:
            return lead, column

    return None, None


def _create_inbound_lead(payload: PublicPrediagnosisIntake) -> dict[str, Any]:
    db = get_supabase()
    country_code = _normalize_country_code(payload.country)
    normalized_phone = _normalize_phone(payload.phone, country_code)
    normalized_url = _normalized_url(payload.url)
    is_instagram = _is_instagram(payload.url)
    country_meta = COUNTRY_PHONE_META.get(country_code or "", {})
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
        "country_code": country_code,
        "country_name": country_meta.get("name") or str(payload.country or "").strip() or None,
        "commercial_team": country_code,
        "notes": "Lead inbound creado al completar el Pre-Diagnóstico AURA.",
    }
    created = db.table("leads").insert(row).execute().data or []
    if not created:
        raise HTTPException(status_code=500, detail="No se pudo registrar el lead en Aura.")
    return created[0]


def _update_missing_lead_contacts(lead: dict[str, Any], payload: PublicPrediagnosisIntake) -> None:
    changes: dict[str, Any] = {}
    normalized_phone = _normalize_phone(payload.phone, lead.get("country_code") or payload.country)
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
        "country_code": _normalize_country_code(payload.country) or lead.get("country_code"),
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
        "contact_phone": _normalize_phone(payload.phone, payload.country or lead.get("country_code")),
        "contact_email": payload.email,
        "signal_demand": payload.signal_demand,
        "signal_response": payload.signal_response,
        "signal_management": payload.signal_management,
        "signal_followup": payload.signal_followup,
        "signal_measurement": payload.signal_measurement,
        "signal_capacity": payload.signal_capacity,
        "probable_leak_area": payload.probable_leak_area,
        "secondary_area": payload.secondary_area,
        "eligibility": payload.eligibility,
        "confidence": payload.confidence,
        "next_action": payload.next_action,
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
        "description": f"Pre-Diagnóstico AURA completado · {payload.probable_leak_area} · {payload.eligibility}",
        "metadata": {
            "prediagnosis_id": prediagnosis["id"],
            "eligibility": payload.eligibility,
            "probable_leak_area": payload.probable_leak_area,
            "secondary_area": payload.secondary_area,
            "confidence": payload.confidence,
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
