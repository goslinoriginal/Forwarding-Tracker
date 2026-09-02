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
from reportlab.lib.pagesizes import A3, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Image as RLImage, LongTable, Paragraph, SimpleDocTemplate, Spacer, TableStyle
from starlette.middleware.cors import CORSMiddleware


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
mongo_client = AsyncIOMotorClient(mongo_url)
db = mongo_client[os.environ["DB_NAME"]]

app = FastAPI(title="Ocean Freight Tracker API")
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
    optional_columns: dict = Field(default_factory=lambda: dict(DEFAULT_OPTIONAL_COLUMNS))
    created_at: str = Field(default_factory=_now_iso)


class ClientCreate(BaseModel):
    name: str
    company: str = "Patuma"
    contact_email: Optional[str] = None
    notes: Optional[str] = None
    optional_columns: Optional[dict] = None


class ClientUpdate(BaseModel):
    name: Optional[str] = None
    company: Optional[str] = None
    contact_email: Optional[str] = None
    notes: Optional[str] = None
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
    planned_eta: Optional[str] = None  # ISO date YYYY-MM-DD
    second_vessel_name: Optional[str] = None
    second_vessel_etd: Optional[str] = None  # ISO date YYYY-MM-DD
    final_destination: Optional[str] = None
    comments: str = ""
    hbill_released: Optional[bool] = None
    expected_freight_rate: Optional[str] = None
    copy_docs_status: Optional[str] = None
    anf_received: bool = False
    anf_received_at: Optional[str] = None
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
    planned_eta: Optional[str] = None
    second_vessel_name: Optional[str] = None
    second_vessel_etd: Optional[str] = None
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
    planned_eta: Optional[str] = None
    second_vessel_name: Optional[str] = None
    second_vessel_etd: Optional[str] = None
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


@api_router.get("/clients", response_model=List[Client])
async def list_clients():
    docs = await db.clients.find({}, _proj()).sort("name", 1).to_list(1000)
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
    for field in ["name", "contact_email", "notes"]:
        value = getattr(payload, field)
        if value is not None:
            updates[field] = value
    if payload.company is not None and payload.company in COMPANIES:
        updates["company"] = payload.company
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
    return docs


@api_router.post("/shipments", response_model=Shipment)
async def create_shipment(payload: ShipmentCreate):
    await _get_client(payload.client_id)
    data = payload.model_dump()
    # Seed the initial comment "DD.MM - Planned ETD DD.MM." when planned_etd is set and no comment provided
    if (not data.get("comments")) and data.get("planned_etd"):
        today = date.today()
        data["comments"] = f"{today.day:02d}.{today.month:02d} - Planned ETD {_fmt_dot_date(data['planned_etd'])}"
    ship = Shipment(**data)
    await db.shipments.insert_one(ship.model_dump())
    return ship


class MarkShippedPayload(BaseModel):
    sob_date: str  # DD.MM.YYYY or YYYY-MM-DD


class MarkDelayedPayload(BaseModel):
    new_etd: str  # YYYY-MM-DD


def _append_comment(existing: str, snippet: str) -> str:
    current = (existing or "").strip()
    if snippet and snippet in current:
        return current
    if not current:
        return snippet
    sep = "" if current.endswith(".") else "."
    return f"{current}{sep} {snippet}"


_DATE_PREFIX_RE = re.compile(r"^\d{1,2}\.\d{1,2}\.?\s*-\s*")


def _refresh_date_prefix(text: str) -> str:
    """Ensure comment starts with today's 'DD.MM - ' prefix, replacing any existing date prefix."""
    today = date.today()
    prefix = f"{today.day:02d}.{today.month:02d} - "
    stripped = _DATE_PREFIX_RE.sub("", (text or "").strip())
    if not stripped:
        return prefix.rstrip()
    return prefix + stripped





