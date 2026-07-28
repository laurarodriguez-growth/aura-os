from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated, Any, Literal
from uuid import uuid4

import requests
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field

from .auth import CurrentUser, get_current_user, require_diagnose
from .config import get_settings
from .db import get_supabase
from .diagnose_analysis import analyze_corpus

router = APIRouter(prefix="/api", tags=["Diagnose"])
settings = get_settings()


ASSESSMENT_TEMPLATES: dict[str, dict[str, Any]] = {
    "icp": {
        "title": "ICP Assessment",
        "description": "Evalúa claridad, valor y capacidad de compra del cliente ideal.",
        "questions": [
            {"id": "ideal_customer_clarity", "label": "Cliente ideal claramente definido", "description": "Existe una definición concreta por sector, tamaño, problema y capacidad de compra.", "weight": 3, "finding": "El cliente ideal no está suficientemente definido.", "recommendation": "Documentar un ICP operativo con criterios de inclusión, exclusión y señales de compra."},
            {"id": "urgent_problem", "label": "Problema urgente y costoso", "description": "La oferta resuelve un problema que el cliente reconoce y desea corregir pronto.", "weight": 4, "finding": "El problema principal no se percibe como urgente.", "recommendation": "Reformular la oferta alrededor de una pérdida visible, medible y prioritaria."},
            {"id": "buying_capacity", "label": "Capacidad de compra", "description": "El segmento puede pagar la solución sin una fricción desproporcionada.", "weight": 4, "finding": "La capacidad de compra del segmento es incierta.", "recommendation": "Añadir señales de capacidad económica y ticket mínimo a la calificación del ICP."},
            {"id": "high_value_services", "label": "Servicios de mayor valor identificados", "description": "Se conocen los servicios que generan mayor margen, recurrencia o impacto.", "weight": 3, "finding": "No están priorizados los servicios de mayor valor.", "recommendation": "Ordenar servicios por margen, demanda, ciclo de venta y potencial de expansión."},
            {"id": "decision_maker", "label": "Decisor identificable", "description": "El equipo sabe quién aprueba o influye en la compra.", "weight": 3, "finding": "El decisor no está claramente identificado.", "recommendation": "Definir cargos objetivo, influenciadores y ruta de acceso al decisor."},
            {"id": "offer_fit", "label": "Encaje oferta–mercado", "description": "La propuesta responde con claridad a las necesidades del segmento.", "weight": 4, "finding": "El encaje entre la oferta y el segmento es débil.", "recommendation": "Conectar cada promesa de la oferta con un dolor, resultado y evidencia del ICP."},
            {"id": "lead_quality", "label": "Calidad de los leads actuales", "description": "Los leads recientes cumplen consistentemente con las características del ICP.", "weight": 3, "finding": "Los leads actuales presentan bajo encaje con el ICP.", "recommendation": "Ajustar fuentes, mensajes y filtros de captación según los leads que sí convierten."},
        ],
    },
    "conversion": {
        "title": "Conversion Audit",
        "description": "Mide la capacidad de convertir consultas en conversaciones, reuniones y ventas.",
        "questions": [
            {"id": "response_time", "label": "Tiempo de respuesta", "description": "Las consultas reciben respuesta rápida y dentro de un estándar definido.", "weight": 5, "finding": "El tiempo de respuesta está provocando pérdida de oportunidades.", "recommendation": "Definir SLA por canal y alertas para consultas sin atender."},
            {"id": "lead_capture", "label": "Captura estructurada de datos", "description": "Cada consulta guarda nombre, contacto, fuente, necesidad y responsable.", "weight": 4, "finding": "La información de los leads se captura de forma incompleta o dispersa.", "recommendation": "Estandarizar los datos mínimos y centralizar cada consulta desde el primer contacto."},
            {"id": "first_contact_script", "label": "Primer contacto estandarizado", "description": "El equipo utiliza un guion claro para calificar y avanzar la conversación.", "weight": 3, "finding": "El primer contacto depende demasiado de la improvisación.", "recommendation": "Crear un guion breve con apertura, calificación, valor y siguiente paso."},
            {"id": "followup_process", "label": "Proceso de seguimiento", "description": "Existen múltiples intentos, cadencias y próximos pasos documentados.", "weight": 5, "finding": "No existe un seguimiento comercial consistente.", "recommendation": "Implementar una cadencia mínima de seguimiento con canal, guion, fecha y responsable."},
            {"id": "appointment_process", "label": "Agendamiento y confirmación", "description": "Las reuniones se agendan, confirman y recuperan cuando hay no-show.", "weight": 4, "finding": "El proceso de agendamiento y confirmación tiene fugas.", "recommendation": "Estandarizar confirmaciones, recordatorios y recuperación de citas perdidas."},
            {"id": "objection_tracking", "label": "Objeciones registradas", "description": "El equipo documenta objeciones y conoce cuáles bloquean más ventas.", "weight": 3, "finding": "Las objeciones no se registran ni se convierten en aprendizaje.", "recommendation": "Clasificar objeciones y construir respuestas basadas en frecuencia y resultados."},
            {"id": "stage_visibility", "label": "Visibilidad por etapa", "description": "Se conoce cuántos leads avanzan, se estancan o se pierden en cada etapa.", "weight": 4, "finding": "No existe visibilidad real del embudo de conversión.", "recommendation": "Medir entrada, contacto, respuesta, reunión, propuesta y venta por periodo."},
            {"id": "source_attribution", "label": "Atribución de fuente", "description": "Cada lead conserva su fuente y puede compararse su conversión.", "weight": 3, "finding": "No se conoce qué canales generan oportunidades de calidad.", "recommendation": "Registrar fuente y campaña para comparar contacto, reunión, venta e ingreso."},
            {"id": "conversion_metrics", "label": "Métricas de conversión", "description": "La empresa revisa tasas y tiempos de conversión con una frecuencia definida.", "weight": 4, "finding": "La conversión no se gestiona con métricas periódicas.", "recommendation": "Crear un tablero con tasas, tiempos, volumen e ingresos por etapa."},
        ],
    },
    "process": {
        "title": "Process Analysis",
        "description": "Detecta fricción operativa, dependencias y pérdida de información.",
        "questions": [
            {"id": "clear_owners", "label": "Responsables definidos", "description": "Cada etapa tiene una persona responsable y criterios claros de entrega.", "weight": 4, "finding": "Los responsables del proceso no están claramente definidos.", "recommendation": "Asignar ownership por etapa y reglas de reasignación o escalamiento."},
            {"id": "standard_workflow", "label": "Flujo documentado", "description": "El equipo conoce el proceso desde la entrada hasta el cierre.", "weight": 4, "finding": "El flujo depende del conocimiento informal del equipo.", "recommendation": "Documentar el proceso actual, decisiones, entradas, salidas y excepciones."},
            {"id": "single_source_truth", "label": "Fuente única de información", "description": "Los datos relevantes viven en un sistema central y accesible.", "weight": 5, "finding": "La información está fragmentada entre chats, hojas y personas.", "recommendation": "Definir una fuente única y reglas para actualizarla en cada interacción."},
            {"id": "manual_rework", "label": "Bajo retrabajo manual", "description": "El equipo evita copiar, buscar o reconstruir información repetidamente.", "weight": 3, "finding": "El retrabajo manual consume tiempo y aumenta errores.", "recommendation": "Identificar tareas repetitivas y eliminar duplicación antes de automatizar."},
            {"id": "handoffs", "label": "Entregas entre personas", "description": "Los handoffs incluyen contexto, responsable y próximo paso.", "weight": 3, "finding": "Las entregas entre personas pierden contexto o generan retrasos.", "recommendation": "Crear criterios de entrega y campos obligatorios para cada handoff."},
            {"id": "sops", "label": "SOPs disponibles", "description": "Las tareas críticas tienen instrucciones fáciles de seguir y actualizar.", "weight": 3, "finding": "Las tareas críticas no tienen SOPs operativos.", "recommendation": "Documentar primero los procesos de mayor impacto, frecuencia y riesgo."},
            {"id": "quality_control", "label": "Control de calidad", "description": "Se revisan errores, cumplimiento y resultados con responsables definidos.", "weight": 3, "finding": "No existe un control de calidad consistente.", "recommendation": "Definir checkpoints, criterios de aceptación y revisión periódica."},
            {"id": "cycle_time", "label": "Tiempos del proceso medidos", "description": "Se conoce cuánto tarda cada etapa y dónde se acumulan retrasos.", "weight": 4, "finding": "Los cuellos de botella no se identifican con datos de tiempo.", "recommendation": "Medir tiempos por etapa y establecer alertas de estancamiento."},
        ],
    },
    "automation": {
        "title": "Automation Score",
        "description": "Evalúa preparación, integración y oportunidades de automatización.",
        "questions": [
            {"id": "central_crm", "label": "CRM o base central", "description": "Los contactos, estados y actividades se gestionan en una base común.", "weight": 5, "finding": "No existe una base central confiable para operar los leads.", "recommendation": "Centralizar leads, responsables, estados, seguimientos y actividad."},
            {"id": "automatic_capture", "label": "Captura automática", "description": "Los leads ingresan al sistema sin copiar datos manualmente.", "weight": 4, "finding": "La captura manual de leads genera retrasos y pérdida de datos.", "recommendation": "Conectar formularios y canales con una entrada estructurada y deduplicada."},
            {"id": "automatic_assignment", "label": "Asignación automática", "description": "Cada oportunidad recibe responsable según reglas claras.", "weight": 3, "finding": "La asignación de oportunidades depende de coordinación manual.", "recommendation": "Definir reglas por origen, zona, servicio, carga o disponibilidad."},
            {"id": "followup_automation", "label": "Recordatorios y seguimiento", "description": "El sistema crea alertas o acciones cuando una oportunidad requiere atención.", "weight": 5, "finding": "Los seguimientos dependen de la memoria del equipo.", "recommendation": "Automatizar recordatorios y colas de trabajo sin automatizar conversaciones sensibles."},
            {"id": "integrations", "label": "Integraciones entre herramientas", "description": "Los sistemas comparten información sin duplicación manual.", "weight": 4, "finding": "Las herramientas no intercambian información de forma confiable.", "recommendation": "Priorizar integraciones que eliminen doble registro y reduzcan tiempos."},
            {"id": "data_quality", "label": "Calidad de datos", "description": "Los datos tienen formatos, campos y reglas consistentes.", "weight": 4, "finding": "La calidad de datos limita cualquier automatización futura.", "recommendation": "Normalizar campos, valores, responsables y reglas de deduplicación."},
            {"id": "alerts", "label": "Alertas operativas", "description": "El equipo recibe alertas por retrasos, vencimientos o excepciones.", "weight": 3, "finding": "Los problemas se descubren tarde porque no existen alertas.", "recommendation": "Crear alertas accionables solo para excepciones que cambian el próximo paso."},
            {"id": "reporting", "label": "Reportes automáticos", "description": "Las métricas se actualizan sin consolidación manual frecuente.", "weight": 3, "finding": "Los reportes consumen tiempo manual o llegan demasiado tarde.", "recommendation": "Automatizar métricas básicas desde la fuente operativa antes de añadir BI complejo."},
            {"id": "automation_governance", "label": "Gobierno y mantenimiento", "description": "Las automatizaciones tienen dueño, documentación y revisión.", "weight": 3, "finding": "Las automatizaciones no tienen mantenimiento ni ownership definido.", "recommendation": "Asignar dueño, documentación, alertas de fallo y revisión periódica."},
        ],
    },
}

