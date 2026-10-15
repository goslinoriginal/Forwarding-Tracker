import { useState } from "react";
import { api } from "@/lib/api";
import { roeDay, useRefresh } from "@/lib/data";
import { Modal, dmy, useToast } from "@/lib/ui";

const SKIP_KEY = "oceanops.roeSkip";
export const skippedToday = (today) => { try { return localStorage.getItem(SKIP_KEY) === today; } catch { return false; } };
const skipToday = (today) => { try { localStorage.setItem(SKIP_KEY, today); } catch {} };

const weekday = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-ZA", { weekday: "long" });
};

/** Capture (or correct) the USD and EUR rates of exchange for one day. */
export default function RoeModal({ day, existing, daily, onClose }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [date, setDate] = useState(day);
  const [usd, setUsd] = useState(existing?.usd || "");
  const [eur, setEur] = useState(existing?.eur || "");
  const [busy, setBusy] = useState(false);
  const target = roeDay(date) || date;

  const save = async () => {
    if (!usd.trim() && !eur.trim()) { toast("Enter the USD and/or EUR rate", { error: true }); return; }
    setBusy(true);
    try {
      await api.put(`/roe/${target}`, { usd, eur });
      await refresh("roe");
      toast(`ROE saved for ${dmy(target)}`);
      onClose();
    } catch {
      toast("Couldn't save the ROE", { error: true });
    } finally {
      setBusy(false);
    }
  };
  const later = () => { if (daily) skipToday(day); onClose(); };

  return (
    <Modal onClose={later}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h2>{daily ? "Today's rates of exchange" : "Rates of exchange"}</h2>
        <span style={{ fontSize: 14, color: "var(--mute)" }}>
          {daily ? "Type in today's rates once — every pro forma today fills them in, and any shipment that sailed today picks them up as its SOB-date ROE." : "Saved per day. A Saturday or Sunday uses the following Monday's rates."}
        </span>
      </div>
      {!daily && (
        <label className="oo-field">
          <span>Date</span>
          <input type="date" className="oo-input" value={date} onChange={(e) => setDate(e.target.value)} />
          {target !== date && <span className="oo-sub" style={{ fontSize: 12 }}>Weekend — saved as {weekday(target)} {dmy(target)}</span>}
        </label>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <label className="oo-field" style={{ gap: 8 }}>
          <span style={{ fontSize: 13, color: "var(--ink)" }}>USD → ZAR</span>
          <input className="oo-input big mono" value={usd} onChange={(e) => setUsd(e.target.value)} placeholder="0.0000" inputMode="decimal" autoFocus data-testid="roe-usd" onKeyDown={(e) => e.key === "Enter" && save()} />
        </label>
        <label className="oo-field" style={{ gap: 8 }}>
          <span style={{ fontSize: 13, color: "var(--ink)" }}>EUR → ZAR</span>
          <input className="oo-input big mono" value={eur} onChange={(e) => setEur(e.target.value)} placeholder="0.0000" inputMode="decimal" data-testid="roe-eur" onKeyDown={(e) => e.key === "Enter" && save()} />
        </label>
      </div>
      <div className="oo-modal-actions">
        <button type="button" className="oo-btn foot" style={{ padding: "11px 18px" }} onClick={later}>{daily ? "Later" : "Cancel"}</button>
        <button type="button" className="oo-btn primary foot" style={{ padding: "11px 20px" }} onClick={save} disabled={busy}>Save {weekday(target)}'s ROE</button>
      </div>
    </Modal>
  );
}
