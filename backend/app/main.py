from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Annotated, Any

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .auditor import audit_website
from .auth import CurrentUser, get_current_user, require_admin
from .config import get_settings
from .db import get_supabase
from .exports import CALL_EXPORT_FIELDS, LEAD_EXPORT_FIELDS, consolidated_rows, csv_response
from .google_places import build_queries, is_hard_excluded, place_to_lead, search_text
from .models import CallLogCreate, LeadUpdate, SearchJobCreate
from .scoring import calculate_auto_score, normalize_manual_scores

settings = get_settings()
logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO))
logger = logging.getLogger("aura-grow")

app = FastAPI(title=settings.app_name, version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)


STATUSES = [
    "Nuevo", "Investigando", "Listo para contactar", "Contactado", "Seguimiento 1", "Seguimiento 2",
    "Respondió", "Interesado", "Reunión agendada", "Propuesta enviada", "Diagnóstico vendido",
    "Implementación vendida", "No interesado", "No califica", "Descartado",
]


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


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": settings.app_name}


@app.get("/api/me")
def me(user: Annotated[CurrentUser, Depends(get_current_user)]) -> dict[str, Any]:
    return {"id": user.id, "email": user.email, "full_name": user.full_name, "role": user.role}


@app.get("/api/profiles")
def profiles(user: Annotated[CurrentUser, Depends(get_current_user)]) -> list[dict[str, Any]]:
    response = get_supabase().table("profiles").select("id,full_name,role").order("full_name").execute()
    return response.data or []


@app.get("/api/config")
def public_config(user: Annotated[CurrentUser, Depends(get_current_user)]) -> dict[str, Any]:
    return {
        "statuses": STATUSES,
        "max_api_budget_per_job": settings.max_api_budget_per_job,
        "google_cache_days": settings.google_cache_days,
        "website_cache_days": settings.website_cache_days,
    }


