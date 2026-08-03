from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .auth import CurrentUser, require_diagnose
from .db import get_supabase


router = APIRouter(prefix="/api", tags=["Diagnose definitivo"])


SCORING_WEIGHTS = {
    "first_response": 15,
    "qualification_next_step": 10,
    "followup": 20,
    "appointments_recovery": 15,
    "measurement_conversion": 15,
    "team_responsibilities": 10,
    "tools_records": 10,
    "patient_experience": 5,
}

VISUAL_STATUSES = {
    "green": {"label": "Controlado", "score": 100, "description": "Hay proceso, responsable, registro y evidencia."},
    "yellow": {"label": "Inconsistente", "score": 60, "description": "Existe, pero se cumple parcialmente o no puede medirse."},
    "red": {"label": "Pérdida probable", "score": 20, "description": "Falta responsable, fecha, registro, próximo paso o verificación."},
    "gray": {"label": "Sin evidencia", "score": None, "description": "La afirmación todavía no pudo comprobarse."},
}

CONVERSATION_BLOCKS = [
    {
        "key": "objective_direction", "title": "Objetivo y resultado esperado", "score_area": None,
        "intro": "Alineemos qué resultado necesita el negocio y qué decisión debe habilitar este diagnóstico.",
        "core_question": "¿Qué resultado comercial concreto esperan mejorar y cómo sabrán que cambió?",
        "followups": ["¿En qué plazo esperan verlo?", "¿Qué ocurre si no se corrige?"],
        "section": "general", "priority": "high",
    },
    {
        "key": "icp_service", "title": "Cliente y servicio prioritario", "score_area": "patient_experience",
        "intro": "Definamos a quién atienden, qué necesita y qué experiencia debe recibir.",
        "core_question": "¿Qué tipo de paciente o cliente y qué servicio deben priorizarse en este proceso?",
        "followups": ["¿Cómo reconocen una consulta de buen encaje?", "¿Qué información necesita esa persona para avanzar con confianza?"],
        "section": "icp", "priority": "medium",
    },
    {
        "key": "inquiry_journey", "title": "Recorrido de una consulta real", "score_area": "qualification_next_step",
        "intro": "Reconstruyamos un caso real desde que entra hasta que avanza o se pierde.",
        "core_question": "Cuéntame la última consulta real: ¿por dónde entró, quién respondió y cuál fue el siguiente paso?",
        "followups": ["¿Dónde quedó registrada?", "¿Cómo decidieron si estaba calificada?"],
        "section": "conversion", "priority": "critical",
    },
    {
        "key": "first_response", "title": "Primera respuesta", "score_area": "first_response",
        "intro": "Revisemos velocidad, consistencia y capacidad de conducir la conversación.",
        "core_question": "¿Cuánto tardan en responder y qué debe lograr la primera respuesta?",
        "followups": ["¿Hay un estándar por horario o canal?", "¿Quién cubre cuando la responsable no está?"],
        "section": "conversion", "priority": "critical",
    },
    {
        "key": "followup", "title": "Seguimiento", "score_area": "followup",
        "intro": "El seguimiento es el núcleo: debe tener fecha, responsable, registro y próximo paso.",
        "core_question": "Dame un caso reciente: ¿cuándo se programó el seguimiento, quién quedó responsable y dónde se registró?",
        "followups": ["¿Cuántos intentos hacen y con qué cadencia?", "¿Cómo detectan seguimientos vencidos?"],
        "section": "conversion", "priority": "critical",
    },
    {
        "key": "appointments_recovery", "title": "Citas y recuperación", "score_area": "appointments_recovery",
        "intro": "Veamos agendamiento, confirmación, asistencia y recuperación de cancelaciones o no-show.",
        "core_question": "¿Cómo se agenda, confirma y recupera una cita cancelada o no atendida?",
        "followups": ["¿Quién queda responsable?", "¿Dónde registran reprogramaciones y no-show?"],
        "section": "conversion", "priority": "high",
    },
    {
        "key": "team_responsibilities", "title": "Equipo y responsabilidades", "score_area": "team_responsibilities",
        "intro": "Aclaremos propiedad, entregas y escalamiento para que el proceso no dependa de memoria.",
        "core_question": "¿Quién es responsable de cada etapa y qué pasa cuando una consulta cambia de persona?",
        "followups": ["¿Cómo se transfiere el contexto?", "¿Quién revisa que el próximo paso se cumpla?"],
        "section": "process", "priority": "high",
    },
    {
        "key": "tools_records", "title": "Herramientas y registros", "score_area": "tools_records",
        "intro": "Identifiquemos la fuente de verdad y qué trabajo sigue siendo manual.",
        "core_question": "¿Qué herramientas usan y dónde queda el registro central de cada consulta?",
        "followups": ["¿Quién lo actualiza?", "¿Qué información vive todavía en chats o notas personales?"],
        "section": "process", "priority": "high",
    },
    {
        "key": "measurement_conversion", "title": "Métricas y conversión", "score_area": "measurement_conversion",
        "intro": "Separemos percepción de datos para medir consultas, citas, asistencia y resultado.",
        "core_question": "¿Cuántas consultas, citas y asistencias tuvieron aproximadamente en el último periodo?",
        "followups": ["¿Dónde se calculan esas cifras?", "¿Pueden medir de consulta a tratamiento o venta?"],
        "section": "conversion", "priority": "critical",
    },
    {
        "key": "automation_validation", "title": "Automatización y validación final", "score_area": None,
        "intro": "Validemos qué conviene automatizar después de estabilizar responsables y registros.",
        "core_question": "¿Qué parte repetitiva quieren automatizar y qué proceso estable debe existir primero?",
        "followups": ["Si usan bot, ¿cómo transfiere a una persona?", "¿Qué no deberíamos automatizar todavía?"],
        "section": "automation", "priority": "medium",
    },
]

