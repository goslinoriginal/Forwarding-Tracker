# Ocean Freight Shipment Tracker — PRD

## Original problem statement
Freight forwarder needs a shipment tracker for FCL & LCL ocean cargo. Today they use one Excel spreadsheet per client and manually check shipping line websites (MSC, Maersk, ONE, COSCO, Hapag Lloyd, PIL, CMA CGM, Vanguard groupage) to write comments like "Planned ETD 05.09.", "Vessel delayed slightly. Now planned ETD 09.09.", "Awaiting confirmation of departure." Reports are sent daily. After the ANF is received the shipment falls off the list. Some clients need "H/bill released by supplier" and "expected ocean freight rate", others don't.

## User choices (Feb 2026)
- Tracking: manual entry with a **track-trace.com deep link** per shipment (no paid carrier API).
- Report delivery: **PDF + Excel download** from dashboard.
- Auth: **none** (internal single-tenant tool).
- Column customisation: **fixed standard columns with on/off toggles per client**.
- Shipment lifecycle: **deleted from active list once ANF received** (kept as archived so tomorrow's report excludes them).

## Architecture
- **Backend**: FastAPI (`/app/backend/server.py`) — MongoDB (motor). Routes prefixed `/api`.
  - `GET/POST/PATCH/DELETE /api/clients` — per-client `optional_columns` toggle map.
  - `GET/POST/PATCH/DELETE /api/shipments?client_id=&include_anf=` — auto sets `anf_received_at` ISO on flip.
  - `GET /api/reports/{id}/{preview|xlsx|pdf}` — excludes ANF-archived rows. Uses openpyxl (xlsx) & reportlab LongTable (landscape A3 PDF).
  - `GET /api/dashboard/stats` — counts + carrier aggregation.
- **Frontend**: React + Tailwind + shadcn/ui, dark maritime theme (slate-950 / cyan-400 accents / JetBrains Mono for data).
  - `Dashboard` (`/`) — KPI cards + carrier volume bars + recent clients.
  - `ClientsPage` (`/clients`) — cards with column-toggle chips, add/edit/delete client.
  - `ClientDetail` (`/clients/:id`) — spreadsheet-style shipment table with stacked Vessel/Tracking Doc badge (deep-links to track-trace.com), inline comment textarea, quick-preset comment popover, ANF mark, PDF/Excel export, per-client column-toggle popover.

## What's implemented (2026-02)
- End-to-end client + shipment CRUD ✅
- Fixed columns: Supplier, Order/Booking, File #, Status, Vessel + Tracking Doc, POD, ETA, Comments ✅
- Optional togglable columns per client: SOB Date, POL, Final Destination, H/bill released, Expected Freight Rate ✅
- 9 carriers with colored badges (MSC, Maersk, ONE, COSCO, Hapag Lloyd, PIL, CMA CGM, Vanguard, Other) ✅
- track-trace.com deep-link per shipment (`?number=<doc>`) + copy-to-clipboard on tracking doc ✅
- Quick preset comments popover ("Planned ETD ", "Vessel delayed slightly. Now planned ETD ", "Vessel changed by S/Line. Now planned ETD ", "Awaiting confirmation of departure.", "Shipped on board ", "H/bill released by supplier.", "H/bill NOT released by supplier.", "ANF received. Docs to Ops.") ✅
- One-click "Mark ANF received" — auto-appends "ANF received. Docs to Ops." to comments and archives out of the next report ✅
- Show/hide ANF-archived shipments toggle ✅
- PDF export (landscape A3, repeating header, alternating rows) & Excel export (frozen header, borders, wrap) ✅
- Dashboard: KPIs (active clients, active shipments, delayed, booked) + carrier volume bar chart ✅
- All backend + frontend tests: 100% pass (`/app/test_reports/iteration_1.json`)

## Backlog / Next tasks
- **P1** Duplicate-shipment button (many rows share supplier/rates) so ops don't retype.
- **P1** Multi-vessel transhipment: allow 2nd/3rd vessel per shipment (design already accommodates in comments; needs a dedicated sub-row UI).
- **P2** Email daily report to client via Resend integration.
- **P2** Bulk import from Excel (paste .xlsx to seed shipments).
- **P2** Comment history / change log per shipment (currently only latest state is stored).
- **P3** Carrier auto-detection from tracking doc prefix (MEDU→MSC, MAEU→Maersk, HLCU→Hapag, etc.).

## User personas
- **Ops coordinator** — main daily user; needs speed, keyboard-friendly comment editing, one-click ANF, and daily PDF/Excel export per client.
- **Client** — recipient of the daily report; needs a clean spreadsheet-style PDF with the columns their contract calls for.
