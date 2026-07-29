from __future__ import annotations

import re
import unicodedata
from datetime import date, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from .auth import CurrentUser, get_current_user, require_admin
from .db import get_supabase

router = APIRouter(prefix="/api/outcomes", tags=["outcomes"])

CONVERSATION_STATUSES = {
    "not_started", "waiting_response", "response_received", "conversation_active",
    "waiting_decision_maker", "waiting_confirmation", "followup_scheduled", "closed",
}
FINAL_COMMERCIAL_STATUSES = {
    "Reunión agendada", "No interesado", "No califica", "Descartado",
    "Diagnóstico vendido", "Implementación vendida",
}


def _slug(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "_", normalized.lower()).strip("_")[:80] or "outcome"


def _first(response: Any) -> dict[str, Any] | None:
    rows = response.data or []
    return rows[0] if rows else None


class OutcomeCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    code: str | None = Field(default=None, max_length=80)
    category: str = Field(default="General", min_length=2, max_length=80)
    description: str | None = Field(default=None, max_length=500)
    color: str = Field(default="#B6FF2E", pattern=r"^#[0-9A-Fa-f]{6}$")
    recommended_conversation_status: str | None = None
    recommended_commercial_status: str | None = Field(default=None, max_length=80)
    followup_delay_days: int | None = Field(default=None, ge=0, le=3650)
    recommended_next_step: str | None = Field(default=None, max_length=300)
    priority_adjustment: int = Field(default=0, ge=-100, le=100)
    is_terminal: bool = False
    available_for_action: bool = False
    available_for_response: bool = True
    available_for_classification: bool = True
    is_active: bool = True
    sort_order: int = Field(default=100, ge=0, le=10000)


class OutcomeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    category: str | None = Field(default=None, min_length=2, max_length=80)
    description: str | None = Field(default=None, max_length=500)
    color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    recommended_conversation_status: str | None = None
    recommended_commercial_status: str | None = Field(default=None, max_length=80)
    followup_delay_days: int | None = Field(default=None, ge=0, le=3650)
    recommended_next_step: str | None = Field(default=None, max_length=300)
    priority_adjustment: int | None = Field(default=None, ge=-100, le=100)
    is_terminal: bool | None = None
    available_for_action: bool | None = None
    available_for_response: bool | None = None
    available_for_classification: bool | None = None
    is_active: bool | None = None
    sort_order: int | None = Field(default=None, ge=0, le=10000)


def validate_definition(values: dict[str, Any]) -> None:
    status = values.get("recommended_conversation_status")
    if status and status not in CONVERSATION_STATUSES:
        raise HTTPException(status_code=422, detail="Estado de conversación recomendado inválido")


def get_outcome_definition(outcome_id: str | None = None, outcome_name: str | None = None) -> dict[str, Any] | None:
    if not outcome_id and not outcome_name:
        return None
    query = get_supabase().table("outcome_library").select("*")
    if outcome_id:
        query = query.eq("id", outcome_id)
    else:
        query = query.ilike("name", str(outcome_name).strip())
    try:
        return _first(query.limit(1).execute())
    except Exception:
        return None


def derive_outcome_stage(
    conversation_status: str | None,
    outcome_definition: dict[str, Any] | None,
    followup_date: date | str | None,
    commercial_status: str | None = None,
) -> Literal["pending", "provisional", "final"]:
    if (
        (outcome_definition and outcome_definition.get("is_terminal"))
        or conversation_status == "closed"
        or commercial_status in FINAL_COMMERCIAL_STATUSES
    ):
        return "final"
    if conversation_status in {"not_started", "waiting_response", None, ""}:
        return "pending"
    if followup_date or conversation_status in {
        "response_received", "conversation_active", "waiting_decision_maker",
        "waiting_confirmation", "followup_scheduled",
    }:
        return "provisional"
    return "pending"


def suggested_followup_date(definition: dict[str, Any] | None, base_date: date | None = None) -> date | None:
    if not definition or definition.get("followup_delay_days") is None:
        return None
    return (base_date or date.today()) + timedelta(days=int(definition["followup_delay_days"]))


@router.get("")
def list_outcomes(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    context: Literal["action", "response", "classification", "all"] = Query(default="classification"),
    include_inactive: bool = False,
) -> list[dict[str, Any]]:
    query = get_supabase().table("outcome_library").select("*")
    if not include_inactive or user.role != "admin":
        query = query.eq("is_active", True)
    context_column = {
        "action": "available_for_action",
        "response": "available_for_response",
        "classification": "available_for_classification",
    }.get(context)
    if context_column:
        query = query.eq(context_column, True)
    return query.order("sort_order").order("name").execute().data or []


@router.post("/admin")
def create_outcome(
    payload: OutcomeCreate,
    user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    row = payload.model_dump(mode="json")
    row["name"] = row["name"].strip()
    row["code"] = _slug(row.get("code") or row["name"])
    row["created_by"] = user.id
    validate_definition(row)
    try:
        response = get_supabase().table("outcome_library").insert(row).execute()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"No se pudo crear el outcome: {exc}") from exc
    return _first(response) or row


@router.patch("/admin/{outcome_id}")
def update_outcome(
    outcome_id: str,
    payload: OutcomeUpdate,
    user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    changes = payload.model_dump(exclude_unset=True, mode="json")
    if "name" in changes:
        changes["name"] = changes["name"].strip()
    validate_definition(changes)
    if not changes:
        existing = _first(get_supabase().table("outcome_library").select("*").eq("id", outcome_id).limit(1).execute())
        if not existing:
            raise HTTPException(status_code=404, detail="Outcome no encontrado")
        return existing
    try:
        response = get_supabase().table("outcome_library").update(changes).eq("id", outcome_id).execute()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"No se pudo actualizar el outcome: {exc}") from exc
    row = _first(response)
    if not row:
        raise HTTPException(status_code=404, detail="Outcome no encontrado")
    return row
