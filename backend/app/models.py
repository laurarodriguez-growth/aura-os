from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


Niche = Literal["Dental", "Medicina estética", "Gastronomía y turismo"]
ScoringMode = Literal["automatic", "manual", "template"]
ConversationStatus = Literal[
    "not_started", "waiting_response", "response_received", "conversation_active",
    "waiting_decision_maker", "waiting_confirmation", "followup_scheduled", "closed",
]
OutcomeStage = Literal["pending", "provisional", "final"]
ActivityType = Literal[
    "contact_attempt", "call_made", "message_sent", "email_sent", "response_received",
    "information_sent", "followup", "meeting", "note", "other",
]


class ScoringRule(BaseModel):
    criterion: str
    label: str
    operator: str = "is_true"
    value: Any = None
    points: int = Field(default=0, ge=-100, le=100)
    enabled: bool = True
    category: str = "demand"


class TierThresholds(BaseModel):
    A: int = Field(default=70, ge=0, le=100)
    B: int = Field(default=50, ge=0, le=100)
    C: int = Field(default=30, ge=0, le=100)

    @model_validator(mode="after")
    def validate_order(self) -> "TierThresholds":
        if not (self.A > self.B > self.C):
            raise ValueError("Los tiers deben cumplir A > B > C")
        return self


class GeographicPlace(BaseModel):
    name: str = Field(min_length=1, max_length=180)
    formatted_address: str = Field(min_length=1, max_length=500)
    place_id: str = Field(min_length=3, max_length=255)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    country: str = Field(min_length=2, max_length=120)
    country_code: str = Field(min_length=2, max_length=2)
    region: str | None = Field(default=None, max_length=180)
    city: str | None = Field(default=None, max_length=180)


class SearchJobCreate(BaseModel):
    niche: Niche
    country_code: str = Field(default="PA", min_length=2, max_length=2)
    country_name: str = Field(default="Panamá", min_length=2, max_length=120)
    base_city: GeographicPlace | None = None
    target_locations: list[GeographicPlace] = Field(default_factory=list, max_length=12)
    search_mode: Literal["zones", "radius"] = "zones"
    radius_km: Literal[5, 10, 25, 50] | None = None
    # Legacy fields remain accepted while older clients are upgraded.
    city: str = "Ciudad de Panamá"
    zones: list[str] = Field(default_factory=list, max_length=12)
    services: list[str] = Field(default_factory=list, max_length=12)
    max_results: int = Field(default=100, ge=1, le=500)
    api_request_budget: int = Field(default=30, ge=1, le=60)
    scoring_mode: ScoringMode = "automatic"
    scoring_template_id: str | None = None
    scoring_template_name: str | None = None
    scoring_rules: list[ScoringRule] = Field(default_factory=list, max_length=100)
    scoring_thresholds: TierThresholds = Field(default_factory=TierThresholds)

    @model_validator(mode="after")
    def validate_geography(self) -> "SearchJobCreate":
        self.country_code = self.country_code.upper()
        if self.search_mode == "radius" and not self.radius_km:
            raise ValueError("Selecciona un radio de 5, 10, 25 o 50 km")
        if self.base_city:
            if self.base_city.country_code.upper() != self.country_code:
                raise ValueError("La ciudad base no pertenece al país seleccionado")
            for zone in self.target_locations:
                if zone.country_code.upper() != self.country_code:
                    raise ValueError("Todas las zonas deben pertenecer al país seleccionado")
        elif not self.city.strip():
            raise ValueError("Selecciona una ciudad base")
        if self.search_mode == "zones" and self.base_city and not self.target_locations:
            raise ValueError("Selecciona al menos una zona objetivo o usa búsqueda por radio")
        return self


class ScoringTemplateCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    niche: Niche
    country: str = Field(default="Panamá", min_length=2, max_length=80)
    rules: list[ScoringRule] = Field(min_length=1, max_length=100)
    thresholds: TierThresholds = Field(default_factory=TierThresholds)
    is_default: bool = False


class LeadUpdate(BaseModel):
    status: str | None = None
    owner_id: str | None = None
    outcome: str | None = None
    outcome_id: str | None = None
    notes: str | None = None
    next_followup_date: date | None = None
    decision_maker_name: str | None = None
    decision_maker_title: str | None = None
    decision_maker_link: str | None = None
    manual_ads_score: int | None = Field(default=None, ge=0, le=8)
    manual_volume_score: int | None = Field(default=None, ge=0, le=6)
    manual_followup_score: int | None = Field(default=None, ge=0, le=8)
    manual_decision_maker_score: int | None = Field(default=None, ge=0, le=8)
    conversation_status: ConversationStatus | None = None
    outcome_stage: OutcomeStage | None = None
    response_due_at: datetime | None = None
    do_not_contact: bool | None = None
    whatsapp_phone: str | None = Field(default=None, max_length=40)
    email: str | None = Field(default=None, max_length=255)


class DuplicateLeadMergeRequest(BaseModel):
    target_lead_id: str = Field(min_length=36, max_length=36)


class FocusAssignmentRequest(BaseModel):
    setter_ids: list[str] = Field(min_length=1, max_length=50)
    lead_ids: list[str] = Field(default_factory=list, max_length=1000)
    strategy: Literal["round_robin"] = "round_robin"


class CallLogCreate(BaseModel):
    occurred_at: datetime | None = None
    channel: Literal["Llamada", "WhatsApp", "Instagram", "Email", "Otro"] = "Llamada"
    direction: Literal["Saliente", "Entrante"] = "Saliente"
    duration_seconds: int | None = Field(default=None, ge=0, le=86400)
    activity_type: ActivityType = "contact_attempt"
    conversation_status: ConversationStatus = "not_started"
    outcome_stage: OutcomeStage | None = None
    outcome: str = "Pendiente"
    outcome_id: str | None = None
    commercial_status: str | None = Field(default=None, max_length=80)
    contact_name: str | None = None
    contact_title: str | None = None
    objection: str | None = None
    notes: str | None = None
    next_step: str | None = None
    followup_date: date | None = None
    appointment_booked: bool = False
    sale_amount: float | None = Field(default=None, ge=0)
    transcript: str | None = Field(default=None, max_length=50000)
    analysis: dict[str, Any] = Field(default_factory=dict)
    awaiting_response: bool = False
    response_due_at: datetime | None = None
    is_final_outcome: bool | None = None


class ChatAnalysisRequest(BaseModel):
    transcript: str = Field(min_length=1, max_length=50000)
    channel: Literal["Llamada", "WhatsApp", "Instagram", "Email", "Otro"] | None = None


UserRole = Literal["admin", "setter", "agent"]


class AdminUserCreate(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=5, max_length=255)
    password: str = Field(min_length=8, max_length=128)
    role: UserRole = "setter"
    operating_country: str = Field(default="PA", min_length=2, max_length=3)
    diagnose_enabled: bool = False


class AdminUserUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    role: UserRole | None = None
    operating_country: str | None = Field(default=None, min_length=2, max_length=3)
    password: str | None = Field(default=None, min_length=8, max_length=128)
    diagnose_enabled: bool | None = None


class AdminUserDelete(BaseModel):
    confirmation: str
