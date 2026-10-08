from __future__ import annotations

import io
import logging
import os
import uuid
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated, Any, List, Optional
from xml.sax.saxutils import escape

from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from motor.motor_asyncio import AsyncIOMotorClient
from openpyxl import Workbook
from openpyxl.drawing.image import Image as XLImage
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from pydantic import BaseModel, ConfigDict, Field
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A3, A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Image as RLImage, LongTable, Paragraph, SimpleDocTemplate, Spacer, TableStyle
from starlette.middleware.cors import CORSMiddleware


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
mongo_client = AsyncIOMotorClient(mongo_url)
db = mongo_client[os.environ["DB_NAME"]]

app = FastAPI(title="C-Freight Portal API")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("tracker")


# ---------- Constants ----------
DEFAULT_OPTIONAL_COLUMNS = {
    "hbill_released": False,
    "expected_freight_rate": False,
    "copy_docs_status": False,
    "final_destination": True,
    "sob_date": True,
    "pol": False,
}

CARRIERS = ["MSC", "Maersk", "ONE", "COSCO", "Hapag Lloyd", "PIL", "CMA CGM", "Vanguard", "Other"]

COMPANIES = {
    "Patuma": {
        "name": "PATUMA FREIGHT",
        "suffix": "(PTY) LTD",
        "tagline": "SPECIALISED FORWARDING & SHIPPING CONSULTANCY",
        "reg": "Reg. No.1992/003670/07",
        "logo": str(ROOT_DIR / "static" / "logos" / "patuma.png"),
    },
    "Clearfreight": {
        "name": "CLEARFREIGHT",
        "suffix": "(PTY) LTD",
        "tagline": "INTERNATIONAL CLEARING & FORWARDING AGENTS",
        "reg": "Reg. No. 91/04800/07",
        "logo": str(ROOT_DIR / "static" / "logos" / "clearfreight.png"),
    },
}

STATUS_OPTIONS = ["Planned", "Booked", "Shipped", "Delayed"]


