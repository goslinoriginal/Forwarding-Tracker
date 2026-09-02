"""Iteration 3 backend tests: companies, copy_docs_status, renamed labels, branded reports."""
import io
import os
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv
from openpyxl import load_workbook

load_dotenv(Path(__file__).parents[2] / "frontend" / ".env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def patuma_client(api):
    r = api.post(f"{BASE_URL}/api/clients", json={
        "name": "TEST_Iter3_Patuma", "company": "Patuma",
        "optional_columns": {"copy_docs_status": True, "final_destination": True, "sob_date": True},
    })
    assert r.status_code == 200, r.text
    cid = r.json()["id"]
    yield cid
    api.delete(f"{BASE_URL}/api/clients/{cid}")


@pytest.fixture(scope="module")
def clearfreight_client(api):
    r = api.post(f"{BASE_URL}/api/clients", json={
        "name": "TEST_Iter3_Clearfreight", "company": "Clearfreight",
    })
    assert r.status_code == 200, r.text
    cid = r.json()["id"]
    yield cid
    api.delete(f"{BASE_URL}/api/clients/{cid}")


# ---- Companies endpoint ----
def test_companies_endpoint(api):
    r = api.get(f"{BASE_URL}/api/companies")
    assert r.status_code == 200
    data = r.json()
    assert "companies" in data
    keys = {c["key"] for c in data["companies"]}
    assert keys == {"Patuma", "Clearfreight"}
    patuma = next(c for c in data["companies"] if c["key"] == "Patuma")
    assert patuma["name"] == "PATUMA FREIGHT"
    assert patuma["suffix"] == "(PTY) LTD"
    assert "tagline" in patuma
    assert "reg" in patuma
    clearfreight = next(c for c in data["companies"] if c["key"] == "Clearfreight")
    assert clearfreight["name"] == "CLEARFREIGHT"


# ---- Client company field ----
def test_client_company_field_persisted(api, patuma_client, clearfreight_client):
    r = api.get(f"{BASE_URL}/api/clients/{patuma_client}")
    assert r.json()["company"] == "Patuma"
    r = api.get(f"{BASE_URL}/api/clients/{clearfreight_client}")
    assert r.json()["company"] == "Clearfreight"


def test_client_invalid_company_falls_back_to_patuma(api):
    r = api.post(f"{BASE_URL}/api/clients", json={"name": "TEST_Iter3_BadCo", "company": "Bogus"})
    assert r.status_code == 200
    cid = r.json()["id"]
    assert r.json()["company"] == "Patuma"
    api.delete(f"{BASE_URL}/api/clients/{cid}")


def test_client_patch_updates_company(api, patuma_client):
    r = api.patch(f"{BASE_URL}/api/clients/{patuma_client}", json={"company": "Clearfreight"})
    assert r.status_code == 200
    assert r.json()["company"] == "Clearfreight"
    # revert
    r = api.patch(f"{BASE_URL}/api/clients/{patuma_client}", json={"company": "Patuma"})
    assert r.json()["company"] == "Patuma"


def test_client_patch_invalid_company_ignored(api, patuma_client):
    r = api.patch(f"{BASE_URL}/api/clients/{patuma_client}", json={"company": "NotACompany"})
    assert r.status_code == 200
    assert r.json()["company"] == "Patuma"


# ---- Shipment copy_docs_status ----
def test_shipment_copy_docs_status_roundtrip(api, patuma_client):
    r = api.post(f"{BASE_URL}/api/shipments", json={
        "client_id": patuma_client, "supplier": "TEST_COPY", "copy_docs_status": "Received",
    })
    assert r.status_code == 200
    assert r.json()["copy_docs_status"] == "Received"
    sid = r.json()["id"]
    r = api.patch(f"{BASE_URL}/api/shipments/{sid}", json={"copy_docs_status": "Awaiting original"})
    assert r.status_code == 200
    assert r.json()["copy_docs_status"] == "Awaiting original"
    # GET verify
    r = api.get(f"{BASE_URL}/api/shipments?client_id={patuma_client}")
    ship = next(s for s in r.json() if s["id"] == sid)
    assert ship["copy_docs_status"] == "Awaiting original"


# ---- Report preview: renamed columns + copy_docs_status ----
def test_preview_columns_renamed_labels(api, patuma_client):
    r = api.get(f"{BASE_URL}/api/reports/{patuma_client}/preview")
    assert r.status_code == 200
    data = r.json()
    labels = {c["key"]: c["label"] for c in data["columns"]}
    # Renamed labels
    assert labels.get("order_booking_file") == "Order"
    assert labels.get("file_number") == "Booking File"
    assert labels.get("status") == "Shipped/Pending"
    assert labels.get("sob_date") == "SOB DATE/RCG"
    assert labels.get("vessel_block") == "Vessel"
    assert labels.get("eta") == "DBN Port ETA"
    assert labels.get("final_destination") == "Final Destination"
    assert labels.get("comments") == "Comments"
    assert labels.get("copy_docs_status") == "Copy Docs Status"
    # Client company in response
    assert data["client"]["company"] == "Patuma"


def test_preview_copy_docs_only_when_enabled(api, clearfreight_client):
    # clearfreight_client did not enable copy_docs_status
    r = api.get(f"{BASE_URL}/api/reports/{clearfreight_client}/preview")
    keys = [c["key"] for c in r.json()["columns"]]
    assert "copy_docs_status" not in keys
    # enable and re-check
    api.patch(f"{BASE_URL}/api/clients/{clearfreight_client}",
              json={"optional_columns": {"copy_docs_status": True}})
    r = api.get(f"{BASE_URL}/api/reports/{clearfreight_client}/preview")
    keys = [c["key"] for c in r.json()["columns"]]
    assert "copy_docs_status" in keys


def test_preview_expected_freight_rate_label(api, patuma_client):
    api.patch(f"{BASE_URL}/api/clients/{patuma_client}",
              json={"optional_columns": {"expected_freight_rate": True, "copy_docs_status": True,
                                          "final_destination": True, "sob_date": True}})
    r = api.get(f"{BASE_URL}/api/reports/{patuma_client}/preview")
    labels = {c["key"]: c["label"] for c in r.json()["columns"]}
    assert labels.get("expected_freight_rate") == "EXPECTED FREIGHT RATE per container"


# ---- PDF / XLSX for both companies ----
def test_pdf_patuma(api, patuma_client):
    # add a shipment
    api.post(f"{BASE_URL}/api/shipments", json={
        "client_id": patuma_client, "supplier": "TEST_PDF_P", "vessel_name": "MSC ALPHA",
        "tracking_doc_number": "MEDU1", "carrier": "MSC", "copy_docs_status": "OK",
    })
    r = api.get(f"{BASE_URL}/api/reports/{patuma_client}/pdf")
    assert r.status_code == 200
    assert "application/pdf" in r.headers["content-type"]
    assert r.content[:5] == b"%PDF-"
    assert len(r.content) > 2000


def test_pdf_clearfreight(api, clearfreight_client):
    api.post(f"{BASE_URL}/api/shipments", json={
        "client_id": clearfreight_client, "supplier": "TEST_PDF_C",
    })
    r = api.get(f"{BASE_URL}/api/reports/{clearfreight_client}/pdf")
    assert r.status_code == 200
    assert "application/pdf" in r.headers["content-type"]
    assert r.content[:5] == b"%PDF-"
    assert len(r.content) > 2000


def test_pdf_with_many_columns(api, patuma_client):
    # Enable ALL optional columns
    api.patch(f"{BASE_URL}/api/clients/{patuma_client}", json={"optional_columns": {
        "hbill_released": True, "expected_freight_rate": True, "copy_docs_status": True,
        "final_destination": True, "sob_date": True, "pol": True,
    }})
    r = api.get(f"{BASE_URL}/api/reports/{patuma_client}/pdf")
    assert r.status_code == 200
    assert r.content[:5] == b"%PDF-"
    assert len(r.content) > 2000


def test_pdf_with_min_columns(api):
    """PDF should not crash with only mandatory columns (6 columns)."""
    r = api.post(f"{BASE_URL}/api/clients", json={
        "name": "TEST_Iter3_Min", "company": "Patuma",
        "optional_columns": {"hbill_released": False, "expected_freight_rate": False,
                             "copy_docs_status": False, "final_destination": False,
                             "sob_date": False, "pol": False},
    })
    cid = r.json()["id"]
    try:
        api.post(f"{BASE_URL}/api/shipments", json={"client_id": cid, "supplier": "S"})
        pv = api.get(f"{BASE_URL}/api/reports/{cid}/preview").json()
        # supplier, order, booking, status, vessel, eta, comments = 7 mandatory
        assert len(pv["columns"]) >= 6
        r = api.get(f"{BASE_URL}/api/reports/{cid}/pdf")
        assert r.status_code == 200
        assert r.content[:5] == b"%PDF-"
        assert len(r.content) > 2000
    finally:
        api.delete(f"{BASE_URL}/api/clients/{cid}")


def test_xlsx_both_companies(api, patuma_client, clearfreight_client):
    for cid in (patuma_client, clearfreight_client):
        r = api.get(f"{BASE_URL}/api/reports/{cid}/xlsx")
        assert r.status_code == 200
        assert "spreadsheetml" in r.headers["content-type"]
        assert r.content[:2] == b"PK"
        assert len(r.content) > 2000


def test_xlsx_branded_header(api, patuma_client):
    """Verify SHIPPING REPORT banner + company name in XLSX."""
    r = api.get(f"{BASE_URL}/api/reports/{patuma_client}/xlsx")
    wb = load_workbook(io.BytesIO(r.content))
    ws = wb.active
    # Row 1: company name
    assert "PATUMA FREIGHT" in (ws.cell(row=1, column=1).value or "")
    # Row 3: SHIPPING REPORT banner
    assert ws.cell(row=3, column=1).value == "SHIPPING REPORT"
    banner_fill = ws.cell(row=3, column=1).fill.fgColor.rgb or ""
    assert "0000CC" in banner_fill
    # Row 5: table header - first column label "Supplier"
    assert ws.cell(row=5, column=1).value == "Supplier"


def test_xlsx_clearfreight_branding(api, clearfreight_client):
    r = api.get(f"{BASE_URL}/api/reports/{clearfreight_client}/xlsx")
    wb = load_workbook(io.BytesIO(r.content))
    ws = wb.active
    assert "CLEARFREIGHT" in (ws.cell(row=1, column=1).value or "")
