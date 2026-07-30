from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, model_validator

from .auth import CurrentUser, get_current_user, require_admin
from .db import get_supabase


logger = logging.getLogger("aura-grow")

REVIEW_STATUSES = [
    "pending_review",
    "approved_good_example",
    "needs_new_rule",
    "rule_updated",
    "discarded",
]

EVALUATIONS = ["worked", "needs_adjustment", "incorrect"]

PROBLEM_TYPES = [
    "incorrect_interpretation",
    "unnatural_text",
    "too_long",
    "incorrect_classification",
    "incorrect_followup",
    "context_not_recognized",
    "missing_playbook_case",
    "other",
]


class BacklogReviewUpdate(BaseModel):
    evaluation: Literal["worked", "needs_adjustment", "incorrect"] | None = None
    review_status: Literal[
        "pending_review",
        "approved_good_example",
        "needs_new_rule",
        "rule_updated",
        "discarded",
    ] | None = None
    problem_type: Literal[
        "incorrect_interpretation",
        "unnatural_text",
        "too_long",
        "incorrect_classification",
        "incorrect_followup",
        "context_not_recognized",
        "missing_playbook_case",
        "other",
    ] | None = None
    expected_interpretation: str | None = Field(default=None, max_length=10000)
    expected_response: str | None = Field(default=None, max_length=20000)
    review_notes: str | None = Field(default=None, max_length=10000)

    @model_validator(mode="after")
    def validate_correction(self) -> "BacklogReviewUpdate":
        if self.evaluation in {"needs_adjustment", "incorrect"}:
            if not self.problem_type:
                raise ValueError("Selecciona el tipo de problema")
            if not (str(self.expected_interpretation or "").strip() or str(self.expected_response or "").strip()):
                raise ValueError("Registra qué debió entender o responder Aura")
        return self


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _first(response: Any) -> dict[str, Any]:
    rows = getattr(response, "data", None) or []
    return rows[0] if rows else {}


def _analysis_rule_key(analysis: dict[str, Any]) -> str:
    explicit = str(analysis.get("rule_key") or "").strip()
    if explicit:
        return explicit
    signals = analysis.get("signals") or []
    if signals and isinstance(signals[0], dict):
        return str(signals[0].get("key") or "response")
    return "response"


def record_analysis(
    *,
    lead_id: str | None,
    user: CurrentUser,
    analysis: dict[str, Any],
) -> dict[str, Any] | None:
    """Persist one analysis without making the analysis endpoint depend on the migration."""
    classification = analysis.get("classification") or analysis.get("suggestion") or {}
    row = {
        "lead_id": lead_id or None,
        "setter_id": user.id,
        "setter_name": user.full_name,
        "lead_message": str(
            analysis.get("lead_message")
            or analysis.get("analysis_scope")
            or ""
        ),
        "previous_context": str(analysis.get("previous_context") or "") or None,
        "interpretation": str(analysis.get("summary") or ""),
        "suggested_response": str(analysis.get("recommended_reply") or "") or None,
        "classification": classification,
        "confidence": max(0, min(100, int(analysis.get("confidence") or 0))),
        "rule_key": _analysis_rule_key(analysis),
        "playbook_version": str(
            analysis.get("playbook_version")
            or analysis.get("library_version")
            or ""
        ) or None,
        "analysis_method": str(analysis.get("method") or "") or None,
        "outcome": str(classification.get("outcome") or "") or None,
        "analysis_payload": analysis,
        "review_status": "pending_review",
        "suggestion_used": False,
    }
    try:
        response = get_supabase().table("aura_learning_backlog").insert(row).execute()
        return _first(response) or row
    except Exception:
        # The commercial workflow remains available if SQL has not been installed yet.
        logger.exception("No se pudo guardar el análisis en el Backlog de Aura")
        return None


