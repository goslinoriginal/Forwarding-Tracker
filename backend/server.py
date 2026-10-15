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
from openpyxl.cell.rich_text import CellRichText, TextBlock
from openpyxl.cell.text import InlineFont
from openpyxl.drawing.image import Image as XLImage
from openpyxl.drawing.spreadsheet_drawing import AnchorMarker, OneCellAnchor
from openpyxl.drawing.xdr import XDRPositiveSize2D
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.utils.units import pixels_to_EMU
from openpyxl.worksheet.datavalidation import DataValidation
from pydantic import BaseModel, ConfigDict, Field
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A3, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth
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
    pin_order: Optional[int] = None  # position among pinned clients (lower = higher up)
    flagged: bool = False  # priority client — surfaced on the dashboard
    # Group clients (e.g. Mushrooms, Handovers) bundle several end clients in one report
    # with their own column layout; "internal" ones aren't emailed to anyone directly.
    report_layout: str = "standard"  # standard | mushrooms | handovers
    internal: bool = False
    handover_parties: dict = Field(default_factory=dict)  # end client -> clearing agent
    email_to: Optional[str] = None  # recipient(s) for the status-report email draft, comma-separated
    email_cc: Optional[str] = None  # cc'd address(es), comma-separated
    email_greeting: Optional[str] = None  # e.g. "Roland and Jessica" for "Dear ..."
    email_subject: Optional[str] = None  # custom status-report subject; blank uses the default
    email_body: Optional[str] = None  # custom status-report message; blank uses the default
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
    email_subject: Optional[str] = None
    email_body: Optional[str] = None
    optional_columns: Optional[dict] = None


class ClientUpdate(BaseModel):
    name: Optional[str] = None
    company: Optional[str] = None
    contact_email: Optional[str] = None
    notes: Optional[str] = None
    default_pod: Optional[str] = None
    pinned: Optional[bool] = None
    flagged: Optional[bool] = None
    internal: Optional[bool] = None
    handover_parties: Optional[dict] = None
    email_to: Optional[str] = None
    email_cc: Optional[str] = None
    email_greeting: Optional[str] = None
    email_subject: Optional[str] = None
    email_body: Optional[str] = None
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
    comment_note: str = ""  # typed by ops; appended after the auto-generated status comment
    comment_lead: str = ""  # wording that comes before the automatic comment, e.g. "BVB/Country."
    end_client: Optional[str] = None  # group reports: who the shipment is for
    handover_party: Optional[str] = None
    fcl_count: Optional[str] = None
    obill_refs: Optional[str] = None  # containers / references listed after the O/Bill
    doc_draft_bills: Optional[str] = None  # YYYY-MM-DD document-received dates
    doc_copy_invoices: Optional[str] = None
    doc_original_invoices: Optional[str] = None
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
    comment_note: str = ""
    comment_lead: str = ""  # wording that comes before the automatic comment, e.g. "BVB/Country."
    end_client: Optional[str] = None  # group reports: who the shipment is for
    handover_party: Optional[str] = None
    fcl_count: Optional[str] = None
    obill_refs: Optional[str] = None  # containers / references listed after the O/Bill
    doc_draft_bills: Optional[str] = None  # YYYY-MM-DD document-received dates
    doc_copy_invoices: Optional[str] = None
    doc_original_invoices: Optional[str] = None
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
    comment_note: Optional[str] = None
    comment_lead: Optional[str] = None
    end_client: Optional[str] = None
    handover_party: Optional[str] = None
    fcl_count: Optional[str] = None
    obill_refs: Optional[str] = None
    doc_draft_bills: Optional[str] = None
    doc_copy_invoices: Optional[str] = None
    doc_original_invoices: Optional[str] = None
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
    optional_columns.update((await _get_settings()).get("default_columns") or {})
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
    for field in ["name", "contact_email", "notes", "default_pod", "email_to", "email_cc", "email_greeting", "email_subject", "email_body"]:
        value = getattr(payload, field)
        if value is not None:
            updates[field] = value
    if payload.company is not None and payload.company in COMPANIES:
        updates["company"] = payload.company
    if payload.pinned is not None:
        updates["pinned"] = payload.pinned
        if payload.pinned and not existing.get("pinned"):
            # Newly pinned clients go to the bottom of the pinned list
            last = await db.clients.find({"pinned": True}, {"_id": 0, "pin_order": 1}).to_list(1000)
            updates["pin_order"] = max([c.get("pin_order") or 0 for c in last] + [0]) + 1
        elif not payload.pinned:
            updates["pin_order"] = None
    if payload.flagged is not None:
        updates["flagged"] = payload.flagged
    if payload.internal is not None:
        updates["internal"] = payload.internal
    if payload.handover_parties is not None:
        updates["handover_parties"] = {k.strip(): (v or "").strip() for k, v in payload.handover_parties.items() if k.strip()}
    if payload.optional_columns is not None:
        merged = dict(existing.get("optional_columns") or DEFAULT_OPTIONAL_COLUMNS)
        for k, v in payload.optional_columns.items():
            if k in DEFAULT_OPTIONAL_COLUMNS:
                merged[k] = bool(v)
        updates["optional_columns"] = merged
    if updates:
        await db.clients.update_one({"id": client_id}, {"$set": updates})
    return await _get_client(client_id)


class PinOrderPayload(BaseModel):
    ids: List[str]


@api_router.post("/clients/pin-order")
async def set_pin_order(payload: PinOrderPayload):
    """Reorder the pinned clients — ids in their new top-to-bottom order."""
    for i, cid in enumerate(payload.ids):
        await db.clients.update_one({"id": cid}, {"$set": {"pin_order": i + 1}})
    return {"ok": True}


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
      - Multiple legs:  '{today} - SOB X (1st Vessel). Planned ETD Y (2nd Vessel). Awaiting confirmation of departure of 2nd Vessel.'
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
    lead = (ship.get("comment_lead") or "").strip()
    if lead:
        parts.append(lead)
    all_sailed = True

    for leg in legs:
        # Transhipments name the leg after each date, e.g. "SOB 13.10 (1st Vessel)."
        tag = f" ({_ordinal(leg['index'])} Vessel)" if multi else ""
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
            parts.append(f"SOB {_plain_dd_mm(leg['sob_date'])}{tag}.")
        elif leg["index"] == 1 and (leg.get("etd_tba") or etd_overdue):
            # A lapsed ETD never gets shown as-is — the client should never see a date
            # that's already in the past. Falls back to TBA until a new date is set.
            parts.append(f"ETD TBA{tag}.")
        elif leg.get("planned_etd"):
            etd_txt = _plain_dd_mm(leg["planned_etd"])
            # "Vessel delayed, slightly." — or "2nd Vessel delayed, slightly." on a transhipment
            who = f"{_ordinal(leg['index'])} Vessel" if multi else "Vessel"
            if leg["state"] == "delayed":
                slightly = ", slightly" if (leg.get("delay_days") or 0) <= 5 else ""
                parts.append(f"{who} delayed{slightly}. Now planned ETD {etd_txt}{tag}.")
            elif leg["state"] == "changed":
                parts.append(f"{who} changed by S/Line. Now planned ETD {etd_txt}{tag}.")
            else:
                parts.append(f"Planned ETD {etd_txt}{tag}.")

    # Awaiting clause — skipped when ops wrote their own "Awaiting ..." note. Once the
    # shipment is closed off it reads "ANF received" (FCL) / "SOB's received" (LCL) instead.
    is_lcl = (ship.get("cargo_type") or "FCL").upper() == "LCL"
    own_awaiting = bool(re.search(r"(^|\.\s*)awaiting\b", f"{lead} {ship.get('comment_note') or ''}".strip(), re.I))
    note_text = (ship.get("comment_note") or "").lower()
    if ship.get("anf_received"):
        if "received" not in note_text:
            parts.append("SOB's received. Docs to Ops." if is_lcl else "ANF received. Docs to Ops.")
    elif own_awaiting:
        pass
    elif all_sailed:
        parts.append("Awaiting SOB's." if is_lcl else "Awaiting ANF.")
    elif legs[0]["sob_date"] and multi:
        waiting = next((l for l in legs if not l["sob_date"]), legs[-1])
        parts.append(f"Awaiting confirmation of departure of {_ordinal(waiting['index'])} Vessel.")
    else:
        parts.append("Awaiting confirmation of departure.")

    note = (ship.get("comment_note") or "").strip()
    if note:
        parts.append(note)

    body = re.sub(r"\.{2,}", ".", " ".join(p for p in parts if p))
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
    updates["updated_at"] = _now_iso()
    await db.shipments.update_one({"id": shipment_id}, {"$set": updates})
    doc = await db.shipments.find_one({"id": shipment_id}, _proj())
    return doc


