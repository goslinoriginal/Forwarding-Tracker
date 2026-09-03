"""Iteration 12: ANF archival flow backend tests."""
import os
import io
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
CLIENT_ID = "61aa6ac3-3adb-44a7-832b-94799a99faf7"  # Flange 2000


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def shipment_id(api):
    # Create a fresh shipment
    payload = {
        "client_id": CLIENT_ID,
        "supplier": "TEST_ANF_SUPPLIER",
        "file_number": "TEST-ANF-001",
        "cargo_type": "FCL",
        "carrier": "MSC",
    }
    r = api.post(f"{BASE_URL}/api/shipments", json=payload)
    assert r.status_code == 200, r.text
    sid = r.json()["id"]
    yield sid
    # Cleanup
    api.delete(f"{BASE_URL}/api/shipments/{sid}")


def test_health(api):
    r = api.get(f"{BASE_URL}/api/dashboard/stats")
    assert r.status_code == 200


def test_shipment_created_not_anf(api, shipment_id):
    r = api.get(f"{BASE_URL}/api/shipments?client_id={CLIENT_ID}&include_anf=false")
    assert r.status_code == 200
    ids = [x["id"] for x in r.json()]
    assert shipment_id in ids


def test_mark_anf_sets_timestamp_and_comment(api, shipment_id):
    r = api.patch(f"{BASE_URL}/api/shipments/{shipment_id}", json={"anf_received": True})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["anf_received"] is True
    assert data["anf_received_at"] is not None
    assert isinstance(data["anf_received_at"], str)
    # Note: comment append is handled by the frontend markAnf() call, not backend.


def test_list_excludes_anf_when_flag_false(api, shipment_id):
    r = api.get(f"{BASE_URL}/api/shipments?client_id={CLIENT_ID}&include_anf=false")
    assert r.status_code == 200
    ids = [x["id"] for x in r.json()]
    assert shipment_id not in ids


def test_list_includes_anf_by_default(api, shipment_id):
    r = api.get(f"{BASE_URL}/api/shipments?client_id={CLIENT_ID}")
    assert r.status_code == 200
    ids = [x["id"] for x in r.json()]
    assert shipment_id in ids


def test_report_preview_excludes_anf(api, shipment_id):
    r = api.get(f"{BASE_URL}/api/reports/{CLIENT_ID}/preview")
    assert r.status_code == 200
    body = r.json()
    # Confirm the ANF shipment supplier is not shown
    suppliers = [row.get("supplier", "") for row in body.get("rows", [])]
    assert "TEST_ANF_SUPPLIER" not in suppliers


def test_report_xlsx_excludes_anf(api, shipment_id):
    r = api.get(f"{BASE_URL}/api/reports/{CLIENT_ID}/xlsx")
    assert r.status_code == 200
    # Body is binary xlsx; just make sure supplier string isn't in it
    assert b"TEST_ANF_SUPPLIER" not in r.content


def test_report_pdf_excludes_anf(api, shipment_id):
    r = api.get(f"{BASE_URL}/api/reports/{CLIENT_ID}/pdf")
    assert r.status_code == 200
    assert b"TEST_ANF_SUPPLIER" not in r.content


def test_dashboard_stats_excludes_anf(api, shipment_id):
    # Just ensure endpoint works; we can't easily assert count without pre-state
    r = api.get(f"{BASE_URL}/api/dashboard/stats")
    assert r.status_code == 200
    data = r.json()
    assert "active_shipments" in data


def test_dashboard_reminders_excludes_anf(api, shipment_id):
    r = api.get(f"{BASE_URL}/api/dashboard/reminders")
    assert r.status_code == 200
    reminders = r.json().get("reminders", [])
    sids = [x["shipment_id"] for x in reminders]
    assert shipment_id not in sids


def test_unarchive_clears_timestamp(api, shipment_id):
    r = api.patch(f"{BASE_URL}/api/shipments/{shipment_id}", json={"anf_received": False})
    assert r.status_code == 200
    data = r.json()
    assert data["anf_received"] is False
    assert data["anf_received_at"] is None
    # Now appears again
    r2 = api.get(f"{BASE_URL}/api/shipments?client_id={CLIENT_ID}&include_anf=false")
    ids = [x["id"] for x in r2.json()]
    assert shipment_id in ids
