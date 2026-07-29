from __future__ import annotations

import hashlib
import ipaddress
import json
import re
import socket
import time
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from .config import get_settings
from .db import get_supabase

EMAIL_RE = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.I)
PHONE_RE = re.compile(r"(?:\+?507[\s.-]?)?(?:6\d{3}[\s.-]?\d{4}|[2-8]\d{2}[\s.-]?\d{4})")
DOCTOR_RE = re.compile(
    r"\b(?:Dr\.?|Dra\.?|Doctor|Doctora)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,4})",
    re.UNICODE,
)
DECISION_RE = re.compile(
    r"\b(?:dueñ[oa]|propietari[oa]|fundador[ae]?|director(?:a)?\s+(?:administrativ[oa]|de\s+cl[ií]nica|general)|gerente\s+(?:general|comercial)|administrador(?:a)?)\s*[:\-–]?\s*([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,4})",
    re.I | re.UNICODE,
)

SERVICE_PATTERNS = {
    "Dental": {
        "Implantes": ("implante dental", "implantes dentales", "implantología", "implantologia"),
        "Ortodoncia": ("ortodoncia", "brackets", "alineadores", "invisalign"),
        "Diseño de sonrisa": ("diseño de sonrisa", "diseno de sonrisa", "smile design"),
        "Estética dental": ("estética dental", "estetica dental", "carillas", "blanqueamiento"),
        "Rehabilitación oral": ("rehabilitación oral", "rehabilitacion oral", "prótesis dental", "protesis dental"),
        "Endodoncia": ("endodoncia", "tratamiento de conducto"),
        "Odontopediatría": (
            "odontopediatría",
            "odontopediatria",
            "odontología pediátrica",
            "odontologia pediatrica",
            "dentista pediátrico",
            "dentista pediatrico",
            "dentista infantil",
            "pediatric dentist",
            "pediatric dentistry",
        ),
    },
    "Medicina estética": {
        "Botox": ("botox", "toxina botulínica", "toxina botulinica"),
        "Ácido hialurónico": ("ácido hialurónico", "acido hialuronico", "relleno facial", "fillers"),
        "Láser": ("tratamiento láser", "tratamiento laser", "depilación láser", "depilacion laser"),
        "Rejuvenecimiento": ("rejuvenecimiento facial", "bioestimulación", "bioestimulacion"),
        "Armonización facial": ("armonización facial", "armonizacion facial", "perfilamiento"),
        "Medicina estética corporal": ("moldeo corporal", "reducción de medidas", "reduccion de medidas", "criolipólisis", "criolipolisis"),
    },
}

TECH_PATTERNS = {
    "cms_tools": {
        "WordPress": ("wp-content", "wp-includes"),
        "Wix": ("wixstatic.com", "wix.com"),
        "Webflow": ("webflow.com", "data-wf-page"),
        "Squarespace": ("static.squarespace.com", "squarespace.com"),
        "GoDaddy": ("godaddysites.com", "secureserver.net"),
    },
    "booking_tools": {
        "Calendly": ("calendly.com",),
        "Doctoralia": ("doctoralia",),
        "Booksy": ("booksy.com",),
        "Setmore": ("setmore.com",),
        "SimplyBook": ("simplybook",),
        "AgendaPro": ("agendapro",),
        "Fresha": ("fresha.com",),
        "Dentalink": ("dentalink",),
    },
    "crm_tools": {
        "HubSpot": ("hubspot", "hs-scripts.com"),
        "Kommo": ("kommo", "amocrm"),
        "GoHighLevel": ("leadconnectorhq", "gohighlevel"),
        "Salesforce": ("salesforce", "pardot"),
        "Zoho": ("zoho",),
        "Pipedrive": ("pipedrive",),
        "ActiveCampaign": ("activecampaign",),
        "RD Station": ("rdstation",),
    },
    "chat_tools": {
        "Tidio": ("tidio",),
        "JivoChat": ("jivochat", "jivosite"),
        "Intercom": ("intercom",),
        "ManyChat": ("manychat",),
        "Crisp": ("crisp.chat",),
        "Zendesk": ("zendesk",),
        "Tawk.to": ("tawk.to",),
        "Landbot": ("landbot",),
    },
}

