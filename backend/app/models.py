from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field


Niche = Literal["Dental", "Medicina estética"]


class SearchJobCreate(BaseModel):
    niche: Niche
    city: str = "Ciudad de Panamá"
    zones: list[str] = Field(default_factory=list, max_length=12)
    services: list[str] = Field(default_factory=list, max_length=12)
    max_results: int = Field(default=100, ge=10, le=500)
    api_request_budget: int = Field(default=30, ge=1, le=60)


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