def _easter(y: int) -> date:
    a, b, c = y % 19, y // 100, y % 100
    d, e = b // 4, b % 4
    g = (8 * b + 13) // 25
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 19 * l) // 433
    month = (h + l - 7 * m + 90) // 25
    return date(y, month, (h + l - 7 * m + 33 * month + 19) % 32)


_HOLIDAY_CACHE: dict = {}


def _sa_holidays(y: int) -> dict:
    """South African public holidays for a year; one on a Sunday moves the day off to the Monday."""
    if y not in _HOLIDAY_CACHE:
        fixed = {(1, 1): "New Year's Day", (3, 21): "Human Rights Day", (4, 27): "Freedom Day", (5, 1): "Workers' Day",
                 (6, 16): "Youth Day", (8, 9): "National Women's Day", (9, 24): "Heritage Day",
                 (12, 16): "Day of Reconciliation", (12, 25): "Christmas Day", (12, 26): "Day of Goodwill"}
        out = {}
        for (m, d), name in fixed.items():
            day = date(y, m, d)
            out[day] = name
            if day.weekday() == 6:
                out[day + timedelta(days=1)] = f"{name} (observed)"
        e = _easter(y)
        out[e - timedelta(days=2)] = "Good Friday"
        out[e + timedelta(days=1)] = "Family Day"
        _HOLIDAY_CACHE[y] = out
    return _HOLIDAY_CACHE[y]


def _is_workday(d: date) -> bool:
    return d.weekday() < 5 and d not in _sa_holidays(d.year)


def _workday_on_or_before(d: date) -> date:
    """We don't work weekends or public holidays: those fall back to the working day before."""
    while not _is_workday(d):
        d -= timedelta(days=1)
    return d


def _prev_workday(d: date) -> date:
    return _workday_on_or_before(d - timedelta(days=1))


def _workdays_until(today: date, due: date) -> int:
    """Working days from today to the due date; negative once it has passed."""
    step = 1 if due >= today else -1
    n, d = 0, today
    while d != due:
        d += timedelta(days=step)
        if _is_workday(d):
            n += step
    if due < today and n == 0:
        n = -1  # e.g. due Friday, looked at on the weekend
    return n


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
        report_by = _workday_on_or_before(target - timedelta(days=10))
        kind = "LCL cargo report (10d before ETA)"
    else:
        # FCL: use second vessel if present, else primary. Once that vessel has
        # sailed the cargo has left, so there is nothing left to report.
        if s.get("second_vessel_name") and s.get("second_vessel_etd"):
            if s.get("second_vessel_sob_date"):
                return None
            target_iso = s["second_vessel_etd"]
            kind = f"Cargo report before 2nd vessel {s['second_vessel_name']}"
        else:
            if s.get("sob_date"):
                return None
            target_iso = s.get("planned_etd")
            kind = "Cargo report before departure"
        if not target_iso:
            return None
        try:
            target = date.fromisoformat(target_iso)
        except Exception:
            return None
        report_by = _workday_on_or_before(target - timedelta(days=2))
    # Show from one working day before it's due, as a heads-up
    if today < _prev_workday(report_by):
        return None
    if s.get("cargo_report_ack_date") == target_iso:
        return None
    return {"kind": kind, "target_date": target_iso, "report_by": report_by.isoformat(), "days_left": _workdays_until(today, report_by)}


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


