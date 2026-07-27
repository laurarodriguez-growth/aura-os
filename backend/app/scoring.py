from __future__ import annotations

from copy import deepcopy
from typing import Any

PANAMA_TERMS = (
    "ciudad de panamá",
    "panama city",
    "panamá",
    "panama",
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

DEFAULT_THRESHOLDS = {"A": 70, "B": 50, "C": 30}

SCORING_CATALOG: list[dict[str, Any]] = [
    {"key": "niche_equals", "label": "Nicho coincide", "category": "fit", "operators": ["equals"], "value_type": "text", "default_value": "Dental"},
    {"key": "location_panama", "label": "Ubicación dentro de Panamá", "category": "fit", "operators": ["is_true", "is_false"], "value_type": "none"},
    {"key": "rating", "label": "Rating de Google", "category": "demand", "operators": ["gte", "lte", "equals"], "value_type": "number", "default_value": 4.5},
    {"key": "review_count", "label": "Cantidad de reseñas", "category": "capacity", "operators": ["gte", "lte", "equals"], "value_type": "number", "default_value": 100},
    {"key": "service_detected", "label": "Servicio detectado", "category": "high_ticket", "operators": ["contains", "not_contains"], "value_type": "text", "default_value": "Implantes"},
    {"key": "doctor_count", "label": "Cantidad estimada de doctores", "category": "capacity", "operators": ["gte", "lte", "equals"], "value_type": "number", "default_value": 3},
    {"key": "branch_count", "label": "Cantidad estimada de sucursales", "category": "capacity", "operators": ["gte", "lte", "equals"], "value_type": "number", "default_value": 2},
    {"key": "website_present", "label": "Tiene página web", "category": "capacity", "operators": ["is_true", "is_false"], "value_type": "none"},
    {"key": "phone_present", "label": "Tiene teléfono", "category": "capacity", "operators": ["is_true", "is_false"], "value_type": "none"},
    {"key": "email_present", "label": "Tiene email", "category": "capacity", "operators": ["is_true", "is_false"], "value_type": "none"},
    {"key": "instagram_present", "label": "Tiene Instagram", "category": "demand", "operators": ["is_true", "is_false"], "value_type": "none"},
    {"key": "whatsapp_present", "label": "Tiene WhatsApp", "category": "demand", "operators": ["is_true", "is_false"], "value_type": "none"},
    {"key": "booking_found", "label": "Agenda online detectada", "category": "leakage", "operators": ["is_true", "is_false"], "value_type": "none"},
    {"key": "form_found", "label": "Formulario detectado", "category": "leakage", "operators": ["is_true", "is_false"], "value_type": "none"},
    {"key": "crm_visible", "label": "CRM visible", "category": "leakage", "operators": ["is_true", "is_false"], "value_type": "none"},
    {"key": "chat_found", "label": "Chat web detectado", "category": "leakage", "operators": ["is_true", "is_false"], "value_type": "none"},
    {"key": "generic_whatsapp_cta_found", "label": "CTA genérico a WhatsApp", "category": "leakage", "operators": ["is_true", "is_false"], "value_type": "none"},
    {"key": "meta_pixel_found", "label": "Meta Pixel detectado", "category": "demand", "operators": ["is_true", "is_false"], "value_type": "none"},
    {"key": "google_tag_found", "label": "Google Tag o Analytics detectado", "category": "demand", "operators": ["is_true", "is_false"], "value_type": "none"},
    {"key": "promotional_language_found", "label": "Promociones visibles", "category": "demand", "operators": ["is_true", "is_false"], "value_type": "none"},
    {"key": "https_enabled", "label": "Web con HTTPS", "category": "capacity", "operators": ["is_true", "is_false"], "value_type": "none"},
    {"key": "mobile_friendly_signal", "label": "Señal de web móvil", "category": "capacity", "operators": ["is_true", "is_false"], "value_type": "none"},
]


def _rule(criterion: str, label: str, points: int, *, operator: str = "is_true", value: Any = None, category: str | None = None) -> dict[str, Any]:
    item = next((x for x in SCORING_CATALOG if x["key"] == criterion), None)
    return {
        "criterion": criterion,
        "label": label,
        "operator": operator,
        "value": value,
        "points": points,
        "enabled": True,
        "category": category or (item or {}).get("category", "demand"),
    }


SCORING_PRESETS: dict[str, dict[str, Any]] = {
    "Dental": {
        "name": "Dental Panamá · Recomendada",
        "country": "Panamá",
        "thresholds": {"A": 70, "B": 50, "C": 30},
        "rules": [
            _rule("niche_equals", "Nicho dental", 10, operator="equals", value="Dental", category="fit"),
            _rule("location_panama", "Ubicación en Panamá", 5, category="fit"),
            _rule("review_count", "100 o más reseñas", 8, operator="gte", value=100, category="capacity"),
            _rule("rating", "Rating de 4.5 o más", 5, operator="gte", value=4.5, category="demand"),
            _rule("service_detected", "Implantes detectados", 10, operator="contains", value="implante", category="high_ticket"),
            _rule("service_detected", "Ortodoncia detectada", 8, operator="contains", value="ortodoncia", category="high_ticket"),
            _rule("service_detected", "Diseño de sonrisa detectado", 7, operator="contains", value="diseño de sonrisa", category="high_ticket"),
            _rule("doctor_count", "Equipo de 3 o más doctores", 6, operator="gte", value=3, category="capacity"),
            _rule("branch_count", "Dos o más sucursales", 6, operator="gte", value=2, category="capacity"),
            _rule("website_present", "Página web activa", 4, category="capacity"),
            _rule("whatsapp_present", "WhatsApp visible", 5, category="demand"),
            _rule("instagram_present", "Instagram visible", 4, category="demand"),
            _rule("booking_found", "Sin agenda online detectada", 8, operator="is_false", category="leakage"),
            _rule("form_found", "Sin formulario estructurado", 5, operator="is_false", category="leakage"),
            _rule("crm_visible", "Sin CRM visible", 6, operator="is_false", category="leakage"),
            _rule("generic_whatsapp_cta_found", "CTA genérico a WhatsApp", 3, category="leakage"),
            _rule("meta_pixel_found", "Meta Pixel detectado", 3, category="demand"),
            _rule("promotional_language_found", "Promociones visibles", 2, category="demand"),
        ],
    },
    "Medicina estética": {
        "name": "Medicina estética Panamá · Recomendada",
        "country": "Panamá",
        "thresholds": {"A": 68, "B": 48, "C": 28},
        "rules": [
            _rule("niche_equals", "Nicho de medicina estética", 10, operator="equals", value="Medicina estética", category="fit"),
            _rule("location_panama", "Ubicación en Panamá", 5, category="fit"),
            _rule("review_count", "75 o más reseñas", 8, operator="gte", value=75, category="capacity"),
            _rule("rating", "Rating de 4.5 o más", 5, operator="gte", value=4.5, category="demand"),
            _rule("service_detected", "Botox o toxina botulínica", 10, operator="contains", value="botox", category="high_ticket"),
            _rule("service_detected", "Ácido hialurónico", 9, operator="contains", value="hialur", category="high_ticket"),
            _rule("service_detected", "Tratamientos láser", 8, operator="contains", value="láser", category="high_ticket"),
            _rule("doctor_count", "Equipo de 2 o más profesionales", 6, operator="gte", value=2, category="capacity"),
            _rule("branch_count", "Dos o más sucursales", 6, operator="gte", value=2, category="capacity"),
            _rule("website_present", "Página web activa", 4, category="capacity"),
            _rule("whatsapp_present", "WhatsApp visible", 5, category="demand"),
            _rule("instagram_present", "Instagram visible", 5, category="demand"),
            _rule("booking_found", "Sin agenda online detectada", 8, operator="is_false", category="leakage"),
            _rule("form_found", "Sin formulario estructurado", 5, operator="is_false", category="leakage"),
            _rule("crm_visible", "Sin CRM visible", 6, operator="is_false", category="leakage"),
            _rule("meta_pixel_found", "Meta Pixel detectado", 4, category="demand"),
            _rule("promotional_language_found", "Promociones visibles", 4, category="demand"),
        ],
    },
}


def get_scoring_preset(niche: str) -> dict[str, Any]:
    preset = SCORING_PRESETS.get(niche) or SCORING_PRESETS["Dental"]
    return deepcopy(preset)


def _truthy(data: dict[str, Any], key: str) -> bool:
    return bool(data.get(key))


def _number(data: dict[str, Any], key: str) -> float:
    try:
        return float(data.get(key) or 0)
    except (TypeError, ValueError):
        return 0


def _text(value: Any) -> str:
    return str(value or "").strip().lower()


def _actual_value(data: dict[str, Any], criterion: str) -> Any:
    if criterion == "niche_equals":
        return data.get("niche")
    if criterion == "location_panama":
        address = _text(data.get("address"))
        return any(term in address for term in PANAMA_TERMS)
    if criterion == "rating":
        return _number(data, "rating")
    if criterion == "review_count":
        return _number(data, "review_count")
    if criterion == "service_detected":
        services = data.get("high_ticket_services") or []
        if isinstance(services, str):
            services = [item.strip() for item in services.split(",") if item.strip()]
        return " | ".join(str(item) for item in services)
    if criterion == "doctor_count":
        return _number(data, "doctor_count_estimate")
    if criterion == "branch_count":
        return _number(data, "branch_count_estimate")
    if criterion == "website_present":
        return _truthy(data, "website")
    if criterion == "phone_present":
        return _truthy(data, "phone")
    if criterion == "email_present":
        return _truthy(data, "email")
    if criterion == "instagram_present":
        return _truthy(data, "instagram_url")
    if criterion == "whatsapp_present":
        return _truthy(data, "whatsapp_url") or _truthy(data, "whatsapp_phone")
    if criterion == "google_tag_found":
        return _truthy(data, "google_tag_found") or _truthy(data, "google_analytics_found")
    return _truthy(data, criterion)


def _matches(actual: Any, operator: str, expected: Any) -> bool:
    if operator == "is_true":
        return bool(actual)
    if operator == "is_false":
        return not bool(actual)
    if operator in {"gte", "lte"}:
        try:
            actual_number = float(actual or 0)
            expected_number = float(expected or 0)
        except (TypeError, ValueError):
            return False
        return actual_number >= expected_number if operator == "gte" else actual_number <= expected_number
    if operator == "equals":
        if isinstance(actual, (int, float)) or isinstance(expected, (int, float)):
            try:
                return float(actual) == float(expected)
            except (TypeError, ValueError):
                pass
        return _text(actual) == _text(expected)
    if operator == "contains":
        return _text(expected) in _text(actual)
    if operator == "not_contains":
        return _text(expected) not in _text(actual)
    return False


def _tier_for_score(score: int, thresholds: dict[str, Any] | None = None) -> str:
    thresholds = thresholds or DEFAULT_THRESHOLDS
    a = int(thresholds.get("A", DEFAULT_THRESHOLDS["A"]))
    b = int(thresholds.get("B", DEFAULT_THRESHOLDS["B"]))
    c = int(thresholds.get("C", DEFAULT_THRESHOLDS["C"]))
    if score >= a:
        return "A"
    if score >= b:
        return "B"
    if score >= c:
        return "C"
    return "Descartar"


def calculate_configured_score(
    data: dict[str, Any],
    rules: list[dict[str, Any]] | None,
    thresholds: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not rules:
        preset = get_scoring_preset(str(data.get("niche") or "Dental"))
        rules = preset["rules"]
        thresholds = thresholds or preset["thresholds"]

    categories = {"fit": 0, "high_ticket": 0, "capacity": 0, "demand": 0, "leakage": 0}
    reasons: list[str] = []
    flags: list[str] = []
    raw_total = 0

    for rule in rules:
        if not rule.get("enabled", True):
            continue
        criterion = str(rule.get("criterion") or "")
        operator = str(rule.get("operator") or "is_true")
        expected = rule.get("value")
        points = int(rule.get("points") or 0)
        actual = _actual_value(data, criterion)
        if not _matches(actual, operator, expected):
            continue
        raw_total += points
        category = str(rule.get("category") or "demand")
        if category not in categories:
            category = "demand"
        categories[category] += points
        label = str(rule.get("label") or criterion)
        if points >= 0:
            reasons.append(f"{label} (+{points})")
        else:
            flags.append(f"{label} ({points})")

    total = max(0, min(100, raw_total))
    tier = _tier_for_score(total, thresholds)
    return {
        "fit_score": max(0, categories["fit"]),
        "high_ticket_score": max(0, categories["high_ticket"]),
        "capacity_score": max(0, categories["capacity"]),
        "demand_score": max(0, categories["demand"]),
        "leakage_score": max(0, categories["leakage"]),
        "auto_score": total,
        "auto_tier": tier,
        "score_reasons": reasons,
        "quality_flags": flags,
    }


def calculate_auto_score(data: dict[str, Any]) -> dict[str, Any]:
    preset = get_scoring_preset(str(data.get("niche") or "Dental"))
    return calculate_configured_score(data, preset["rules"], preset["thresholds"])


def normalize_manual_scores(
    data: dict[str, Any],
    thresholds: dict[str, Any] | None = None,
) -> dict[str, int | str]:
    ads = max(0, min(8, int(data.get("manual_ads_score") or 0)))
    volume = max(0, min(6, int(data.get("manual_volume_score") or 0)))
    followup = max(0, min(8, int(data.get("manual_followup_score") or 0)))
    decision = max(0, min(8, int(data.get("manual_decision_maker_score") or 0)))
    manual = ads + volume + followup + decision
    final = min(100, int(data.get("auto_score") or 0) + manual)
    thresholds = thresholds or data.get("scoring_thresholds") or DEFAULT_THRESHOLDS
    tier = _tier_for_score(final, thresholds)
    return {
        "manual_ads_score": ads,
        "manual_volume_score": volume,
        "manual_followup_score": followup,
        "manual_decision_maker_score": decision,
        "manual_score": manual,
        "final_score": final,
        "final_tier": tier,
    }
