from __future__ import annotations

from typing import Any

PANAMA_TERMS = (
    "ciudad de panamá",
    "panama city",
    "panamá",
    "bella vista",
    "obarrio",
    "san francisco",
    "punta pacífica",
    "costa del este",
    "el cangrejo",
    "paitilla",
    "marbella",
    "avenida balboa",
    "vía españa",
    "via españa",
)


def _truthy(data: dict[str, Any], key: str) -> bool:
    return bool(data.get(key))


def calculate_auto_score(data: dict[str, Any]) -> dict[str, Any]:
    """Calculate the 70-point public-evidence ICP score.

    This intentionally avoids claiming that a clinic has poor internal follow-up.
    Those facts stay in the 30-point manual validation section.
    """
    niche = str(data.get("niche") or "").lower()
    address = str(data.get("address") or "").lower()
    services = data.get("high_ticket_services") or []
    if isinstance(services, str):
        services = [s.strip() for s in services.split(",") if s.strip()]

    review_count = int(data.get("review_count") or 0)
    doctor_count = int(data.get("doctor_count_estimate") or 0)
    branch_count = int(data.get("branch_count_estimate") or 0)

    reasons: list[str] = []
    flags: list[str] = []

    # 1) Vertical + location: 15
    fit = 0
    if "dental" in niche:
        fit += 12
        reasons.append("Nicho dental prioritario")
    elif "estética" in niche or "estetica" in niche or "medicina" in niche:
        fit += 10
        reasons.append("Nicho de medicina estética")
    if any(term in address for term in PANAMA_TERMS):
        fit += 3
        reasons.append("Ubicación dentro del foco de Ciudad de Panamá")
    else:
        flags.append("Ubicación requiere validación")
    fit = min(fit, 15)

    # 2) High-ticket services: 15
    high_ticket = min(len(set(services)) * 3, 15)
    if high_ticket:
        reasons.append(f"{len(set(services))} servicio(s) de ticket medio/alto detectado(s)")
    else:
        flags.append("No se detectaron servicios de alto valor en la web")

    # 3) Capacity: 15
    capacity = 0
    if review_count >= 150:
        capacity += 5
        reasons.append("Volumen alto de reseñas")
    elif review_count >= 60:
        capacity += 4
        reasons.append("Volumen sólido de reseñas")
    elif review_count >= 20:
        capacity += 2

    if doctor_count >= 6:
        capacity += 5
        reasons.append("Equipo clínico amplio detectado")
    elif 2 <= doctor_count <= 5:
        capacity += 4
        reasons.append("Equipo estimado de 2 a 5 doctores")
    elif doctor_count == 1:
        capacity += 1

    if branch_count >= 2:
        capacity += 3
        reasons.append("Múltiples sedes o direcciones detectadas")
    if _truthy(data, "website"):
        capacity += 2
    capacity = min(capacity, 15)

    # 4) Demand/marketing: 10
    demand = 0
    if _truthy(data, "instagram_url"):
        demand += 2
        reasons.append("Instagram visible")
    if _truthy(data, "whatsapp_url") or _truthy(data, "whatsapp_phone"):
        demand += 2
        reasons.append("Canal de WhatsApp visible")
    if _truthy(data, "meta_pixel_found"):
        demand += 2
        reasons.append("Meta Pixel detectado")
    if _truthy(data, "google_tag_found") or _truthy(data, "google_analytics_found"):
        demand += 1
    if _truthy(data, "promotional_language_found"):
        demand += 2
        reasons.append("Promociones o evaluaciones visibles")
    if review_count >= 30:
        demand += 1
    demand = min(demand, 10)

    # 5) Probable process leakage, only public signals: 15
    leakage = 0
    has_whatsapp = _truthy(data, "whatsapp_url") or _truthy(data, "whatsapp_phone")
    if has_whatsapp and not _truthy(data, "booking_found"):
        leakage += 5
        reasons.append("WhatsApp visible sin agenda online detectada")
    if not _truthy(data, "form_found"):
        leakage += 3
        reasons.append("No se detectó formulario estructurado")
    if not _truthy(data, "crm_visible"):
        leakage += 3
        reasons.append("No se detectó CRM públicamente")
    if _truthy(data, "generic_whatsapp_cta_found"):
        leakage += 2
        reasons.append("CTA genérico hacia WhatsApp")
    if not _truthy(data, "chat_found"):
        leakage += 1
    if not _truthy(data, "booking_found"):
        leakage += 1
    leakage = min(leakage, 15)

    total = fit + high_ticket + capacity + demand + leakage
    if total >= 55:
        tier = "A"
    elif total >= 45:
        tier = "B"
    elif total >= 32:
        tier = "C"
    else:
        tier = "Descartar"

    return {
        "fit_score": fit,
        "high_ticket_score": high_ticket,
        "capacity_score": capacity,
        "demand_score": demand,
        "leakage_score": leakage,
        "auto_score": total,
        "auto_tier": tier,
        "score_reasons": reasons,
        "quality_flags": flags,
    }


def normalize_manual_scores(data: dict[str, Any]) -> dict[str, int | str]:
    ads = max(0, min(8, int(data.get("manual_ads_score") or 0)))
    volume = max(0, min(6, int(data.get("manual_volume_score") or 0)))
    followup = max(0, min(8, int(data.get("manual_followup_score") or 0)))
    decision = max(0, min(8, int(data.get("manual_decision_maker_score") or 0)))
    manual = ads + volume + followup + decision
    final = min(100, int(data.get("auto_score") or 0) + manual)
    if final >= 75:
        tier = "A"
    elif final >= 60:
        tier = "B"
    elif final >= 45:
        tier = "C"
    else:
        tier = "Descartar"
    return {
        "manual_ads_score": ads,
        "manual_volume_score": volume,
        "manual_followup_score": followup,
        "manual_decision_maker_score": decision,
        "manual_score": manual,
        "final_score": final,
        "final_tier": tier,
    }
