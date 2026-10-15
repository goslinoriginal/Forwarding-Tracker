import { useEffect, useRef, useState } from "react";
import { downloadReport, fetchEndClients, isGroupClient } from "@/lib/data";
import { Seg, useToast } from "@/lib/ui";

/* "Download" on the client page: new design or the old format, Excel or PDF.
   Group clients (Mushrooms, Handovers) can download one end client's share, or
   split the whole report into one file per end client. */
export default function DownloadMenu({ client }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [old, setOld] = useState(false);
  const [endClient, setEndClient] = useState("");
  const [endClients, setEndClients] = useState([]);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  const group = isGroupClient(client);

  useEffect(() => {
    if (!open) return undefined;
    if (group) fetchEndClients(client.id).then(setEndClients);
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open, group, client.id]);

  const label = (fmt) => (fmt === "pdf" ? "PDF" : "Excel");
  const one = async (fmt) => {
    setBusy(true);
    try {
      await downloadReport(client, fmt, { old, endClient });
      toast(`${label(fmt)} downloaded${endClient ? ` · ${endClient}` : ""}${old ? " (old format)" : ""}`);
    } catch { toast("Export failed", { error: true }); }
    finally { setBusy(false); }
  };
  const split = async (fmt) => {
    setBusy(true);
    try {
      for (const ec of endClients) await downloadReport(client, fmt, { old, endClient: ec });
      toast(`${endClients.length} ${label(fmt)} report${endClients.length === 1 ? "" : "s"} downloaded — one per client`);
    } catch { toast("Export failed", { error: true }); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ position: "relative" }} ref={ref}>
      <button type="button" className="oo-btn" onClick={() => setOpen(!open)}>Download ▾</button>
      {open && (
        <div className="oo-pop" style={{ width: 340, gap: 12 }}>
          <div className="oo-field">
            <span>Format</span>
            <Seg value={old} onChange={setOld} options={[{ value: false, label: "New design" }, { value: true, label: "Old format" }]} />
          </div>
          {group && (
            <label className="oo-field">
              <span>Report for</span>
              <select className="oo-input" value={endClient} onChange={(e) => setEndClient(e.target.value)}>
                <option value="">Whole report ({client.name})</option>
                {endClients.map((ec) => <option key={ec} value={ec}>{ec}</option>)}
              </select>
            </label>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="oo-btn primary sm" disabled={busy} onClick={() => one("xlsx")}>Excel</button>
            <button type="button" className="oo-btn primary sm" disabled={busy} onClick={() => one("pdf")}>PDF</button>
          </div>
          {group && endClients.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 10, borderTop: "1px solid var(--line2)" }}>
              <span className="oo-sub" style={{ fontSize: 12 }}>Split by client — one file each ({endClients.join(", ")})</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className="oo-btn sm" disabled={busy} onClick={() => split("xlsx")}>All as Excel</button>
                <button type="button" className="oo-btn sm" disabled={busy} onClick={() => split("pdf")}>All as PDF</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
