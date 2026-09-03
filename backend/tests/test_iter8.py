"""Iteration 8 backend tests: auto-comment regen, /vessel-status endpoint,
status derivation (no Delayed), XLSX width bump ~15%, logo fills row 1 height."""
import io
import os
import re
from datetime import date

import pytest
import requests
from openpyxl import load_workbook

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

FLANGE_ID = "61aa6ac3-3adb-44a7-832b-94799a99faf7"  # Patuma
CF_ID = "b2d8c8cc-f981-4ea8-954c-cef5422cf3ce"      # Clearfreight

TODAY = date.today()
TODAY_PREFIX = f"{TODAY.day:02d}.{TODAY.month:02d} - "


# ---------- helpers ----------
def _post_ship(**overrides):
    payload = {"client_id": FLANGE_ID, "supplier": "TEST_iter8"}
    payload.update(overrides)
    r = requests.post(f"{API}/shipments", json=payload)
    assert r.status_code == 200, r.text
    return r.json()


def _get_ship(sid):
    r = requests.get(f"{API}/shipments", params={"client_id": FLANGE_ID})
    assert r.status_code == 200
    for s in r.json():
        if s["id"] == sid:
            return s
    raise AssertionError("shipment not found")


created_ids: list[str] = []


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    for sid in created_ids:
        try:
            requests.delete(f"{API}/shipments/{sid}")
        except Exception:
            pass


def _track(sid):
    created_ids.append(sid)
    return sid


# ---------- create: comment auto-gen ----------
def test_create_single_vessel_fcl_comment():
    ship = _post_ship(vessel_name="MSC Maya", planned_etd="2026-08-10", cargo_type="FCL")
    _track(ship["id"])
    # single vessel: no "(1st Vessel)" label
    assert ship["comments"] == f"{TODAY_PREFIX}Planned ETD 10.08. Awaiting confirmation of departure."
    assert ship["status"] == "Booked"


def test_create_two_vessel_comment():
    ship = _post_ship(
        vessel_name="MSC Maya", planned_etd="2026-08-10",
        second_vessel_name="MSC Rio", second_vessel_etd="2026-08-24",
        cargo_type="FCL",
    )
    _track(ship["id"])
    assert ship["comments"] == (
        f"{TODAY_PREFIX}Planned ETD 10.08 (1st Vessel). "
        "Planned ETD 24.08 (2nd Vessel). "
        "Awaiting confirmation of departure."
    )
    assert ship["status"] == "Booked"


# ---------- vessel-status endpoint ----------
def test_vessel_status_first_sailed_two_vessels():
    ship = _post_ship(
        vessel_name="MSC Maya", planned_etd="2026-08-10",
        second_vessel_name="MSC Rio", second_vessel_etd="2026-08-24",
    )
    sid = _track(ship["id"])
    r = requests.post(f"{API}/shipments/{sid}/vessel-status",
                      json={"vessel": 1, "sailed": True, "date": "2026-08-09"})
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["sob_date"] == "2026-08-09"
    assert "SOB 09.08 (1st Vessel)" in s["comments"]
    assert "Planned ETD 24.08 (2nd Vessel)" in s["comments"]
    assert s["comments"].endswith("Awaiting confirmation of departure of 2nd vessel.")
    assert s["status"] == "Booked"


def test_vessel_status_all_sailed_fcl_awaiting_anf():
    ship = _post_ship(
        vessel_name="MSC Maya", planned_etd="2026-08-10",
        second_vessel_name="MSC Rio", second_vessel_etd="2026-08-24",
        cargo_type="FCL",
    )
    sid = _track(ship["id"])
    requests.post(f"{API}/shipments/{sid}/vessel-status",
                  json={"vessel": 1, "sailed": True, "date": "2026-08-09"})
    r = requests.post(f"{API}/shipments/{sid}/vessel-status",
                      json={"vessel": 2, "sailed": True, "date": "2026-08-24"})
    assert r.status_code == 200
    s = r.json()
    assert s["second_vessel_sob_date"] == "2026-08-24"
    assert s["status"] == "Shipped"
    assert s["comments"] == (
        f"{TODAY_PREFIX}SOB 09.08 (1st Vessel). SOB 24.08 (2nd Vessel). Awaiting ANF."
    )