@api_router.post("/shipments/{shipment_id}/mark-shipped", response_model=Shipment)
async def mark_shipped(shipment_id: str, payload: MarkShippedPayload):
    existing = await db.shipments.find_one({"id": shipment_id}, _proj())
    if not existing:
        raise HTTPException(status_code=404, detail="Shipment not found")
    sob_iso = _to_iso_or_original(payload.sob_date)
    sob_dd_mm = _fmt_dot_date(sob_iso) or payload.sob_date
    snippet = f"SOB {sob_dd_mm} Awaiting ANF."
    new_comment = _refresh_date_prefix(_append_comment(existing.get("comments", ""), snippet))
    updates = {
        "sob_date": sob_iso,
        "status": "Shipped",
        "comments": new_comment,
        "updated_at": _now_iso(),
    }
    await db.shipments.update_one({"id": shipment_id}, {"$set": updates})
    doc = await db.shipments.find_one({"id": shipment_id}, _proj())
    return doc


@api_router.post("/shipments/{shipment_id}/mark-delayed", response_model=Shipment)
async def mark_delayed(shipment_id: str, payload: MarkDelayedPayload):
    existing = await db.shipments.find_one({"id": shipment_id}, _proj())
    if not existing:
        raise HTTPException(status_code=404, detail="Shipment not found")
    new_etd_iso = _to_iso_or_original(payload.new_etd)
    dd_mm = _fmt_dot_date(new_etd_iso) or payload.new_etd
    snippet = f"Vessel delayed slightly. Now planned ETD {dd_mm}"
    new_comment = _refresh_date_prefix(_append_comment(existing.get("comments", ""), snippet))
    updates = {
        "planned_etd": new_etd_iso,
        "status": "Delayed" if existing.get("status") != "Shipped" else existing.get("status"),
        "comments": new_comment,
        "updated_at": _now_iso(),
    }
    await db.shipments.update_one({"id": shipment_id}, {"$set": updates})
    doc = await db.shipments.find_one({"id": shipment_id}, _proj())
    return doc


class AppendCommentPayload(BaseModel):
    snippet: str


@api_router.post("/shipments/{shipment_id}/append-comment", response_model=Shipment)
async def append_comment(shipment_id: str, payload: AppendCommentPayload):
    existing = await db.shipments.find_one({"id": shipment_id}, _proj())
    if not existing:
        raise HTTPException(status_code=404, detail="Shipment not found")
    new_comment = _refresh_date_prefix(_append_comment(existing.get("comments", ""), payload.snippet.strip()))
    await db.shipments.update_one({"id": shipment_id}, {"$set": {"comments": new_comment, "updated_at": _now_iso()}})
    doc = await db.shipments.find_one({"id": shipment_id}, _proj())
    return doc


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


def _auto_delayed_comment(existing: dict, updates: dict) -> tuple[dict, list[str]]:
    """Detect ETD delay or vessel change; auto-append delayed comment and set status."""
    appended: list[str] = []

    new_etd = updates.get("planned_etd")
    old_etd = existing.get("planned_etd")
    if new_etd and new_etd != old_etd:
        try:
            new_d = date.fromisoformat(new_etd)
            today = date.today()
            trigger = False
            if old_etd:
                old_d = date.fromisoformat(old_etd)
                if new_d > old_d:
                    trigger = True
            elif new_d > today:
                # First ETD in the future is not a delay — no auto comment
                trigger = False
            if trigger:
                snippet = f"Vessel delayed slightly. Now planned ETD {_fmt_dot_date(new_etd)}"
                appended.append(snippet)
                if existing.get("status") != "Shipped":
                    updates["status"] = "Delayed"
        except Exception:
            pass

    new_vessel = updates.get("vessel_name")
    old_vessel = existing.get("vessel_name")
    if new_vessel and old_vessel and new_vessel.strip() and new_vessel.strip() != (old_vessel or "").strip():
        etd_txt = _fmt_dot_date(updates.get("planned_etd") or existing.get("planned_etd") or "")
        snippet = f"Vessel changed by S/Line to {new_vessel.strip()}. Now planned ETD {etd_txt}".rstrip()
        appended.append(snippet)
        if existing.get("status") != "Shipped":
            updates["status"] = "Delayed"

    new_second = updates.get("second_vessel_name")
    old_second = existing.get("second_vessel_name")
    if new_second and new_second.strip() and new_second.strip() != (old_second or "").strip():
        etd_txt = _fmt_dot_date(updates.get("second_vessel_etd") or existing.get("second_vessel_etd") or "")
        snippet = f"2nd vessel updated to {new_second.strip()}. Planned ETD {etd_txt}".rstrip()
        appended.append(snippet)

    if appended:
        current = (updates.get("comments") if "comments" in updates else existing.get("comments")) or ""
        current = current.strip()
        for line in appended:
            if line and line not in current:
                current = (current + (". " if current and not current.endswith(".") else " " if current else "") + line).strip()
        updates["comments"] = current

    return updates, appended


