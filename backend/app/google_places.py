from __future__ import annotations

import hashlib
import json
import re
from urllib.parse import quote
from datetime import datetime, timedelta, timezone
from typing import Any

import requests

from .config import get_settings
from .db import get_supabase

TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete"
PLACE_DETAILS_URL = "https://places.googleapis.com/v1/places/{place_id}"
PLACE_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,255}$")
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
        "places.addressComponents",
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


def _niche_terms(niche: str) -> tuple[list[str], list[str]]:
    if niche == "Gastronomía y turismo":
        return (
            ["restaurante", "viña", "centro de eventos", "turismo gastronómico"],
            ["reservas de restaurante", "degustaciones en viña", "eventos corporativos", "experiencias gastronómicas"],
        )
    if niche == "Dental":
        return (
            ["clínica dental", "odontopediatría", "dentista", "odontología"],
            ["implantes dentales", "ortodoncia", "odontopediatría", "diseño de sonrisa", "estética dental"],
        )
    return (
        ["clínica de medicina estética", "centro de estética médica", "medicina estética"],
        ["botox", "ácido hialurónico", "tratamientos láser", "rejuvenecimiento facial"],
    )


def build_queries(
    niche: str,
    city: str,
    zones: list[str],
    services: list[str],
    *,
    country_name: str = "Panamá",
    search_mode: str = "zones",
) -> list[str]:
    base_terms, default_services = _niche_terms(niche)
    chosen_services = services or default_services
    chosen_zones = zones or [""]

    queries: list[str] = []
    for term in base_terms:
        queries.append(f"{term} {city} {country_name}".strip())
    for service in chosen_services:
        queries.append(f"{service} {city} {country_name}".strip())
    for zone in (chosen_zones if search_mode == "zones" else []):
        if not zone:
            continue
        for term in base_terms[:2]:
            queries.append(f"{term} {zone} {country_name}".strip())

    # Stable dedupe while preserving priority order.
    seen: set[str] = set()
    unique: list[str] = []
    for query in queries:
        normalized = " ".join(query.split()).lower()
        if normalized not in seen:
            seen.add(normalized)
            unique.append(query)
    return unique


def autocomplete_places(
    *,
    input_text: str,
    country_code: str,
    session_token: str,
    place_type: str,
    latitude: float | None = None,
    longitude: float | None = None,
) -> list[dict[str, Any]]:
    settings = get_settings()
    payload: dict[str, Any] = {
        "input": input_text,
        "languageCode": "es",
        "includedRegionCodes": [country_code.upper()],
        "sessionToken": session_token,
    }
    if place_type == "city":
        payload["includedPrimaryTypes"] = ["(cities)"]
    if latitude is not None and longitude is not None:
        payload["locationBias"] = {
            "circle": {
                "center": {"latitude": latitude, "longitude": longitude},
                "radius": 50000.0,
            }
        }
    response = requests.post(
        AUTOCOMPLETE_URL,
        headers={"Content-Type": "application/json", "X-Goog-Api-Key": settings.google_maps_api_key},
        json=payload,
        timeout=12,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"Google Places Autocomplete respondió {response.status_code}: {response.text[:500]}")
    suggestions: list[dict[str, Any]] = []
    for item in response.json().get("suggestions") or []:
        prediction = item.get("placePrediction") or {}
        place_id = prediction.get("placeId")
        if not place_id:
            continue
        text = ((prediction.get("text") or {}).get("text") or "").strip()
        structured = prediction.get("structuredFormat") or {}
        main_text = ((structured.get("mainText") or {}).get("text") or text).strip()
        secondary = ((structured.get("secondaryText") or {}).get("text") or "").strip()
        suggestions.append({"place_id": place_id, "name": main_text, "description": text, "secondary_text": secondary})
    return suggestions


def place_details(*, place_id: str, session_token: str) -> dict[str, Any]:
    settings = get_settings()

    normalized_place_id = str(place_id or "").strip()
    if not PLACE_ID_PATTERN.fullmatch(normalized_place_id):
        raise RuntimeError("Google Place ID inválido")

    encoded_place_id = quote(normalized_place_id, safe="")

    response = requests.get(
        PLACE_DETAILS_URL.format(place_id=encoded_place_id),
        params={"languageCode": "es", "sessionToken": session_token},
        headers={
            "X-Goog-Api-Key": settings.google_maps_api_key,
            "X-Goog-FieldMask": "id,displayName,formattedAddress,location,addressComponents",
        },
        timeout=12,
    )
    if response.status_code >= 400:
        raise RuntimeError(
            f"Google Place Details respondió {response.status_code}: {response.text[:500]}"
        )

    place = response.json()
    geo = geographic_fields(place)
    return {
        "name": (
            (place.get("displayName") or {}).get("text")
            or place.get("formattedAddress")
            or "Ubicación"
        ),
        "formatted_address": place.get("formattedAddress") or "",
        "place_id": place.get("id") or normalized_place_id,
        "latitude": (place.get("location") or {}).get("latitude"),
        "longitude": (place.get("location") or {}).get("longitude"),
        **geo,
    }

def geographic_fields(place: dict[str, Any]) -> dict[str, Any]:
    values: dict[str, tuple[str | None, str | None]] = {}
    for component in place.get("addressComponents") or []:
        long_text = component.get("longText")
        short_text = component.get("shortText")
        for component_type in component.get("types") or []:
            values[component_type] = (long_text, short_text)

    def long(*keys: str) -> str | None:
        for key in keys:
            if key in values and values[key][0]:
                return values[key][0]
        return None

    country = long("country") or ""
    country_code = ((values.get("country") or (None, None))[1] or "").upper()
    return {
        "country": country,
        "country_code": country_code,
        "region": long("administrative_area_level_1", "administrative_area_level_2"),
        "city": long("locality", "postal_town", "administrative_area_level_3", "administrative_area_level_2"),
    }


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
    country_code: str = "PA",
    latitude: float | None = None,
    longitude: float | None = None,
    radius_meters: float | None = None,
) -> tuple[dict[str, Any], bool]:
    settings = get_settings()
    db = get_supabase()
    payload: dict[str, Any] = {
        "textQuery": query,
        "pageSize": 20,
        "languageCode": "es",
        "regionCode": country_code.upper(),
    }
    if latitude is not None and longitude is not None:
        payload["locationBias"] = {
            "circle": {
                "center": {"latitude": latitude, "longitude": longitude},
                "radius": min(float(radius_meters or 50000), 50000.0),
            }
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
        **geographic_fields(place),
        "source": source,
        "last_google_fetch_at": utcnow().isoformat(),
    }