def mark_analysis_source_and_capture_result(
    *,
    lead_id: str,
    current_backlog_id: str | None,
    call_log: dict[str, Any],
    result_payload: dict[str, Any],
) -> None:
    """Link the analyzed response and use this interaction as the result of older cases."""
    try:
        db = get_supabase()
        call_log_id = call_log.get("id")
        occurred_at = call_log.get("occurred_at") or _utcnow_iso()

        if current_backlog_id:
            db.table("aura_learning_backlog").update({
                "source_call_log_id": call_log_id,
                "updated_at": _utcnow_iso(),
            }).eq("id", current_backlog_id).eq("lead_id", lead_id).execute()

        direction = str(result_payload.get("direction") or "").strip().lower()
        activity_type = str(result_payload.get("activity_type") or "").strip().lower()
        conversation_status = str(result_payload.get("conversation_status") or "").strip().lower()
        meaningful_result = (
            direction == "entrante"
            or activity_type == "response_received"
            or conversation_status == "closed"
            or result_payload.get("appointment_booked") is True
            or float(result_payload.get("sale_amount") or 0) > 0
        )
        if not meaningful_result:
            return

        query = (
            db.table("aura_learning_backlog")
            .select("id")
            .eq("lead_id", lead_id)
            .is_("result_observed_at", "null")
            .order("created_at", desc=True)
            .limit(50)
        )
        candidates = query.execute().data or []
        candidate_ids = [
            str(item.get("id"))
            for item in candidates
            if item.get("id") and str(item.get("id")) != str(current_backlog_id or "")
        ]
        if not candidate_ids:
            return

        direction = str(result_payload.get("direction") or "")
        outcome = str(result_payload.get("outcome") or "Sin outcome")
        result_summary = f"{direction or 'Interacción'} · {outcome}"
        db.table("aura_learning_backlog").update({
            "result_call_log_id": call_log_id,
            "result_summary": result_summary,
            "result_outcome": result_payload.get("outcome"),
            "result_commercial_status": result_payload.get("commercial_status"),
            "result_conversation_status": result_payload.get("conversation_status"),
            "result_payload": result_payload,
            "result_observed_at": occurred_at,
            "updated_at": _utcnow_iso(),
        }).in_("id", candidate_ids).execute()
    except Exception:
        # Learning telemetry must never block the setter from saving an interaction.
        logger.exception("No se pudo enlazar el resultado posterior del Backlog de Aura")


def _all_rows() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    start = 0
    page_size = 1000
    try:
        while True:
            response = (
                get_supabase().table("aura_learning_backlog")
                .select("*")
                .order("created_at", desc=True)
                .range(start, start + page_size - 1)
                .execute()
            )
            batch = response.data or []
            rows.extend(batch)
            if len(batch) < page_size:
                break
            start += page_size
    except Exception as exc:
        logger.exception("No se pudo consultar el Backlog de Aura")
        raise HTTPException(
            status_code=503,
            detail="El Backlog de Aura todavía no está instalado. Ejecuta database/18_aura_learning_backlog.sql en Supabase.",
        ) from exc
    return rows


def _date_value(value: Any) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _confidence_matches(value: Any, band: str | None) -> bool:
    if not band:
        return True
    confidence = int(value or 0)
    if band == "high":
        return confidence >= 80
    if band == "medium":
        return 60 <= confidence < 80
    if band == "low":
        return confidence < 60
    return True