SCORE_OPTIONS = [
    {"value": 0, "label": "No existe"},
    {"value": 1, "label": "Muy débil"},
    {"value": 2, "label": "Parcial"},
    {"value": 3, "label": "Sólido"},
    {"value": 4, "label": "Optimizado"},
]


class DiagnosisCreate(BaseModel):
    lead_id: str | None = None
    company_name: str = Field(min_length=2, max_length=180)
    industry: str | None = Field(default=None, max_length=120)
    website: str | None = Field(default=None, max_length=500)
    instagram: str | None = Field(default=None, max_length=500)
    whatsapp: str | None = Field(default=None, max_length=120)
    city: str | None = Field(default="Ciudad de Panamá", max_length=120)
    contact_name: str | None = Field(default=None, max_length=160)
    contact_title: str | None = Field(default=None, max_length=160)
    objective: str | None = Field(default=None, max_length=3000)
    declared_problem: str | None = Field(default=None, max_length=3000)
    assigned_to: str | None = None


class DiagnosisUpdate(BaseModel):
    company_name: str | None = Field(default=None, min_length=2, max_length=180)
    industry: str | None = Field(default=None, max_length=120)
    website: str | None = Field(default=None, max_length=500)
    instagram: str | None = Field(default=None, max_length=500)
    whatsapp: str | None = Field(default=None, max_length=120)
    city: str | None = Field(default=None, max_length=120)
    contact_name: str | None = Field(default=None, max_length=160)
    contact_title: str | None = Field(default=None, max_length=160)
    objective: str | None = Field(default=None, max_length=3000)
    declared_problem: str | None = Field(default=None, max_length=3000)
    executive_summary: str | None = Field(default=None, max_length=10000)
    assigned_to: str | None = None
    status: Literal["draft", "in_progress", "completed", "archived"] | None = None