EVIDENCE_REQUIREMENTS = [
    {"key": "booked_conversation", "label": "Conversación que terminó en cita", "block_key": "appointments_recovery"},
    {"key": "no_response_conversation", "label": "Conversación que dejó de responder", "block_key": "followup"},
    {"key": "objection_conversation", "label": "Conversación con objeción, rechazo o baja calificación", "block_key": "inquiry_journey"},
    {"key": "scheduling_system", "label": "Captura del sistema o método de agenda", "block_key": "appointments_recovery"},
    {"key": "automatic_response", "label": "Respuesta automática actual", "block_key": "first_response"},
    {"key": "followup_method", "label": "Muestra del método de seguimiento", "block_key": "followup"},
    {"key": "funnel_numbers", "label": "Cifras aproximadas de consultas, citas y asistencia", "block_key": "measurement_conversion"},
]


class BlockEvaluationSave(BaseModel):
    finding: str | None = Field(default=None, max_length=6000)
    evidence_summary: str | None = Field(default=None, max_length=6000)
    confidence: Literal["low", "medium", "high"] = "low"
    risk: str | None = Field(default=None, max_length=6000)
    commercial_impact: str | None = Field(default=None, max_length=6000)
    priority: Literal["immediate", "30_days", "later", "do_not_touch"] = "30_days"
    recommendation: str | None = Field(default=None, max_length=6000)
    requires_validation: bool = True
    next_best_question: str | None = Field(default=None, max_length=2000)
    visual_status: Literal["green", "yellow", "red", "gray"] = "gray"


class EvidenceGovernanceUpdate(BaseModel):
    requirement_key: str | None = Field(default=None, max_length=120)
    block_key: str | None = Field(default=None, max_length=120)
    anonymized: bool | None = None
    provided_by: str | None = Field(default=None, max_length=240)
    received_at: datetime | None = None
    analysis_purpose: str | None = Field(default=None, max_length=500)
    validation_status: Literal["pending_review", "validated", "requires_information", "discarded"] | None = None
    deletion_status: Literal["retained", "scheduled"] | None = None


class ImplementationUpdate(BaseModel):
    implementation_recommended: bool = False
    implementation_scope: str | None = Field(default=None, max_length=6000)
    implementation_exclusions: str | None = Field(default=None, max_length=6000)
    implementation_timeline: str | None = Field(default=None, max_length=1000)
    implementation_deliverables: str | None = Field(default=None, max_length=6000)
    client_responsibilities: str | None = Field(default=None, max_length=6000)
    implementation_metric: str | None = Field(default=None, max_length=2000)


def _first(response: Any) -> dict[str, Any] | None:
    return (response.data or [None])[0]


def _require_diagnosis(diagnosis_id: str) -> dict[str, Any]:
    row = _first(get_supabase().table("diagnoses").select("*").eq("id", diagnosis_id).limit(1).execute())
    if not row:
        raise HTTPException(status_code=404, detail="Diagnóstico no encontrado")
    return row


def _require_evidence_admin(user: CurrentUser) -> None:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Las evidencias de Diagnose están restringidas a administradores autorizados")


