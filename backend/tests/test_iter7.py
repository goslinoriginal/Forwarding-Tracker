"""Iteration 7 tests: XLSX logo sizing (capped at 60% of table width, centered)
plus regressions from iter 6 (comment prefix behavior, PDF export size)."""
import io
import os
from datetime import date

import pytest
import requests
from openpyxl import load_workbook
from openpyxl.drawing.spreadsheet_drawing import OneCellAnchor


def _load_backend_url() -> str:
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if not v:
        env = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", ".env")
        with open(env) as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    v = line.split("=", 1)[1].strip()
                    break
    return v.rstrip("/")


BASE_URL = _load_backend_url()
API = f"{BASE_URL}/api"

FLANGE_ID = "61aa6ac3-3adb-44a7-832b-94799a99faf7"  # Patuma
CF_ID = "b2d8c8cc-f981-4ea8-954c-cef5422cf3ce"      # Clearfreight

EMU_PER_PIXEL = 9525


def today_prefix() -> str:
    t = date.today()
    return f"{t.day:02d}.{t.month:02d}"


@pytest.fixture(scope="module")
def created_shipments():
    ids = []
    yield ids
    for sid in ids:
        try:
            requests.delete(f"{API}/shipments/{sid}", timeout=10)
        except Exception:
            pass