class AssessmentAnswer(BaseModel):
    question_id: str
    score: int = Field(ge=0, le=4)
    note: str | None = Field(default=None, max_length=3000)
    evidence: str | None = Field(default=None, max_length=3000)


class AssessmentSave(BaseModel):
    answers: list[AssessmentAnswer]
    notes: str | None = Field(default=None, max_length=5000)


class FindingCreate(BaseModel):
    source_section: str | None = None
    title: str = Field(min_length=2, max_length=300)
    description: str | None = Field(default=None, max_length=5000)
    evidence: str | None = Field(default=None, max_length=5000)
    impact: Literal["low", "medium", "high", "critical"] = "medium"
    urgency: Literal["low", "medium", "high", "critical"] = "medium"
    recommendation: str | None = Field(default=None, max_length=5000)
    priority: int = Field(default=50, ge=0, le=100)
    status: Literal["open", "sent_to_focus", "resolved", "dismissed"] = "open"


class FindingUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=300)
    description: str | None = Field(default=None, max_length=5000)
    evidence: str | None = Field(default=None, max_length=5000)
    impact: Literal["low", "medium", "high", "critical"] | None = None
    urgency: Literal["low", "medium", "high", "critical"] | None = None
    recommendation: str | None = Field(default=None, max_length=5000)
    priority: int | None = Field(default=None, ge=0, le=100)
    status: Literal["open", "sent_to_focus", "resolved", "dismissed"] | None = None


class RoadmapCreate(BaseModel):
    finding_id: str | None = None
    phase: Literal["7_days", "30_days", "90_days"] = "7_days"
    title: str = Field(min_length=2, max_length=300)
    description: str | None = Field(default=None, max_length=5000)
    priority: Literal["low", "medium", "high", "critical"] = "medium"
    owner_id: str | None = None
    due_date: date | None = None
    order_index: int = 0


class RoadmapUpdate(BaseModel):
    phase: Literal["7_days", "30_days", "90_days"] | None = None
    title: str | None = Field(default=None, min_length=2, max_length=300)
    description: str | None = Field(default=None, max_length=5000)
    priority: Literal["low", "medium", "high", "critical"] | None = None
    owner_id: str | None = None
    due_date: date | None = None
    status: Literal["planned", "sent_to_focus", "in_progress", "completed", "cancelled"] | None = None
    order_index: int | None = None


class SendToFocus(BaseModel):
    assigned_to: str | None = None
    due_date: date | None = None


class FocusTaskUpdate(BaseModel):
    status: Literal["pending", "in_progress", "completed", "dismissed"] | None = None
    assigned_to: str | None = None
    due_date: date | None = None


class InterviewQuestionUpdate(BaseModel):
    answer: str | None = Field(default=None, max_length=8000)
    status: Literal["pending", "answered", "not_applicable"] | None = None


class InterviewQuestionCreate(BaseModel):
    question: str = Field(min_length=3, max_length=1000)
    rationale: str | None = Field(default=None, max_length=3000)
    section: Literal["general", "icp", "conversion", "process", "automation"] = "general"
    priority: Literal["low", "medium", "high", "critical"] = "medium"


def _first(response: Any) -> dict[str, Any] | None:
    return (response.data or [None])[0]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _score_level(score: int) -> str:
    if score >= 80:
        return "Optimizado"
    if score >= 65:
        return "Sólido"
    if score >= 45:
        return "En desarrollo"
    if score >= 25:
        return "Débil"
    return "Crítico"


def _impact_priority(impact: str, urgency: str) -> int:
    values = {"low": 20, "medium": 45, "high": 75, "critical": 95}
    return round((values.get(impact, 45) + values.get(urgency, 45)) / 2)


def _require_diagnosis(diagnosis_id: str) -> dict[str, Any]:
    row = _first(get_supabase().table("diagnoses").select("*").eq("id", diagnosis_id).limit(1).execute())
    if not row:
        raise HTTPException(status_code=404, detail="Diagnóstico no encontrado")
    return row


def _recalculate_overall(diagnosis_id: str) -> dict[str, Any]:
    db = get_supabase()
    rows = db.table("diagnosis_assessments").select("section,score").eq("diagnosis_id", diagnosis_id).execute().data or []
    score = round(sum(int(row.get("score") or 0) for row in rows) / len(rows)) if rows else 0
    level = _score_level(score) if rows else "Sin evaluar"
    update = {"overall_score": score, "overall_level": level, "status": "in_progress" if rows else "draft"}
    return _first(db.table("diagnoses").update(update).eq("id", diagnosis_id).execute()) or update


def _profiles_map() -> dict[str, str]:
    rows = get_supabase().table("profiles").select("id,full_name").execute().data or []
    return {str(row["id"]): row.get("full_name") or "Usuario" for row in rows}