def _block_map() -> dict[str, dict[str, Any]]:
    return {item["key"]: item for item in CONVERSATION_BLOCKS}


def _seed_core_questions(diagnosis_id: str) -> None:
    db = get_supabase()
    existing = db.table("diagnosis_interview_questions").select("question_key").eq("diagnosis_id", diagnosis_id).execute().data or []
    existing_keys = {str(row.get("question_key")) for row in existing}
    rows = []
    for block in CONVERSATION_BLOCKS:
        question_key = f"core:{block['key']}"
        if question_key in existing_keys:
            continue
        rows.append({
            "diagnosis_id": diagnosis_id,
            "question_key": question_key,
            "block_key": block["key"],
            "section": block["section"],
            "question": block["core_question"],
            "rationale": block["intro"],
            "priority": block["priority"],
            "source": "manual",
            "question_type": "core",
            "evidence_status": "pending",
        })
        for index, question in enumerate(block["followups"]):
            followup_key = f"conditional:{block['key']}:{index + 1}"
            if followup_key not in existing_keys:
                rows.append({
                    "diagnosis_id": diagnosis_id,
                    "question_key": followup_key,
                    "block_key": block["key"],
                    "section": block["section"],
                    "question": question,
                    "rationale": "Úsala solo si ayuda a comprobar responsable, registro, fecha, próximo paso o resultado.",
                    "priority": block["priority"],
                    "source": "manual",
                    "question_type": "conditional",
                    "evidence_status": "pending",
                })
    if rows:
        db.table("diagnosis_interview_questions").insert(rows).execute()


def _calculate_metrics(evaluations: list[dict[str, Any]]) -> dict[str, Any]:
    by_area = {str(row.get("score_area")): row for row in evaluations if row.get("score_area")}
    maturity_earned = 0.0
    maturity_weight = 0
    covered_weight = 0
    area_rows = []
    for area, weight in SCORING_WEIGHTS.items():
        row = by_area.get(area)
        status = str((row or {}).get("visual_status") or "gray")
        score = VISUAL_STATUSES[status]["score"]
        if score is not None:
            maturity_earned += score * weight
            maturity_weight += weight
        has_evidence = bool(row and row.get("evidence_summary") and not row.get("requires_validation"))
        if has_evidence:
            covered_weight += weight
        area_rows.append({
            "area": area,
            "weight": weight,
            "visual_status": status,
            "score": score,
            "evidence_covered": has_evidence,
        })
    maturity = round(maturity_earned / maturity_weight) if maturity_weight else None
    return {"maturity": maturity, "evidence_coverage": covered_weight, "areas": area_rows}


def _report_readiness(
    questions: list[dict[str, Any]],
    evaluations: list[dict[str, Any]],
    evidence: list[dict[str, Any]],
    findings: list[dict[str, Any]],
) -> dict[str, Any]:
    reasons = []
    answered_blocks = {
        str(row.get("block_key")) for row in questions
        if row.get("question_type") == "core" and row.get("status") in {"answered", "not_applicable"}
    }
    critical_blocks = {"first_response", "followup", "measurement_conversion"}
    missing_answers = sorted(critical_blocks - answered_blocks)
    if missing_answers:
        reasons.append("Faltan respuestas núcleo en Primera respuesta, Seguimiento o Métricas.")

    active_evidence = [row for row in evidence if row.get("deletion_status") != "deleted" and row.get("validation_status") != "discarded"]
    requirement_keys = {str(row.get("requirement_key")) for row in active_evidence if row.get("requirement_key") and row.get("validation_status") == "validated"}
    missing_evidence = [item["key"] for item in EVIDENCE_REQUIREMENTS if item["key"] not in requirement_keys]
    if missing_evidence:
        reasons.append(f"Faltan validar {len(missing_evidence)} de las 7 evidencias mínimas.")

    eval_by_block = {str(row.get("block_key")): row for row in evaluations}
    gray_critical = [key for key in critical_blocks if (eval_by_block.get(key) or {}).get("visual_status", "gray") == "gray"]
    if gray_critical:
        reasons.append("Primera respuesta, Seguimiento y Medición no pueden quedar completamente grises.")

    unresolved = [row for row in active_evidence if row.get("validation_status") == "requires_information"]
    if unresolved:
        reasons.append(f"Hay {len(unresolved)} evidencias que requieren información adicional.")

    unsupported = [row for row in findings if row.get("status") != "dismissed" and not row.get("evidence") and not row.get("requires_validation")]
    if unsupported:
        reasons.append(f"Hay {len(unsupported)} hallazgos sin evidencia ni advertencia de validación.")

    return {
        "preliminary_ready": True,
        "final_ready": not reasons,
        "reasons": reasons,
        "missing_evidence_keys": missing_evidence,
    }


