from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone
from typing import Any

import requests

from .config import get_settings
from .db import get_supabase

TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
FIELD_MASK = ",".join(
    [
        "places.id",
        "places.displayName",
        "places.formattedAddress",
        "places.nationalPhoneNumber",
        "places.internationalPhoneNumber",
        "places.websiteUri",
        "places.googleMapsUri",
        "places.rating",
        "places.userRatingCount",
        "places.primaryType",
        "places.types",
        "places.businessStatus",
        "places.location",
        "nextPageToken",
    ]
)

HARD_EXCLUSION_TERMS = (
    "laboratorio dental",
    "dental lab",
    "depósito dental",
    "deposito dental",
    "proveedor dental",
    "facultad de odontología",
    "facultad de odontologia",
    "universidad",
    "hospital público",
    "hospital publico",
    "centro de salud",
    "farmacia",
    "barbería",
    "barberia",
    "salón de belleza",
    "salon de belleza",
)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _cache_key(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def build_queries(niche: str, city: str, zones: list[str], services: list[str]) -> list[str]:
    base_terms = (
        ["clínica dental", "odontopediatría", "dentista", "odontología"]
        if niche == "Dental"
        else ["clínica de medicina estética", "centro de estética médica", "medicina estética"]
    )
    default_services = (
        ["implantes dentales", "ortodoncia", "odontopediatría", "diseño de sonrisa", "estética dental"]
        if niche == "Dental"
        else ["botox", "ácido hialurónico", "tratamientos láser", "rejuvenecimiento facial"]
    )
    chosen_services = services or default_services
    chosen_zones = zones or [""]

    queries: list[str] = []
    for term in base_terms:
        queries.append(f"{term} {city}".strip())
    for service in chosen_services:
        queries.append(f"{service} {city}".strip())
    for zone in chosen_zones:
        if not zone:
            continue
        for term in base_terms[:2]:
            queries.append(f"{term} {zone} {city}".strip())

    # Stable dedupe while preserving priority order.
    seen: set[str] = set()
    unique: list[str] = []
    for query in queries:
        normalized = " ".join(query.split()).lower()
        if normalized not in seen:
            seen.add(normalized)
            unique.append(query)
    return unique


def is_hard_excluded(place: dict[str, Any], niche: str) -> str | None:
    name = str((place.get("displayName") or {}).get("text") or "").lower()
    address = str(place.get("formattedAddress") or "").lower()
    types = " ".join(place.get("types") or []).lower()
    combined = f"{name} {address} {types}"
    for term in HARD_EXCLUSION_TERMS:
        if term in combined:
            return f"Exclusión por término: {term}"
    if place.get("businessStatus") == "CLOSED_PERMANENTLY":
        return "Negocio cerrado permanentemente"
    if niche == "Dental" and not any(
        term in combined
        for term in (
            "dental",
            "dentist",
            "odont",
            "orthodont",
            "pediatric dentist",
            "pediatric dentistry",
            "dentista pediátrico",
            "dentista pediatrico",
        )
    ):
        return "No parece ser una clínica dental"
    if niche == "Medicina estética" and not any(term in combined for term in ("estét", "estet", "aesthetic", "beauty", "dermat", "medical_spa", "spa")):
        return "No parece ser medicina estética"
    return None


def search_text(
    *,
    query: str,
    page_token: str | None,
    cache_days: int | None = None,
) -> tuple[dict[str, Any], bool]:
    settings = get_settings()
    db = get_supabase()
    payload: dict[str, Any] = {
        "textQuery": query,
        "pageSize": 20,
        "languageCode": "es",
        "regionCode": "PA",
    }
    if page_token:
        payload["pageToken"] = page_token

    key = _cache_key(payload)
    now_iso = utcnow().isoformat()
    cached = (
        db.table("search_cache")
        .select("response_payload,expires_at")
        .eq("cache_key", key)
        .gt("expires_at", now_iso)
        .limit(1)
        .execute()
    )
    if cached.data:
        cached_payload = dict(cached.data[0]["response_payload"])
        # Google page tokens are short-lived. A cached first page must not reuse an expired token.
        cached_payload.pop("nextPageToken", None)
        return cached_payload, True

    response = requests.post(
        TEXT_SEARCH_URL,
        headers={
            "Content-Type": "application/json",
            "X-Goog-Api-Key": settings.google_maps_api_key,
            "X-Goog-FieldMask": FIELD_MASK,
        },
        json=payload,
        timeout=20,
    )
    if response.status_code >= 400:
        try:
            detail = response.json()
        except ValueError:
            detail = response.text[:500]
        raise RuntimeError(f"Google Places respondió {response.status_code}: {detail}")

    data = response.json()
    ttl = cache_days if cache_days is not None else settings.google_cache_days
    db.table("search_cache").upsert(
        {
            "cache_key": key,
            "request_payload": payload,
            "response_payload": data,
            "expires_at": (utcnow() + timedelta(days=ttl)).isoformat(),
        },
        on_conflict="cache_key",
    ).execute()
    return data, False


def place_to_lead(place: dict[str, Any], niche: str, source: str) -> dict[str, Any]:
    display_name = place.get("displayName") or {}
    location = place.get("location") or {}
    return {
        "place_id": place.get("id"),
        "niche": niche,
        "business_name": display_name.get("text") or "Sin nombre",
        "address": place.get("formattedAddress"),
        "phone": place.get("nationalPhoneNumber") or place.get("internationalPhoneNumber"),
        "website": place.get("websiteUri"),
        "maps_url": place.get("googleMapsUri"),
        "rating": place.get("rating"),
        "review_count": place.get("userRatingCount") or 0,
        "primary_type": place.get("primaryType"),
        "types": place.get("types") or [],
        "business_status": place.get("businessStatus"),
        "latitude": location.get("latitude"),
        "longitude": location.get("longitude"),
        "source": source,
        "last_google_fetch_at": utcnow().isoformat(),
    }