@api_router.post("/shipments/{shipment_id}/unack-cargo-report")
async def unack_cargo_report(shipment_id: str):
    result = await db.shipments.update_one({"id": shipment_id}, {"$set": {"cargo_report_ack_date": None}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Shipment not found")
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


# Group reports keep the exact columns of their original spreadsheets
LAYOUT_COLUMNS = {
    "mushrooms": [
        ("file_number", "File No."), ("sob_date", "SOB Date"), ("obill", "O/Bill"), ("fcl_count", "No. of FCLs"),
        ("vessel_block", "Vessel"), ("eta", "ETA Durban"), ("doc_draft_bills", "Draft/Copy Bills Received"),
        ("doc_copy_invoices", "Copy Invoices & Phyto's Received"),
        ("doc_original_invoices", "Original Invoices & Phyto's Received"), ("comments", "Comments"),
    ],
    "handovers": [
        ("end_client", "Client"), ("order_booking_file", "Order"), ("file_number", "Booking File"),
        ("status", "Shipped Pending"), ("vessel_block", "Vessel"), ("eta", "Planned ETA"),
        ("final_destination", "Final Destination"), ("comments", "Comments"), ("days_to_arrival", "Days till arrival"),
    ],
}


def _columns_for_client(client: dict) -> list[tuple[str, str]]:
    if client.get("report_layout") in LAYOUT_COLUMNS:
        return list(LAYOUT_COLUMNS[client["report_layout"]])
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
        if doc and not ship.get("_doc_in_obill"):
            parts.append(doc)
        return "\n".join(parts)
    if key == "obill":
        return ", ".join(x for x in [ship.get("tracking_doc_number"), ship.get("obill_refs")] if x)
    if key in ("doc_draft_bills", "doc_copy_invoices", "doc_original_invoices"):
        val = ship.get(key)
        return (_fmt_dot_full(_to_iso_or_original(val)) or val) if val else ""
    if key == "days_to_arrival":
        target = ship.get("eta") or ship.get("planned_eta")
        try:
            return str((date.fromisoformat(target) - date.today()).days)
        except Exception:
            return ""
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


async def _active_shipments_for_report(client: dict, end_client: Optional[str] = None) -> tuple[dict, list[dict]]:
    """Active shipments for a report. With end_client (group reports split per client)
    only that client's shipments are included and the report is headed with their name."""
    query: dict[str, Any] = {"client_id": client["id"], "anf_received": {"$ne": True}}
    if end_client:
        query["end_client"] = end_client
        client = {**client, "name": end_client}
    shipments = await db.shipments.find(query, _proj()).sort("created_at", 1).to_list(5000)
    in_obill = any(k == "obill" for k, _ in _columns_for_client(client))
    for s in shipments:
        s["_doc_in_obill"] = in_obill
    return client, shipments


async def _report_rows(client_id: str, end_client: Optional[str] = None):
    client, shipments = await _active_shipments_for_report(await _get_client(client_id), end_client)
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


_XL_CHAR = 1.22  # one Arial-12 character in Excel column-width units
_XL_SCREEN_WIDTH = 200  # column widths that fill a full-HD screen at 100% zoom


def _xl_wrapped_lines(text: str, width: float) -> int:
    """How many lines Excel needs for this text in a column of this width."""
    cap = max(1.0, (width - 1.5) / _XL_CHAR)
    total = 0
    for line in str(text).splitlines() or [""]:
        n, cur = 1, 0
        for word in line.split():
            if cur and cur + 1 + len(word) > cap:
                n, cur = n + 1, len(word)
            else:
                cur += (1 if cur else 0) + len(word)
        total += n
    return total


def _build_xlsx(client: dict, columns: list[tuple[str, str]], rows: list[dict]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Shipping Report"
    ws.sheet_view.showGridLines = False
    ws.page_setup.orientation = ws.ORIENTATION_LANDSCAPE
    # Print every column on one page width
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0

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
        "pol": 12.5, "eta": 12.5, "final_destination": 14.5,
        "comments": 39.5, "copy_docs_status": 15.2,
        "hbill_released": 10, "expected_freight_rate": 18,
        # Group layouts (Mushrooms, Handovers)
        "obill": 30, "fcl_count": 9.5, "end_client": 16.5, "days_to_arrival": 10,
        "doc_draft_bills": 13, "doc_copy_invoices": 13, "doc_original_invoices": 13,
    }
    widths = [min_widths.get(key, 14) for key, _ in columns]
    widths[0] = max(widths[0], 12.5)  # the report date sits in the first column

    # Wide enough that no word or date breaks (Arial 12 runs wider than Excel's width
    # unit), then the rest of a full screen is shared out — most of it to Comments.
    def _longest_word(text) -> int:
        return max((len(w) for w in str(text or "").split()), default=0)
    for i, (key, label) in enumerate(columns):
        need = max([_longest_word(label) * 1.12] + [_longest_word(r.get(key, "")) for r in rows]) * _XL_CHAR + 2.5
        widths[i] = round(max(widths[i], need), 1)
    if sum(widths) < _XL_SCREEN_WIDTH:
        extra = _XL_SCREEN_WIDTH - sum(widths)
        ci = next((i for i, (k, _) in enumerate(columns) if k == "comments"), None)
        if ci is not None:
            widths[ci] += extra * 0.4
            extra *= 0.6
        others = [i for i in range(len(widths)) if i != ci]
        base = sum(widths[i] for i in others) or 1
        for i in others:
            widths[i] += extra * widths[i] / base
        widths = [round(w, 1) for w in widths]

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
    # The Patuma header picture already carries the "SHIPPING REPORT" bar, so under it
    # this row is just the blue band (as on the original reports)
    cell = ws.cell(row=2, column=1, value=None if company_key == "Patuma" else "SHIPPING REPORT")
    cell.fill = PatternFill("solid", fgColor="0000D4")
    cell.font = Font(bold=True, size=16, color="00ABEA", name="Arial")
    cell.alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[2].height = 12 if company_key == "Patuma" else 26

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
    # Tall enough for the longest heading once it wraps (e.g. "Original Invoices & Phyto's Received")
    ws.row_dimensions[4].height = max(42, 16 * max(_xl_wrapped_lines(label, w / 1.12) for (_, label), w in zip(columns, widths)) + 8)

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
                max_lines = max(max_lines, _xl_wrapped_lines(value, widths[col_index - 1]))
        ws.row_dimensions[row_index].height = max(48, min(400, 16 * max_lines + 14))

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


def _safe_name(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("_") or "client"


@api_router.get("/reports/{client_id}/end-clients")
async def report_end_clients(client_id: str):
    """End clients with active shipments — the per-client split of a group report."""
    await _get_client(client_id)
    names = await db.shipments.distinct("end_client", {"client_id": client_id, "anf_received": {"$ne": True}})
    return {"end_clients": sorted(n for n in names if n)}


@api_router.get("/reports/{client_id}/xlsx")
async def export_xlsx(client_id: str, end_client: Optional[str] = None):
    client, columns, rows = await _report_rows(client_id, end_client)
    content = _build_xlsx(client, columns, rows)
    filename = f"shipping-report-{_safe_name(client['name'])}-{datetime.now(timezone.utc).strftime('%Y%m%d')}.xlsx"
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@api_router.get("/reports/{client_id}/pdf")
async def export_pdf(client_id: str, end_client: Optional[str] = None):
    client, columns, rows = await _report_rows(client_id, end_client)
    content = _build_pdf(client, columns, rows)
    filename = f"shipping-report-{_safe_name(client['name'])}-{datetime.now(timezone.utc).strftime('%Y%m%d')}.pdf"
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------- "New" client-facing status report (blue #0077b6 design) ----------
# The approved "Status Report Template v2" design. Uses the same columns as the
# operational report above — so it follows each client's report-column toggles —
# restyled in the soft blue theme. The Excel mirrors the hand-tuned
# Status Report Template.xlsx; the PDF draws the same layout on A3 landscape.

_SR_ACCENT_100 = "E8F3FB"
_SR_ACCENT_200 = "C8E2F4"
_SR_ACCENT_300 = "9CCBEC"
_SR_ACCENT_400 = "2F8FCB"
_SR_ACCENT_500 = "0077B6"
_SR_ACCENT_600 = "00659B"
_SR_ACCENT_700 = "00527E"
_SR_ACCENT_800 = "003F61"
_SR_ACCENT_900 = "002B43"
_SR_TEXT = "1D1F20"
_SR_MUTED = "5D5D60"
_SR_DOCS_TEXT = "7A7A7D"
_SR_BORDER = "C4C4C8"
_SR_ZEBRA = "F9FCFE"
_SR_PANEL = "F3F9FD"  # tint behind the docs / H-bill / freight-rate columns

# key -> (header label, Excel width in characters, PDF width in design px)
_SR_COLUMNS = {
    "supplier": ("Supplier", 21, 120),
    "order_booking_file": ("Order", 29, 170),
    "file_number": ("Booking File", 13, 84),
    "status": ("Shipped / Pending", 14, 108),
    "sob_date": ("SOB Date / RCG", 15, 92),
    "vessel_block": ("Vessel", 29, 170),
    "pol": ("POL", 15, 92),
    "eta": ("DBN Port ETA", 15, 92),
    "final_destination": ("Final Destination", 16, 114),
    "comments": ("Comments", 48, 240),
    "copy_docs_status": ("Copy Docs Status", 13, 96),
    "hbill_released": ("H/bill Released", 13, 96),
    "expected_freight_rate": ("Freight Rate / Ctr", 16, 100),
    # group-report columns
    "obill": ("O/Bill", 30, 210),
    "fcl_count": ("No. of FCLs", 10, 70),
    "doc_draft_bills": ("Draft/Copy Bills Received", 14, 112),
    "doc_copy_invoices": ("Copy Invoices & Phyto's Received", 15, 112),
    "doc_original_invoices": ("Original Invoices & Phyto's Received", 15, 112),
    "end_client": ("Client", 21, 120),
    "days_to_arrival": ("Days till arrival", 11, 80),
}
_SR_PANEL_KEYS = {"copy_docs_status", "hbill_released", "expected_freight_rate"}
_SR_STATUS_OPTIONS = ["Shipped", "Booked", "Pending", "Planned"]
# status -> (fill, text, outline); Planned gets a dashed outline in the PDF
_SR_STATUS = {
    "Shipped": (_SR_ACCENT_200, _SR_ACCENT_900, _SR_ACCENT_300),
    "Booked": (_SR_ACCENT_100, _SR_ACCENT_800, _SR_ACCENT_300),
    "Pending": ("F5F5F8", "424244", "D4D4D7"),
    "Planned": ("FFFFFF", _SR_ACCENT_700, _SR_ACCENT_400),
}
# Excel column widths are in "characters" of the default 11pt font. These estimate
# how many of those a piece of text needs at a given size, so a column can be made
# wide enough that no word or date ever breaks mid-way.
_XL_NARROW = set(".,:;'!|()-/ ")


def _xl_text_units(text: str, size: float, bold: bool = False) -> float:
    units = 0.0
    for ch in text:
        if ch in _XL_NARROW:
            units += 0.55
        elif ch.isupper() or ch in "$%&@#WMwm":
            units += 1.3
        else:
            units += 1.0
    return units * size / 11 * (1.1 if bold else 1.0)


_XL_BOLD_KEYS = {"supplier", "file_number", "status", "eta", "expected_freight_rate"}
_XL_CELL_PAD = 3.5  # indent + cell margins, in width units


_COMMENT_DATE_PREFIX = re.compile(r"^\s*\d{1,2}\.\d{1,2}\s*-\s*")
# Patuma's letterhead logo has the old "SHIPPING REPORT" banner baked in; this
# report uses the clean crop from the design instead.
_SR_LOGOS = {"Patuma": str(ROOT_DIR / "static" / "logos" / "patuma-report.png")}
# Helvetica runs wider than the design's Barlow, so the PDF gives the date / number
# columns a little more room than the design's pixel widths.
_SR_PDF_WIDTHS = {
    "file_number": 104, "status": 116, "sob_date": 110, "pol": 100, "eta": 110,
    "final_destination": 142, "hbill_released": 112,
}


def _sr_logo_path(client: dict) -> Optional[str]:
    company = client.get("company", "Patuma")
    path = _SR_LOGOS.get(company)
    if path and os.path.exists(path):
        return path
    return COMPANIES.get(company, COMPANIES["Patuma"]).get("logo")


def _sr_footer_text(co: dict) -> str:
    return f"{co['name'].title()} {co['suffix'].title()} · {co['tagline'].title()} · {co['reg']}"


def _sr_updated_dd_mm(value: Optional[str]) -> str:
    if not value:
        return ""
    try:
        d = datetime.fromisoformat(value).astimezone()
        return f"{d.day:02d}.{d.month:02d}"
    except Exception:
        return ""


def _sr_labels(columns: list[tuple[str, str]], client: dict) -> dict:
    """Header text per column: the design's labels, or the group layout's own labels."""
    custom = client.get("report_layout") in LAYOUT_COLUMNS
    return {k: (label if custom or k not in _SR_COLUMNS else _SR_COLUMNS[k][0]) for k, label in columns}


def _sr_vessel_text(ship: dict) -> str:
    """Each vessel on its own line, with its "(1st Vessel)" label on the line below."""
    legs = _vessel_legs(ship)
    multi = len(legs) > 1
    parts = []
    for leg in legs:
        if leg["name"]:
            parts.append(leg["name"])
            if multi:
                parts.append(f"({_ordinal(leg['index'])} Vessel)")
    if ship.get("tracking_doc_number") and not ship.get("_doc_in_obill"):
        parts.append(ship["tracking_doc_number"])
    return "\n".join(parts)


async def _modern_report_rows(client_id: str, end_client: Optional[str] = None):
    client, shipments = await _active_shipments_for_report(await _get_client(client_id), end_client)
    columns = _columns_for_client(client)
    rows = []
    for s in shipments:
        # The comment's own "DD.MM - " stamp is swapped for the shipment's last-updated
        # date, which the report shows as a separate tag in front of the comment.
        s["comments"] = _COMMENT_DATE_PREFIX.sub("", _regenerate_comment(s))
        s["status"] = _derive_status(s)
        row = {key: _cell_value(key, s) for key, _ in columns}
        if "vessel_block" in row:
            row["vessel_block"] = _sr_vessel_text(s)
        row["comment_date"] = _sr_updated_dd_mm(s.get("updated_at"))
        rows.append(row)
    return client, columns, rows


def _build_xlsx_modern(client: dict, columns: list[tuple[str, str]], rows: list[dict]) -> bytes:
    LBL = _sr_labels(columns, client)
    wb = Workbook()
    ws = wb.active
    ws.title = "Status Report"
    ws.sheet_view.showGridLines = False
    ws.sheet_view.zoomScale = 90

    co = COMPANIES.get(client.get("company", "Patuma"), COMPANIES["Patuma"])
    keys = [key for key, _ in columns]
    ncols = len(keys)
    # Start from the template widths, then widen any column whose heading word or
    # longest value (dates, booking numbers...) wouldn't fit on one line.
    base_widths = [_SR_COLUMNS[k][1] for k in keys]
    widths = []
    for key, base in zip(keys, base_widths):
        need = max(_xl_text_units(word, 13, bold=True) for word in LBL[key].upper().split())
        if key not in ("comments", "order_booking_file", "vessel_block"):
            for row in rows:
                for token in str(row.get(key, "") or "").split():
                    size = 14 if key == "status" else 15
                    need = max(need, _xl_text_units(token, size, bold=key in _XL_BOLD_KEYS))
        widths.append(min(40, max(base, round(need + _XL_CELL_PAD + 0.49))))
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w

    def solid(color: str) -> PatternFill:
        return PatternFill("solid", fgColor=color)

    def inline(size: float, color: str, bold: bool = False) -> InlineFont:
        return InlineFont(rFont="Calibri", sz=size, b=bold, color=color)

    # Row 1 layout: logo (cols A-B) | title | client | report date. The date block takes
    # the right-most columns, the client block the columns before it, each widening
    # leftwards until it has room, and the title fills whatever is left in between.
    date_start = ncols
    while date_start > 5 and sum(widths[date_start - 1:]) < 22:
        date_start -= 1
    client_end = date_start - 1
    client_start = client_end
    while client_start > 4 and sum(widths[client_start - 1:client_end]) < 24:
        client_start -= 1
    title_end = client_start - 1

    ws.row_dimensions[1].height = 78
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=2)
    if title_end > 3:
        ws.merge_cells(start_row=1, start_column=3, end_row=1, end_column=title_end)
    if client_end > client_start:
        ws.merge_cells(start_row=1, start_column=client_start, end_row=1, end_column=client_end)
    if ncols > date_start:
        ws.merge_cells(start_row=1, start_column=date_start, end_row=1, end_column=ncols)

    logo_path = _sr_logo_path(client)
    if logo_path and os.path.exists(logo_path):
        try:
            img = XLImage(logo_path)
            aspect = img.width / img.height if img.height else 10
            box_w = sum(int(w * 7 + 5) for w in widths[:2]) - 24
            target_w = box_w
            target_h = int(target_w / aspect)
            if target_h > 56:
                target_h = 56
                target_w = int(target_h * aspect)
            row_h_px = int(78 * 96 / 72)
            img.anchor = OneCellAnchor(
                _from=AnchorMarker(col=0, colOff=pixels_to_EMU(12), row=0, rowOff=pixels_to_EMU(max(0, (row_h_px - target_h) // 2))),
                ext=XDRPositiveSize2D(cx=pixels_to_EMU(target_w), cy=pixels_to_EMU(target_h)),
            )
            ws.add_image(img)
        except Exception as exc:
            logger.warning("New xlsx logo embed failed: %s", exc)

    # 28pt needs ~62 characters of width on one line; narrower title areas (clients
    # with few columns) wrap onto two lines at a size that still fits.
    title_w = sum(widths[2:title_end])
    title_size = 28 if title_w >= 62 else max(14, min(28, round(28 * title_w / 42)))
    title = ws.cell(row=1, column=3, value="SHIPPING STATUS REPORT")
    title.font = Font(name="Calibri", size=title_size, color=_SR_ACCENT_800)
    title.alignment = Alignment(vertical="center", wrap_text=True, indent=2)

    client_cell = ws.cell(row=1, column=client_start)
    client_cell.value = CellRichText(
        TextBlock(inline(11, _SR_MUTED), "CLIENT\n"),
        TextBlock(inline(20, _SR_ACCENT_800, bold=True), client.get("name", "")),
    )
    client_cell.alignment = Alignment(horizontal="right", vertical="center", wrap_text=True, indent=1)

    date_cell = ws.cell(row=1, column=date_start)
    date_cell.value = CellRichText(
        TextBlock(inline(11, _SR_ACCENT_100), "REPORT DATE\n"),
        TextBlock(inline(20, "FFFFFF", bold=True), datetime.now(timezone.utc).strftime("%d.%m.%Y")),
    )
    date_cell.alignment = Alignment(vertical="center", wrap_text=True, indent=1)
    for col in range(date_start, ncols + 1):
        ws.cell(row=1, column=col).fill = solid(_SR_ACCENT_500)

    # Row 2: the blue stripe under the header; row 3: breathing room
    ws.row_dimensions[2].height = 4
    for col in range(1, ncols + 1):
        ws.cell(row=2, column=col).fill = solid(_SR_ACCENT_500)
    ws.row_dimensions[3].height = 10

    # Row 4: column headings
    header_row = 4
    for col, (key, _) in enumerate(columns, start=1):
        c = ws.cell(row=header_row, column=col, value=LBL[key].upper())
        c.font = Font(name="Calibri", size=13, bold=True, color="FFFFFF")
        c.fill = solid(_SR_ACCENT_600 if key in _SR_PANEL_KEYS else _SR_ACCENT_500)
        c.alignment = Alignment(vertical="center", wrap_text=True, indent=1)
    # Tall enough for however many lines the longest heading wraps onto
    head_lines = 1
    for key, w in zip(keys, widths):
        lines, used = 1, 0.0
        for word in LBL[key].upper().split():
            wu = _xl_text_units(word, 13, bold=True)
            if used and used + 0.6 + wu > w - _XL_CELL_PAD:
                lines, used = lines + 1, wu
            else:
                used += (0.6 if used else 0) + wu
        head_lines = max(head_lines, lines)
    ws.row_dimensions[header_row].height = max(46, 18 * head_lines + 12)

    # Data rows
    grid = Side(style="thin", color=_SR_BORDER)
    cell_border = Border(left=grid, right=grid, top=grid, bottom=grid)
    body_align = Alignment(vertical="top", wrap_text=True, indent=1)
    first_data = header_row + 1
    for offset, row in enumerate(rows):
        r = first_data + offset
        band = _SR_ZEBRA if offset % 2 else "FFFFFF"
        max_lines = 1
        for col, key in enumerate(keys, start=1):
            value = row.get(key, "") or ""
            c = ws.cell(row=r, column=col)
            c.border = cell_border
            c.fill = solid(_SR_PANEL if key in _SR_PANEL_KEYS else band)
            c.alignment = body_align
            c.font = Font(name="Calibri", size=15, color=_SR_TEXT)
            if key == "supplier":
                c.font = Font(name="Calibri", size=15, bold=True, color=_SR_ACCENT_800)
            elif key == "file_number":
                c.font = Font(name="Calibri", size=15, bold=True, color=_SR_TEXT)
            elif key == "status":
                c.font = Font(name="Calibri", size=14, bold=True, color=_SR_TEXT)
                c.alignment = Alignment(horizontal="center", vertical="top")
            elif key == "eta":
                c.font = Font(name="Calibri", size=15, bold=True, color=_SR_ACCENT_700)
            elif key == "copy_docs_status":
                c.font = Font(name="Calibri", size=15, color=_SR_DOCS_TEXT)
            elif key == "expected_freight_rate":
                c.font = Font(name="Calibri", size=15, bold=True, color=_SR_ACCENT_800)

            if key == "comments" and value and row.get("comment_date"):
                stamp = f"{row['comment_date']} — "
                c.value = CellRichText(
                    TextBlock(inline(15, _SR_ACCENT_700, bold=True), stamp),
                    TextBlock(inline(15, _SR_TEXT), value),
                )
                text_for_size = stamp + value
            else:
                c.value = value
                text_for_size = value

            if text_for_size:
                # Characters per line at 15pt in a column measured in 11pt characters
                per_line = max(4, int((widths[col - 1] - 2) * 11 / 15))
                lines = sum(max(1, -(-len(line) // per_line)) for line in str(text_for_size).splitlines())
                max_lines = max(max_lines, lines)
        ws.row_dimensions[r].height = max(30, 21 * max_lines + 14)
    last_data = first_data + len(rows) - 1

    # Status: dropdown + colour that follows whichever status is picked
    if rows and "status" in keys:
        letter = get_column_letter(keys.index("status") + 1)
        rng = f"{letter}{first_data}:{letter}{last_data}"
        dv = DataValidation(type="list", formula1=f'"{",".join(_SR_STATUS_OPTIONS)}"', allow_blank=True)
        ws.add_data_validation(dv)
        dv.add(rng)
        for status in _SR_STATUS_OPTIONS:
            fill, text, _ = _SR_STATUS[status]
            ws.conditional_formatting.add(rng, FormulaRule(
                formula=[f'${letter}{first_data}="{status}"'],
                font=Font(bold=True, color=text),
                fill=PatternFill(fill_type="solid", start_color=fill, end_color=fill, bgColor=fill),
            ))

    # Footer: status key on the left, company line on the right (or underneath when
    # there aren't enough columns left to hold it)
    footer_row = last_data + 2 if rows else first_data + 1
    ws.row_dimensions[footer_row - 1].height = 30
    ws.row_dimensions[footer_row].height = 28
    split = 1
    while split < ncols and sum(widths[:split]) < 70:
        split += 1
    key_cell = ws.cell(row=footer_row, column=1)
    key_cell.value = CellRichText(
        TextBlock(inline(12, _SR_MUTED), "STATUS KEY   "),
        TextBlock(inline(14, _SR_ACCENT_300), "■ "),
        TextBlock(inline(12, _SR_MUTED), "Shipped   "),
        TextBlock(inline(14, _SR_ACCENT_200), "■ "),
        TextBlock(inline(12, _SR_MUTED), "Booked   "),
        TextBlock(inline(14, _SR_BORDER), "■ "),
        TextBlock(inline(12, _SR_MUTED), "Pending   "),
        TextBlock(inline(14, _SR_ACCENT_700), "□ "),
        TextBlock(inline(12, _SR_MUTED), "Planned"),
    )
    key_cell.alignment = Alignment(vertical="center")
    if split > 1:
        ws.merge_cells(start_row=footer_row, start_column=1, end_row=footer_row, end_column=split)
    footer_text = _sr_footer_text(co)
    if sum(widths[split:]) >= len(footer_text) + 4:
        line_row, line_start = footer_row, split + 1
    else:
        line_row, line_start = footer_row + 1, 1
        ws.row_dimensions[line_row].height = 24
    line_cell = ws.cell(row=line_row, column=line_start, value=footer_text)
    line_cell.font = Font(name="Calibri", size=12, color=_SR_MUTED)
    line_cell.alignment = Alignment(horizontal="right", vertical="center")
    if ncols > line_start:
        ws.merge_cells(start_row=line_row, start_column=line_start, end_row=line_row, end_column=ncols)

    # Printing: landscape A4, one page wide, header + column titles on every page
    ws.page_setup.orientation = ws.ORIENTATION_LANDSCAPE
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_title_rows = f"1:{header_row}"
    ws.print_options.horizontalCentered = True
    ws.page_margins.left = ws.page_margins.right = 0.3
    ws.page_margins.top = ws.page_margins.bottom = 0.4

    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def _build_pdf_modern(client: dict, columns: list[tuple[str, str]], rows: list[dict]) -> bytes:
    LBL = _sr_labels(columns, client)
    page_width, _ = landscape(A3)
    margin = 10 * mm
    available_width = page_width - 2 * margin
    s = available_width / 1440  # the design is drawn on a 1440px-wide page

    def hexc(value: str):
        return colors.HexColor(f"#{value}")

    styles = getSampleStyleSheet()

    def pstyle(name: str, size: float, color: str, bold: bool = False, leading: float = 1.2, align: int = 0, scale: Optional[float] = None) -> ParagraphStyle:
        scale = scale or s
        return ParagraphStyle(
            name, parent=styles["Normal"], fontName="Helvetica-Bold" if bold else "Helvetica",
            fontSize=size * scale, leading=size * scale * leading, textColor=hexc(color), alignment=align,
        )

    def para(text: str, style: ParagraphStyle) -> Paragraph:
        safe = escape(str(text or "")).replace("\n", "<br/>")
        return Paragraph(safe or " ", style)

    co = COMPANIES.get(client.get("company", "Patuma"), COMPANIES["Patuma"])
    story: list = []

    # ----- Header: logo | title | client | report date -----
    label_style = pstyle("SRLabel", 13, _SR_MUTED)
    date_label_style = pstyle("SRDateLabel", 13, _SR_ACCENT_100)
    name_style = pstyle("SRName", 28, _SR_ACCENT_800, bold=True, leading=1.1)
    date_style = pstyle("SRDate", 28, "FFFFFF", bold=True, leading=1.1)
    client_name = client.get("name", "")
    date_str = datetime.now(timezone.utc).strftime("%d.%m.%Y")

    logo_w = 400 * s
    client_w = min(360 * s, max(stringWidth("CLIENT", "Helvetica", 13 * s), stringWidth(client_name, "Helvetica-Bold", 28 * s)) + 66 * s)
    date_w = max(stringWidth("REPORT DATE", "Helvetica", 13 * s), stringWidth(date_str, "Helvetica-Bold", 28 * s)) + 66 * s
    title_w = available_width - logo_w - client_w - date_w

    title_text = "SHIPPING STATUS REPORT"
    title_size = 44 * s
    max_title = title_w - 66 * s
    if stringWidth(title_text, "Helvetica", title_size) > max_title:
        title_size = title_size * max_title / stringWidth(title_text, "Helvetica", title_size)
    title_style = ParagraphStyle(
        "SRTitle", parent=styles["Normal"], fontName="Helvetica", fontSize=title_size,
        leading=title_size, textColor=hexc(_SR_ACCENT_800),
    )

    logo_cell: Any = ""
    logo_path = _sr_logo_path(client)
    if logo_path and os.path.exists(logo_path):
        try:
            from PIL import Image as PILImage
            pil = PILImage.open(logo_path)
            aspect = pil.width / pil.height if pil.height else 10
            w = logo_w - 56 * s
            h = w / aspect
            if h > 60 * s:
                h = 60 * s
                w = h * aspect
            logo_cell = RLImage(logo_path, width=w, height=h)
            logo_cell.hAlign = "LEFT"
        except Exception as exc:
            logger.warning("New PDF logo embed failed: %s", exc)
    if logo_cell == "":
        logo_cell = para(f"{co['name']} {co['suffix']}", pstyle("SRCo", 22, _SR_ACCENT_800, bold=True))

    header = LongTable(
        [[
            logo_cell,
            Paragraph(title_text, title_style),
            [para("CLIENT", label_style), Spacer(1, 6 * s), para(client_name, name_style)],
            [para("REPORT DATE", date_label_style), Spacer(1, 6 * s), para(date_str, date_style)],
        ]],
        colWidths=[logo_w, title_w, client_w, date_w],
    )
    divider = hexc(_SR_ACCENT_200)
    header.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 30 * s),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 30 * s),
        ("LEFTPADDING", (0, 0), (0, 0), 28 * s),
        ("RIGHTPADDING", (0, 0), (0, 0), 28 * s),
        ("LEFTPADDING", (1, 0), (-1, 0), 32 * s),
        ("RIGHTPADDING", (1, 0), (-1, 0), 32 * s),
        ("LINEAFTER", (0, 0), (0, 0), 1, divider),
        ("LINEBEFORE", (2, 0), (2, 0), 1, divider),
        ("LINEAFTER", (2, 0), (2, 0), 1, divider),
        ("BACKGROUND", (3, 0), (3, 0), hexc(_SR_ACCENT_500)),
    ]))
    story.append(header)

    stripe = LongTable([[""]], colWidths=[available_width], rowHeights=[3 * s])
    stripe.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), hexc(_SR_ACCENT_500)),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(stripe)
    story.append(Spacer(1, 36 * s))

    # ----- Shipment table -----
    # When a client has many report columns switched on, the whole table is scaled
    # down together (like the design zooming to fit) instead of squeezing columns.
    keys = [key for key, _ in columns]
    table_width = available_width - 72 * s
    px = {k: _SR_PDF_WIDTHS.get(k, _SR_COLUMNS[k][2]) for k in keys}
    needed = sum(w for k, w in px.items() if k != "comments") + (240 if "comments" in keys else 0)
    t = s * min(1.0, (1440 - 72) / needed)
    col_widths = [px[k] * t for k in keys]
    if "comments" in keys:
        col_widths[keys.index("comments")] = table_width - sum(w for k, w in zip(keys, col_widths) if k != "comments")
    else:
        col_widths = [w * table_width / sum(col_widths) for w in col_widths]

    pad_v, pad_h = 14 * t, 10 * t
    # Column headings wrap between words only, so size them to fit the longest word
    head_size = 16 * t
    for k, w in zip(keys, col_widths):
        for word in LBL[k].upper().split():
            head_size = min(head_size, (w - 2 * pad_h - 1) / stringWidth(word, "Helvetica-Bold", 1))
    header_style = pstyle("SRHead", head_size / t, "FFFFFF", bold=True, leading=1.15, scale=t)
    body = pstyle("SRBody", 16, _SR_TEXT, leading=1.45, scale=t)
    body_bold = pstyle("SRBodyBold", 16, _SR_TEXT, bold=True, leading=1.45, scale=t)
    supplier_style = pstyle("SRSupplier", 16, _SR_ACCENT_800, bold=True, leading=1.45, scale=t)
    eta_style = pstyle("SREta", 16, _SR_ACCENT_700, bold=True, leading=1.45, scale=t)
    docs_style = pstyle("SRDocs", 16, _SR_DOCS_TEXT, leading=1.45, scale=t)
    rate_style = pstyle("SRRate", 16, _SR_ACCENT_800, bold=True, leading=1.45, scale=t)
    pill_size = 13 * t
    chip_style = pstyle("SRChip", 13, _SR_ACCENT_800, bold=True, leading=1.3, scale=t)

    def status_pill(status: str):
        if not status:
            return ""
        fill, text, outline = _SR_STATUS.get(status, _SR_STATUS["Pending"])
        label = status.upper()
        style = ParagraphStyle(
            "SRPill", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=pill_size,
            leading=pill_size * 1.2, textColor=hexc(text),
        )
        pill = LongTable([[Paragraph(escape(label), style)]], colWidths=[stringWidth(label, "Helvetica-Bold", pill_size) + 20 * t + 1])
        pill.hAlign = "LEFT"
        box = ("BOX", (0, 0), (-1, -1), 0.75, hexc(outline), None, (2, 2)) if status == "Planned" else ("BOX", (0, 0), (-1, -1), 0.75, hexc(outline))
        pill.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), hexc(fill)),
            box,
            ("TOPPADDING", (0, 0), (-1, -1), 3 * t),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * t),
            ("LEFTPADDING", (0, 0), (-1, -1), 10 * t),
            ("RIGHTPADDING", (0, 0), (-1, -1), 10 * t),
        ]))
        return pill

    def comment_cell(text: str, stamp: str, width: float):
        if not stamp:
            return para(text, body)
        chip_w = stringWidth(stamp, "Helvetica-Bold", 13 * t) + 12 * t + 1
        chip = LongTable([[Paragraph(escape(stamp), chip_style)]], colWidths=[chip_w])
        chip.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), hexc(_SR_ACCENT_100)),
            ("TOPPADDING", (0, 0), (-1, -1), 1 * t),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2 * t),
            ("LEFTPADDING", (0, 0), (-1, -1), 6 * t),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6 * t),
        ]))
        inner = LongTable([[chip, para(text, body)]], colWidths=[chip_w, max(20, width - 2 * pad_h - chip_w)])
        inner.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("LEFTPADDING", (1, 0), (1, 0), 10 * t),
            ("TOPPADDING", (0, 0), (0, 0), 3 * t),
        ]))
        return inner

    cell_styles = {
        "supplier": supplier_style, "file_number": body_bold, "eta": eta_style,
        "copy_docs_status": docs_style, "expected_freight_rate": rate_style,
    }
    table_data = [[para(LBL[k].upper(), header_style) for k in keys]]
    for row in rows:
        cells = []
        for i, key in enumerate(keys):
            value = row.get(key, "") or ""
            if key == "status":
                cells.append(status_pill(value))
            elif key == "comments":
                cells.append(comment_cell(value, row.get("comment_date", "") if value else "", col_widths[i]))
            else:
                cells.append(para(value, cell_styles.get(key, body)))
        table_data.append(cells)

    table = LongTable(table_data, colWidths=col_widths, repeatRows=1, splitByRow=1)
    line = hexc(_SR_BORDER)
    cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), hexc(_SR_ACCENT_500)),
        ("VALIGN", (0, 0), (-1, 0), "BOTTOM"),
        ("VALIGN", (0, 1), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), pad_v),
        ("BOTTOMPADDING", (0, 0), (-1, -1), pad_v),
        ("LEFTPADDING", (0, 0), (-1, -1), pad_h),
        ("RIGHTPADDING", (0, 0), (-1, -1), pad_h),
    ]
    if rows:
        cmds += [
            ("INNERGRID", (0, 1), (-1, -1), 0.6, line),
            ("BOX", (0, 1), (-1, -1), 0.6, line),
        ]
    for i in range(2, len(table_data), 2):
        cmds.append(("BACKGROUND", (0, i), (-1, i), hexc(_SR_ZEBRA)))
    for i, key in enumerate(keys):
        if key in _SR_PANEL_KEYS:
            cmds.append(("BACKGROUND", (i, 0), (i, 0), hexc(_SR_ACCENT_600)))
            if rows:
                cmds.append(("BACKGROUND", (i, 1), (i, -1), hexc(_SR_PANEL)))
    table.setStyle(TableStyle(cmds))
    table.hAlign = "CENTER"
    story.append(table)

    # ----- Footer: status key + company line -----
    small = pstyle("SRSmall", 13, _SR_MUTED)
    small_right = pstyle("SRSmallRight", 13, _SR_MUTED, align=2)
    sw = 12 * s

    def swatch(fill: Optional[str], outline: Optional[str] = None, dashed: bool = False):
        box = LongTable([[""]], colWidths=[sw], rowHeights=[sw])
        cmds = [("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]
        if fill:
            cmds.append(("BACKGROUND", (0, 0), (-1, -1), hexc(fill)))
        if outline:
            cmds.append(("BOX", (0, 0), (-1, -1), 0.75, hexc(outline), None, (2, 2)) if dashed else ("BOX", (0, 0), (-1, -1), 0.75, hexc(outline)))
        box.setStyle(TableStyle(cmds))
        return box

    key_items = [
        ("STATUS KEY", None),
        ("Shipped", swatch(_SR_ACCENT_300)),
        ("Booked", swatch(_SR_ACCENT_100, _SR_ACCENT_300)),
        ("Pending", swatch("E7E7EA")),
        ("Planned", swatch(None, _SR_ACCENT_400, dashed=True)),
    ]
    key_cells: list = []
    key_widths: list = []
    for label, sw_box in key_items:
        if sw_box is not None:
            key_cells.append(sw_box)
            key_widths.append(sw + 8 * s)
        key_cells.append(para(label, small))
        key_widths.append(stringWidth(label, "Helvetica", 13 * s) + 20 * s)
    key_table = LongTable([key_cells], colWidths=key_widths)
    key_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    key_w = sum(key_widths)
    footer = LongTable(
        [[key_table, para(_sr_footer_text(co), small_right)]],
        colWidths=[key_w, table_width - key_w],
    )
    footer.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 20 * s),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    footer.hAlign = "CENTER"
    story.append(footer)

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=landscape(A3),
        leftMargin=margin, rightMargin=margin, topMargin=margin, bottomMargin=margin,
        title=f"Shipping Status Report - {client.get('name', '')}",
    )
    doc.build(story)
    return buffer.getvalue()