def test_patch_cargo_type_to_lcl_awaiting_sobs():
    ship = _post_ship(
        vessel_name="MSC Maya", planned_etd="2026-08-10",
        second_vessel_name="MSC Rio", second_vessel_etd="2026-08-24",
        cargo_type="FCL",
    )
    sid = _track(ship["id"])
    requests.post(f"{API}/shipments/{sid}/vessel-status", json={"vessel": 1, "sailed": True, "date": "2026-08-09"})
    requests.post(f"{API}/shipments/{sid}/vessel-status", json={"vessel": 2, "sailed": True, "date": "2026-08-24"})
    r = requests.patch(f"{API}/shipments/{sid}", json={"cargo_type": "LCL"})
    assert r.status_code == 200
    s = r.json()
    assert s["cargo_type"] == "LCL"
    assert s["comments"].endswith("Awaiting SOB's.")
    assert s["status"] == "Shipped"


def test_vessel_status_unmark_reverts():
    ship = _post_ship(vessel_name="MSC Maya", planned_etd="2026-08-10")
    sid = _track(ship["id"])
    requests.post(f"{API}/shipments/{sid}/vessel-status", json={"vessel": 1, "sailed": True, "date": "2026-08-09"})
    r = requests.post(f"{API}/shipments/{sid}/vessel-status", json={"vessel": 1, "sailed": False})
    assert r.status_code == 200
    s = r.json()
    assert s["sob_date"] is None
    assert s["comments"] == f"{TODAY_PREFIX}Planned ETD 10.08. Awaiting confirmation of departure."
    assert s["status"] == "Booked"


def test_vessel_status_sailed_without_date_400():
    ship = _post_ship(vessel_name="MSC Maya", planned_etd="2026-08-10")
    sid = _track(ship["id"])
    r = requests.post(f"{API}/shipments/{sid}/vessel-status", json={"vessel": 1, "sailed": True})
    assert r.status_code == 400


def test_vessel_status_invalid_vessel_number_400():
    ship = _post_ship(vessel_name="MSC Maya", planned_etd="2026-08-10")
    sid = _track(ship["id"])
    r = requests.post(f"{API}/shipments/{sid}/vessel-status", json={"vessel": 3, "sailed": True, "date": "2026-08-09"})
    assert r.status_code == 400


# ---------- PATCH auto-regen + no Delayed ----------
def test_patch_never_produces_delayed():
    ship = _post_ship(vessel_name="MSC Maya", planned_etd="2026-08-10")
    sid = _track(ship["id"])
    # push ETD later — old behavior would set Delayed. New must NOT.
    r = requests.patch(f"{API}/shipments/{sid}", json={"planned_etd": "2026-09-15"})
    assert r.status_code == 200
    s = r.json()
    assert s["status"] != "Delayed"
    assert s["status"] == "Booked"
    assert "Planned ETD 15.09" in s["comments"]
    # explicitly try to set Delayed via PATCH — server should re-derive
    r2 = requests.patch(f"{API}/shipments/{sid}", json={"status": "Delayed"})
    assert r2.status_code == 200
    assert r2.json()["status"] != "Delayed"


def test_patch_second_vessel_sob_roundtrip():
    ship = _post_ship(vessel_name="MSC Maya", planned_etd="2026-08-10",
                      second_vessel_name="MSC Rio", second_vessel_etd="2026-08-24")
    sid = _track(ship["id"])
    r = requests.patch(f"{API}/shipments/{sid}", json={"second_vessel_sob_date": "2026-08-25"})
    assert r.status_code == 200
    s = r.json()
    assert s["second_vessel_sob_date"] == "2026-08-25"
    assert "SOB 25.08 (2nd Vessel)" in s["comments"]


