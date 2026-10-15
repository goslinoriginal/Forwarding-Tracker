import { useState } from "react";
import { api, OPTIONAL_COLUMNS } from "@/lib/api";
import { COMPANY_HUE, Modal, Pill, STATUS_HUE, Seg, dm, isoPlusDays, useToast } from "@/lib/ui";

/* Import the old Excel status reports: pick files -> review what was read -> import.
   Shipments with "ANF received" / "SOB's received", cancelled ones, and those with
   no update since the cutoff date come in archived (not monitored). */

const readAsBase64 = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

const ENTITIES = [{ value: "Patuma", label: "Patuma" }, { value: "Clearfreight", label: "Clearfreight" }];
const SHIP_COLS = "84px minmax(120px,1.2fr) minmax(130px,1.3fr) 86px minmax(150px,1.4fr)";

function legsText(s) {
  return [s.vessel_name, s.second_vessel_name, ...(s.extra_vessels || []).map((v) => v.name)].filter(Boolean).join(" → ") || "—";
}

function statusOf(s) {
  if (s.sob_date) return "Shipped";
  if (s.vessel_name || s.planned_etd || s.tracking_doc_number) return "Booked";
  return "Planned";
}

export default function ImportModal({ onClose, onDone }) {
  const toast = useToast();
  const [files, setFiles] = useState([]);
  const [cutoff, setCutoff] = useState(isoPlusDays(-7));
  const [reports, setReports] = useState(null);
  const [busy, setBusy] = useState(false);

  const read = async () => {
    if (!files.length) { toast("Choose one or more Excel status reports first", { error: true }); return; }
    setBusy(true);
    try {
      const payload = await Promise.all(files.map(async (f) => ({ name: f.name, data: await readAsBase64(f) })));
      const { data } = await api.post("/import/preview", { files: payload, cutoff });
      setReports(data.reports);
    } catch {
      toast("Couldn't read the reports", { error: true });
    } finally {
      setBusy(false);
    }
  };

  const setEntity = (i, company) => setReports((rs) => rs.map((r, j) => (j === i ? { ...r, client: { ...r.client, company } } : r)));
  const setName = (i, name) => setReports((rs) => rs.map((r, j) => (j === i ? { ...r, client: { ...r.client, name } } : r)));

  const ok = (reports || []).filter((r) => !r.error);
  const newShips = ok.flatMap((r) => r.shipments.filter((s) => !s.duplicate));
  const activeCount = newShips.filter((s) => !s.archived).length;

  const commit = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/import/commit", { reports: ok });
      toast(
        `Imported ${data.shipments_added} shipment${data.shipments_added === 1 ? "" : "s"} · ${data.created_clients} new client${data.created_clients === 1 ? "" : "s"}`
        + (data.archived ? ` · ${data.archived} archived` : "")
        + (data.skipped_duplicates ? ` · ${data.skipped_duplicates} already in the system` : ""),
      );
      onDone?.();
      onClose();
    } catch {
      toast("Import failed — nothing was saved for the failing report", { error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} wide>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h2>Import status reports</h2>
        <span style={{ fontSize: 14, color: "var(--mute)" }}>
          Upload your existing Excel status reports. Each report becomes a client with its shipments and report columns.
        </span>
      </div>

      {!reports ? (
        <>
          <label className="oo-field" style={{ gap: 8 }}>
            <span style={{ fontSize: 13, color: "var(--ink)" }}>Status reports (.xlsx — choose as many as you like)</span>
            <input
              type="file"
              accept=".xlsx"
              multiple
              className="oo-input big"
              onChange={(e) => setFiles(Array.from(e.target.files || []))}
            />
          </label>
          <label className="oo-field" style={{ gap: 8, maxWidth: 320 }}>
            <span style={{ fontSize: 13, color: "var(--ink)" }}>Archive shipments with no update since</span>
            <input type="date" className="oo-input big" value={cutoff} onChange={(e) => setCutoff(e.target.value)} />
          </label>
          <span className="oo-sub">
            Shipments marked “ANF received” or “SOB's received”, cancelled ones, and any not updated since this date are still imported,
            but archived so they don't need monitoring.
          </span>
          <div className="oo-modal-actions">
            <button type="button" className="oo-btn foot" style={{ padding: "11px 18px" }} onClick={onClose}>Cancel</button>
            <button type="button" className="oo-btn primary foot" style={{ padding: "11px 20px" }} onClick={read} disabled={busy}>
              {busy ? "Reading…" : `Read ${files.length || ""} report${files.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Pill size="lg">{ok.length} client{ok.length === 1 ? "" : "s"}</Pill>
            <Pill size="lg">{newShips.length} shipment{newShips.length === 1 ? "" : "s"} to import</Pill>
            <Pill size="lg" tone="grn">{activeCount} active</Pill>
            <Pill size="lg" tone="pur">{newShips.length - activeCount} archived</Pill>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: "58vh", overflow: "auto", margin: "0 -6px", padding: "0 6px" }}>
            {reports.map((r, i) => (
              r.error ? (
                <div key={r.file} className="oo-card" style={{ flex: "none", padding: 16, background: "var(--red-bg)", color: "var(--red-fg)" }}>
                  <b>{r.file}</b> — {r.error}
                </div>
              ) : (
                <div key={r.file} className="oo-card" style={{ flex: "none" }}>
                  <div style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", background: "var(--sub)", borderBottom: "1px solid var(--line2)" }}>
                    <input className="oo-input" style={{ maxWidth: 280, fontWeight: 600 }} value={r.client.name} onChange={(e) => setName(i, e.target.value)} />
                    <Seg options={ENTITIES} value={r.client.company} onChange={(v) => setEntity(i, v)} />
                    {r.existing_client_id ? <Pill hue={COMPANY_HUE[r.client.company]}>Existing client — new shipments are added</Pill> : <Pill tone="grn">New client</Pill>}
                    <span className="oo-sub" style={{ marginLeft: "auto" }}>Report {dm(r.report_date)}{r.report_date.slice(0, 4)}</span>
                  </div>
                  <div style={{ padding: "8px 18px", fontSize: 12, color: "var(--mute)" }}>
                    Columns: {OPTIONAL_COLUMNS.filter((o) => r.client.optional_columns[o.key]).map((o) => o.label).join(" · ") || "Standard only"}
                    {r.warnings.length > 0 && <span style={{ color: "var(--amb-fg)" }}> · {r.warnings.join(" · ")}</span>}
                  </div>
                  {r.shipments.map((s, k) => (
                    <div key={k} style={{ display: "grid", gridTemplateColumns: SHIP_COLS, gap: 12, padding: "9px 18px", borderTop: "1px solid var(--line2)", alignItems: "center", fontSize: 13, opacity: s.duplicate ? 0.5 : 1 }}>
                      <span className="mono" style={{ fontWeight: 600 }}>{s.file_number || "—"}</span>
                      <span className="oo-ellipsis">{s.supplier || "—"}</span>
                      <span className="oo-ellipsis" style={{ color: "var(--ink2)" }} title={s.tracking_doc_number}>{legsText(s)}</span>
                      <Pill hue={STATUS_HUE[statusOf(s)]} size="xs">{statusOf(s)}</Pill>
                      <span className="oo-ellipsis" style={{ fontSize: 12 }} title={s.original_comment}>
                        {s.duplicate
                          ? <span style={{ color: "var(--mute)" }}>Already in the system — skipped</span>
                          : s.archived
                            ? <span style={{ color: "var(--pur-fg)" }}>Archived · {s.archive_reason}</span>
                            : <span style={{ color: "var(--grn-fg)" }}>Active · updated {dm(s.last_update)}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              )
            ))}
          </div>
          <div className="oo-modal-actions">
            <button type="button" className="oo-btn foot" style={{ padding: "11px 18px", marginRight: "auto" }} onClick={() => setReports(null)}>← Choose other files</button>
            <button type="button" className="oo-btn foot" style={{ padding: "11px 18px" }} onClick={onClose}>Cancel</button>
            <button type="button" className="oo-btn primary foot" style={{ padding: "11px 20px" }} onClick={commit} disabled={busy || !newShips.length && !ok.some((r) => !r.existing_client_id)}>
              {busy ? "Importing…" : `Import ${ok.length} client${ok.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
