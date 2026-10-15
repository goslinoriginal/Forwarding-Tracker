import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, OPTIONAL_COLUMNS } from "@/lib/api";
import {
  displayStatus, downloadReport, etaText, etdText, shipmentLegs, statusLabel,
  useClients, useRefresh, useReportLog, useShipments,
} from "@/lib/data";
import { CARRIER_HUE, COMPANY_HUE, Pill, STATUS_HUE, Seg, Toggle, dm, useChip, useToast } from "@/lib/ui";
import { NEW_ID, useEditor } from "@/components/ShipmentEditor";
import ClientModal from "@/components/ClientModal";

const STATUSES = ["All", "Planned", "Booked", "Shipped", "Delayed"];

export default function ClientDetail() {
  const { clientId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const chip = useChip();
  const refresh = useRefresh();
  const { openEditor } = useEditor();
  const { data: clients, isLoading } = useClients();
  const { data: ships = [] } = useShipments();
  const { data: sent = {} } = useReportLog();
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [showArch, setShowArch] = useState(false);
  const [colsOpen, setColsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const popRef = useRef(null);

  useEffect(() => {
    if (!colsOpen) return undefined;
    const close = (e) => { if (popRef.current && !popRef.current.contains(e.target)) setColsOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [colsOpen]);

  const client = (clients || []).find((c) => c.id === clientId);
  if (!client) {
    return (
      <div className="oo-page detail">
        <button type="button" className="oo-back" onClick={() => navigate("/clients")}>← Clients</button>
        <span className="oo-sub">{isLoading ? "Loading client…" : "Client not found."}</span>
      </div>
    );
  }

  const cols = client.optional_columns || {};
  const mine = ships.filter((s) => s.client_id === client.id).slice().reverse();
  const mineActive = mine.filter((s) => !s.anf_received);
  const pool = showArch ? mine : mineActive;
  const q = search.trim().toLowerCase();
  const rows = pool
    .filter((s) => filter === "All" || displayStatus(s) === filter)
    .filter((s) => !q || [s.supplier, s.tracking_doc_number, s.file_number, s.order_booking_file, ...shipmentLegs(s).map((l) => l.name)].join(" ").toLowerCase().includes(q));
  const sentT = sent[client.id];

  const gc = ["72px", "minmax(130px,1.3fr)", "104px", "minmax(130px,1.2fr)"];
  if (cols.sob_date) gc.push("72px");
  if (cols.pol) gc.push("90px");
  gc.push("64px", "64px");
  if (cols.final_destination) gc.push("110px");
  gc.push("minmax(120px,1.6fr)");
  if (cols.copy_docs_status) gc.push("120px");
  if (cols.hbill_released) gc.push("52px");
  if (cols.expected_freight_rate) gc.push("100px");
  gc.push("14px");
  const gridCols = gc.join(" ");
  // Scroll width = every column at its minimum, so nothing is clipped on narrow screens
  const tableMin = Math.max(900, gc.reduce((a, t) => a + parseInt(t.replace("minmax(", ""), 10), 0) + (gc.length - 1) * 14 + 40);

  const setCol = async (key) => {
    const next = { ...cols, [key]: !cols[key] };
    try {
      await api.patch(`/clients/${client.id}`, { optional_columns: next });
      await refresh("clients");
    } catch { toast("Couldn't update the columns", { error: true }); }
  };

  const exportAs = async (fmt) => {
    try {
      await downloadReport(client, fmt);
      toast(`${fmt === "pdf" ? "PDF" : "Excel"} generated · ${mineActive.length} shipment${mineActive.length === 1 ? "" : "s"}`);
    } catch { toast("Export failed", { error: true }); }
  };

  return (
    <div className="oo-page detail" data-screen-label="Client detail">
      <div className="oo-head">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button type="button" className="oo-back" onClick={() => navigate("/clients")}>← Clients</button>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <h1 className="oo-h1" style={{ fontSize: 34 }}>{client.name}</h1>
            <Pill hue={COMPANY_HUE[client.company]}>{client.company}</Pill>
          </div>
          <p style={{ fontSize: 14, color: "var(--ink2)" }}>
            {mineActive.length} active · {mine.length - mineActive.length} archived (ANF / SOB's received) · {sentT ? `Report sent ${sentT}` : "Report not sent today"}
          </p>
        </div>
        <div className="oo-actions" style={{ position: "relative" }} ref={popRef}>
          <button type="button" className="oo-btn" onClick={() => setProfileOpen(true)}>Profile</button>
          <button type="button" className="oo-btn" onClick={() => setColsOpen(!colsOpen)} data-testid="column-settings-button">Columns</button>
          <button type="button" className="oo-btn" onClick={() => exportAs("xlsx")}>Excel</button>
          <button type="button" className="oo-btn" onClick={() => exportAs("pdf")}>PDF</button>
          <button type="button" className="oo-btn" onClick={() => openEditor(client.id, NEW_ID)}>+ Shipment</button>
          <button type="button" className="oo-btn primary" onClick={() => openEditor(client.id)}>Do status report</button>
          {colsOpen && (
            <div className="oo-pop">
              <span style={{ fontSize: 12, color: "var(--mute)", padding: "0 6px 8px" }}>Optional report columns for {client.name}</span>
              {OPTIONAL_COLUMNS.map((o) => (
                <div key={o.key} className="oo-pop-row">
                  <span>{o.label}</span>
                  <Toggle on={!!cols[o.key]} onChange={() => setCol(o.key)} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="oo-toolbar">
        <Seg
          value={filter}
          onChange={setFilter}
          options={STATUSES.map((f) => ({ value: f, label: f, count: f === "All" ? pool.length : pool.filter((s) => displayStatus(s) === f).length }))}
        />
        <input className="oo-search wide" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search file #, supplier, vessel, doc #…" />
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--ink2)" }}>
          <span>Show archived</span>
          <Toggle on={showArch} onChange={setShowArch} />
        </div>
      </div>

      <div className="oo-card scroll">
        <div style={{ minWidth: tableMin }}>
          <div className="oo-grid-head" style={{ gridTemplateColumns: gridCols }}>
            <span>File #</span><span>Supplier · Order</span><span>Status</span><span>Vessel · Doc</span>
            {cols.sob_date && <span>SOB / RCG</span>}
            {cols.pol && <span>POL</span>}
            <span>ETD</span><span>ETA</span>
            {cols.final_destination && <span>Final dest.</span>}
            <span>Comments</span>
            {cols.copy_docs_status && <span>Copy docs</span>}
            {cols.hbill_released && <span>H/bill</span>}
            {cols.expected_freight_rate && <span>Rate</span>}
            <span />
          </div>
          {rows.map((s, i) => {
            const st = displayStatus(s);
            const legs = shipmentLegs(s);
            const car = chip(CARRIER_HUE[s.carrier] ?? 250);
            const hb = s.hbill_released;
            return (
              <div
                key={s.id}
                className="oo-grid-row click"
                style={{ gridTemplateColumns: gridCols, alignItems: "start", padding: "16px 20px", background: s.anf_received ? "var(--pur-bg)" : "transparent", animationDelay: `${Math.min(i, 12) * 30}ms` }}
                onClick={() => openEditor(client.id, s.id)}
                data-testid={`shipment-row-${s.id}`}
              >
                <span className="mono" style={{ fontSize: 13, fontWeight: 600, paddingTop: 1 }}>{s.file_number || "—"}</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{s.supplier || "—"}</span>
                  <span style={{ fontSize: 12, color: "var(--mute)", lineHeight: 1.4, whiteSpace: "pre-line" }}>{s.order_booking_file}</span>
                </div>
                <Pill hue={STATUS_HUE[st]} dot>{statusLabel(st, s.cargo_type)}</Pill>
                <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
                  <span className="oo-ellipsis" style={{ fontSize: 13, fontWeight: 600 }}>{s.vessel_name || "—"}</span>
                  {legs.length > 1 && <span style={{ fontSize: 12, color: "var(--ink2)" }}>+ {legs.slice(1).map((l) => l.name).filter(Boolean).join(" → ")}</span>}
                  {s.tracking_doc_number && (
                    <span className="mono" style={{ alignSelf: "flex-start", fontSize: 11, padding: "2px 8px", borderRadius: 7, ...car }}>{s.tracking_doc_number}</span>
                  )}
                </div>
                {cols.sob_date && <span className="mono" style={{ fontSize: 12, color: "var(--ink2)", paddingTop: 2 }}>{dm(s.sob_date) || "—"}</span>}
                {cols.pol && <span style={{ fontSize: 13, color: "var(--ink2)" }}>{s.pol || "—"}</span>}
                <span className="mono" style={{ fontSize: 12, color: "var(--ink2)", paddingTop: 2 }}>{etdText(s)}</span>
                <span className="mono" style={{ fontSize: 12, color: "var(--ink2)", paddingTop: 2 }}>{etaText(s)}</span>
                {cols.final_destination && <span style={{ fontSize: 13, color: "var(--ink2)" }}>{s.final_destination || "—"}</span>}
                <span style={{ fontSize: 13, color: "var(--ink2)", lineHeight: 1.45, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                  {s.comments}
                </span>
                {cols.copy_docs_status && <span style={{ fontSize: 13, color: "var(--ink2)" }}>{s.copy_docs_status || "—"}</span>}
                {cols.hbill_released && (
                  <span style={{ fontSize: 13, fontWeight: 500, color: hb === true ? "var(--grn-fg)" : hb === false ? "var(--red-fg)" : "var(--faint)" }}>
                    {hb === true ? "Yes" : hb === false ? "No" : "—"}
                  </span>
                )}
                {cols.expected_freight_rate && <span className="mono" style={{ fontSize: 12, color: "var(--ink2)" }}>{s.expected_freight_rate || "—"}</span>}
                <span className="oo-chev">›</span>
              </div>
            );
          })}
          {!rows.length && (
            <div className="oo-empty">
              <b>{mine.length ? "No shipments match" : "No shipments yet"}</b>
              <span className="oo-sub">{mine.length ? "Try another status or clear the search." : `Add the first shipment for ${client.name}.`}</span>
              {!mine.length && <button type="button" className="oo-btn primary" style={{ marginTop: 10 }} onClick={() => openEditor(client.id, NEW_ID)}>+ New shipment</button>}
            </div>
          )}
        </div>
      </div>

      {profileOpen && (
        <ClientModal
          client={client}
          onClose={() => setProfileOpen(false)}
          onSaved={() => refresh("clients")}
          onDeleted={async () => { await refresh(); navigate("/clients"); }}
        />
      )}
    </div>
  );
}