@api_router.get("/reports/{client_id}/xlsx-modern")
async def export_xlsx_modern(client_id: str, end_client: Optional[str] = None):
    client, columns, rows = await _modern_report_rows(client_id, end_client)
    content = _build_xlsx_modern(client, columns, rows)
    filename = f"status-report-{_safe_name(client['name'])}-{datetime.now(timezone.utc).strftime('%Y%m%d')}.xlsx"
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@api_router.get("/reports/{client_id}/pdf-modern")
async def export_pdf_modern(client_id: str, end_client: Optional[str] = None):
    client, columns, rows = await _modern_report_rows(client_id, end_client)
    content = _build_pdf_modern(client, columns, rows)
    filename = f"status-report-{_safe_name(client['name'])}-{datetime.now(timezone.utc).strftime('%Y%m%d')}.pdf"
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------- Settings ----------
DEFAULT_QUICK_COMMENTS = [
    "Planned ETD ",
    "Vessel delayed slightly. Now planned ETD ",
    "Vessel changed by S/Line. Now planned ETD ",
    "Awaiting confirmation of departure.",
    "Shipped on board ",
    "H/bill released by supplier.",
    "H/bill NOT released by supplier.",
    "ANF received. Docs to Ops.",
]
EXPORT_FORMATS = ["PDF", "Excel", "PDF + Excel"]