PROMO_TERMS = (
    "promoción",
    "promocion",
    "descuento",
    "evaluación gratuita",
    "evaluacion gratuita",
    "consulta gratis",
    "agenda tu cita",
    "reserva tu cita",
    "cotiza",
    "precio especial",
)

GENERIC_WA_TERMS = (
    "escríbenos al whatsapp",
    "escribenos al whatsapp",
    "contáctanos por whatsapp",
    "contactanos por whatsapp",
    "más información por whatsapp",
    "mas informacion por whatsapp",
)

INTERNAL_PAGE_TERMS = (
    "equipo",
    "doctores",
    "especialistas",
    "nosotros",
    "servicios",
    "tratamientos",
    "contacto",
    "ubicaciones",
    "sedes",
)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _session() -> requests.Session:
    session = requests.Session()
    retries = Retry(total=1, connect=1, read=1, backoff_factor=0.2, status_forcelist=[429, 500, 502, 503, 504])
    session.mount("https://", HTTPAdapter(max_retries=retries))
    session.mount("http://", HTTPAdapter(max_retries=retries))
    session.headers.update(
        {
            "User-Agent": "Mozilla/5.0 (compatible; GrowthLeadFinder/1.0; +https://laurarodriguez-growth.github.io/)",
            "Accept-Language": "es-PA,es;q=0.9,en;q=0.7",
        }
    )
    return session