def filter_backlog_rows(
    rows: list[dict[str, Any]],
    *,
    setter_id: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    outcome: str | None = None,
    confidence: str | None = None,
    review_status: str | None = None,
    problem_type: str | None = None,
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for item in rows:
        item_date = _date_value(item.get("created_at"))
        if setter_id and str(item.get("setter_id") or "") != setter_id:
            continue
        if date_from and (not item_date or item_date < date_from):
            continue
        if date_to and (not item_date or item_date > date_to):
            continue
        if outcome and str(item.get("outcome") or "") != outcome:
            continue
        if not _confidence_matches(item.get("confidence"), confidence):
            continue
        if review_status and str(item.get("review_status") or "") != review_status:
            continue
        if problem_type and str(item.get("problem_type") or "") != problem_type:
            continue
        result.append(item)
    return result


def backlog_metrics(rows: list[dict[str, Any]]) -> dict[str, Any]:
    total = len(rows)
    approved = sum(1 for item in rows if item.get("evaluation") == "worked")
    corrected = sum(
        1
        for item in rows
        if item.get("evaluation") in {"needs_adjustment", "incorrect"}
    )
    pending = sum(
        1
        for item in rows
        if (item.get("review_status") or "pending_review") == "pending_review"
    )
    evaluated = approved + corrected
    classification_accuracy = round((approved / evaluated) * 100, 1) if evaluated else 0.0
    suggestions = [item for item in rows if str(item.get("suggested_response") or "").strip()]
    used = sum(1 for item in suggestions if item.get("suggestion_used") is True)
    suggestion_usage_rate = round((used / len(suggestions)) * 100, 1) if suggestions else 0.0
    return {
        "analyses": total,
        "approved": approved,
        "corrected": corrected,
        "pending": pending,
        "classification_accuracy": classification_accuracy,
        "evaluated": evaluated,
        "suggestion_usage_rate": suggestion_usage_rate,
        "suggestions_used": used,
        "suggestions_total": len(suggestions),
    }


def _profile_rows() -> list[dict[str, Any]]:
    try:
        return (
            get_supabase().table("profiles")
            .select("id,full_name,role,is_active")
            .order("full_name")
            .execute()
            .data
            or []
        )
    except Exception:
        return []


def _lead_map(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    ids = sorted({str(item.get("lead_id")) for item in rows if item.get("lead_id")})
    if not ids:
        return {}
    try:
        leads = (
            get_supabase().table("leads")
            .select("id,business_name,status,owner_id")
            .in_("id", ids)
            .execute()
            .data
            or []
        )
        return {str(item.get("id")): item for item in leads}
    except Exception:
        return {}


admin_router = APIRouter(prefix="/api/admin/aura-backlog", tags=["Aura backlog"])
usage_router = APIRouter(prefix="/api/aura-backlog", tags=["Aura backlog"])


@admin_router.get("")
def list_backlog(
    user: Annotated[CurrentUser, Depends(require_admin)],
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    setter_id: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    outcome: str | None = None,
    confidence: Literal["low", "medium", "high"] | None = None,
    review_status: str | None = None,
    problem_type: str | None = None,
) -> dict[str, Any]:
    del user
    all_rows = _all_rows()
    filtered = filter_backlog_rows(
        all_rows,
        setter_id=setter_id,
        date_from=date_from,
        date_to=date_to,
        outcome=outcome,
        confidence=confidence,
        review_status=review_status,
        problem_type=problem_type,
    )
    total = len(filtered)
    start = (page - 1) * page_size
    items = filtered[start:start + page_size]
    leads = _lead_map(items)
    for item in items:
        lead = leads.get(str(item.get("lead_id") or ""), {})
        item["business_name"] = lead.get("business_name") or "Lead no disponible"
        item["lead_status"] = lead.get("status")

    profiles = _profile_rows()
    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "metrics": backlog_metrics(filtered),
        "filter_options": {
            "profiles": [
                item
                for item in profiles
                if item.get("is_active") is not False
                and str(item.get("role") or "") in {"admin", "setter", "agent"}
            ],
            "outcomes": sorted({
                str(item.get("outcome"))
                for item in all_rows
                if item.get("outcome")
            }),
            "review_statuses": REVIEW_STATUSES,
            "problem_types": PROBLEM_TYPES,
            "confidence_bands": ["high", "medium", "low"],
        },
        "generated_at": _utcnow_iso(),
    }


@admin_router.patch("/{case_id}")
def review_backlog_case(
    case_id: str,
    payload: BacklogReviewUpdate,
    user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    db = get_supabase()
    current = _first(
        db.table("aura_learning_backlog")
        .select("*")
        .eq("id", case_id)
        .limit(1)
        .execute()
    )
    if not current:
        raise HTTPException(status_code=404, detail="Caso del Backlog no encontrado")

    changes = payload.model_dump(exclude_unset=True)
    evaluation = changes.get("evaluation", current.get("evaluation"))
    if evaluation == "worked":
        changes["review_status"] = "approved_good_example"
        changes["problem_type"] = None
        changes["expected_interpretation"] = None
        changes["expected_response"] = None
    elif evaluation in {"needs_adjustment", "incorrect"}:
        if changes.get("review_status") not in {"needs_new_rule", "rule_updated", "discarded"}:
            changes["review_status"] = "needs_new_rule"

    changes.update({
        "reviewed_by": user.id,
        "reviewed_at": _utcnow_iso(),
        "updated_at": _utcnow_iso(),
    })
    response = (
        db.table("aura_learning_backlog")
        .update(changes)
        .eq("id", case_id)
        .execute()
    )
    return _first(response) or {**current, **changes}


@usage_router.post("/{case_id}/suggestion-used")
def register_suggestion_usage(
    case_id: str,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> dict[str, Any]:
    db = get_supabase()
    query = db.table("aura_learning_backlog").select("id,setter_id").eq("id", case_id).limit(1)
    current = _first(query.execute())
    if not current:
        raise HTTPException(status_code=404, detail="Análisis no encontrado")
    if user.role != "admin" and str(current.get("setter_id") or "") != user.id:
        raise HTTPException(status_code=403, detail="No puedes actualizar el análisis de otro setter")
    response = (
        db.table("aura_learning_backlog")
        .update({
            "suggestion_used": True,
            "suggestion_used_at": _utcnow_iso(),
            "updated_at": _utcnow_iso(),
        })
        .eq("id", case_id)
        .execute()
    )
    return _first(response) or {"id": case_id, "suggestion_used": True}