class SettingsUpdate(BaseModel):
    default_columns: Optional[dict] = None
    export_format: Optional[str] = None
    quick_comments: Optional[List[str]] = None
    email_default_to: Optional[str] = None
    email_default_cc: Optional[str] = None
    email_default_subject: Optional[str] = None
    email_default_body: Optional[str] = None


# Added to every client's status-report email; the client's own addresses go in front.
DEFAULT_EMAIL_TO = (
    "Clearfreight (Pty) Ltd - Dean Chetty <dean@clearfreight.co.za>; "
    "Clearfreight (Pty) Ltd - Leon Menhennet <leonm@clearfreight.co.za>; "
    "Clearfreight (Pty) Ltd - Sorisha Chetty <durban@clearfreight.co.za>"
)
DEFAULT_EMAIL_CC = (
    "Clearfreight (Pty) Ltd - Maree Prinsloo <maree@clearfreight.co.za>; "
    "Clearfreight (Pty) Ltd - Joey Naidoo <joey@clearfreight.co.za>; "
    "Clearfreight (Pty) Ltd - Andre Prinsloo <andrep@clearfreight.co.za>; "
    "Clearfreight (Pty) Ltd - Richard Whitfeld <rwhitfeld@clearfreight.co.za>"
)
DEFAULT_EMAIL_SUBJECT = "Status Report - {client}"
DEFAULT_EMAIL_BODY = "Dear {name},\n\nPlease see attached Status Report for your pending shipments.\n\nThanks."
_EMAIL_DEFAULTS = {
    "email_default_to": DEFAULT_EMAIL_TO, "email_default_cc": DEFAULT_EMAIL_CC,
    "email_default_subject": DEFAULT_EMAIL_SUBJECT, "email_default_body": DEFAULT_EMAIL_BODY,
}