@api_router.patch("/shipments/{shipment_id}", response_model=Shipment)
async def update_shipment(shipment_id: str, payload: ShipmentUpdate):
    existing = await db.shipments.find_one({"id": shipment_id}, _proj())
    if not existing:
        raise HTTPException(status_code=404, detail="Shipment not found")
    updates = payload.model_dump(exclude_none=True)
    if "anf_received" in updates and updates["anf_received"] and not existing.get("anf_received"):
        updates["anf_received_at"] = _now_iso()
    if "anf_received" in updates and not updates["anf_received"]:
        updates["anf_received_at"] = None
    updates, _ = _auto_delayed_comment(existing, updates)
    updates["updated_at"] = _now_iso()
    await db.shipments.update_one({"id": shipment_id}, {"$set": updates})
    doc = await db.shipments.find_one({"id": shipment_id}, _proj())
    return doc


def _reminder_for_shipment(s: dict, today: date) -> Optional[dict]:
    """Return reminder metadata if this shipment needs cargo reporting soon."""
    if s.get("anf_received"):
        return None
    cargo = (s.get("cargo_type") or "FCL").upper()
    if cargo == "LCL":
        target_iso = s.get("planned_eta")
        if not target_iso:
            return None
        try:
            target = date.fromisoformat(target_iso)
        except Exception:
            return None
        days = (target - today).days
        if days <= 10:
            return {"kind": "LCL cargo report (10d before ETA)", "target_date": target_iso, "days_left": days}
        return None
    # FCL: use second vessel if present, else primary
    if s.get("second_vessel_name") and s.get("second_vessel_etd"):
        target_iso = s["second_vessel_etd"]
        label = f"Cargo report before 2nd vessel {s['second_vessel_name']}"
    else:
        target_iso = s.get("planned_etd")
        label = "Cargo report before departure"
    if not target_iso:
        return None
    try:
        target = date.fromisoformat(target_iso)
    except Exception:
        return None
    days = (target - today).days
    if days <= 2:
        return {"kind": label, "target_date": target_iso, "days_left": days}
    return None


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
                "supplier": s.get("supplier") or "",
                "vessel_name": s.get("second_vessel_name") or s.get("vessel_name") or "",
                "tracking_doc_number": s.get("tracking_doc_number") or "",
                "carrier": s.get("carrier") or "Other",
                "cargo_type": s.get("cargo_type") or "FCL",
                **r,
            })
    reminders.sort(key=lambda r: r["days_left"])
    return {"today": today.isoformat(), "reminders": reminders}


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

    return {
        "total_clients": total_clients,
        "active_shipments": active_shipments,
        "anf_pending": anf_pending,
        "delayed": delayed,
        "shipped": shipped,
        "booked": booked,
        "carriers": carrier_counts,
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
        vessel = ship.get("vessel_name") or ""
        doc = ship.get("tracking_doc_number") or ""
        second = ship.get("second_vessel_name") or ""
        parts = []
        if vessel:
            parts.append(vessel + (" (1st Vessel)" if second else ""))
        if second:
            parts.append(second + " (2nd Vessel)")
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
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    # Row 1: Logo image (bigger + horizontally centered across merged range)
    logo_path = co.get("logo")
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=ncols)
    ws.row_dimensions[1].height = 80

    # Pre-compute compact column widths so we know total width
    min_widths = {
        "supplier": 14, "order_booking_file": 22, "file_number": 10,
        "status": 12, "sob_date": 10, "vessel_block": 18,
        "pol": 10, "eta": 10, "final_destination": 14,
        "comments": 32, "copy_docs_status": 14,
        "hbill_released": 8, "expected_freight_rate": 12,
    }
    widths = [min_widths.get(key, 12) for key, _ in columns]

    if logo_path and os.path.exists(logo_path):
        try:
            from openpyxl.drawing.spreadsheet_drawing import OneCellAnchor, AnchorMarker
            from openpyxl.drawing.xdr import XDRPositiveSize2D
            from openpyxl.utils.units import pixels_to_EMU
            img = XLImage(logo_path)
            orig_w, orig_h = img.width, img.height
            aspect = orig_w / orig_h if orig_h else 10
            # Cap logo to 60% of table width AND 100px max height, keep aspect ratio
            total_px = sum(int(w * 7 + 5) for w in widths)
            max_w = int(total_px * 0.6)
            target_w_px = min(max_w, int(100 * aspect))
            target_h_px = max(50, int(target_w_px / aspect))
            offset_px = max(0, (total_px - target_w_px) // 2)
            # Walk columns to find anchor col + column offset
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
            ws.row_dimensions[1].height = max(60, int(target_h_px * 0.78))
            img.anchor = OneCellAnchor(
                _from=AnchorMarker(col=anchor_col, colOff=pixels_to_EMU(col_off), row=0, rowOff=pixels_to_EMU(2)),
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
    cell.fill = PatternFill("solid", fgColor="0000CC")
    cell.font = Font(bold=True, size=16, color="33CCFF")
    cell.alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[2].height = 26

    # Row 3: Date + yellow spacer + Client: + name
    client_label_col = max(2, ncols - 3)
    yellow_start = 2
    yellow_end = client_label_col - 1
    name_start = client_label_col + 1

    ws.cell(row=3, column=1, value=date_str)
    ws.cell(row=3, column=1).fill = PatternFill("solid", fgColor="99CCFF")
    ws.cell(row=3, column=1).font = Font(bold=True, size=11, color="000000")
    ws.cell(row=3, column=1).alignment = Alignment(horizontal="center", vertical="center")

    if yellow_end >= yellow_start:
        ws.merge_cells(start_row=3, start_column=yellow_start, end_row=3, end_column=yellow_end)
        yc = ws.cell(row=3, column=yellow_start)
        yc.fill = PatternFill("solid", fgColor="FFFF00")

    ws.cell(row=3, column=client_label_col, value="Client:")
    ws.cell(row=3, column=client_label_col).fill = PatternFill("solid", fgColor="99CCFF")
    ws.cell(row=3, column=client_label_col).font = Font(bold=True, size=11, color="000000")
    ws.cell(row=3, column=client_label_col).alignment = Alignment(horizontal="center", vertical="center")

    if name_start <= ncols:
        ws.merge_cells(start_row=3, start_column=name_start, end_row=3, end_column=ncols)
        nc = ws.cell(row=3, column=name_start, value=client.get("name", ""))
        nc.fill = PatternFill("solid", fgColor="66CCFF")
        nc.font = Font(bold=True, size=11, color="000000")
        nc.alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[3].height = 22

    # Row 4: Table header — dark blue bg, cyan bold underlined text
    header_fill = PatternFill("solid", fgColor="0033CC")
    header_font = Font(bold=True, color="33CCFF", size=10, underline="single")
    header_align = Alignment(horizontal="center", vertical="center", wrap_text=True)
    for col_index, (_, label) in enumerate(columns, start=1):
        c = ws.cell(row=4, column=col_index, value=label)
        c.fill = header_fill
        c.font = header_font
        c.alignment = header_align
        c.border = border
    ws.row_dimensions[4].height = 34

    # Data rows
    body_font = Font(color="000000", size=10)
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
        ws.row_dimensions[row_index].height = max(48, min(180, 16 * max_lines + 8))

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
