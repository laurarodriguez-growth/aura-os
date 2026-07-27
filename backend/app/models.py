from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


Niche = Literal["Dental", "Medicina estética"]
ScoringMode = Literal["automatic", "manual", "template"]


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


class SearchJobCreate(BaseModel):
    niche: Niche
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
    notes: str | None = None
    next_followup_date: date | None = None
    decision_maker_name: str | None = None
    decision_maker_title: str | None = None
    decision_maker_link: str | None = None
    manual_ads_score: int | None = Field(default=None, ge=0, le=8)
    manual_volume_score: int | None = Field(default=None, ge=0, le=6)
    manual_followup_score: int | None = Field(default=None, ge=0, le=8)
    manual_decision_maker_score: int | None = Field(default=None, ge=0, le=8)
    do_not_contact: bool | None = None


class CallLogCreate(BaseModel):
    occurred_at: datetime | None = None
    channel: Literal["Llamada", "WhatsApp", "Instagram", "Email", "Otro"] = "Llamada"
    direction: Literal["Saliente", "Entrante"] = "Saliente"
    duration_seconds: int | None = Field(default=None, ge=0, le=86400)
    outcome: str
    contact_name: str | None = None
    contact_title: str | None = None
    objection: str | None = None
    notes: str | None = None
    next_step: str | None = None
    followup_date: date | None = None
    appointment_booked: bool = False
    sale_amount: float | None = Field(default=None, ge=0)