def _full_diagnosis(diagnosis_id: str) -> dict[str, Any]:
    db = get_supabase()
    diagnosis = _require_diagnosis(diagnosis_id)
    assessments = db.table("diagnosis_assessments").select("*").eq("diagnosis_id", diagnosis_id).execute().data or []
    evidence = db.table("diagnosis_evidence").select("*").eq("diagnosis_id", diagnosis_id).order("created_at", desc=True).execute().data or []
    findings = db.table("diagnosis_findings").select("*").eq("diagnosis_id", diagnosis_id).order("priority", desc=True).order("created_at", desc=True).execute().data or []
    roadmap = db.table("diagnosis_roadmap").select("*").eq("diagnosis_id", diagnosis_id).order("phase").order("order_index").execute().data or []
    reports = db.table("diagnosis_reports").select("id,report_version,created_at,generated_by").eq("diagnosis_id", diagnosis_id).order("created_at", desc=True).execute().data or []
    latest_analysis = _first(
        db.table("diagnosis_analysis_runs")
        .select("*")
        .eq("diagnosis_id", diagnosis_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    interview_questions = (
        db.table("diagnosis_interview_questions")
        .select("*")
        .eq("diagnosis_id", diagnosis_id)
        .order("priority")
        .order("created_at")
        .execute()
        .data
        or []
    )
    lead = None
    if diagnosis.get("lead_id"):
        lead = _first(db.table("leads").select("id,business_name,address,phone,website,instagram_url,whatsapp_url,final_score,final_tier,status").eq("id", diagnosis["lead_id"]).limit(1).execute())
    profile_names = _profiles_map()
    for item in roadmap:
        item["owner_name"] = profile_names.get(str(item.get("owner_id")), "Sin asignar") if item.get("owner_id") else "Sin asignar"
    diagnosis.update({
        "assessments": assessments,
        "evidence": evidence,
        "findings": findings,
        "roadmap": roadmap,
        "reports": reports,
        "latest_analysis": latest_analysis,
        "interview_questions": interview_questions,
        "lead": lead,
        "assigned_name": profile_names.get(str(diagnosis.get("assigned_to")), "Sin asignar") if diagnosis.get("assigned_to") else "Sin asignar",
    })
    return diagnosis


def _storage_headers(content_type: str | None = None) -> dict[str, str]:
    headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
    }
    if content_type:
        headers["Content-Type"] = content_type
    return headers


def _delete_storage_object(path: str) -> None:
    requests.delete(
        f"{settings.supabase_url.rstrip('/')}/storage/v1/object/diagnose-evidence/{path}",
        headers=_storage_headers("application/json"),
        timeout=15,
    )


@router.get("/diagnose/templates")
def diagnosis_templates(user: Annotated[CurrentUser, Depends(require_diagnose)]) -> dict[str, Any]:
    return {"sections": ASSESSMENT_TEMPLATES, "score_options": SCORE_OPTIONS}


@router.get("/diagnose/summary")
def diagnosis_summary(user: Annotated[CurrentUser, Depends(require_diagnose)]) -> dict[str, Any]:
    db = get_supabase()
    rows = db.table("diagnoses").select("id,status,overall_score,overall_level,updated_at").neq("status", "archived").execute().data or []
    findings = db.table("diagnosis_findings").select("id,impact,status").in_("status", ["open", "sent_to_focus"]).execute().data or []
    tasks = db.table("focus_tasks").select("id,status").in_("status", ["pending", "in_progress"]).execute().data or []
    reports = db.table("diagnosis_reports").select("id", count="exact").execute()
    recent = db.table("diagnoses").select("id,company_name,industry,status,overall_score,overall_level,updated_at").neq("status", "archived").order("updated_at", desc=True).limit(6).execute().data or []
    return {
        "active": sum(1 for row in rows if row.get("status") in {"draft", "in_progress"}),
        "completed": sum(1 for row in rows if row.get("status") == "completed"),
        "critical_findings": sum(1 for row in findings if row.get("impact") == "critical" and row.get("status") == "open"),
        "focus_actions": len(tasks),
        "reports": int(reports.count or 0),
        "recent": recent,
    }


@router.post("/diagnose", status_code=201)
def create_diagnosis(payload: DiagnosisCreate, user: Annotated[CurrentUser, Depends(require_diagnose)]) -> dict[str, Any]:
    db = get_supabase()
    data = payload.model_dump(exclude_none=True)
    data["created_by"] = user.id
    data["assigned_to"] = data.get("assigned_to") or user.id
    result = _first(db.table("diagnoses").insert(data).execute())
    if not result:
        raise HTTPException(status_code=500, detail="No se pudo crear el diagnóstico")
    return result


@router.get("/diagnose")
def list_diagnoses(
    user: Annotated[CurrentUser, Depends(require_diagnose)],
    search: str | None = None,
    status: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=30, ge=1, le=100),
) -> dict[str, Any]:
    start = (page - 1) * page_size
    query = get_supabase().table("diagnoses").select("*", count="exact")
    if status:
        query = query.eq("status", status)
    else:
        query = query.neq("status", "archived")
    if search:
        safe = "".join(char for char in search[:120] if char.isalnum() or char in " áéíóúÁÉÍÓÚñÑ@._+-")
        if safe:
            pattern = f"*{safe}*"
            query = query.or_(f"company_name.ilike.{pattern},industry.ilike.{pattern},contact_name.ilike.{pattern},declared_problem.ilike.{pattern}")
    response = query.order("updated_at", desc=True).range(start, start + page_size - 1).execute()
    return {"items": response.data or [], "total": int(response.count or 0), "page": page, "page_size": page_size}


@router.get("/diagnose/reports")
def list_diagnosis_reports(user: Annotated[CurrentUser, Depends(require_diagnose)]) -> dict[str, Any]:
    db = get_supabase()
    reports = db.table("diagnosis_reports").select("*").order("created_at", desc=True).limit(200).execute().data or []
    diagnosis_ids = list({row.get("diagnosis_id") for row in reports if row.get("diagnosis_id")})
    names: dict[str, dict[str, Any]] = {}
    if diagnosis_ids:
        rows = db.table("diagnoses").select("id,company_name,overall_score,overall_level,status").in_("id", diagnosis_ids).execute().data or []
        names = {str(row["id"]): row for row in rows}
    for report in reports:
        report["diagnosis"] = names.get(str(report.get("diagnosis_id")), {})
    return {"items": reports}