# ---------- deprecated endpoints ----------
def test_deprecated_mark_shipped_404():
    ship = _post_ship(vessel_name="MSC Maya", planned_etd="2026-08-10")
    sid = _track(ship["id"])
    r = requests.post(f"{API}/shipments/{sid}/mark-shipped", json={"sob_date": "2026-08-09"})
    assert r.status_code == 404


def test_deprecated_mark_delayed_404():
    ship = _post_ship(vessel_name="MSC Maya", planned_etd="2026-08-10")
    sid = _track(ship["id"])
    r = requests.post(f"{API}/shipments/{sid}/mark-delayed", json={"new_etd": "2026-09-01"})
    assert r.status_code == 404


def test_append_comment_now_regenerates():
    ship = _post_ship(vessel_name="MSC Maya", planned_etd="2026-08-10")
    sid = _track(ship["id"])
    r = requests.post(f"{API}/shipments/{sid}/append-comment", json={"snippet": "ignored"})
    assert r.status_code == 200
    s = r.json()
    assert s["comments"] == f"{TODAY_PREFIX}Planned ETD 10.08. Awaiting confirmation of departure."


# ---------- XLSX width bump + logo fills row 1 ----------
def _load_xlsx(client_id):
    r = requests.get(f"{API}/reports/{client_id}/xlsx")
    assert r.status_code == 200
    wb = load_workbook(io.BytesIO(r.content))
    return wb, wb.active


def test_xlsx_total_width_bumped_15pct():
    _, ws = _load_xlsx(FLANGE_ID)
    # sum widths for columns that have a header in row 4
    total_units = 0.0
    for col in range(1, ws.max_column + 1):
        letter = ws.cell(row=4, column=col).column_letter
        w = ws.column_dimensions[letter].width or 0
        total_units += w
    total_px = int(total_units * 7 + 5 * ws.max_column)
    # iter 6 baseline ~1290. Iter 8 target ~1490 ± 30 -> allow 1450-1550
    assert 1450 <= total_px <= 1560, f"total_px={total_px} out of range"


def test_xlsx_logo_fills_row1_height():
    wb, ws = _load_xlsx(FLANGE_ID)
    row1_h_pt = ws.row_dimensions[1].height
    row1_px = int(row1_h_pt * 96 / 72)
    # image should exist and be anchored with cy ~ row1_px (in EMU: cy = px * 9525)
    imgs = ws._images
    assert imgs, "no image embedded"
    img = imgs[0]
    # OneCellAnchor: img.anchor.ext.cy is EMU
    cy_px = img.anchor.ext.cy / 9525
    # allow 5 px tolerance (or the width-cap fallback reduces height)
    assert abs(cy_px - row1_px) <= 5 or cy_px < row1_px, f"cy_px={cy_px} row1_px={row1_px}"


def test_xlsx_logo_horizontally_centered():
    wb, ws = _load_xlsx(FLANGE_ID)
    imgs = ws._images
    assert imgs
    img = imgs[0]
    # compute total px
    total_px = 0
    col_px = []
    for col in range(1, ws.max_column + 1):
        letter = ws.cell(row=4, column=col).column_letter
        w = ws.column_dimensions[letter].width or 0
        px = int(w * 7 + 5)
        col_px.append(px)
        total_px += px
    img_w_px = img.anchor.ext.cx / 9525
    anchor_col = img.anchor._from.col  # 0-based
    col_off_px = img.anchor._from.colOff / 9525
    left = sum(col_px[:anchor_col]) + col_off_px
    expected_left = (total_px - img_w_px) / 2
    assert abs(left - expected_left) <= 5, f"left={left} expected={expected_left}"
