from dataclasses import dataclass
from typing import Annotated, Any

import requests
from fastapi import Depends, Header, HTTPException, status

from .config import get_settings
from .db import get_supabase


@dataclass(slots=True)
class CurrentUser:
    id: str
    email: str
    full_name: str
    role: str
    operating_country: str


def _extract_token(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sesión requerida")
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido")
    return token


def get_current_user(authorization: Annotated[str | None, Header()] = None) -> CurrentUser:
    token = _extract_token(authorization)
    settings = get_settings()
    try:
        response = requests.get(
            f"{settings.supabase_url.rstrip('/')}/auth/v1/user",
            headers={
                "apikey": settings.supabase_anon_key,
                "Authorization": f"Bearer {token}",
            },
            timeout=8,
        )
    except requests.RequestException as exc:
        raise HTTPException(status_code=503, detail="No se pudo validar la sesión") from exc

    if response.status_code != 200:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sesión vencida o inválida")

    auth_user = response.json()
    user_id = auth_user.get("id")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Usuario inválido")

    db = get_supabase()
    profile_response = db.table("profiles").select("id,full_name,role,is_active,operating_country").eq("id", user_id).limit(1).execute()
    profile = (profile_response.data or [{}])[0]
    if profile.get("is_active") is False:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tu acceso a Aura Grow está desactivado")
    return CurrentUser(
        id=user_id,
        email=auth_user.get("email", ""),
        full_name=profile.get("full_name") or auth_user.get("user_metadata", {}).get("full_name") or auth_user.get("email", "Usuario"),
        role=profile.get("role") or "agent",
        operating_country=(profile.get("operating_country") or ("ALL" if profile.get("role") == "admin" else "PA")).upper(),
    )


def require_admin(user: Annotated[CurrentUser, Depends(get_current_user)]) -> CurrentUser:
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Esta acción requiere rol administrador")
    return user


def user_feature_enabled(user_id: str, feature_key: str) -> bool:
    """Return true only when this exact user has the feature enabled."""
    try:
        response = (
            get_supabase().table("user_feature_access")
            .select("enabled")
            .eq("user_id", user_id)
            .eq("feature_key", feature_key)
            .limit(1)
            .execute()
        )
    except Exception:
        return False
    rows = response.data or []
    return bool(rows and rows[0].get("enabled") is True)


def require_diagnose(user: Annotated[CurrentUser, Depends(get_current_user)]) -> CurrentUser:
    if not user_feature_enabled(user.id, "diagnose"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Diagnose no está habilitado para este usuario",
        )
    return user


def can_access_diagnosis(user: CurrentUser, diagnosis: dict[str, object]) -> bool:
    """Diagnose records belong to their assignee; administrators can access all."""
    return user.role == "admin" or str(diagnosis.get("assigned_to") or "") == user.id


def enforce_diagnosis_access(user: CurrentUser, diagnosis: dict[str, object]) -> None:
    # Return 404 to avoid revealing that another user's diagnosis exists.
    if not can_access_diagnosis(user, diagnosis):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Diagnóstico no encontrado")


def diagnosis_assignee_for_create(user: CurrentUser, requested_assignee: str | None) -> str:
    return (requested_assignee or user.id) if user.role == "admin" else user.id


def sanitize_diagnosis_update(user: CurrentUser, data: dict[str, Any]) -> dict[str, Any]:
    if user.role != "admin":
        data.pop("assigned_to", None)
    return data