def _definitive_payload(diagnosis_id: str, include_evidence: bool) -> dict[str, Any]:
    db = get_supabase()
    diagnosis = _require_diagnosis(diagnosis_id)
    _seed_core_questions(diagnosis_id)
    evaluations = db.table("diagnosis_block_evaluations").select("*").eq("diagnosis_id", diagnosis_id).execute().data or []
    questions = db.table("diagnosis_interview_questions").select("*").eq("diagnosis_id", diagnosis_id).order("created_at").execute().data or []
    evidence = db.table("diagnosis_evidence").select("*").eq("diagnosis_id", diagnosis_id).order("created_at", desc=True).execute().data or []
    findings = db.table("diagnosis_findings").select("*").eq("diagnosis_id", diagnosis_id).order("priority", desc=True).execute().data or []
    roadmap = db.table("diagnosis_roadmap").select("*").eq("diagnosis_id", diagnosis_id).order("order_index").execute().data or []
    metrics = _calculate_metrics(evaluations)
    readiness = _report_readiness(questions, evaluations, evidence, findings)
    evaluation_by_block = {str(row.get("block_key")): row for row in evaluations}
    process_stages = []
    stage_map = [
        ("Consulta", "inquiry_journey"), ("Primera respuesta", "first_response"),
        ("Calificación", "inquiry_journey"), ("Siguiente paso", "inquiry_journey"),
        ("Seguimiento", "followup"), ("Cita", "appointments_recovery"),
        ("Confirmación", "appointments_recovery"), ("Asistencia", "appointments_recovery"),
        ("Tratamiento, venta o abandono", "measurement_conversion"),
    ]
    for label, block_key in stage_map:
        evaluation = evaluation_by_block.get(block_key) or {}
        process_stages.append({"label": label, "block_key": block_key, "visual_status": evaluation.get("visual_status", "gray"), "evidence": evaluation.get("evidence_summary"), "finding": evaluation.get("finding")})
    loss_points = [
        {"block_key": row.get("block_key"), "finding": row.get("finding"), "evidence": row.get("evidence_summary"), "risk": row.get("risk"), "commercial_impact": row.get("commercial_impact"), "confidence": row.get("confidence"), "visual_status": row.get("visual_status")}
        for row in evaluations if row.get("visual_status") in {"red", "yellow"}
    ]
    priorities = {key: [] for key in ("immediate", "30_days", "later", "do_not_touch")}
    for row in evaluations:
        priorities.get(str(row.get("priority")), priorities["30_days"]).append(row)
    return {
        "diagnosis": {key: diagnosis.get(key) for key in (
            "implementation_recommended", "implementation_scope", "implementation_exclusions",
            "implementation_timeline", "implementation_deliverables", "client_responsibilities", "implementation_metric"
        )},
        "blocks": CONVERSATION_BLOCKS,
        "evaluations": evaluations,
        "questions": questions,
        "evidence": evidence if include_evidence else [],
        "evidence_restricted": not include_evidence,
        "evidence_requirements": EVIDENCE_REQUIREMENTS,
        "metrics": metrics,
        "report_readiness": readiness,
        "process_xray": process_stages,
        "loss_points": loss_points,
        "priorities": priorities,
        "roadmap": roadmap,
    }


@router.get("/diagnose/definitive-templates")
def definitive_templates(user: Annotated[CurrentUser, Depends(require_diagnose)]) -> dict[str, Any]:
    return {
        "blocks": CONVERSATION_BLOCKS,
        "scoring_weights": SCORING_WEIGHTS,
        "visual_statuses": VISUAL_STATUSES,
        "evidence_requirements": EVIDENCE_REQUIREMENTS,
        "privacy_notice": "Pueden ocultar nombres, teléfonos y cualquier dato clínico. Necesitamos analizar el proceso, no la información médica del paciente.",
    }


@router.get("/diagnose/{diagnosis_id}/definitive")
def get_definitive_diagnosis(
    diagnosis_id: str,
    user: Annotated[CurrentUser, Depends(require_diagnose)],
) -> dict[str, Any]:
    return _definitive_payload(diagnosis_id, include_evidence=user.role == "admin")