@router.get("/diagnose/{diagnosis_id}")
def get_diagnosis(diagnosis_id: str, user: Annotated[CurrentUser, Depends(require_diagnose)]) -> dict[str, Any]:
    return _full_diagnosis(diagnosis_id)


@router.patch("/diagnose/{diagnosis_id}")
def update_diagnosis(payload: DiagnosisUpdate, diagnosis_id: str, user: Annotated[CurrentUser, Depends(require_diagnose)]) -> dict[str, Any]:
    _require_diagnosis(diagnosis_id)
    data = payload.model_dump(exclude_unset=True)
    if data.get("status") == "completed":
        data["completed_at"] = _now_iso()
    elif data.get("status") and data["status"] != "completed":
        data["completed_at"] = None
    result = _first(get_supabase().table("diagnoses").update(data).eq("id", diagnosis_id).execute())
    return result or _require_diagnosis(diagnosis_id)


@router.put("/diagnose/{diagnosis_id}/assessments/{section}")
def save_assessment(
    diagnosis_id: str,
    section: str,
    payload: AssessmentSave,
    user: Annotated[CurrentUser, Depends(require_diagnose)],
) -> dict[str, Any]:
    _require_diagnosis(diagnosis_id)
    template = ASSESSMENT_TEMPLATES.get(section)
    if not template:
        raise HTTPException(status_code=404, detail="Sección de evaluación no válida")
    answers_by_id = {answer.question_id: answer for answer in payload.answers}
    normalized: list[dict[str, Any]] = []
    earned = 0
    maximum = 0
    completed = 0
    for question in template["questions"]:
        answer = answers_by_id.get(question["id"])
        score = int(answer.score) if answer else 0
        weight = int(question.get("weight") or 1)
        maximum += 4 * weight
        earned += score * weight
        if answer:
            completed += 1
        normalized.append({
            "question_id": question["id"],
            "label": question["label"],
            "score": score,
            "weight": weight,
            "note": answer.note if answer else None,
            "evidence": answer.evidence if answer else None,
        })
    score = round((earned / maximum) * 100) if maximum else 0
    level = _score_level(score)
    data = {
        "diagnosis_id": diagnosis_id,
        "section": section,
        "answers": normalized,
        "score": score,
        "level": level,
        "notes": payload.notes,
        "updated_by": user.id,
    }
    db = get_supabase()
    existing = _first(db.table("diagnosis_assessments").select("id").eq("diagnosis_id", diagnosis_id).eq("section", section).limit(1).execute())
    if existing:
        saved = _first(db.table("diagnosis_assessments").update(data).eq("id", existing["id"]).execute())
    else:
        saved = _first(db.table("diagnosis_assessments").insert(data).execute())
    overall = _recalculate_overall(diagnosis_id)
    return {"assessment": saved, "overall": overall, "completion": round((completed / len(template["questions"])) * 100)}


@router.post("/diagnose/{diagnosis_id}/generate-findings")
def generate_findings(diagnosis_id: str, user: Annotated[CurrentUser, Depends(require_diagnose)]) -> dict[str, Any]:
    _require_diagnosis(diagnosis_id)
    db = get_supabase()
    assessments = db.table("diagnosis_assessments").select("section,answers").eq("diagnosis_id", diagnosis_id).execute().data or []
    created = 0
    updated = 0
    for assessment in assessments:
        section = assessment.get("section")
        template = ASSESSMENT_TEMPLATES.get(str(section), {})
        question_map = {q["id"]: q for q in template.get("questions", [])}
        for answer in assessment.get("answers") or []:
            score = int(answer.get("score") or 0)
            if score > 2:
                continue
            question = question_map.get(answer.get("question_id"))
            if not question:
                continue
            impact = "critical" if score == 0 and int(question.get("weight") or 1) >= 4 else "high" if score <= 1 else "medium"
            urgency = "high" if int(question.get("weight") or 1) >= 4 else "medium"
            source_key = f"{section}:{question['id']}"
            data = {
                "diagnosis_id": diagnosis_id,
                "source_section": section,
                "source_key": source_key,
                "title": question["finding"],
                "description": question.get("description"),
                "evidence": answer.get("evidence") or answer.get("note"),
                "impact": impact,
                "urgency": urgency,
                "recommendation": question.get("recommendation"),
                "priority": _impact_priority(impact, urgency),
                "created_by": user.id,
            }
            existing = _first(db.table("diagnosis_findings").select("id").eq("diagnosis_id", diagnosis_id).eq("source_key", source_key).limit(1).execute())
            if existing:
                db.table("diagnosis_findings").update(data).eq("id", existing["id"]).execute()
                updated += 1
            else:
                db.table("diagnosis_findings").insert(data).execute()
                created += 1
    return {"created": created, "updated": updated, "findings": _full_diagnosis(diagnosis_id)["findings"]}


@router.post("/diagnose/{diagnosis_id}/findings", status_code=201)
def create_finding(diagnosis_id: str, payload: FindingCreate, user: Annotated[CurrentUser, Depends(require_diagnose)]) -> dict[str, Any]:
    _require_diagnosis(diagnosis_id)
    data = payload.model_dump(exclude_none=True)
    data.update({"diagnosis_id": diagnosis_id, "created_by": user.id})
    if "priority" not in data:
        data["priority"] = _impact_priority(data.get("impact", "medium"), data.get("urgency", "medium"))
    return _first(get_supabase().table("diagnosis_findings").insert(data).execute()) or {}


@router.patch("/diagnose/{diagnosis_id}/findings/{finding_id}")
def update_finding(diagnosis_id: str, finding_id: str, payload: FindingUpdate, user: Annotated[CurrentUser, Depends(require_diagnose)]) -> dict[str, Any]:
    _require_diagnosis(diagnosis_id)
    data = payload.model_dump(exclude_unset=True)
    return _first(get_supabase().table("diagnosis_findings").update(data).eq("id", finding_id).eq("diagnosis_id", diagnosis_id).execute()) or {}


@router.delete("/diagnose/{diagnosis_id}/findings/{finding_id}")
def delete_finding(diagnosis_id: str, finding_id: str, user: Annotated[CurrentUser, Depends(require_diagnose)]) -> dict[str, bool]:
    _require_diagnosis(diagnosis_id)
    get_supabase().table("diagnosis_findings").delete().eq("id", finding_id).eq("diagnosis_id", diagnosis_id).execute()
    return {"deleted": True}