@app.post("/api/search-jobs")
def create_search_job(
    payload: SearchJobCreate,
    user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    budget = min(payload.api_request_budget, settings.max_api_budget_per_job)
    queries = build_queries(payload.niche, payload.city, payload.zones, payload.services)
    if not queries:
        raise HTTPException(status_code=400, detail="No se pudieron generar consultas")
    row = {
        "created_by": user.id,
        "niche": payload.niche,
        "city": payload.city,
        "zones": payload.zones,
        "services": payload.services,
        "max_results": payload.max_results,
        "api_request_budget": budget,
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


def _upsert_discovered_place(job: dict[str, Any], place: dict[str, Any], query_text: str, from_cache: bool) -> str | None:
    db = get_supabase()
    place_id = place.get("id")
    if not place_id:
        return None
    exclusion = is_hard_excluded(place, job["niche"])
    lead_data = place_to_lead(place, job["niche"], query_text)
    lead_data["excluded_reason"] = exclusion
    lead_data["zone"] = None
    lead_data.update(calculate_auto_score(lead_data))
    lead_data.update(normalize_manual_scores(lead_data))

    # Only public extraction fields are updated; commercial work fields are intentionally omitted.
    db.table("leads").upsert(lead_data, on_conflict="place_id").execute()
    lead = _first(db.table("leads").select("id").eq("place_id", place_id).limit(1).execute())
    if not lead:
        return None
    lead_id = lead["id"]
    db.table("search_results").upsert(
        {
            "job_id": job["id"],
            "lead_id": lead_id,
            "query_text": query_text,
            "from_google_cache": from_cache,
        },
        on_conflict="job_id,lead_id",
    ).execute()
    return lead_id


@app.post("/api/search-jobs/{job_id}/step")
def step_search_job(
    job_id: str,
    user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    db = get_supabase()
    job = _first(db.table("search_jobs").select("*").eq("id", job_id).limit(1).execute())
    if not job:
        raise HTTPException(status_code=404, detail="Búsqueda no encontrada")
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
            budget_used = int(job.get("api_requests_used") or 0)
            budget = int(job.get("api_request_budget") or 0)

            if total >= int(job.get("max_results") or 0) or query_index >= len(queries) or budget_used >= budget:
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
                if _job_result_count(job_id) >= int(job["max_results"]):
                    break
                _upsert_discovered_place(job, place, query_text, from_cache)

            total = _job_result_count(job_id)
            next_token = response.get("nextPageToken")
            if next_token and total < int(job["max_results"]) and budget_used < budget:
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
                "updated_at": utcnow_iso(),
            }
            if total >= int(job["max_results"]) or next_query_index >= len(queries) or budget_used >= budget:
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
                score = calculate_auto_score(merged)
                existing_flags = list(update_data.get("quality_flags") or [])
                score["quality_flags"] = list(dict.fromkeys(existing_flags + list(score.get("quality_flags") or [])))
                update_data.update(score)
                update_data.update(normalize_manual_scores({**merged, **score}))
                update_data["last_web_audit_at"] = utcnow_iso()
                db.table("leads").update(update_data).eq("id", lead["id"]).execute()
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
) -> dict[str, Any]:
    db = get_supabase()
    start = (page - 1) * page_size
    query = db.table("leads").select("*", count="exact").eq("archived", False)
    if not include_excluded:
        query = query.is_("excluded_reason", "null")
    if search:
        safe = search.replace(",", " ").strip()
        query = query.or_(f"business_name.ilike.%{safe}%,address.ilike.%{safe}%,phone.ilike.%{safe}%")
    if niche:
        query = query.eq("niche", niche)
    if status:
        query = query.eq("status", status)
    if tier:
        query = query.eq("final_tier", tier)
    if owner_id:
        query = query.eq("owner_id", owner_id)
    if followup_due:
        query = query.lte("next_followup_date", date.today().isoformat()).not_.in_("status", ["Descartado", "No interesado", "Implementación vendida"])
    response = query.order("final_score", desc=True).order("created_at", desc=True).range(start, start + page_size - 1).execute()
    return {"items": response.data or [], "total": int(response.count or 0), "page": page, "page_size": page_size}


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


@app.post("/api/leads/{lead_id}/call-logs")
def create_call_log(
    lead_id: str,
    payload: CallLogCreate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> dict[str, Any]:
    db = get_supabase()
    lead = _first(db.table("leads").select("id,status,first_contact_date").eq("id", lead_id).limit(1).execute())
    if not lead:
        raise HTTPException(status_code=404, detail="Lead no encontrado")
    row = payload.model_dump(mode="json")
    row["lead_id"] = lead_id
    row["agent_id"] = user.id
    row["occurred_at"] = (payload.occurred_at or datetime.now(timezone.utc)).isoformat()
    response = db.table("call_logs").insert(row).execute()
    call = _first(response) or row

    rpc_data = db.rpc("increment_lead_contact_attempts", {"p_lead_id": lead_id}).execute().data
    if isinstance(rpc_data, list):
        attempt_count = int(rpc_data[0]) if rpc_data else 1
    else:
        attempt_count = int(rpc_data or 1)
    lead_update: dict[str, Any] = {
        "last_contact_date": row["occurred_at"],
        "owner_id": user.id,
        "outcome": payload.outcome,
        "contact_attempts": attempt_count,
    }
    if not lead.get("first_contact_date"):
        lead_update["first_contact_date"] = date.today().isoformat()
    if payload.followup_date:
        lead_update["next_followup_date"] = payload.followup_date.isoformat()
    outcome_status = {
        "Respondió": "Respondió",
        "Interesado": "Interesado",
        "Reunión agendada": "Reunión agendada",
        "No interesado": "No interesado",
        "No califica": "No califica",
        "Venta": "Implementación vendida",
    }.get(payload.outcome)
    if outcome_status:
        lead_update["status"] = outcome_status
    elif lead.get("status") in {"Nuevo", "Investigando", "Listo para contactar"}:
        lead_update["status"] = "Contactado"
    db.table("leads").update(lead_update).eq("id", lead_id).execute()
    _log_activity(lead_id, user.id, "contact_logged", f"{payload.channel}: {payload.outcome}", {"call_log_id": call.get("id")})
    return call


@app.get("/api/call-logs")
def list_call_logs(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    date_from: date | None = None,
    date_to: date | None = None,
    agent_id: str | None = None,
    limit: int = Query(default=500, ge=1, le=1000),
) -> list[dict[str, Any]]:
    db = get_supabase()
    query = db.table("call_logs").select("*").order("occurred_at", desc=True).limit(limit)
    if date_from:
        query = query.gte("occurred_at", f"{date_from.isoformat()}T00:00:00Z")
    if date_to:
        query = query.lte("occurred_at", f"{date_to.isoformat()}T23:59:59Z")
    if agent_id:
        query = query.eq("agent_id", agent_id)
    calls = query.execute().data or []
    lead_ids = list({call["lead_id"] for call in calls if call.get("lead_id")})
    leads: dict[str, str] = {}
    for i in range(0, len(lead_ids), 100):
        response = db.table("leads").select("id,business_name").in_("id", lead_ids[i:i + 100]).execute()
        leads.update({row["id"]: row.get("business_name") for row in (response.data or [])})
    profiles = _profile_map()
    for call in calls:
        call["business_name"] = leads.get(call.get("lead_id"), "")
        call["agent_name"] = profiles.get(str(call.get("agent_id")), "")
    return calls


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
    non_contact = {"No respondió", "Buzón de voz", "Número incorrecto"}
    connected = sum(1 for item in calls if item.get("outcome") not in non_contact)
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
    filename = f"leads_{'trabajados_' if worked_only else ''}{date.today().isoformat()}.csv"
    return csv_response(leads, LEAD_EXPORT_FIELDS, filename)


@app.get("/api/export/call-logs")
def export_call_logs(user: Annotated[CurrentUser, Depends(get_current_user)]) -> Any:
    calls = _fetch_all("call_logs")
    profiles = _profile_map()
    lead_names = {row["id"]: row.get("business_name", "") for row in _fetch_all("leads", "id,business_name")}
    for call in calls:
        call["business_name"] = lead_names.get(call.get("lead_id"), "")
        call["agent_name"] = profiles.get(str(call.get("agent_id")), "")
    return csv_response(calls, CALL_EXPORT_FIELDS, f"call_log_{date.today().isoformat()}.csv")


@app.get("/api/export/consolidated")
def export_consolidated(user: Annotated[CurrentUser, Depends(get_current_user)]) -> Any:
    leads = _fetch_all("leads")
    calls = _fetch_all("call_logs")
    rows, fields = consolidated_rows(leads, calls)
    return csv_response(rows, fields, f"metricas_consolidadas_{date.today().isoformat()}.csv")


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Any, exc: Exception) -> JSONResponse:
    logger.exception("Error no controlado")
    return JSONResponse(status_code=500, content={"detail": "Ocurrió un error interno"})