async def _get_settings() -> dict:
    doc = await db.settings.find_one({"id": "global"}, _proj()) or {}
    return {
        "default_columns": {**DEFAULT_OPTIONAL_COLUMNS, **(doc.get("default_columns") or {})},
        "export_format": doc.get("export_format") or "PDF + Excel",
        "quick_comments": doc.get("quick_comments") if doc.get("quick_comments") is not None else list(DEFAULT_QUICK_COMMENTS),
        **{k: doc[k] if doc.get(k) is not None else v for k, v in _EMAIL_DEFAULTS.items()},
    }


# ----- Rates of exchange (captured once a day from the boss's rates) -----
def _roe_day(iso: str) -> str:
    """A weekend or public holiday uses the next working day's ROE."""
    d = date.fromisoformat(iso)
    while not _is_workday(d):
        d += timedelta(days=1)
    return d.isoformat()


@api_router.get("/holidays")
async def list_holidays(year: Optional[int] = None):
    years = [year] if year else [date.today().year - 1, date.today().year, date.today().year + 1]
    return [{"date": d.isoformat(), "name": n} for y in years for d, n in sorted(_sa_holidays(y).items())]


@api_router.get("/roe")
async def list_roe():
    rows = await db.roe.find({}, _proj()).sort("date", -1).to_list(2000)
    return {"today": date.today().isoformat(), "rates": rows}