@router.post("/diagnose/{diagnosis_id}/generate-roadmap")
def generate_roadmap(diagnosis_id: str, user: Annotated[CurrentUser, Depends(require_diagnose)]) -> dict[str, Any]:
    _require_diagnosis(diagnosis_id)
    db = get_supabase()
    findings = db.table("diagnosis_findings").select("*").eq("diagnosis_id", diagnosis_id).eq("status", "open").order("priority", desc=True).execute().data or []
    existing = db.table("diagnosis_roadmap").select("finding_id").eq("diagnosis_id", diagnosis_id).execute().data or []
    existing_ids = {row.get("finding_id") for row in existing}
    created = 0
    for index, finding in enumerate(findings):
        if finding.get("id") in existing_ids:
            continue
        impact = finding.get("impact")
        phase = "7_days" if impact == "critical" else "30_days" if impact == "high" else "90_days"
        due_days = 7 if phase == "7_days" else 30 if phase == "30_days" else 90
        db.table("diagnosis_roadmap").insert({
            "diagnosis_id": diagnosis_id,
            "finding_id": finding.get("id"),
            "phase": phase,
            "title": finding.get("recommendation") or finding.get("title"),
            "description": finding.get("description"),
            "priority": impact if impact in {"low", "medium", "high", "critical"} else "medium",
            "owner_id": user.id,
            "due_date": (date.today() + timedelta(days=due_days)).isoformat(),
            "order_index": index,
        }).execute()
        created += 1
    return {"created": created, "roadmap": _full_diagnosis(diagnosis_id)["roadmap"]}


@router.post("/diagnose/{diagnosis_id}/roadmap", status_code=201)
def create_roadmap_item(diagnosis_id: str, payload: RoadmapCreate, user: Annotated[CurrentUser, Depends(require_diagnose)]) -> dict[str, Any]:
    _require_diagnosis(diagnosis_id)
    data = payload.model_dump(exclude_none=True)
    data["diagnosis_id"] = diagnosis_id
    data["owner_id"] = data.get("owner_id") or user.id
    return _first(get_supabase().table("diagnosis_roadmap").insert(data).execute()) or {}


@router.patch("/diagnose/{diagnosis_id}/roadmap/{item_id}")
def update_roadmap_item(diagnosis_id: str, item_id: str, payload: RoadmapUpdate, user: Annotated[CurrentUser, Depends(require_diagnose)]) -> dict[str, Any]:
    _require_diagnosis(diagnosis_id)
    data = payload.model_dump(exclude_unset=True)
    return _first(get_supabase().table("diagnosis_roadmap").update(data).eq("id", item_id).eq("diagnosis_id", diagnosis_id).execute()) or {}


@router.delete("/diagnose/{diagnosis_id}/roadmap/{item_id}")
def delete_roadmap_item(diagnosis_id: str, item_id: str, user: Annotated[CurrentUser, Depends(require_diagnose)]) -> dict[str, bool]:
    _require_diagnosis(diagnosis_id)
    get_supabase().table("diagnosis_roadmap").delete().eq("id", item_id).eq("diagnosis_id", diagnosis_id).execute()
    return {"deleted": True}


@router.post("/diagnose/{diagnosis_id}/roadmap/{item_id}/send-to-focus")
def send_roadmap_to_focus(
    diagnosis_id: str,
    item_id: str,
    payload: SendToFocus,
    user: Annotated[CurrentUser, Depends(require_diagnose)],
) -> dict[str, Any]:
    diagnosis = _require_diagnosis(diagnosis_id)
    db = get_supabase()
    item = _first(db.table("diagnosis_roadmap").select("*").eq("id", item_id).eq("diagnosis_id", diagnosis_id).limit(1).execute())
    if not item:
        raise HTTPException(status_code=404, detail="Acción de roadmap no encontrada")
    assigned_to = payload.assigned_to or item.get("owner_id") or user.id
    due_date_value = payload.due_date or (date.today() + timedelta(days=1))
    task_data = {
        "diagnosis_id": diagnosis_id,
        "roadmap_item_id": item_id,
        "lead_id": diagnosis.get("lead_id"),
        "created_by": user.id,
        "assigned_to": assigned_to,
        "title": item.get("title"),
        "description": item.get("description"),
        "priority": item.get("priority") or "medium",
        "due_date": due_date_value.isoformat(),
        "status": "pending",
    }
    existing = _first(db.table("focus_tasks").select("id").eq("roadmap_item_id", item_id).in_("status", ["pending", "in_progress"]).limit(1).execute())
    if existing:
        task = _first(db.table("focus_tasks").update(task_data).eq("id", existing["id"]).execute())
    else:
        task = _first(db.table("focus_tasks").insert(task_data).execute())
    db.table("diagnosis_roadmap").update({"status": "sent_to_focus", "focus_task_id": task.get("id") if task else None}).eq("id", item_id).execute()
    if item.get("finding_id"):
        db.table("diagnosis_findings").update({"status": "sent_to_focus"}).eq("id", item["finding_id"]).execute()
    return task or {}


@router.post("/diagnose/{diagnosis_id}/evidence", status_code=201)
def create_evidence(
    diagnosis_id: str,
    user: Annotated[CurrentUser, Depends(require_diagnose)],
    name: str = Form(...),
    category: str = Form("General"),
    evidence_type: str = Form("note"),
    external_url: str | None = Form(None),
    notes: str | None = Form(None),
    file: UploadFile | None = File(None),
) -> dict[str, Any]:
    _require_diagnosis(diagnosis_id)
    if evidence_type not in {"file", "link", "note"}:
        raise HTTPException(status_code=400, detail="Tipo de evidencia no válido")
    data: dict[str, Any] = {
        "diagnosis_id": diagnosis_id,
        "uploaded_by": user.id,
        "name": name[:240],
        "category": category[:120],
        "evidence_type": evidence_type,
        "external_url": external_url,
        "notes": notes,
    }
    if file:
        body = file.file.read()
        if len(body) > 10 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="El archivo supera el máximo de 10 MB")
        suffix = Path(file.filename or "archivo").suffix.lower()[:12]
        storage_path = f"{diagnosis_id}/{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{uuid4().hex}{suffix}"
        response = requests.post(
            f"{settings.supabase_url.rstrip('/')}/storage/v1/object/diagnose-evidence/{storage_path}",
            headers={**_storage_headers(file.content_type or "application/octet-stream"), "x-upsert": "false"},
            data=body,
            timeout=30,
        )
        if response.status_code not in {200, 201}:
            raise HTTPException(status_code=502, detail="No se pudo subir la evidencia a Supabase Storage")
        data.update({
            "evidence_type": "file",
            "storage_path": storage_path,
            "mime_type": file.content_type,
            "size_bytes": len(body),
        })
    elif evidence_type == "file":
        raise HTTPException(status_code=400, detail="Selecciona un archivo")
    return _first(get_supabase().table("diagnosis_evidence").insert(data).execute()) or {}


