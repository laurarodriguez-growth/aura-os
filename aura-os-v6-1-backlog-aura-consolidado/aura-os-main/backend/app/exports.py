from __future__ import annotations

import csv
import io
from collections import defaultdict
from datetime import datetime
from typing import Any, Iterable

from fastapi.responses import StreamingResponse


LEAD_EXPORT_FIELDS = [
    "id", "place_id", "capture_date", "niche", "business_name", "address", "zone", "phone",
    "website", "instagram_url", "whatsapp_url", "whatsapp_phone", "email", "maps_url", "rating",
    "review_count", "primary_type", "types", "business_status", "high_ticket_services",
    "doctor_names", "doctor_count_estimate", "doctor_count_confidence", "branch_addresses",
    "branch_count_estimate", "branch_count_confidence", "form_found", "booking_found", "booking_tools",
    "crm_visible", "crm_tools", "chat_found", "chat_tools", "cms_tools", "meta_pixel_found",
    "google_tag_found", "google_analytics_found", "tiktok_pixel_found", "linkedin_insight_found",
    "promotional_language_found", "generic_whatsapp_cta_found", "decision_maker_candidate",
    "decision_maker_confidence", "pages_audited", "website_status", "website_response_ms",
    "mobile_friendly_signal", "https_enabled", "fit_score", "high_ticket_score", "capacity_score",
    "demand_score", "leakage_score", "auto_score", "auto_tier", "manual_ads_score",
    "manual_volume_score", "manual_followup_score", "manual_decision_maker_score", "manual_score",
    "final_score", "final_tier", "score_reasons", "quality_flags", "excluded_reason",
    "decision_maker_name", "decision_maker_title", "decision_maker_link", "status", "owner_id",
    "first_contact_date", "last_contact_date", "next_followup_date", "outcome", "outcome_stage",
    "conversation_status", "response_due_at", "last_inbound_at", "last_outbound_at", "notes",
    "do_not_contact", "contact_attempts", "source", "last_google_fetch_at", "last_web_audit_at",
    "created_at", "updated_at",
]

CALL_EXPORT_FIELDS = [
    "id", "lead_id", "business_name", "occurred_at", "agent_id", "agent_name", "channel", "direction",
    "duration_seconds", "activity_type", "conversation_status", "outcome_stage", "outcome",
    "contact_name", "contact_title", "objection", "notes", "next_step", "followup_date",
    "appointment_booked", "sale_amount", "awaiting_response", "response_due_at", "is_final_outcome",
    "transcript", "analysis", "created_at",
]


def _flat(value: Any) -> Any:
    if isinstance(value, list):
        return " | ".join(str(item) for item in value)
    if isinstance(value, dict):
        return " | ".join(f"{key}: {val}" for key, val in value.items())
    if isinstance(value, bool):
        return "Sí" if value else "No"
    return value if value is not None else ""


def csv_response(rows: Iterable[dict[str, Any]], fields: list[str], filename: str) -> StreamingResponse:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({field: _flat(row.get(field)) for field in fields})
    content = "\ufeff" + buffer.getvalue()
    return StreamingResponse(
        iter([content.encode("utf-8")]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def consolidated_rows(leads: list[dict[str, Any]], calls: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[str]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for call in calls:
        grouped[str(call.get("lead_id"))].append(call)

    fields = LEAD_EXPORT_FIELDS + [
        "total_actividades_contacto", "llamadas", "whatsapps", "instagrams", "emails", "contactos_conectados",
        "reuniones_agendadas", "ventas", "ingreso_atribuido", "primer_intento", "ultimo_intento",
        "ultimo_resultado_call_log", "dias_hasta_primer_contacto",
    ]
    rows: list[dict[str, Any]] = []
    non_contact = {"No respondió", "Buzón de voz", "Número incorrecto", "Pendiente"}
    for lead in leads:
        lead_calls = sorted(grouped.get(str(lead.get("id")), []), key=lambda c: c.get("occurred_at") or "")
        channels = defaultdict(int)
        for call in lead_calls:
            channels[call.get("channel") or "Otro"] += 1
        connected = sum(
            1 for call in lead_calls
            if call.get("direction") == "Entrante"
            or call.get("activity_type") == "response_received"
            or call.get("outcome") not in non_contact
        )
        meetings = sum(1 for call in lead_calls if call.get("appointment_booked") or call.get("outcome") == "Reunión agendada")
        sales = sum(1 for call in lead_calls if call.get("outcome") == "Venta" or float(call.get("sale_amount") or 0) > 0)
        revenue = sum(float(call.get("sale_amount") or 0) for call in lead_calls)
        first_attempt = lead_calls[0].get("occurred_at") if lead_calls else None
        last_attempt = lead_calls[-1].get("occurred_at") if lead_calls else None
        days_to_first = ""
        try:
            if first_attempt and lead.get("capture_date"):
                days_to_first = (
                    datetime.fromisoformat(str(first_attempt).replace("Z", "+00:00"))
                    - datetime.fromisoformat(str(lead["capture_date"]).replace("Z", "+00:00"))
                ).days
        except (ValueError, TypeError):
            days_to_first = ""

        row = dict(lead)
        row.update(
            {
                "total_actividades_contacto": len(lead_calls),
                "llamadas": channels["Llamada"],
                "whatsapps": channels["WhatsApp"],
                "instagrams": channels["Instagram"],
                "emails": channels["Email"],
                "contactos_conectados": connected,
                "reuniones_agendadas": meetings,
                "ventas": sales,
                "ingreso_atribuido": revenue,
                "primer_intento": first_attempt,
                "ultimo_intento": last_attempt,
                "ultimo_resultado_call_log": lead_calls[-1].get("outcome") if lead_calls else "",
                "dias_hasta_primer_contacto": days_to_first,
            }
        )
        rows.append(row)
    return rows, fields