def _create_shipment(client_id: str, planned_etd: str = "2025-09-12") -> dict:
    r = requests.post(f"{API}/shipments", json={
        "client_id": client_id,
        "supplier": "TEST_iter7",
        "planned_etd": planned_etd,
    }, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _load_xlsx(client_id: str):
    r = requests.get(f"{API}/reports/{client_id}/xlsx", timeout=30)
    assert r.status_code == 200, r.text
    return load_workbook(io.BytesIO(r.content)), r.content


def _compute_table_pixel_width(ws) -> int:
    """Sum column widths (only those with header value in row 4) using width_chars * 7 + 5."""
    total = 0
    for cell in ws[4]:
        if cell.value is None:
            continue
        w = ws.column_dimensions[cell.column_letter].width
        if w:
            total += int(w * 7 + 5)
    return total


def _image_placement(ws):
    """Return (image_left_edge_px, image_width_px, total_width_px) using
    the OneCellAnchor from + colOff and ext.cx."""
    img = ws._images[0]
    assert isinstance(img.anchor, OneCellAnchor), f"anchor type: {type(img.anchor)}"
    anchor_col = img.anchor._from.col  # 0-indexed column
    col_off_emu = img.anchor._from.colOff or 0
    ext_cx_emu = img.anchor.ext.cx

    # Sum pixel widths of the columns preceding anchor_col
    left_px = 0
    # iterate all headered columns in order
    ordered_letters = [c.column_letter for c in ws[4] if c.value is not None]
    for idx, letter in enumerate(ordered_letters):
        if idx >= anchor_col:
            break
        w = ws.column_dimensions[letter].width
        if w:
            left_px += int(w * 7 + 5)
    left_px += col_off_emu // EMU_PER_PIXEL
    img_w_px = ext_cx_emu // EMU_PER_PIXEL
    total_px = _compute_table_pixel_width(ws)
    return left_px, img_w_px, total_px, ext_cx_emu // EMU_PER_PIXEL


# ----------------------- ITER 7 core: logo sizing -----------------------

@pytest.mark.parametrize("client_id,label", [(FLANGE_ID, "Patuma"), (CF_ID, "Clearfreight")])
def test_xlsx_logo_within_table_width(client_id, label):
    wb, _ = _load_xlsx(client_id)
    ws = wb.active
    assert len(ws._images) >= 1, f"{label}: no image embedded"

    left_px, img_w_px, total_px, _ = _image_placement(ws)
    print(f"[{label}] total_px={total_px}, img_w_px={img_w_px}, left_px={left_px}")

    # 30-60% band
    assert img_w_px <= int(0.6 * total_px) + 1, \
        f"{label}: img width {img_w_px}px exceeds 60% of table ({0.6*total_px:.0f}px)"
    assert img_w_px >= int(0.3 * total_px) - 1, \
        f"{label}: img width {img_w_px}px is under 30% of table ({0.3*total_px:.0f}px)"

    # Horizontally centered within table
    expected_left = (total_px - img_w_px) // 2
    assert abs(left_px - expected_left) <= 3, \
        f"{label}: left={left_px}px expected ~{expected_left}px (tol 3px)"


def test_xlsx_row1_min_height_flange():
    wb, _ = _load_xlsx(FLANGE_ID)
    ws = wb.active
    assert ws.row_dimensions[1].height >= 60, ws.row_dimensions[1].height


def test_xlsx_row1_min_height_clearfreight():
    wb, _ = _load_xlsx(CF_ID)
    ws = wb.active
    assert ws.row_dimensions[1].height >= 60, ws.row_dimensions[1].height


def test_xlsx_comments_column_width_32():
    wb, _ = _load_xlsx(FLANGE_ID)
    ws = wb.active
    letter = None
    for cell in ws[4]:
        if cell.value == "Comments":
            letter = cell.column_letter
            break
    assert letter is not None, "Comments column not found"
    assert ws.column_dimensions[letter].width == 32, ws.column_dimensions[letter].width


# ----------------------- Regression: comment prefix -----------------------

def test_create_shipment_seeds_today_prefix(created_shipments):
    s = _create_shipment(FLANGE_ID)
    created_shipments.append(s["id"])
    assert s["comments"].startswith(f"{today_prefix()} - Planned ETD "), s["comments"]


def test_append_comment_today_prefix(created_shipments):
    s = _create_shipment(FLANGE_ID)
    created_shipments.append(s["id"])
    r = requests.post(f"{API}/shipments/{s['id']}/append-comment",
                      json={"snippet": "Awaiting confirmation of departure."}, timeout=15)
    assert r.status_code == 200
    c = r.json()["comments"]
    assert c.startswith(f"{today_prefix()} - "), c
    assert "Awaiting confirmation of departure." in c


def test_mark_delayed_refreshes_prefix(created_shipments):
    s = _create_shipment(FLANGE_ID)
    created_shipments.append(s["id"])
    requests.patch(f"{API}/shipments/{s['id']}",
                   json={"comments": "01.01 - Planned ETD 12.09."}, timeout=10)
    r = requests.post(f"{API}/shipments/{s['id']}/mark-delayed",
                      json={"new_etd": "2025-09-18"}, timeout=15)
    assert r.status_code == 200
    c = r.json()["comments"]
    assert c.startswith(f"{today_prefix()} - "), c
    assert "18.09" in c


def test_mark_shipped_refreshes_prefix(created_shipments):
    s = _create_shipment(FLANGE_ID)
    created_shipments.append(s["id"])
    requests.patch(f"{API}/shipments/{s['id']}",
                   json={"comments": "01.01 - Planned ETD 12.09."}, timeout=10)
    r = requests.post(f"{API}/shipments/{s['id']}/mark-shipped",
                      json={"sob_date": "2025-09-18"}, timeout=15)
    assert r.status_code == 200
    c = r.json()["comments"]
    assert c.startswith(f"{today_prefix()} - "), c
    assert "SOB 18.09" in c


# ----------------------- Regression: PDF export -----------------------

@pytest.mark.parametrize("client_id,label", [(FLANGE_ID, "Patuma"), (CF_ID, "Clearfreight")])
def test_pdf_export_ok_with_logo(client_id, label):
    r = requests.get(f"{API}/reports/{client_id}/pdf", timeout=30)
    assert r.status_code == 200, r.text
    assert r.headers.get("content-type", "").startswith("application/pdf"), r.headers
    size = len(r.content)
    print(f"[{label}] pdf size = {size} bytes")
    assert size >= 40 * 1024, f"{label}: pdf too small ({size} bytes) - logo likely missing"