@router.put("/diagnose/{diagnosis_id}/block-evaluations/{block_key}")
def save_block_evaluation(
    diagnosis_id: str,
    block_key: str,
    payload: BlockEvaluationSave,
    user: Annotated[CurrentUser, Depends(require_diagnose)],
) -> dict[str, Any]:
    _require_diagnosis(diagnosis_id)
    block = _block_map().get(block_key)
    if not block:
        raise HTTPException(status_code=404, detail="Bloque de entrevista no válido")
    data = payload.model_dump()
    data.update({
        "diagnosis_id": diagnosis_id,
        "block_key": block_key,
        "score_area": block.get("score_area"),
        "internal_score": VISUAL_STATUSES[data["visual_status"]]["score"],
        "updated_by": user.id,
    })
    db = get_supabase()
    existing = _first(db.table("diagnosis_block_evaluations").select("id").eq("diagnosis_id", diagnosis_id).eq("block_key", block_key).limit(1).execute())
    if existing:
        saved = _first(db.table("diagnosis_block_evaluations").update(data).eq("id", existing["id"]).execute())
    else:
        saved = _first(db.table("diagnosis_block_evaluations").insert(data).execute())
    evaluations = db.table("diagnosis_block_evaluations").select("*").eq("diagnosis_id", diagnosis_id).execute().data or []
    metrics = _calculate_metrics(evaluations)
    maturity = metrics["maturity"]
    db.table("diagnoses").update({
        "overall_score": maturity or 0,
        "overall_level": "Sin evaluar" if maturity is None else "Controlado" if maturity >= 80 else "Inconsistente" if maturity >= 50 else "Pérdida probable",
        "status": "in_progress",
    }).eq("id", diagnosis_id).execute()
    return {"evaluation": saved, "metrics": metrics}


@router.patch("/diagnose/{diagnosis_id}/evidence/{evidence_id}/governance")
def update_evidence_governance(
    diagnosis_id: str,
    evidence_id: str,
    payload: EvidenceGovernanceUpdate,
    user: Annotated[CurrentUser, Depends(require_diagnose)],
) -> dict[str, Any]:
    _require_evidence_admin(user)
    _require_diagnosis(diagnosis_id)
    data = payload.model_dump(exclude_unset=True)
    if data.get("requirement_key") and data["requirement_key"] not in {row["key"] for row in EVIDENCE_REQUIREMENTS}:
        raise HTTPException(status_code=400, detail="Evidencia mínima no válida")
    data["access_scope"] = "Laura y administradores autorizados"
    saved = _first(get_supabase().table("diagnosis_evidence").update(data).eq("id", evidence_id).eq("diagnosis_id", diagnosis_id).execute())
    if not saved:
        raise HTTPException(status_code=404, detail="Evidencia no encontrada")
    return saved


@router.patch("/diagnose/{diagnosis_id}/implementation")
def update_implementation_offer(
    diagnosis_id: str,
    payload: ImplementationUpdate,
    user: Annotated[CurrentUser, Depends(require_diagnose)],
) -> dict[str, Any]:
    _require_diagnosis(diagnosis_id)
    return _first(get_supabase().table("diagnoses").update(payload.model_dump()).eq("id", diagnosis_id).execute()) or {}


@router.post("/diagnose/{diagnosis_id}/reports/{report_type}", status_code=201)
def create_validated_report(
    diagnosis_id: str,
    report_type: Literal["preliminary", "final"],
    user: Annotated[CurrentUser, Depends(require_diagnose)],
) -> dict[str, Any]:
    payload = _definitive_payload(diagnosis_id, include_evidence=user.role == "admin")
    readiness = payload["report_readiness"]
    if report_type == "final" and not readiness["final_ready"]:
        raise HTTPException(status_code=409, detail={"message": "El informe final todavía no cumple las validaciones", **readiness})
    db = get_supabase()
    count = db.table("diagnosis_reports").select("id", count="exact").eq("diagnosis_id", diagnosis_id).execute().count or 0
    snapshot = {
        "report_type": report_type,
        "metrics": payload["metrics"],
        "process_xray": payload["process_xray"],
        "loss_points": payload["loss_points"],
        "priorities": payload["priorities"],
        "roadmap": payload["roadmap"],
        "limitations": readiness["reasons"] if report_type == "preliminary" else [],
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    return _first(db.table("diagnosis_reports").insert({
        "diagnosis_id": diagnosis_id,
        "generated_by": user.id,
        "report_version": int(count) + 1,
        "report_type": report_type,
        "validation_summary": readiness,
        "snapshot": snapshot,
    }).execute()) or {}
