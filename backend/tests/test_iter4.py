"""Iteration 4 backend tests: auto-seeded comment, mark-shipped, mark-delayed."""
import os
from datetime import date
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def client_id():
    r = requests.post(f"{API}/clients", json={"name": "TEST_iter4_client", "company": "Patuma"})
    assert r.status_code == 200, r.text
    cid = r.json()["id"]
    yield cid
    requests.delete(f"{API}/clients/{cid}")


def _create_ship(client_id, **extra):
    payload = {"client_id": client_id, "supplier": "TEST_supp"}
    payload.update(extra)
    r = requests.post(f"{API}/shipments", json=payload)
    assert r.status_code == 200, r.text
    return r.json()


def _today_ddmm():
    t = date.today()
    return f"{t.day:02d}.{t.month:02d}"


# --- Auto-seed comment ---
def test_auto_seed_comment_when_planned_etd_and_no_comment(client_id):
    ship = _create_ship(client_id, planned_etd="2026-09-15")
    expected = f"{_today_ddmm()} - Planned ETD 15.09."
    assert ship["comments"] == expected
    # verify persistence
    r = requests.get(f"{API}/shipments", params={"client_id": client_id})
    got = next(s for s in r.json() if s["id"] == ship["id"])
    assert got["comments"] == expected


def test_auto_seed_does_not_override_explicit_comment(client_id):
    ship = _create_ship(client_id, planned_etd="2026-09-15", comments="Custom note")
    assert ship["comments"] == "Custom note"


def test_no_planned_etd_no_auto_seed(client_id):
    ship = _create_ship(client_id)
    assert ship["comments"] == ""


# --- mark-shipped ---
def test_mark_shipped_iso(client_id):
    ship = _create_ship(client_id, planned_etd="2026-09-15")
    r = requests.post(f"{API}/shipments/{ship['id']}/mark-shipped", json={"sob_date": "2026-09-15"})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["sob_date"] == "2026-09-15"
    assert data["status"] == "Shipped"
    assert "SOB 15.09. Awaiting ANF." in data["comments"]
    # ensure it appended (not overwrote)
    assert data["comments"].startswith(f"{_today_ddmm()} - Planned ETD 15.09.")


def test_mark_shipped_ddmmyyyy_format(client_id):
    ship = _create_ship(client_id)
    r = requests.post(f"{API}/shipments/{ship['id']}/mark-shipped", json={"sob_date": "15.09.2026"})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["sob_date"] == "2026-09-15"
    assert "SOB 15.09." in data["comments"]


def test_mark_shipped_404(client_id):
    r = requests.post(f"{API}/shipments/nonexistent-id/mark-shipped", json={"sob_date": "2026-09-15"})
    assert r.status_code == 404


# --- mark-delayed ---
def test_mark_delayed_iso(client_id):
    ship = _create_ship(client_id, planned_etd="2026-09-10")
    r = requests.post(f"{API}/shipments/{ship['id']}/mark-delayed", json={"new_etd": "2026-09-20"})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["planned_etd"] == "2026-09-20"
    assert data["status"] == "Delayed"
    assert "Vessel delayed slightly. Now planned ETD 20.09." in data["comments"] or \
           "Vessel delayed slightly. Now planned ETD 20.09" in data["comments"]


def test_mark_delayed_ddmmyyyy(client_id):
    ship = _create_ship(client_id)
    r = requests.post(f"{API}/shipments/{ship['id']}/mark-delayed", json={"new_etd": "20.09.2026"})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["planned_etd"] == "2026-09-20"
    assert "20.09" in data["comments"]


def test_mark_delayed_idempotent(client_id):
    ship = _create_ship(client_id)
    r1 = requests.post(f"{API}/shipments/{ship['id']}/mark-delayed", json={"new_etd": "2026-09-20"})
    r2 = requests.post(f"{API}/shipments/{ship['id']}/mark-delayed", json={"new_etd": "2026-09-20"})
    assert r1.json()["comments"] == r2.json()["comments"]
    # snippet appears exactly once
    snippet = "Vessel delayed slightly. Now planned ETD 20.09"
    assert r2.json()["comments"].count(snippet) == 1


def test_mark_delayed_does_not_downgrade_shipped(client_id):
    ship = _create_ship(client_id)
    requests.post(f"{API}/shipments/{ship['id']}/mark-shipped", json={"sob_date": "2026-09-15"})
    r = requests.post(f"{API}/shipments/{ship['id']}/mark-delayed", json={"new_etd": "2026-09-25"})
    assert r.status_code == 200
    assert r.json()["status"] == "Shipped"


def test_mark_shipped_flips_delayed_to_shipped(client_id):
    ship = _create_ship(client_id, planned_etd="2026-09-10")
    requests.post(f"{API}/shipments/{ship['id']}/mark-delayed", json={"new_etd": "2026-09-20"})
    r = requests.post(f"{API}/shipments/{ship['id']}/mark-shipped", json={"sob_date": "2026-09-22"})
    assert r.status_code == 200
    assert r.json()["status"] == "Shipped"


def test_mark_delayed_404(client_id):
    r = requests.post(f"{API}/shipments/nonexistent/mark-delayed", json={"new_etd": "2026-09-20"})
    assert r.status_code == 404