# ---------- Models ----------
def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Client(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    company: str = "Patuma"  # Patuma or Clearfreight
    contact_email: Optional[str] = None
    notes: Optional[str] = None
    default_pod: Optional[str] = None  # Port of discharge most shipments for this client use
    pinned: bool = False
    email_to: Optional[str] = None  # recipient(s) for the status-report email draft, comma-separated
    email_cc: Optional[str] = None  # cc'd address(es), comma-separated
    email_greeting: Optional[str] = None  # e.g. "Roland and Jessica" for "Dear ..."
    optional_columns: dict = Field(default_factory=lambda: dict(DEFAULT_OPTIONAL_COLUMNS))
    created_at: str = Field(default_factory=_now_iso)


class ClientCreate(BaseModel):
    name: str
    company: str = "Patuma"
    contact_email: Optional[str] = None
    notes: Optional[str] = None
    default_pod: Optional[str] = None
    email_to: Optional[str] = None
    email_cc: Optional[str] = None
    email_greeting: Optional[str] = None
    optional_columns: Optional[dict] = None


class ClientUpdate(BaseModel):
    name: Optional[str] = None
    company: Optional[str] = None
    contact_email: Optional[str] = None
    notes: Optional[str] = None
    default_pod: Optional[str] = None
    pinned: Optional[bool] = None
    email_to: Optional[str] = None
    email_cc: Optional[str] = None
    email_greeting: Optional[str] = None
    optional_columns: Optional[dict] = None


class Shipment(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_id: str
    supplier: str = ""
    order_booking_file: str = ""
    file_number: str = ""
    cargo_type: str = "FCL"  # FCL / LCL
    status: str = "Booked"  # Booked / Shipped / Delayed
    sob_date: Optional[str] = None
    vessel_name: str = ""
    tracking_doc_number: str = ""
    carrier: str = "Other"
    pol: Optional[str] = None
    pod: str = ""
    eta: Optional[str] = None
    planned_etd: Optional[str] = None  # ISO date YYYY-MM-DD
    etd_tba: bool = False  # true when the 1st vessel's ETD lapsed and no new date is set yet
    planned_eta: Optional[str] = None  # ISO date YYYY-MM-DD
    second_vessel_name: Optional[str] = None
    second_vessel_etd: Optional[str] = None  # ISO date YYYY-MM-DD
    second_vessel_sob_date: Optional[str] = None  # ISO date YYYY-MM-DD (set when 2nd vessel has sailed)
    first_vessel_state: str = "planned"  # planned | delayed | changed (sailed handled by sob_date)
    second_vessel_state: str = "planned"
    first_vessel_delay_days: Optional[int] = None  # size of the last ETD push, for comment wording
    second_vessel_delay_days: Optional[int] = None
    extra_vessels: List[dict] = Field(default_factory=list)  # legs beyond the 2nd: [{id, name, planned_etd, sob_date, state, delay_days}]
    final_destination: Optional[str] = None
    comments: str = ""
    hbill_released: Optional[bool] = None
    expected_freight_rate: Optional[str] = None
    copy_docs_status: Optional[str] = None
    anf_received: bool = False
    anf_received_at: Optional[str] = None
    cargo_report_ack_date: Optional[str] = None  # target_date of the cargo-report reminder last marked done
    created_at: str = Field(default_factory=_now_iso)
    updated_at: str = Field(default_factory=_now_iso)


class ShipmentCreate(BaseModel):
    client_id: str
    supplier: str = ""
    order_booking_file: str = ""
    file_number: str = ""
    cargo_type: str = "FCL"
    status: str = "Booked"
    sob_date: Optional[str] = None
    vessel_name: str = ""
    tracking_doc_number: str = ""
    carrier: str = "Other"
    pol: Optional[str] = None
    pod: str = ""
    eta: Optional[str] = None
    planned_etd: Optional[str] = None
    etd_tba: bool = False
    planned_eta: Optional[str] = None
    second_vessel_name: Optional[str] = None
    second_vessel_etd: Optional[str] = None
    second_vessel_sob_date: Optional[str] = None
    extra_vessels: Optional[List[dict]] = None
    final_destination: Optional[str] = None
    comments: str = ""
    hbill_released: Optional[bool] = None
    expected_freight_rate: Optional[str] = None
    copy_docs_status: Optional[str] = None


class ShipmentUpdate(BaseModel):
    supplier: Optional[str] = None
    order_booking_file: Optional[str] = None
    file_number: Optional[str] = None
    cargo_type: Optional[str] = None
    status: Optional[str] = None
    sob_date: Optional[str] = None
    vessel_name: Optional[str] = None
    tracking_doc_number: Optional[str] = None
    carrier: Optional[str] = None
    pol: Optional[str] = None
    pod: Optional[str] = None
    eta: Optional[str] = None
    planned_etd: Optional[str] = None
    etd_tba: Optional[bool] = None
    planned_eta: Optional[str] = None
    second_vessel_name: Optional[str] = None
    second_vessel_etd: Optional[str] = None
    second_vessel_sob_date: Optional[str] = None
    extra_vessels: Optional[List[dict]] = None
    final_destination: Optional[str] = None
    comments: Optional[str] = None
    hbill_released: Optional[bool] = None
    expected_freight_rate: Optional[str] = None
    copy_docs_status: Optional[str] = None
    anf_received: Optional[bool] = None


# ---------- Helpers ----------
def _proj() -> dict:
    return {"_id": 0}


async def _get_client(client_id: str) -> dict:
    doc = await db.clients.find_one({"id": client_id}, _proj())
    if not doc:
        raise HTTPException(status_code=404, detail="Client not found")
    return doc


# ---------- Client Endpoints ----------
@api_router.get("/carriers")
async def list_carriers():
    return {"carriers": CARRIERS}


@api_router.get("/vessels")
async def list_vessels():
    names: set[str] = set()
    for field in ("vessel_name", "second_vessel_name"):
        for v in await db.shipments.distinct(field):
            if v and v.strip():
                names.add(v.strip())
    async for doc in db.shipments.find({"extra_vessels": {"$exists": True, "$ne": []}}, {"_id": 0, "extra_vessels": 1}):
        for ev in doc.get("extra_vessels") or []:
            v = (ev.get("name") or "").strip()
            if v:
                names.add(v)
    return {"vessels": sorted(names)}


@api_router.get("/clients")
async def list_clients():
    docs = await db.clients.find({}, _proj()).sort("name", 1).to_list(1000)
    shipments = await db.shipments.find(
        {"anf_received": {"$ne": True}}, {"_id": 0, "client_id": 1, "status": 1}
    ).to_list(10000)
    counts: dict[str, int] = {}
    on_water: dict[str, int] = {}
    for s in shipments:
        cid = s.get("client_id")
        counts[cid] = counts.get(cid, 0) + 1
        if s.get("status") == "Shipped":
            on_water[cid] = on_water.get(cid, 0) + 1
    for c in docs:
        c["active_shipment_count"] = counts.get(c["id"], 0)
        c["on_water_count"] = on_water.get(c["id"], 0)
    return docs


@api_router.post("/clients", response_model=Client)
async def create_client(payload: ClientCreate):
    optional_columns = dict(DEFAULT_OPTIONAL_COLUMNS)
    if payload.optional_columns:
        optional_columns.update({k: bool(v) for k, v in payload.optional_columns.items() if k in DEFAULT_OPTIONAL_COLUMNS})
    company = payload.company if payload.company in COMPANIES else "Patuma"
    client_obj = Client(
        name=payload.name,
        company=company,
        contact_email=payload.contact_email,
        notes=payload.notes,
        default_pod=payload.default_pod,
        email_to=payload.email_to,
        email_cc=payload.email_cc,
        email_greeting=payload.email_greeting,
        optional_columns=optional_columns,
    )
    await db.clients.insert_one(client_obj.model_dump())
    return client_obj


@api_router.get("/clients/{client_id}", response_model=Client)
async def get_client(client_id: str):
    return await _get_client(client_id)


@api_router.patch("/clients/{client_id}", response_model=Client)
async def update_client(client_id: str, payload: ClientUpdate):
    existing = await _get_client(client_id)
    updates: dict[str, Any] = {}
    for field in ["name", "contact_email", "notes", "default_pod", "email_to", "email_cc", "email_greeting"]:
        value = getattr(payload, field)
        if value is not None:
            updates[field] = value
    if payload.company is not None and payload.company in COMPANIES:
        updates["company"] = payload.company
    if payload.pinned is not None:
        updates["pinned"] = payload.pinned
    if payload.optional_columns is not None:
        merged = dict(existing.get("optional_columns") or DEFAULT_OPTIONAL_COLUMNS)
        for k, v in payload.optional_columns.items():
            if k in DEFAULT_OPTIONAL_COLUMNS:
                merged[k] = bool(v)
        updates["optional_columns"] = merged
    if updates:
        await db.clients.update_one({"id": client_id}, {"$set": updates})
    return await _get_client(client_id)


@api_router.get("/companies")
async def list_companies():
    return {"companies": [{"key": k, **v} for k, v in COMPANIES.items()]}


@api_router.delete("/clients/{client_id}")
async def delete_client(client_id: str):
    await _get_client(client_id)
    await db.shipments.delete_many({"client_id": client_id})
    await db.clients.delete_one({"id": client_id})
    return {"ok": True}


# ---------- Shipment Endpoints ----------
@api_router.get("/shipments", response_model=List[Shipment])
async def list_shipments(client_id: Optional[str] = None, include_anf: bool = True):
    query: dict[str, Any] = {}
    if client_id:
        query["client_id"] = client_id
    if not include_anf:
        query["anf_received"] = {"$ne": True}
    docs = await db.shipments.find(query, _proj()).sort("created_at", -1).to_list(5000)
    for d in docs:
        d["comments"] = _regenerate_comment(d)
        d["status"] = _derive_status(d)
    return docs


@api_router.post("/shipments", response_model=Shipment)
async def create_shipment(payload: ShipmentCreate):
    client = await _get_client(payload.client_id)
    data = payload.model_dump()
    if not (data.get("pod") or "").strip() and client.get("default_pod"):
        data["pod"] = client["default_pod"]
    data["extra_vessels"] = data.get("extra_vessels") or []
    ship = Shipment(**data)
    ship_dict = ship.model_dump()
    ship_dict["comments"] = _regenerate_comment(ship_dict)
    ship_dict["status"] = _derive_status(ship_dict)
    ship_dict["updated_at"] = _now_iso()
    await db.shipments.insert_one(ship_dict)
    return Shipment(**ship_dict)


class VesselStatusPayload(BaseModel):
    vessel: int  # 1 or 2
    sailed: bool
    date: Optional[str] = None  # YYYY-MM-DD when sailed=True


def _ordinal(n: int) -> str:
    if 10 <= n % 100 <= 20:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def _vessel_legs(ship: dict) -> list[dict]:
    """Assemble every vessel leg (1st, 2nd, 3rd...) into one ordered list.
    The 1st leg's sob_date is always the shipment's sob_date — the single
    source of truth for when cargo physically departed, no matter how many
    transshipment legs follow it."""
    legs = [{
        "index": 1,
        "name": ship.get("vessel_name") or "",
        "planned_etd": ship.get("planned_etd"),
        "etd_tba": bool(ship.get("etd_tba")),
        "sob_date": ship.get("sob_date"),
        "state": (ship.get("first_vessel_state") or "planned").lower(),
        "delay_days": ship.get("first_vessel_delay_days"),
    }]
    has_second = bool((ship.get("second_vessel_name") or "").strip()) or bool(ship.get("second_vessel_etd")) or bool(ship.get("second_vessel_sob_date"))
    if has_second:
        legs.append({
            "index": 2,
            "name": ship.get("second_vessel_name") or "",
            "planned_etd": ship.get("second_vessel_etd"),
            "etd_tba": False,
            "sob_date": ship.get("second_vessel_sob_date"),
            "state": (ship.get("second_vessel_state") or "planned").lower(),
            "delay_days": ship.get("second_vessel_delay_days"),
        })
    for i, ev in enumerate(ship.get("extra_vessels") or []):
        legs.append({
            "index": 3 + i,
            "name": ev.get("name") or "",
            "planned_etd": ev.get("planned_etd"),
            "etd_tba": False,
            "sob_date": ev.get("sob_date"),
            "state": (ev.get("state") or "planned").lower(),
            "delay_days": ev.get("delay_days"),
        })
    return legs


def _regenerate_comment(ship: dict) -> str:
    """Build the shipment comment from state.
    Format:
      - Single vessel:  '{today} - Planned ETD X. Awaiting confirmation of departure.'
      - Multiple legs:  '{today} - 1st Planned ETD X. 2nd Planned ETD Y. Awaiting confirmation of departure.'
      - When a vessel sails, 'Planned ETD X' becomes 'SOB X'.
      - Awaiting clause depends on how far the shipment has progressed and cargo_type.
    """
    today = date.today()
    prefix = f"{today.day:02d}.{today.month:02d} - "

    def _plain_dd_mm(iso: Optional[str]) -> str:
        if not iso:
            return ""
        try:
            d = date.fromisoformat(iso)
            return f"{d.day:02d}.{d.month:02d}"
        except Exception:
            return iso

    legs = _vessel_legs(ship)
    multi = len(legs) > 1
    parts: list[str] = []
    all_sailed = True

    for leg in legs:
        label = f"{_ordinal(leg['index'])} " if multi else ""
        sailed = bool(leg["sob_date"])
        if not sailed:
            all_sailed = False
        etd_overdue = False
        if leg["index"] == 1 and leg.get("planned_etd"):
            try:
                etd_overdue = date.fromisoformat(leg["planned_etd"]) < today
            except Exception:
                pass
        if sailed:
            parts.append(f"{label}SOB {_plain_dd_mm(leg['sob_date'])}.")
        elif leg["index"] == 1 and (leg.get("etd_tba") or etd_overdue):
            # A lapsed ETD never gets shown as-is — the client should never see a date
            # that's already in the past. Falls back to TBA until a new date is set.
            parts.append(f"{label}ETD TBA.")
        elif leg.get("planned_etd"):
            etd_txt = _plain_dd_mm(leg["planned_etd"])
            if leg["state"] == "delayed":
                slightly = " slightly" if (leg.get("delay_days") or 0) <= 5 else ""
                parts.append(f"{label}Vessel delayed{slightly}. Now planned ETD {etd_txt}.")
            elif leg["state"] == "changed":
                parts.append(f"{label}Vessel changed by S/Line. Now planned ETD {etd_txt}.")
            else:
                parts.append(f"{label}Planned ETD {etd_txt}.")

    # Awaiting clause
    is_lcl = (ship.get("cargo_type") or "FCL").upper() == "LCL"
    if all_sailed:
        parts.append("Awaiting SOB's." if is_lcl else "Awaiting ANF.")
    elif legs[0]["sob_date"] and multi:
        parts.append("Awaiting confirmation of departure of next vessel.")
    else:
        parts.append("Awaiting confirmation of departure.")

    body = " ".join(p for p in parts if p)
    return prefix + body if body else prefix.rstrip()


def _derive_status(ship: dict) -> str:
    """Only three states: Planned, Booked, Shipped. Never Delayed.
    The 1st vessel sailing is what moves cargo — status flips to Shipped as soon as
    sob_date is set, even if a 2nd (transshipment) vessel hasn't sailed yet."""
    if ship.get("sob_date"):
        return "Shipped"
    if ship.get("vessel_name") or ship.get("planned_etd") or ship.get("tracking_doc_number"):
        return "Booked"
    return "Planned"


@api_router.post("/shipments/{shipment_id}/vessel-status", response_model=Shipment)
async def set_vessel_status(shipment_id: str, payload: VesselStatusPayload):
    """vessel is 1-based across the full leg order: 1 = vessel_name, 2 = second_vessel_name,
    3+ = extra_vessels[vessel-3]. Leg 1's sob_date is always the shipment's canonical SOB date."""
    existing = await db.shipments.find_one({"id": shipment_id}, _proj())
    if not existing:
        raise HTTPException(status_code=404, detail="Shipment not found")
    if payload.vessel < 1:
        raise HTTPException(status_code=400, detail="vessel must be >= 1")
    iso = None
    if payload.sailed:
        iso = _to_iso_or_original(payload.date or "")
        if not iso:
            raise HTTPException(status_code=400, detail="date required when sailed=true")

    updates: dict = {}
    if payload.vessel == 1:
        updates["sob_date"] = iso
    elif payload.vessel == 2:
        updates["second_vessel_sob_date"] = iso
    else:
        extra = [dict(ev) for ev in (existing.get("extra_vessels") or [])]
        idx = payload.vessel - 3
        if idx < 0 or idx >= len(extra):
            raise HTTPException(status_code=400, detail="No such vessel leg")
        extra[idx]["sob_date"] = iso
        updates["extra_vessels"] = extra

    merged = {**existing, **updates}
    updates["comments"] = _regenerate_comment(merged)
    updates["status"] = _derive_status(merged)
    updates["updated_at"] = _now_iso()
    await db.shipments.update_one({"id": shipment_id}, {"$set": updates})
    doc = await db.shipments.find_one({"id": shipment_id}, _proj())
    return doc
@api_router.post("/shipments/{shipment_id}/append-comment", response_model=Shipment)
async def append_comment_deprecated(shipment_id: str):
    """Deprecated: comments are now auto-generated from state. Regenerate and return."""
    existing = await db.shipments.find_one({"id": shipment_id}, _proj())
    if not existing:
        raise HTTPException(status_code=404, detail="Shipment not found")
    comment = _regenerate_comment(existing)
    status = _derive_status(existing)
    await db.shipments.update_one({"id": shipment_id}, {"$set": {"comments": comment, "status": status, "updated_at": _now_iso()}})
    return await db.shipments.find_one({"id": shipment_id}, _proj())


def _fmt_dot_date(iso: str) -> str:
    """Convert YYYY-MM-DD to DD.MM."""
    try:
        d = date.fromisoformat(iso)
        return f"{d.day:02d}.{d.month:02d}."
    except Exception:
        return iso or ""


def _fmt_dot_full(iso: str) -> str:
    """Convert YYYY-MM-DD to DD.MM.YYYY."""
    try:
        d = date.fromisoformat(iso)
        return f"{d.day:02d}.{d.month:02d}.{d.year}"
    except Exception:
        return ""


def _to_iso_or_original(text: str) -> str:
    """Accept 'YYYY-MM-DD' or 'DD.MM.YYYY' or 'DD.MM.' — return YYYY-MM-DD if parseable else original."""
    text = (text or "").strip()
    try:
        return date.fromisoformat(text).isoformat()
    except Exception:
        pass
    for fmt in ("%d.%m.%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except Exception:
            continue
    return text


@api_router.patch("/shipments/{shipment_id}", response_model=Shipment)
async def update_shipment(shipment_id: str, payload: ShipmentUpdate):
    existing = await db.shipments.find_one({"id": shipment_id}, _proj())
    if not existing:
        raise HTTPException(status_code=404, detail="Shipment not found")
    updates = payload.model_dump(exclude_none=True)
    # planned_etd and etd_tba are mutually exclusive — setting one clears the other
    if updates.get("etd_tba"):
        updates["planned_etd"] = None
    elif updates.get("planned_etd"):
        updates["etd_tba"] = False
    if "anf_received" in updates and updates["anf_received"] and not existing.get("anf_received"):
        updates["anf_received_at"] = _now_iso()
    if "anf_received" in updates and not updates["anf_received"]:
        updates["anf_received_at"] = None

    # Detect vessel state transitions (only when a previous value existed — not on initial fill).
    # A vessel can be renamed or re-dated at any time, before or after it's sailed — the
    # shipping line changing schedules/vessels is routine, so editing is never blocked;
    # this just decides whether the next comment should call out a change or a delay.
    def _later(a, b):
        try:
            return date.fromisoformat(a) > date.fromisoformat(b)
        except Exception:
            return False

    def _delay_days(a, b):
        try:
            return (date.fromisoformat(a) - date.fromisoformat(b)).days
        except Exception:
            return None

    if "vessel_name" in updates and existing.get("vessel_name") and updates["vessel_name"] and updates["vessel_name"].strip() != (existing.get("vessel_name") or "").strip():
        updates["first_vessel_state"] = "changed"
        updates["first_vessel_delay_days"] = None
    elif "planned_etd" in updates and existing.get("planned_etd") and updates.get("planned_etd") and _later(updates["planned_etd"], existing["planned_etd"]):
        updates["first_vessel_state"] = "delayed"
        updates["first_vessel_delay_days"] = _delay_days(updates["planned_etd"], existing["planned_etd"])

    if "second_vessel_name" in updates and existing.get("second_vessel_name") and updates["second_vessel_name"] and updates["second_vessel_name"].strip() != (existing.get("second_vessel_name") or "").strip():
        updates["second_vessel_state"] = "changed"
        updates["second_vessel_delay_days"] = None
    elif "second_vessel_etd" in updates and existing.get("second_vessel_etd") and updates.get("second_vessel_etd") and _later(updates["second_vessel_etd"], existing["second_vessel_etd"]):
        updates["second_vessel_state"] = "delayed"
        updates["second_vessel_delay_days"] = _delay_days(updates["second_vessel_etd"], existing["second_vessel_etd"])

    if "extra_vessels" in updates:
        old_extra = existing.get("extra_vessels") or []
        new_extra = []
        for i, ev in enumerate(updates["extra_vessels"] or []):
            ev = dict(ev)
            old_ev = old_extra[i] if i < len(old_extra) else {}
            if old_ev.get("name") and ev.get("name") and ev["name"].strip() != (old_ev.get("name") or "").strip():
                ev["state"] = "changed"
                ev["delay_days"] = None
            elif old_ev.get("planned_etd") and ev.get("planned_etd") and _later(ev["planned_etd"], old_ev["planned_etd"]):
                ev["state"] = "delayed"
                ev["delay_days"] = _delay_days(ev["planned_etd"], old_ev["planned_etd"])
            elif "state" not in ev:
                ev["state"] = old_ev.get("state", "planned")
            new_extra.append(ev)
        updates["extra_vessels"] = new_extra

    # Auto-regenerate comment + status from state
    merged = {**existing, **updates}
    updates["comments"] = _regenerate_comment(merged)
    updates["status"] = _derive_status(merged)
    # On ANF-received transition, ensure the ANF phrase is present (survives comment regeneration)
    if updates.get("anf_received") and not existing.get("anf_received"):
        if "ANF received" not in (updates["comments"] or ""):
            base = (updates["comments"] or "").rstrip()
            sep = "" if not base else (" " if base.endswith(".") else ". ")
            updates["comments"] = f"{base}{sep}ANF received. Docs to Ops."
    updates["updated_at"] = _now_iso()
    await db.shipments.update_one({"id": shipment_id}, {"$set": updates})
    doc = await db.shipments.find_one({"id": shipment_id}, _proj())
    return doc


def _reminder_for_shipment(s: dict, today: date) -> Optional[dict]:
    """Return reminder metadata if this shipment needs cargo reporting soon.
    Once a reminder for a given target_date is acknowledged (cargo_report_ack_date
    matches it), it stays suppressed — unless the trigger date itself changes,
    which starts a new reporting cycle and surfaces it again."""
    if s.get("anf_received"):
        return None
    cargo = (s.get("cargo_type") or "FCL").upper()
    if cargo == "LCL":
        target_iso = s.get("eta") or s.get("planned_eta")
        if not target_iso:
            return None
        try:
            target = date.fromisoformat(target_iso)
        except Exception:
            return None
        days = (target - today).days
        if days > 10:
            return None
        kind = "LCL cargo report (10d before ETA)"
    else:
        # FCL: use second vessel if present, else primary
        if s.get("second_vessel_name") and s.get("second_vessel_etd"):
            target_iso = s["second_vessel_etd"]
            kind = f"Cargo report before 2nd vessel {s['second_vessel_name']}"
        else:
            target_iso = s.get("planned_etd")
            kind = "Cargo report before departure"
        if not target_iso:
            return None
        try:
            target = date.fromisoformat(target_iso)
        except Exception:
            return None
        days = (target - today).days
        if days > 2:
            return None
    if s.get("cargo_report_ack_date") == target_iso:
        return None
    return {"kind": kind, "target_date": target_iso, "days_left": days}


@api_router.get("/dashboard/reminders")
async def dashboard_reminders():
    today = date.today()
    docs = await db.shipments.find({"anf_received": {"$ne": True}}, _proj()).to_list(5000)
    client_lookup: dict[str, str] = {}
    async for c in db.clients.find({}, {"_id": 0, "id": 1, "name": 1}):
        client_lookup[c["id"]] = c["name"]
    reminders = []
    for s in docs:
        r = _reminder_for_shipment(s, today)
        if r:
            reminders.append({
                "shipment_id": s["id"],
                "client_id": s["client_id"],
                "client_name": client_lookup.get(s["client_id"], "—"),
                "file_number": s.get("file_number") or "",
                "supplier": s.get("supplier") or "",
                "vessel_name": s.get("second_vessel_name") or s.get("vessel_name") or "",
                "tracking_doc_number": s.get("tracking_doc_number") or "",
                "carrier": s.get("carrier") or "Other",
                "cargo_type": s.get("cargo_type") or "FCL",
                **r,
            })
    reminders.sort(key=lambda r: r["days_left"])
    return {"today": today.isoformat(), "reminders": reminders}


@api_router.post("/shipments/{shipment_id}/ack-cargo-report")
async def ack_cargo_report(shipment_id: str):
    existing = await db.shipments.find_one({"id": shipment_id}, _proj())
    if not existing:
        raise HTTPException(status_code=404, detail="Shipment not found")
    r = _reminder_for_shipment(existing, date.today())
    target = r["target_date"] if r else None
    await db.shipments.update_one({"id": shipment_id}, {"$set": {"cargo_report_ack_date": target, "updated_at": _now_iso()}})
    return {"ok": True}


@api_router.delete("/shipments/{shipment_id}")
async def delete_shipment(shipment_id: str):
    result = await db.shipments.delete_one({"id": shipment_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Shipment not found")
    return {"ok": True}


# ---------- Dashboard ----------
@api_router.get("/dashboard/stats")
async def dashboard_stats():
    total_clients = await db.clients.count_documents({})
    active_shipments = await db.shipments.count_documents({"anf_received": {"$ne": True}})
    anf_pending = active_shipments
    delayed = await db.shipments.count_documents({"anf_received": {"$ne": True}, "status": "Delayed"})
    shipped = await db.shipments.count_documents({"anf_received": {"$ne": True}, "status": "Shipped"})
    booked = await db.shipments.count_documents({"anf_received": {"$ne": True}, "status": "Booked"})

    carrier_counts: list[dict[str, Any]] = []
    pipeline = [
        {"$match": {"anf_received": {"$ne": True}}},
        {"$group": {"_id": "$carrier", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]
    async for row in db.shipments.aggregate(pipeline):
        carrier_counts.append({"carrier": row["_id"] or "Other", "count": row["count"]})

    # "Handled" = arrived at POD — counted off the single eta field, regardless of ANF status.
    today = date.today()
    week_start = today - timedelta(days=today.weekday())
    month_start = today.replace(day=1)
    year_start = today.replace(month=1, day=1)
    today_iso = today.isoformat()

    async def _arrived_count(start_iso: str) -> int:
        return await db.shipments.count_documents({"eta": {"$gte": start_iso, "$lte": today_iso}})

    arrived_week = await _arrived_count(week_start.isoformat())
    arrived_month = await _arrived_count(month_start.isoformat())
    arrived_year = await _arrived_count(year_start.isoformat())

    by_client_pipeline = [
        {"$match": {"eta": {"$gte": month_start.isoformat(), "$lte": today_iso}}},
        {"$group": {"_id": "$client_id", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]
    by_client_rows = await db.shipments.aggregate(by_client_pipeline).to_list(200)
    client_ids = [r["_id"] for r in by_client_rows if r["_id"]]
    client_docs = await db.clients.find({"id": {"$in": client_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(200)
    client_name_map = {c["id"]: c["name"] for c in client_docs}
    arrived_by_client_month = [
        {"client_id": r["_id"], "client_name": client_name_map.get(r["_id"], "Unknown"), "count": r["count"]}
        for r in by_client_rows if r["_id"]
    ]

    return {
        "total_clients": total_clients,
        "active_shipments": active_shipments,
        "anf_pending": anf_pending,
        "delayed": delayed,
        "shipped": shipped,
        "booked": booked,
        "carriers": carrier_counts,
        "arrived_week": arrived_week,
        "arrived_month": arrived_month,
        "arrived_year": arrived_year,
        "arrived_by_client_month": arrived_by_client_month,
    }


# ---------- Report Export Helpers ----------
STANDARD_COLUMNS = [
    ("supplier", "Supplier"),
    ("order_booking_file", "Order"),
    ("file_number", "Booking File"),
    ("status", "Shipped/Pending"),
    ("sob_date", "SOB DATE/RCG"),
    ("vessel_block", "Vessel"),
    ("pol", "POL"),
    ("eta", "DBN Port ETA"),
    ("final_destination", "Final Destination"),
    ("comments", "Comments"),
    ("copy_docs_status", "Copy Docs Status"),
    ("hbill_released", "H/bill Released by Supplier"),
    ("expected_freight_rate", "EXPECTED FREIGHT RATE per container"),
]

OPTIONAL_KEYS = {
    "sob_date": "sob_date",
    "pol": "pol",
    "final_destination": "final_destination",
    "hbill_released": "hbill_released",
    "expected_freight_rate": "expected_freight_rate",
    "copy_docs_status": "copy_docs_status",
}


def _columns_for_client(client: dict) -> list[tuple[str, str]]:
    optional = client.get("optional_columns") or DEFAULT_OPTIONAL_COLUMNS
    result: list[tuple[str, str]] = []
    for key, label in STANDARD_COLUMNS:
        if key in OPTIONAL_KEYS and not optional.get(OPTIONAL_KEYS[key], False):
            continue
        result.append((key, label))
    return result


def _cell_value(key: str, ship: dict) -> str:
    if key == "vessel_block":
        legs = _vessel_legs(ship)
        multi = len(legs) > 1
        parts = []
        for leg in legs:
            if leg["name"]:
                label = f" ({_ordinal(leg['index'])} Vessel)" if multi else ""
                parts.append(leg["name"] + label)
        doc = ship.get("tracking_doc_number") or ""
        if doc:
            parts.append(doc)
        return "\n".join(parts)
    if key == "eta":
        val = ship.get("eta")
        if val:
            iso = _to_iso_or_original(val)
            fmt = _fmt_dot_full(iso)
            return fmt or val
        pe = ship.get("planned_eta")
        if pe:
            return _fmt_dot_full(pe) or pe
        return ""
    if key == "sob_date":
        val = ship.get("sob_date")
        if val:
            iso = _to_iso_or_original(val)
            return _fmt_dot_full(iso) or val
        return ""
    if key == "hbill_released":
        value = ship.get("hbill_released")
        if value is None:
            return ""
        return "Yes" if value else "No"
    if key == "status":
        return ship.get("status") or ""
    val = ship.get(key)
    return "" if val is None else str(val)


async def _report_rows(client_id: str):
    client = await _get_client(client_id)
    shipments = await db.shipments.find(
        {"client_id": client_id, "anf_received": {"$ne": True}},
        _proj(),
    ).sort("created_at", 1).to_list(5000)
    for s in shipments:
        s["comments"] = _regenerate_comment(s)
        s["status"] = _derive_status(s)
    columns = _columns_for_client(client)
    rows = [{key: _cell_value(key, s) for key, _ in columns} for s in shipments]
    return client, columns, rows


@api_router.get("/reports/{client_id}/preview")
async def preview_report(client_id: str):
    client, columns, rows = await _report_rows(client_id)
    return {
        "client": {"id": client["id"], "name": client["name"], "company": client.get("company", "Patuma")},
        "date": datetime.now(timezone.utc).strftime("%d.%m.%Y"),
        "columns": [{"key": k, "label": l} for k, l in columns],
        "rows": rows,
    }


# Palette for the branded report (matches original spreadsheet)
_C_DEEP_BLUE = colors.HexColor("#0000CC")
_C_DEEP_HEADER = colors.HexColor("#0033CC")
_C_CYAN_TEXT = colors.HexColor("#33CCFF")
_C_LIGHT_BOX = colors.HexColor("#99CCFF")
_C_LIGHT_BOX_2 = colors.HexColor("#66CCFF")
_C_YELLOW = colors.HexColor("#FFFF00")
_C_GREY = colors.HexColor("#808080")


def _build_xlsx(client: dict, columns: list[tuple[str, str]], rows: list[dict]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Shipping Report"
    ws.sheet_view.showGridLines = False
    ws.page_setup.orientation = ws.ORIENTATION_LANDSCAPE

    company_key = client.get("company", "Patuma")
    co = COMPANIES.get(company_key, COMPANIES["Patuma"])
    ncols = len(columns)
    date_str = datetime.now(timezone.utc).strftime("%d.%m.%Y")

    thin = Side(style="thin", color="000000")
    medium = Side(style="medium", color="000000")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    header_border = Border(left=thin, right=thin, top=medium, bottom=medium)

    # Row 1: Logo image (bigger + horizontally centered across merged range)
    logo_path = co.get("logo")
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=ncols)
    ws.row_dimensions[1].height = 80

    # Column widths — matched to the reference report (Flange 2000 export)
    min_widths = {
        "supplier": 16.5, "order_booking_file": 17.8, "file_number": 9.5,
        "status": 14.2, "sob_date": 11.7, "vessel_block": 24.2,
        "pol": 12.5, "eta": 12.5, "final_destination": 12.7,
        "comments": 39.5, "copy_docs_status": 15.2,
        "hbill_released": 10, "expected_freight_rate": 18,
    }
    widths = [min_widths.get(key, 14) for key, _ in columns]

    if logo_path and os.path.exists(logo_path):
        try:
            from openpyxl.drawing.spreadsheet_drawing import OneCellAnchor, AnchorMarker
            from openpyxl.drawing.xdr import XDRPositiveSize2D
            from openpyxl.utils.units import pixels_to_EMU
            img = XLImage(logo_path)
            orig_w, orig_h = img.width, img.height
            aspect = orig_w / orig_h if orig_h else 10
            # Row 1 height set FIRST — logo fills top-to-bottom of that row
            row1_h_pt = 80
            row1_h_px = int(row1_h_pt * 96 / 72)  # ~107 px
            target_h_px = row1_h_px  # fill entire row height
            target_w_px = int(target_h_px * aspect)
            # Compute total range width in pixels
            total_px = sum(int(w * 7 + 5) for w in widths)
            # Cap width at 90% of table so it doesn't spill
            if target_w_px > total_px * 0.9:
                target_w_px = int(total_px * 0.9)
                target_h_px = int(target_w_px / aspect)
                row1_h_pt = max(60, int(target_h_px * 72 / 96) + 4)
            ws.row_dimensions[1].height = row1_h_pt
            offset_px = max(0, (total_px - target_w_px) // 2)
            anchor_col = 0
            running = 0
            col_off = 0
            for i, w in enumerate(widths):
                col_px = int(w * 7 + 5)
                if running + col_px > offset_px:
                    anchor_col = i
                    col_off = offset_px - running
                    break
                running += col_px
            img.anchor = OneCellAnchor(
                _from=AnchorMarker(col=anchor_col, colOff=pixels_to_EMU(col_off), row=0, rowOff=0),
                ext=XDRPositiveSize2D(cx=pixels_to_EMU(target_w_px), cy=pixels_to_EMU(target_h_px)),
            )
            ws.add_image(img)
        except Exception as exc:
            logger.warning("Failed to embed logo: %s", exc)
            fallback = ws.cell(row=1, column=1, value=f"{co['name']} {co['suffix']}")
            fallback.font = Font(bold=True, size=24, color="000000")
            fallback.alignment = Alignment(horizontal="center", vertical="center")
    else:
        cell = ws.cell(row=1, column=1, value=f"{co['name']} {co['suffix']}")
        cell.font = Font(bold=True, size=24, color="000000")
        cell.alignment = Alignment(horizontal="center", vertical="center")

    # Row 2: SHIPPING REPORT blue banner
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=ncols)
    cell = ws.cell(row=2, column=1, value="SHIPPING REPORT")
    cell.fill = PatternFill("solid", fgColor="0000D4")
    cell.font = Font(bold=True, size=16, color="00ABEA", name="Arial")
    cell.alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[2].height = 26

    # Row 3: Date + teal spacer + Client: + name
    client_label_col = max(2, ncols - 3)
    spacer_start = 2
    spacer_end = client_label_col - 1
    name_start = client_label_col + 1
    info_font = Font(bold=True, size=12, color="0000D4", name="Arial")

    ws.cell(row=3, column=1, value=date_str)
    ws.cell(row=3, column=1).fill = PatternFill("solid", fgColor="00ABEA")
    ws.cell(row=3, column=1).font = info_font
    ws.cell(row=3, column=1).alignment = Alignment(horizontal="center", vertical="center")

    if spacer_end >= spacer_start:
        ws.merge_cells(start_row=3, start_column=spacer_start, end_row=3, end_column=spacer_end)
        sc = ws.cell(row=3, column=spacer_start)
        sc.fill = PatternFill("solid", fgColor="00ABEA")

    ws.cell(row=3, column=client_label_col, value="Client:")
    ws.cell(row=3, column=client_label_col).fill = PatternFill("solid", fgColor="00ABEA")
    ws.cell(row=3, column=client_label_col).font = info_font
    ws.cell(row=3, column=client_label_col).alignment = Alignment(horizontal="center", vertical="center")

    if name_start <= ncols:
        ws.merge_cells(start_row=3, start_column=name_start, end_row=3, end_column=ncols)
        nc = ws.cell(row=3, column=name_start, value=client.get("name", ""))
        nc.fill = PatternFill("solid", fgColor="00ABEA")
        nc.font = info_font
        nc.alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[3].height = 24

    # Row 4: Table header — dark blue bg, cyan bold text (Copy Docs Status / Expected
    # Freight Rate get their own accent colors, matching the reference report)
    header_fill = PatternFill("solid", fgColor="0000D4")
    header_font = Font(bold=True, color="00ABEA", size=12, name="Arial")
    header_align = Alignment(horizontal="center", vertical="center", wrap_text=True)
    accent_header_style = {
        "copy_docs_status": (PatternFill("solid", fgColor="3B608D"), Font(bold=True, color="00ABEA", size=11, name="Arial")),
        "expected_freight_rate": (PatternFill("solid", fgColor="00B0F0"), Font(bold=False, color="000000", size=11, name="Arial")),
    }
    for col_index, (key, label) in enumerate(columns, start=1):
        c = ws.cell(row=4, column=col_index, value=label)
        fill, font = accent_header_style.get(key, (header_fill, header_font))
        c.fill = fill
        c.font = font
        c.alignment = header_align
        c.border = header_border
    ws.row_dimensions[4].height = 42

    # Data rows
    body_font = Font(color="000000", size=12, name="Arial")
    body_align = Alignment(vertical="center", wrap_text=True, horizontal="center")
    for row_index, row in enumerate(rows, start=5):
        max_lines = 1
        for col_index, (key, _) in enumerate(columns, start=1):
            value = row.get(key, "") or ""
            c = ws.cell(row=row_index, column=col_index, value=value)
            c.border = border
            c.font = body_font
            c.alignment = body_align
            if value:
                lines = value.splitlines()
                colw = widths[col_index - 1]
                wrapped = sum(max(1, -(-len(line) // max(colw - 2, 1))) for line in lines)
                max_lines = max(max_lines, wrapped)
        ws.row_dimensions[row_index].height = max(48, min(200, 20 * max_lines + 10))

    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = "A5"

    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def _build_pdf(client: dict, columns: list[tuple[str, str]], rows: list[dict]) -> bytes:
    page_width, page_height = landscape(A3)
    margin = 10 * mm
    available_width = page_width - (2 * margin)

    weights = [max(9, min(28, len(label) + 6)) for _, label in columns]
    col_widths = [available_width * w / sum(weights) for w in weights]

    styles = getSampleStyleSheet()
    company_style = ParagraphStyle(
        "Company", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=24,
        textColor=colors.black, alignment=1, spaceAfter=0, leading=26,
    )
    suffix_style = ParagraphStyle(
        "Suffix", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=14,
        textColor=colors.black, alignment=1, spaceAfter=0, leading=18,
    )
    tagline_style = ParagraphStyle(
        "Tagline", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=10,
        textColor=colors.black, alignment=1, leading=12, spaceAfter=4,
    )
    banner_style = ParagraphStyle(
        "Banner", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=16,
        textColor=_C_CYAN_TEXT, alignment=1, leading=20,
    )
    box_bold_style = ParagraphStyle(
        "BoxBold", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=11,
        textColor=colors.black, alignment=1, leading=14,
    )
    header_style = ParagraphStyle(
        "Header", parent=styles["Normal"], fontName="Helvetica-Bold",
        fontSize=9, leading=11, textColor=_C_CYAN_TEXT, alignment=1, underline=True,
    )
    body_style = ParagraphStyle(
        "Body", parent=styles["Normal"], fontName="Helvetica",
        fontSize=9, leading=11, textColor=colors.black, alignment=1, wordWrap="CJK",
    )
    body_left_style = ParagraphStyle(
        "BodyLeft", parent=body_style, alignment=TA_LEFT,
    )

    def para(text: str, style: ParagraphStyle) -> Paragraph:
        safe = escape(str(text or "")).replace("\n", "<br/>")
        return Paragraph(safe or " ", style)

    company_key = client.get("company", "Patuma")
    co = COMPANIES.get(company_key, COMPANIES["Patuma"])
    date_str = datetime.now(timezone.utc).strftime("%d.%m.%Y")
    ncols = len(columns)

    story: list = []

    # Row 1: Logo image (falls back to text if missing)
    logo_path = co.get("logo")
    if logo_path and os.path.exists(logo_path):
        try:
            from PIL import Image as PILImage
            pil = PILImage.open(logo_path)
            aspect = pil.width / pil.height if pil.height else 10
            target_w = 500
            target_h = target_w / aspect
            logo = RLImage(logo_path, width=target_w, height=target_h)
            logo.hAlign = "CENTER"
            story.append(logo)
            story.append(Spacer(1, 4))
        except Exception as exc:
            logger.warning("Logo embed failed: %s", exc)
            story.append(Paragraph(f"<b>{escape(co['name'])} {escape(co['suffix'])}</b>", company_style))
    else:
        story.append(Paragraph(f"<b>{escape(co['name'])} {escape(co['suffix'])}</b>", company_style))

    # Blue "SHIPPING REPORT" banner
    banner = LongTable(
        [[para("SHIPPING REPORT", banner_style)]],
        colWidths=[available_width],
    )
    banner.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), _C_DEEP_BLUE),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(banner)

    # Date + yellow + Client: + client name
    # 4 cells: [Date | yellow spacer | Client: | Client name]
    info_widths = [available_width * 0.12, available_width * 0.52, available_width * 0.10, available_width * 0.26]
    info = LongTable(
        [[
            para(date_str, box_bold_style),
            "",
            para("Client:", box_bold_style),
            para(client.get("name", ""), box_bold_style),
        ]],
        colWidths=info_widths,
    )
    info.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, 0), _C_LIGHT_BOX),
        ("BACKGROUND", (1, 0), (1, 0), _C_YELLOW),
        ("BACKGROUND", (2, 0), (2, 0), _C_LIGHT_BOX),
        ("BACKGROUND", (3, 0), (3, 0), _C_LIGHT_BOX_2),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(info)

    # Main data table — dark blue header row with cyan underlined bold text
    left_align_keys = {"order_booking_file", "comments", "vessel_block"}
    header_row = [para(label, header_style) for _, label in columns]
    table_data = [header_row]
    for row in rows:
        table_data.append([
            para(row.get(key, ""), body_left_style if key in left_align_keys else body_style)
            for key, _ in columns
        ])

    table = LongTable(table_data, colWidths=col_widths, repeatRows=1, splitByRow=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), _C_DEEP_HEADER),
        ("TEXTCOLOR", (0, 0), (-1, 0), _C_CYAN_TEXT),
        ("TEXTCOLOR", (0, 1), (-1, -1), colors.black),
        ("GRID", (0, 0), (-1, -1), 0.6, colors.black),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(table)

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=landscape(A3),
        leftMargin=margin, rightMargin=margin, topMargin=margin, bottomMargin=margin,
        title=f"Shipping Report - {client.get('name', '')}",
    )
    doc.build(story)
    return buffer.getvalue()


@api_router.get("/reports/{client_id}/xlsx")
async def export_xlsx(client_id: str):
    client, columns, rows = await _report_rows(client_id)
    content = _build_xlsx(client, columns, rows)
    filename = f"shipping-report-{client['name'].replace(' ', '_')}-{datetime.now(timezone.utc).strftime('%Y%m%d')}.xlsx"
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@api_router.get("/reports/{client_id}/pdf")
async def export_pdf(client_id: str):
    client, columns, rows = await _report_rows(client_id)
    content = _build_pdf(client, columns, rows)
    filename = f"shipping-report-{client['name'].replace(' ', '_')}-{datetime.now(timezone.utc).strftime('%Y%m%d')}.pdf"
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------- "Modern" client-facing status report (draft, for approval) ----------
# A simpler, plain-language alternative to the operational report above — fixed
# column set regardless of a client's report-column toggles (those were built for
# the internal/operational version), friendlier status wording, and a cleaner,
# more spacious visual design. Lives alongside the original so both can be
# compared before deciding whether to replace it.

_CLIENT_STATUS_LABELS = {"Planned": "Preparing", "Booked": "Booked", "Shipped": "On the Water"}

_MODERN_BRAND = "2E63C8"
_MODERN_LIGHT_BAND = "EEF2F7"
_MODERN_TEXT = "101828"
_MODERN_MUTED = "5B6B7D"
_MODERN_BORDER = "D9DEE5"
_MODERN_STATUS_FILL = {"Preparing": "E2E8F0", "Booked": "FEF3C7", "On the Water": "D1FAE5"}
_MODERN_STATUS_TEXT = {"Preparing": "475569", "Booked": "92400E", "On the Water": "065F46"}


def _modern_departure_text(s: dict) -> str:
    if s.get("sob_date"):
        iso = _to_iso_or_original(s["sob_date"])
        return f"Sailed {_fmt_dot_full(iso) or s['sob_date']}"
    if s.get("etd_tba"):
        return "Date TBA"
    if s.get("planned_etd"):
        return f"Expected {_fmt_dot_full(s['planned_etd']) or s['planned_etd']}"
    return "TBA"


async def _modern_report_rows(client_id: str):
    client = await _get_client(client_id)
    shipments = await db.shipments.find(
        {"client_id": client_id, "anf_received": {"$ne": True}}, _proj(),
    ).sort("created_at", 1).to_list(5000)
    rows = []
    for s in shipments:
        s["comments"] = _regenerate_comment(s)
        s["status"] = _derive_status(s)
        rows.append({
            "supplier": s.get("supplier") or "",
            "reference": s.get("file_number") or "",
            "vessel": _cell_value("vessel_block", s),
            "status": _CLIENT_STATUS_LABELS.get(s.get("status"), s.get("status") or "Preparing"),
            "departure": _modern_departure_text(s),
            "arrival": _cell_value("eta", s) or "TBA",
            "destination": s.get("final_destination") or s.get("pod") or "—",
            "notes": s.get("comments") or "",
        })
    return client, rows


def _build_xlsx_modern(client: dict, rows: list[dict]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Status Report"
    ws.sheet_view.showGridLines = False
    ws.page_setup.orientation = ws.ORIENTATION_PORTRAIT

    company_key = client.get("company", "Patuma")
    co = COMPANIES.get(company_key, COMPANIES["Patuma"])
    date_str = datetime.now(timezone.utc).strftime("%d %B %Y")
    headers = ["Supplier", "Reference", "Vessel", "Status", "Departure", "Expected Arrival", "Destination", "Notes"]
    widths = [18, 14, 26, 14, 18, 18, 16, 44]
    ncols = len(headers)

    logo_path = co.get("logo")
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=ncols)
    ws.row_dimensions[1].height = 54
    if logo_path and os.path.exists(logo_path):
        try:
            img = XLImage(logo_path)
            aspect = img.width / img.height if img.height else 4
            target_h_px = 64
            img.height = target_h_px
            img.width = int(target_h_px * aspect)
            ws.add_image(img, "A1")
        except Exception as exc:
            logger.warning("Modern xlsx logo embed failed: %s", exc)

    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=ncols)
    title_cell = ws.cell(row=2, column=1, value="Shipment Status Report")
    title_cell.font = Font(bold=True, size=18, color=_MODERN_TEXT, name="Arial")
    title_cell.alignment = Alignment(horizontal="left", vertical="center")
    ws.row_dimensions[2].height = 28

    ws.merge_cells(start_row=3, start_column=1, end_row=3, end_column=ncols)
    sub_cell = ws.cell(row=3, column=1, value=f"Prepared for {client.get('name', '')}  ·  {date_str}")
    sub_cell.font = Font(size=11, color=_MODERN_MUTED, name="Arial")
    sub_cell.alignment = Alignment(horizontal="left", vertical="center")
    ws.row_dimensions[3].height = 20
    ws.row_dimensions[4].height = 8

    header_row_idx = 5
    thin = Side(style="thin", color=_MODERN_BORDER)
    for i, h in enumerate(headers, start=1):
        c = ws.cell(row=header_row_idx, column=i, value=h)
        c.font = Font(bold=True, size=11, color="FFFFFF", name="Arial")
        c.fill = PatternFill("solid", fgColor=_MODERN_BRAND)
        c.alignment = Alignment(horizontal="left", vertical="center")
        c.border = Border(top=thin, bottom=thin)
    ws.row_dimensions[header_row_idx].height = 26

    for offset, row in enumerate(rows, start=1):
        row_index = header_row_idx + offset
        band = PatternFill("solid", fgColor="FFFFFF" if offset % 2 else _MODERN_LIGHT_BAND)
        values = [row["supplier"], row["reference"], row["vessel"], row["status"], row["departure"], row["arrival"], row["destination"], row["notes"]]
        max_lines = 1
        for col_index, val in enumerate(values, start=1):
            c = ws.cell(row=row_index, column=col_index, value=val)
            c.font = Font(size=10.5, color=_MODERN_TEXT, name="Arial")
            c.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
            c.border = Border(bottom=thin)
            c.fill = band
            if col_index == 4:
                c.fill = PatternFill("solid", fgColor=_MODERN_STATUS_FILL.get(row["status"], "FFFFFF"))
                c.font = Font(size=10.5, bold=True, color=_MODERN_STATUS_TEXT.get(row["status"], _MODERN_TEXT), name="Arial")
                c.alignment = Alignment(horizontal="center", vertical="center")
            if val:
                colw = widths[col_index - 1]
                lines = str(val).splitlines()
                wrapped = sum(max(1, -(-len(line) // max(colw - 2, 1))) for line in lines)
                max_lines = max(max_lines, wrapped)
        ws.row_dimensions[row_index].height = max(22, min(90, 15 * max_lines + 6))

    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = f"A{header_row_idx + 1}"

    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def _build_pdf_modern(client: dict, rows: list[dict]) -> bytes:
    page_width, page_height = A4
    margin = 18 * mm
    available_width = page_width - 2 * margin

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("MTitle", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=20, textColor=colors.HexColor("#101828"), alignment=0, spaceAfter=2)
    sub_style = ParagraphStyle("MSub", parent=styles["Normal"], fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#5B6B7D"), alignment=0, spaceAfter=14)
    intro_style = ParagraphStyle("MIntro", parent=styles["Normal"], fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#344054"), alignment=0, leading=15, spaceAfter=16)
    header_style = ParagraphStyle("MHeader", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=9, textColor=colors.white, alignment=0, leading=11)
    body_style = ParagraphStyle("MBody", parent=styles["Normal"], fontName="Helvetica", fontSize=9, textColor=colors.HexColor("#101828"), alignment=0, leading=12, wordWrap="CJK")

    def para(text, style):
        safe = escape(str(text or "")).replace("\n", "<br/>")
        return Paragraph(safe or " ", style)

    story: list = []
    company_key = client.get("company", "Patuma")
    co = COMPANIES.get(company_key, COMPANIES["Patuma"])
    logo_path = co.get("logo")
    if logo_path and os.path.exists(logo_path):
        try:
            from PIL import Image as PILImage
            pil = PILImage.open(logo_path)
            aspect = pil.width / pil.height if pil.height else 4
            target_h = 34
            logo = RLImage(logo_path, width=target_h * aspect, height=target_h)
            logo.hAlign = "LEFT"
            story.append(logo)
            story.append(Spacer(1, 10))
        except Exception as exc:
            logger.warning("Modern PDF logo embed failed: %s", exc)

    story.append(Paragraph("Shipment Status Report", title_style))
    date_str = datetime.now(timezone.utc).strftime("%d %B %Y")
    story.append(Paragraph(f"Prepared for {escape(client.get('name', ''))} &middot; {date_str}", sub_style))

    n = len(rows)
    plural = "shipment" if n == 1 else "shipments"
    story.append(Paragraph(f"Here's the latest update on your {n} active {plural}.", intro_style))

    headers = ["Supplier", "Reference", "Vessel", "Status", "Departure", "Arrival", "Destination", "Notes"]
    weights = [11, 9, 16, 10, 12, 12, 12, 24]
    col_widths = [available_width * w / sum(weights) for w in weights]

    table_data = [[para(h, header_style) for h in headers]]
    for row in rows:
        table_data.append([
            para(row["supplier"], body_style), para(row["reference"], body_style), para(row["vessel"], body_style),
            para(row["status"], body_style), para(row["departure"], body_style), para(row["arrival"], body_style),
            para(row["destination"], body_style), para(row["notes"], body_style),
        ])

    table = LongTable(table_data, colWidths=col_widths, repeatRows=1, splitByRow=1)
    style_cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(f"#{_MODERN_BRAND}")),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor(f"#{_MODERN_BORDER}")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]
    for i in range(1, len(table_data)):
        if i % 2 == 0:
            style_cmds.append(("BACKGROUND", (0, i), (-1, i), colors.HexColor(f"#{_MODERN_LIGHT_BAND}")))
    for i, row in enumerate(rows, start=1):
        fill = _MODERN_STATUS_FILL.get(row["status"])
        if fill:
            style_cmds.append(("BACKGROUND", (3, i), (3, i), colors.HexColor(f"#{fill}")))
    table.setStyle(TableStyle(style_cmds))
    story.append(table)

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        leftMargin=margin, rightMargin=margin, topMargin=margin, bottomMargin=margin,
        title=f"Status Report - {client.get('name', '')}",
    )
    doc.build(story)
    return buffer.getvalue()


@api_router.get("/reports/{client_id}/xlsx-modern")
async def export_xlsx_modern(client_id: str):
    client, rows = await _modern_report_rows(client_id)
    content = _build_xlsx_modern(client, rows)
    filename = f"status-report-{client['name'].replace(' ', '_')}-{datetime.now(timezone.utc).strftime('%Y%m%d')}.xlsx"
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@api_router.get("/reports/{client_id}/pdf-modern")
async def export_pdf_modern(client_id: str):
    client, rows = await _modern_report_rows(client_id)
    content = _build_pdf_modern(client, rows)
    filename = f"status-report-{client['name'].replace(' ', '_')}-{datetime.now(timezone.utc).strftime('%Y%m%d')}.pdf"
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@api_router.get("/")
async def root():
    return {"service": "ocean-freight-tracker", "status": "ok"}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    mongo_client.close()