@api_router.put("/roe/{day}")
async def save_roe(day: str, payload: dict):
    try:
        day = _roe_day(day)
    except ValueError:
        raise HTTPException(status_code=400, detail="Use a YYYY-MM-DD date")
    clean = lambda v: str(v or "").strip().replace(",", ".")
    row = {"date": day, "usd": clean(payload.get("usd")), "eur": clean(payload.get("eur")), "updated_at": _now_iso()}
    await db.roe.update_one({"date": day}, {"$set": row}, upsert=True)
    return row


@api_router.delete("/roe/{day}")
async def delete_roe(day: str):
    await db.roe.delete_one({"date": day})
    return {"ok": True}


@api_router.get("/settings")
async def get_settings():
    return await _get_settings()


@api_router.put("/settings")
async def update_settings(payload: SettingsUpdate):
    updates: dict[str, Any] = {}
    if payload.default_columns is not None:
        updates["default_columns"] = {k: bool(v) for k, v in payload.default_columns.items() if k in DEFAULT_OPTIONAL_COLUMNS}
    if payload.export_format is not None:
        if payload.export_format not in EXPORT_FORMATS:
            raise HTTPException(status_code=400, detail="Unknown export format")
        updates["export_format"] = payload.export_format
    if payload.quick_comments is not None:
        updates["quick_comments"] = [c for c in payload.quick_comments if (c or "").strip()]
    for k in _EMAIL_DEFAULTS:
        if getattr(payload, k) is not None:
            updates[k] = getattr(payload, k)
    if updates:
        await db.settings.update_one({"id": "global"}, {"$set": updates}, upsert=True)
    return await _get_settings()


