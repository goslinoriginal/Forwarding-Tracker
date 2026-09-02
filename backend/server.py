from __future__ import annotations

import io
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Any, List, Optional
from xml.sax.saxutils import escape

from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from motor.motor_asyncio import AsyncIOMotorClient
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from pydantic import BaseModel, ConfigDict, Field
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A3, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import LongTable, Paragraph, SimpleDocTemplate, TableStyle
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
    "final_destination": True,
    "sob_date": True,
    "pol": False,
}

CARRIERS = ["MSC", "Maersk", "ONE", "COSCO", "Hapag Lloyd", "PIL", "CMA CGM", "Vanguard", "Other"]


# ---------- Models ----------
def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Client(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    contact_email: Optional[str] = None
    notes: Optional[str] = None
    optional_columns: dict = Field(default_factory=lambda: dict(DEFAULT_OPTIONAL_COLUMNS))
    created_at: str = Field(default_factory=_now_iso)


class ClientCreate(BaseModel):
    name: str
    contact_email: Optional[str] = None
    notes: Optional[str] = None
    optional_columns: Optional[dict] = None


class ClientUpdate(BaseModel):
    name: Optional[str] = None
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
    status: str = "Booked"  # Booked / Shipped / Delayed
    sob_date: Optional[str] = None
    vessel_name: str = ""
    tracking_doc_number: str = ""
    carrier: str = "Other"
    pol: Optional[str] = None
    pod: str = ""
    eta: Optional[str] = None
    final_destination: Optional[str] = None
    comments: str = ""
    hbill_released: Optional[bool] = None
    expected_freight_rate: Optional[str] = None
    anf_received: bool = False
    anf_received_at: Optional[str] = None
    created_at: str = Field(default_factory=_now_iso)
    updated_at: str = Field(default_factory=_now_iso)


class ShipmentCreate(BaseModel):
    client_id: str
    supplier: str = ""
    order_booking_file: str = ""
    file_number: str = ""
    status: str = "Booked"
    sob_date: Optional[str] = None
    vessel_name: str = ""
    tracking_doc_number: str = ""
    carrier: str = "Other"
    pol: Optional[str] = None
    pod: str = ""
    eta: Optional[str] = None
    final_destination: Optional[str] = None
    comments: str = ""
    hbill_released: Optional[bool] = None
    expected_freight_rate: Optional[str] = None


class ShipmentUpdate(BaseModel):
    supplier: Optional[str] = None
    order_booking_file: Optional[str] = None
    file_number: Optional[str] = None
    status: Optional[str] = None
    sob_date: Optional[str] = None
    vessel_name: Optional[str] = None
    tracking_doc_number: Optional[str] = None
    carrier: Optional[str] = None
    pol: Optional[str] = None
    pod: Optional[str] = None
    eta: Optional[str] = None
    final_destination: Optional[str] = None
    comments: Optional[str] = None
    hbill_released: Optional[bool] = None
    expected_freight_rate: Optional[str] = None
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
    client_obj = Client(
        name=payload.name,
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
    if payload.optional_columns is not None:
        merged = dict(existing.get("optional_columns") or DEFAULT_OPTIONAL_COLUMNS)
        for k, v in payload.optional_columns.items():
            if k in DEFAULT_OPTIONAL_COLUMNS:
                merged[k] = bool(v)
        updates["optional_columns"] = merged
    if updates:
        await db.clients.update_one({"id": client_id}, {"$set": updates})
    return await _get_client(client_id)


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
    ship = Shipment(**payload.model_dump())
    await db.shipments.insert_one(ship.model_dump())
    return ship


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
    updates["updated_at"] = _now_iso()
    await db.shipments.update_one({"id": shipment_id}, {"$set": updates})
    doc = await db.shipments.find_one({"id": shipment_id}, _proj())
    return doc


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
    ("order_booking_file", "Order / Booking File"),
    ("file_number", "File #"),
    ("status", "Shipped / Pending"),
    ("sob_date", "SOB Date / RCG"),
    ("vessel_block", "Vessel"),
    ("pol", "POL"),
    ("pod", "POD (Port)"),
    ("eta", "ETA"),
    ("final_destination", "Final Destination"),
    ("comments", "Comments"),
    ("hbill_released", "H/bill Released by Supplier"),
    ("expected_freight_rate", "Expected Freight Rate"),
]

OPTIONAL_KEYS = {
    "sob_date": "sob_date",
    "pol": "pol",
    "final_destination": "final_destination",
    "hbill_released": "hbill_released",
    "expected_freight_rate": "expected_freight_rate",
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
        carrier = ship.get("carrier") or ""
        parts = []
        if vessel:
            parts.append(vessel)
        if doc:
            parts.append(doc)
        if carrier and carrier != "Other":
            parts.append(f"[{carrier}]")
        return "\n".join(parts)
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
        "client": {"id": client["id"], "name": client["name"]},
        "date": datetime.now(timezone.utc).strftime("%d.%m.%Y"),
        "columns": [{"key": k, "label": l} for k, l in columns],
        "rows": rows,
    }


def _build_xlsx(client_name: str, columns: list[tuple[str, str]], rows: list[dict]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Status Report"
    ws.freeze_panes = "A3"
    ws.sheet_view.showGridLines = False
    ws.page_setup.orientation = ws.ORIENTATION_LANDSCAPE

    title = f"Shipment Status Report — {client_name}"
    ws.cell(row=1, column=1, value=title)
    ws.cell(row=1, column=1).font = Font(bold=True, size=14, color="0F172A")
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=len(columns))

    thin = Side(style="thin", color="94A3B8")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    header_fill = PatternFill("solid", fgColor="0F172A")
    header_font = Font(bold=True, color="FFFFFF")
    body_alignment = Alignment(vertical="top", wrap_text=True)
    header_alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

    for col_index, (_, label) in enumerate(columns, start=1):
        cell = ws.cell(row=2, column=col_index, value=label)
        cell.fill = header_fill
        cell.font = header_font
        cell.border = border
        cell.alignment = header_alignment
    ws.row_dimensions[2].height = 28

    widths = [max(14, min(40, len(label) + 4)) for _, label in columns]
    for row_index, row in enumerate(rows, start=3):
        for col_index, (key, _) in enumerate(columns, start=1):
            value = row.get(key, "") or ""
            cell = ws.cell(row=row_index, column=col_index, value=value)
            cell.border = border
            cell.alignment = body_alignment
            if value:
                longest = max((len(line) + 2) for line in value.splitlines())
                widths[col_index - 1] = min(50, max(widths[col_index - 1], longest))

    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w

    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def _build_pdf(client_name: str, columns: list[tuple[str, str]], rows: list[dict]) -> bytes:
    page_width, page_height = landscape(A3)
    margin = 12 * mm
    available_width = page_width - (2 * margin)

    weights = [max(10, min(28, len(label) + 6)) for _, label in columns]
    col_widths = [available_width * w / sum(weights) for w in weights]

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "Title", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=14,
        textColor=colors.HexColor("#0F172A"), spaceAfter=6, alignment=TA_LEFT,
    )
    subtitle_style = ParagraphStyle(
        "Subtitle", parent=styles["Normal"], fontName="Helvetica",
        fontSize=9, textColor=colors.HexColor("#475569"), spaceAfter=8,
    )
    header_style = ParagraphStyle(
        "Header", parent=styles["Normal"], fontName="Helvetica-Bold",
        fontSize=8, leading=10, textColor=colors.white, alignment=TA_LEFT,
    )
    body_style = ParagraphStyle(
        "Body", parent=styles["Normal"], fontName="Helvetica",
        fontSize=8, leading=10, alignment=TA_LEFT, wordWrap="CJK",
    )

    def para(text: str, style: ParagraphStyle) -> Paragraph:
        safe = escape(str(text or "")).replace("\n", "<br/>")
        return Paragraph(safe or " ", style)

    table_data = [[para(label, header_style) for _, label in columns]]
    for row in rows:
        table_data.append([para(row.get(key, ""), body_style) for key, _ in columns])

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=landscape(A3),
        leftMargin=margin, rightMargin=margin, topMargin=margin, bottomMargin=margin,
        title=f"Status Report - {client_name}",
    )
    date_str = datetime.now(timezone.utc).strftime("%d.%m.%Y")

    story = [
        Paragraph(f"Shipment Status Report — {escape(client_name)}", title_style),
        Paragraph(f"Report date: {date_str}", subtitle_style),
    ]
    table = LongTable(table_data, colWidths=col_widths, repeatRows=1, splitByRow=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F172A")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#94A3B8")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F1F5F9")]),
    ]))
    story.append(table)
    doc.build(story)
    return buffer.getvalue()


@api_router.get("/reports/{client_id}/xlsx")
async def export_xlsx(client_id: str):
    client, columns, rows = await _report_rows(client_id)
    content = _build_xlsx(client["name"], columns, rows)
    filename = f"status-report-{client['name'].replace(' ', '_')}-{datetime.now(timezone.utc).strftime('%Y%m%d')}.xlsx"
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@api_router.get("/reports/{client_id}/pdf")
async def export_pdf(client_id: str):
    client, columns, rows = await _report_rows(client_id)
    content = _build_pdf(client["name"], columns, rows)
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