def _is_public_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            return False
        addresses = socket.getaddrinfo(parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80))
        for address in addresses:
            ip = ipaddress.ip_address(address[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
                return False
        return True
    except (ValueError, OSError, socket.gaierror):
        return False


def _normalize_url(url: str) -> str:
    if not url:
        return ""
    if not urlparse(url).scheme:
        return f"https://{url}"
    return url


def _cache_key(url: str) -> str:
    parsed = urlparse(url)
    normalized = f"{parsed.scheme.lower()}://{parsed.netloc.lower()}{parsed.path.rstrip('/') or '/'}"
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _dedupe(values: list[str], limit: int = 30) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        clean = re.sub(r"\s+", " ", value.strip()).strip(" ,;|-")
        key = clean.lower()
        if clean and key not in seen:
            seen.add(key)
            result.append(clean)
        if len(result) >= limit:
            break
    return result


def _fetch(session: requests.Session, url: str, timeout: int) -> tuple[str, str, int, str]:
    if not _is_public_url(url):
        raise ValueError("URL no pública o insegura")
    started = time.perf_counter()
    response = session.get(url, timeout=timeout, allow_redirects=True, stream=True)
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    response.raise_for_status()
    content_type = response.headers.get("content-type", "")
    if "text/html" not in content_type and "application/xhtml" not in content_type:
        raise ValueError(f"Contenido no HTML: {content_type}")
    chunks: list[bytes] = []
    size = 0
    max_bytes = 2_000_000
    for chunk in response.iter_content(65536):
        size += len(chunk)
        if size > max_bytes:
            break
        chunks.append(chunk)
    encoding = response.encoding or "utf-8"
    html = b"".join(chunks).decode(encoding, errors="replace")
    return html, response.url, elapsed_ms, content_type


def _extract_internal_links(soup: BeautifulSoup, base_url: str) -> list[str]:
    base_host = urlparse(base_url).netloc.lower()
    candidates: list[tuple[int, str]] = []
    for anchor in soup.find_all("a", href=True):
        href = urljoin(base_url, anchor.get("href", ""))
        parsed = urlparse(href)
        if parsed.scheme not in {"http", "https"} or parsed.netloc.lower() != base_host:
            continue
        label = f"{anchor.get_text(' ', strip=True)} {parsed.path}".lower()
        score = sum(1 for term in INTERNAL_PAGE_TERMS if term in label)
        if score:
            candidates.append((score, href.split("#", 1)[0]))
    candidates.sort(key=lambda item: (-item[0], len(item[1])))
    return _dedupe([url for _, url in candidates], limit=3)


def _detect_tech(source_lower: str, group: str) -> list[str]:
    found: list[str] = []
    for name, patterns in TECH_PATTERNS[group].items():
        if any(pattern in source_lower for pattern in patterns):
            found.append(name)
    return found


def _extract_whatsapp(soup: BeautifulSoup, source: str) -> tuple[str | None, str | None]:
    links: list[str] = []
    for anchor in soup.find_all("a", href=True):
        href = anchor.get("href", "")
        if any(token in href.lower() for token in ("wa.me/", "api.whatsapp.com", "web.whatsapp.com", "whatsapp://")):
            links.append(href)
    match = re.search(r"https?://(?:wa\.me|api\.whatsapp\.com/send)[^\"'<>\s]+", source, re.I)
    if match:
        links.append(match.group(0))
    url = links[0] if links else None
    phone = None
    if url:
        digits = re.findall(r"\d{7,15}", url)
        if digits:
            phone = digits[0]
    return url, phone


def _extract_social(soup: BeautifulSoup, domain: str) -> str | None:
    for anchor in soup.find_all("a", href=True):
        href = anchor.get("href", "")
        if domain in href.lower():
            return href
    return None


def audit_website(url: str, niche: str, cache_days: int | None = None) -> tuple[dict[str, Any], bool]:
    settings = get_settings()
    db = get_supabase()
    url = _normalize_url(url)
    key = _cache_key(url)
    now_iso = utcnow().isoformat()
    cached = (
        db.table("website_cache")
        .select("payload,expires_at")
        .eq("cache_key", key)
        .gt("expires_at", now_iso)
        .limit(1)
        .execute()
    )
    if cached.data:
        return cached.data[0]["payload"], True

    result: dict[str, Any] = {
        "website_status": "sin_auditar",
        "pages_audited": [],
        "high_ticket_services": [],
        "doctor_names": [],
        "doctor_count_estimate": 0,
        "doctor_count_confidence": "sin_evidencia",
        "branch_addresses": [],
        "branch_count_estimate": 0,
        "branch_count_confidence": "sin_evidencia",
        "form_found": False,
        "booking_found": False,
        "booking_tools": [],
        "crm_visible": False,
        "crm_tools": [],
        "chat_found": False,
        "chat_tools": [],
        "cms_tools": [],
        "meta_pixel_found": False,
        "google_tag_found": False,
        "google_analytics_found": False,
        "tiktok_pixel_found": False,
        "linkedin_insight_found": False,
        "promotional_language_found": False,
        "generic_whatsapp_cta_found": False,
        "decision_maker_candidate": None,
        "decision_maker_confidence": "sin_evidencia",
        "website_response_ms": None,
        "mobile_friendly_signal": False,
        "https_enabled": url.lower().startswith("https://"),
        "email": None,
        "instagram_url": None,
        "whatsapp_url": None,
        "whatsapp_phone": None,
        "quality_flags": [],
    }

    session = _session()
    pages: list[tuple[str, str, int]] = []
    try:
        main_html, final_url, elapsed_ms, _ = _fetch(session, url, settings.website_timeout_seconds)
        pages.append((final_url, main_html, elapsed_ms))
        main_soup = BeautifulSoup(main_html, "html.parser")
        for internal_url in _extract_internal_links(main_soup, final_url):
            try:
                html, fetched_url, page_ms, _ = _fetch(session, internal_url, settings.website_timeout_seconds)
                pages.append((fetched_url, html, page_ms))
            except Exception:
                continue
        result["website_status"] = "ok"
        result["website_response_ms"] = elapsed_ms
        result["https_enabled"] = final_url.lower().startswith("https://")
    except Exception as exc:
        result["website_status"] = "error"
        result["quality_flags"] = [f"No se pudo auditar la web: {str(exc)[:180]}"]
        ttl = cache_days if cache_days is not None else max(1, min(settings.website_cache_days, 3))
        db.table("website_cache").upsert(
            {
                "cache_key": key,
                "url": url,
                "payload": result,
                "expires_at": (utcnow() + timedelta(days=ttl)).isoformat(),
            },
            on_conflict="cache_key",
        ).execute()
        return result, False

    all_html = "\n".join(html for _, html, _ in pages)
    all_source_lower = all_html.lower()
    soups = [BeautifulSoup(html, "html.parser") for _, html, _ in pages]
    all_text = "\n".join(soup.get_text(" ", strip=True) for soup in soups)
    text_lower = all_text.lower()
    result["pages_audited"] = _dedupe([page_url for page_url, _, _ in pages], limit=10)

    # Contact channels
    emails = EMAIL_RE.findall(all_text)
    result["email"] = emails[0] if emails else None
    for soup in soups:
        if not result["instagram_url"]:
            result["instagram_url"] = _extract_social(soup, "instagram.com")
        if not result["whatsapp_url"]:
            wa_url, wa_phone = _extract_whatsapp(soup, str(soup))
            result["whatsapp_url"] = wa_url
            result["whatsapp_phone"] = wa_phone

    # Services
    service_map = SERVICE_PATTERNS.get(niche, {})
    services: list[str] = []
    for service, patterns in service_map.items():
        if any(pattern in text_lower for pattern in patterns):
            services.append(service)
    result["high_ticket_services"] = services

    # Team members. Only count actual names following a professional title.
    doctors = _dedupe(DOCTOR_RE.findall(all_text), limit=30)
    result["doctor_names"] = doctors
    result["doctor_count_estimate"] = len(doctors)
    result["doctor_count_confidence"] = "alta" if len(doctors) >= 2 else ("media" if len(doctors) == 1 else "sin_evidencia")

    # Addresses: structured tags and lines containing Panama address cues.
    addresses: list[str] = []
    for soup in soups:
        addresses.extend(tag.get_text(" ", strip=True) for tag in soup.find_all("address"))
        for item in soup.select('[itemprop="streetAddress"], [itemprop="address"], .address, .direccion, .dirección'):
            addresses.append(item.get_text(" ", strip=True))
    address_cues = re.findall(
        r"(?:Calle|Avenida|Ave\.?|Vía|Via|Edificio|PH|Plaza)\s+[^\n|]{5,100}(?:Panamá|Panama)",
        all_text,
        re.I,
    )
    addresses.extend(address_cues)
    addresses = _dedupe(addresses, limit=10)
    result["branch_addresses"] = addresses
    result["branch_count_estimate"] = len(addresses)
    result["branch_count_confidence"] = "media" if addresses else "sin_evidencia"

    # Forms and technology
    result["form_found"] = any(bool(soup.find("form")) for soup in soups)
    result["mobile_friendly_signal"] = any(
        bool(soup.find("meta", attrs={"name": re.compile("viewport", re.I)})) for soup in soups
    )
    result["cms_tools"] = _detect_tech(all_source_lower, "cms_tools")
    result["booking_tools"] = _detect_tech(all_source_lower, "booking_tools")
    result["booking_found"] = bool(result["booking_tools"]) or any(term in text_lower for term in ("reservar cita", "agendar cita", "book appointment"))
    result["crm_tools"] = _detect_tech(all_source_lower, "crm_tools")
    result["crm_visible"] = bool(result["crm_tools"])
    result["chat_tools"] = _detect_tech(all_source_lower, "chat_tools")
    result["chat_found"] = bool(result["chat_tools"])
    result["meta_pixel_found"] = any(token in all_source_lower for token in ("connect.facebook.net", "fbq(", "facebook pixel"))
    result["google_tag_found"] = any(token in all_source_lower for token in ("googletagmanager.com", "gtm-"))
    result["google_analytics_found"] = any(token in all_source_lower for token in ("google-analytics.com", "gtag(", "ga4"))
    result["tiktok_pixel_found"] = any(token in all_source_lower for token in ("analytics.tiktok.com", "ttq."))
    result["linkedin_insight_found"] = any(token in all_source_lower for token in ("snap.licdn.com", "linkedin insight"))
    result["promotional_language_found"] = any(term in text_lower for term in PROMO_TERMS)
    result["generic_whatsapp_cta_found"] = any(term in text_lower for term in GENERIC_WA_TERMS)

    decision = DECISION_RE.search(all_text)
    if decision:
        result["decision_maker_candidate"] = decision.group(1)
        result["decision_maker_confidence"] = "media"

    ttl = cache_days if cache_days is not None else settings.website_cache_days
    db.table("website_cache").upsert(
        {
            "cache_key": key,
            "url": url,
            "payload": result,
            "expires_at": (utcnow() + timedelta(days=ttl)).isoformat(),
        },
        on_conflict="cache_key",
    ).execute()
    return result, False