# ---------- Daily report log ----------
# One entry per client per day once the status report has been sent. The date and
# time come from the browser so "today" always matches the office's local day.
class ReportSentPayload(BaseModel):
    date: str  # YYYY-MM-DD
    time: str  # HH:MM


@api_router.get("/report-log")
async def report_log(date: str):
    rows = await db.report_log.find({"date": date}, _proj()).to_list(1000)
    return {r["client_id"]: r["time"] for r in rows}


@api_router.post("/clients/{client_id}/report-sent")
async def mark_report_sent(client_id: str, payload: ReportSentPayload):
    await _get_client(client_id)
    await db.report_log.update_one(
        {"client_id": client_id, "date": payload.date},
        {"$set": {"client_id": client_id, "date": payload.date, "time": payload.time, "sent_at": _now_iso()}},
        upsert=True,
    )
    return {"ok": True}


# ---------- Quotes & pro forma invoices ----------
# The builder owns the document shape (details, shipment, ROE, charge lines,
# EasyClear ticks); the API stores it as-is and only manages ids and numbering.
DOC_PREFIX = {"quote": "Q", "pfi": "PF"}


async def _next_doc_number(doc_type: str) -> str:
    prefix = f"{DOC_PREFIX.get(doc_type, 'Q')}-{datetime.now().strftime('%y')}-"
    docs = await db.documents.find({"no": {"$regex": f"^{re.escape(prefix)}"}}, {"_id": 0, "no": 1}).to_list(10000)
    highest = 0
    for d in docs:
        try:
            highest = max(highest, int(d["no"][len(prefix):]))
        except (ValueError, KeyError):
            continue
    return f"{prefix}{highest + 1:03d}"


@api_router.get("/documents")
async def list_documents():
    return await db.documents.find({}, _proj()).sort("date", -1).to_list(5000)


@api_router.get("/documents/next-number")
async def next_document_number(type: str = "quote"):
    return {"no": await _next_doc_number(type)}


@api_router.post("/documents")
async def create_document(payload: dict):
    doc = {k: v for k, v in payload.items() if k != "_id"}
    doc["id"] = str(uuid.uuid4())
    doc["type"] = doc.get("type") if doc.get("type") in DOC_PREFIX else "quote"
    if not (doc.get("no") or "").strip():
        doc["no"] = await _next_doc_number(doc["type"])
    doc["created_at"] = doc["updated_at"] = _now_iso()
    await db.documents.insert_one(dict(doc))
    return doc


@api_router.put("/documents/{doc_id}")
async def update_document(doc_id: str, payload: dict):
    existing = await db.documents.find_one({"id": doc_id}, _proj())
    if not existing:
        raise HTTPException(status_code=404, detail="Document not found")
    doc = {k: v for k, v in payload.items() if k not in ("_id", "id", "created_at")}
    doc["updated_at"] = _now_iso()
    await db.documents.update_one({"id": doc_id}, {"$set": doc})
    return await db.documents.find_one({"id": doc_id}, _proj())


@api_router.delete("/documents/{doc_id}")
async def delete_document(doc_id: str):
    result = await db.documents.delete_one({"id": doc_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"ok": True}


# ---------- Import old Excel status reports ----------
import base64  # noqa: E402

from report_import import parse_report  # noqa: E402


class ImportFile(BaseModel):
    name: str
    data: str  # base64-encoded .xlsx


class ImportPreviewPayload(BaseModel):
    files: List[ImportFile]
    cutoff: str  # YYYY-MM-DD — shipments with no update since then are archived


class ImportCommitPayload(BaseModel):
    reports: List[dict]


def _ship_key(s: dict) -> tuple:
    return ((s.get("file_number") or "").strip(), (s.get("supplier") or "").strip().lower())


async def _client_by_name(name: str) -> Optional[dict]:
    return await db.clients.find_one({"name": {"$regex": f"^{re.escape(name.strip())}$", "$options": "i"}}, _proj())


@api_router.post("/import/preview")
async def import_preview(payload: ImportPreviewPayload):
    try:
        cutoff = date.fromisoformat(payload.cutoff)
    except ValueError:
        raise HTTPException(status_code=400, detail="cutoff must be YYYY-MM-DD")
    reports = []
    for f in payload.files:
        try:
            parsed = parse_report(base64.b64decode(f.data), f.name, cutoff)
        except Exception as exc:  # one bad file shouldn't stop the rest
            reports.append({"file": f.name, "error": f"Couldn't read this file: {exc}"})
            continue
        existing = await _client_by_name(parsed["client"]["name"])
        parsed["existing_client_id"] = existing["id"] if existing else None
        known = set()
        if existing:
            async for s in db.shipments.find({"client_id": existing["id"]}, {"_id": 0, "file_number": 1, "supplier": 1}):
                known.add(_ship_key(s))
        for s in parsed["shipments"]:
            s["duplicate"] = _ship_key(s) in known
        reports.append(parsed)
    return {"reports": reports}


SHIPMENT_IMPORT_FIELDS = set(ShipmentCreate.model_fields) | {"first_vessel_state", "second_vessel_state"}


@api_router.post("/import/commit")
async def import_commit(payload: ImportCommitPayload):
    created_clients = updated_clients = added = archived = skipped = 0
    for rep in payload.reports:
        info = rep.get("client") or {}
        name = (info.get("name") or "").strip()
        if not name or rep.get("error"):
            continue
        company = info.get("company") if info.get("company") in COMPANIES else "Patuma"
        columns = {k: bool(v) for k, v in (info.get("optional_columns") or {}).items() if k in DEFAULT_OPTIONAL_COLUMNS}
        layout = info.get("report_layout") if info.get("report_layout") in LAYOUT_COLUMNS else "standard"
        group = {"report_layout": layout, "internal": bool(info.get("internal")), "handover_parties": info.get("handover_parties") or {}}
        client = await _client_by_name(name)
        if client:
            merged = {**(client.get("optional_columns") or {}), **{k: True for k, v in columns.items() if v}}
            changes: dict[str, Any] = {"optional_columns": merged}
            if layout != "standard":
                changes.update(report_layout=layout, internal=group["internal"],
                               handover_parties={**(client.get("handover_parties") or {}), **group["handover_parties"]})
            await db.clients.update_one({"id": client["id"]}, {"$set": changes})
            updated_clients += 1
        else:
            client = Client(name=name, company=company, optional_columns={**DEFAULT_OPTIONAL_COLUMNS, **columns}, **group).model_dump()
            await db.clients.insert_one(dict(client))
            created_clients += 1

        known = set()
        async for s in db.shipments.find({"client_id": client["id"]}, {"_id": 0, "file_number": 1, "supplier": 1}):
            known.add(_ship_key(s))
        base = datetime.now(timezone.utc)
        for i, row in enumerate(rep.get("shipments") or []):
            if _ship_key(row) in known:
                skipped += 1
                continue
            data = {k: v for k, v in row.items() if k in SHIPMENT_IMPORT_FIELDS}
            data["client_id"] = client["id"]
            data["extra_vessels"] = data.get("extra_vessels") or []
            ship = Shipment(**data).model_dump()
            ship["first_vessel_state"] = row.get("first_vessel_state") or "planned"
            ship["second_vessel_state"] = row.get("second_vessel_state") or "planned"
            ship["created_at"] = (base + timedelta(milliseconds=i)).isoformat()  # keeps the report's row order
            if row.get("last_update"):
                ship["updated_at"] = f"{row['last_update']}T12:00:00+00:00"
            if row.get("archived"):
                ship["anf_received"] = True
                ship["anf_received_at"] = _now_iso()
                archived += 1
            ship["comments"] = _regenerate_comment(ship)
            ship["status"] = _derive_status(ship)
            await db.shipments.insert_one(ship)
            known.add(_ship_key(ship))
            added += 1
    return {
        "created_clients": created_clients, "updated_clients": updated_clients,
        "shipments_added": added, "archived": archived, "skipped_duplicates": skipped,
    }


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