@router.get("/diagnose/evidence/{evidence_id}/open")
def open_evidence(evidence_id: str, user: Annotated[CurrentUser, Depends(require_diagnose)]) -> dict[str, str]:
    row = _first(get_supabase().table("diagnosis_evidence").select("*").eq("id", evidence_id).limit(1).execute())
    if not row:
        raise HTTPException(status_code=404, detail="Evidencia no encontrada")
    if row.get("external_url") and not row.get("storage_path"):
        return {"url": row["external_url"]}
    path = row.get("storage_path")
    if not path:
        raise HTTPException(status_code=400, detail="Esta evidencia no tiene archivo o enlace")
    response = requests.post(
        f"{settings.supabase_url.rstrip('/')}/storage/v1/object/sign/diagnose-evidence/{path}",
        headers=_storage_headers("application/json"),
        data=json.dumps({"expiresIn": 3600}),
        timeout=15,
    )
    if response.status_code not in {200, 201}:
        raise HTTPException(status_code=502, detail="No se pudo abrir la evidencia")
    signed = response.json().get("signedURL") or response.json().get("signedUrl")
    if not signed:
        raise HTTPException(status_code=502, detail="Supabase no devolvió una URL firmada")
    if signed.startswith("/"):
        signed = f"{settings.supabase_url.rstrip('/')}/storage/v1{signed}"
    return {"url": signed}


@router.delete("/diagnose/{diagnosis_id}/evidence/{evidence_id}")
def delete_evidence(diagnosis_id: str, evidence_id: str, user: Annotated[CurrentUser, Depends(require_diagnose)]) -> dict[str, bool]:
    _require_diagnosis(diagnosis_id)
    db = get_supabase()
    row = _first(db.table("diagnosis_evidence").select("*").eq("id", evidence_id).eq("diagnosis_id", diagnosis_id).limit(1).execute())
    if not row:
        raise HTTPException(status_code=404, detail="Evidencia no encontrada")
    if row.get("storage_path"):
        _delete_storage_object(row["storage_path"])
    db.table("diagnosis_evidence").delete().eq("id", evidence_id).execute()
    return {"deleted": True}


@router.post("/diagnose/{diagnosis_id}/analyze-evidence")
def analyze_diagnosis_evidence(
    diagnosis_id: str,
    user: Annotated[CurrentUser, Depends(require_diagnose)],
) -> dict[str, Any]:
    diagnosis = _require_diagnosis(diagnosis_id)
    db = get_supabase()
    evidence = (
        db.table("diagnosis_evidence")
        .select("*")
        .eq("diagnosis_id", diagnosis_id)
        .order("created_at")
        .execute()
        .data
        or []
    )
    existing_questions = (
        db.table("diagnosis_interview_questions")
        .select("*")
        .eq("diagnosis_id", diagnosis_id)
        .execute()
        .data
        or []
    )
    result = analyze_corpus(diagnosis, evidence, existing_questions)
    run = _first(db.table("diagnosis_analysis_runs").insert({
        "diagnosis_id": diagnosis_id,
        "created_by": user.id,
        "engine_version": result["engine_version"],
        "status": "completed",
        "summary": result["summary"],
        "evidence_count": result["evidence_count"],
        "extracted_text_chars": result["extracted_text_chars"],
        "signals": result["signals"],
        "assessment_suggestions": result["assessment_suggestions"],
        "limitations": result["limitations"],
        "evidence_context": result["evidence_context"],
    }).execute())
    if not run:
        raise HTTPException(status_code=500, detail="No se pudo guardar el análisis")

    existing_by_key = {str(row.get("question_key")): row for row in existing_questions}
    for question in result["questions"]:
        data = {
            "analysis_run_id": run["id"],
            "section": question["section"],
            "question": question["question"],
            "rationale": question["rationale"],
            "priority": question["priority"],
        }
        existing = existing_by_key.get(question["question_key"])
        if existing:
            db.table("diagnosis_interview_questions").update(data).eq("id", existing["id"]).execute()
        else:
            db.table("diagnosis_interview_questions").insert({
                **data,
                "diagnosis_id": diagnosis_id,
                "question_key": question["question_key"],
                "source": "analysis",
            }).execute()

    questions = (
        db.table("diagnosis_interview_questions")
        .select("*")
        .eq("diagnosis_id", diagnosis_id)
        .order("created_at")
        .execute()
        .data
        or []
    )
    return {"analysis": run, "questions": questions}


@router.get("/diagnose/{diagnosis_id}/analysis")
def get_diagnosis_analysis(
    diagnosis_id: str,
    user: Annotated[CurrentUser, Depends(require_diagnose)],
) -> dict[str, Any]:
    _require_diagnosis(diagnosis_id)
    db = get_supabase()
    analysis = _first(
        db.table("diagnosis_analysis_runs")
        .select("*")
        .eq("diagnosis_id", diagnosis_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    questions = (
        db.table("diagnosis_interview_questions")
        .select("*")
        .eq("diagnosis_id", diagnosis_id)
        .order("created_at")
        .execute()
        .data
        or []
    )
    return {"analysis": analysis, "questions": questions}


@router.post("/diagnose/{diagnosis_id}/interview-questions", status_code=201)
def create_interview_question(
    diagnosis_id: str,
    payload: InterviewQuestionCreate,
    user: Annotated[CurrentUser, Depends(require_diagnose)],
) -> dict[str, Any]:
    _require_diagnosis(diagnosis_id)
    key = f"manual-{uuid4().hex}"
    return _first(get_supabase().table("diagnosis_interview_questions").insert({
        "diagnosis_id": diagnosis_id,
        "question_key": key,
        "question": payload.question,
        "rationale": payload.rationale,
        "section": payload.section,
        "priority": payload.priority,
        "source": "manual",
    }).execute()) or {}


@router.patch("/diagnose/{diagnosis_id}/interview-questions/{question_id}")
def update_interview_question(
    diagnosis_id: str,
    question_id: str,
    payload: InterviewQuestionUpdate,
    user: Annotated[CurrentUser, Depends(require_diagnose)],
) -> dict[str, Any]:
    _require_diagnosis(diagnosis_id)
    db = get_supabase()
    existing = _first(
        db.table("diagnosis_interview_questions")
        .select("*")
        .eq("id", question_id)
        .eq("diagnosis_id", diagnosis_id)
        .limit(1)
        .execute()
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Pregunta no encontrada")
    data = payload.model_dump(exclude_unset=True)
    if "answer" in data:
        answer = (data.get("answer") or "").strip()
        data["answer"] = answer or None
        if payload.status is None:
            data["status"] = "answered" if answer else "pending"
    if data.get("status") == "answered":
        data["answered_by"] = user.id
        data["answered_at"] = _now_iso()
    elif data.get("status") in {"pending", "not_applicable"}:
        data["answered_by"] = None
        data["answered_at"] = None
    return _first(
        db.table("diagnosis_interview_questions")
        .update(data)
        .eq("id", question_id)
        .eq("diagnosis_id", diagnosis_id)
        .execute()
    ) or existing


@router.delete("/diagnose/{diagnosis_id}/interview-questions/{question_id}")
def delete_interview_question(
    diagnosis_id: str,
    question_id: str,
    user: Annotated[CurrentUser, Depends(require_diagnose)],
) -> dict[str, bool]:
    _require_diagnosis(diagnosis_id)
    get_supabase().table("diagnosis_interview_questions").delete().eq("id", question_id).eq("diagnosis_id", diagnosis_id).execute()
    return {"deleted": True}


@router.post("/diagnose/{diagnosis_id}/reports", status_code=201)
def create_report_snapshot(diagnosis_id: str, user: Annotated[CurrentUser, Depends(require_diagnose)]) -> dict[str, Any]:
    diagnosis = _full_diagnosis(diagnosis_id)
    db = get_supabase()
    count_response = db.table("diagnosis_reports").select("id", count="exact").eq("diagnosis_id", diagnosis_id).execute()
    version = int(count_response.count or 0) + 1
    snapshot = {
        "company_name": diagnosis.get("company_name"),
        "overall_score": diagnosis.get("overall_score"),
        "overall_level": diagnosis.get("overall_level"),
        "assessment_scores": {row.get("section"): row.get("score") for row in diagnosis.get("assessments", [])},
        "finding_count": len(diagnosis.get("findings", [])),
        "roadmap_count": len(diagnosis.get("roadmap", [])),
        "analysis_summary": (diagnosis.get("latest_analysis") or {}).get("summary"),
        "interview_answered": sum(1 for row in diagnosis.get("interview_questions", []) if row.get("status") == "answered"),
        "interview_total": len(diagnosis.get("interview_questions", [])),
    }
    return _first(db.table("diagnosis_reports").insert({
        "diagnosis_id": diagnosis_id,
        "generated_by": user.id,
        "report_version": version,
        "snapshot": snapshot,
    }).execute()) or {}


@router.get("/focus/diagnose-tasks")
def list_focus_tasks(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    scope: str = Query(default="mine", pattern="^(mine|all)$"),
    limit: int = Query(default=20, ge=1, le=100),
) -> dict[str, Any]:
    db = get_supabase()
    query = db.table("focus_tasks").select("*").in_("status", ["pending", "in_progress"])
    if user.role != "admin" or scope != "all":
        query = query.eq("assigned_to", user.id)
    rows = query.order("due_date").order("created_at").limit(limit).execute().data or []
    diagnosis_ids = list({row.get("diagnosis_id") for row in rows if row.get("diagnosis_id")})
    diagnoses: dict[str, Any] = {}
    if diagnosis_ids:
        data = db.table("diagnoses").select("id,company_name,overall_score,overall_level").in_("id", diagnosis_ids).execute().data or []
        diagnoses = {str(row["id"]): row for row in data}
    today = date.today()
    priority_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    for row in rows:
        row["diagnosis"] = diagnoses.get(str(row.get("diagnosis_id")), {})
        due = date.fromisoformat(str(row["due_date"])) if row.get("due_date") else None
        row["due_state"] = "overdue" if due and due < today else "today" if due == today else "future" if due else "none"
    rows.sort(key=lambda row: (0 if row.get("due_state") == "overdue" else 1 if row.get("due_state") == "today" else 2, priority_order.get(row.get("priority"), 3), str(row.get("due_date") or "9999")))
    return {"items": rows, "total": len(rows)}


@router.patch("/focus/diagnose-tasks/{task_id}")
def update_focus_task(task_id: str, payload: FocusTaskUpdate, user: Annotated[CurrentUser, Depends(get_current_user)]) -> dict[str, Any]:
    db = get_supabase()
    task = _first(db.table("focus_tasks").select("*").eq("id", task_id).limit(1).execute())
    if not task:
        raise HTTPException(status_code=404, detail="Acción de Focus no encontrada")
    if user.role != "admin" and task.get("assigned_to") != user.id:
        raise HTTPException(status_code=403, detail="Esta acción no está asignada a tu usuario")
    data = payload.model_dump(exclude_unset=True)
    if data.get("status") == "completed":
        data["completed_at"] = _now_iso()
    result = _first(db.table("focus_tasks").update(data).eq("id", task_id).execute()) or task
    if result.get("roadmap_item_id") and data.get("status") == "completed":
        db.table("diagnosis_roadmap").update({"status": "completed"}).eq("id", result["roadmap_item_id"]).execute()
    return result
