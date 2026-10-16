import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { downloadCreditRequest, useCreditRequests, useRefresh } from "@/lib/data";
import { awaitingCredit, calc, money } from "@/lib/billingCalc";
import { Modal, dmy, todayIso, useToast } from "@/lib/ui";

/* Clearfreight freight statements get credited once the shipment's client has been
   invoiced. This lists the accepted ones still waiting, and turns a selection into a
   credit note request: the List plus a PRO-FORMA CREDIT NOTE per file, in the
   forwarding team's own credit note workbook. */

const COLS = "36px minmax(150px,1.3fr) 84px 96px 92px 84px 120px minmax(110px,0.8fr)";

const daysTo = (iso) => {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date();
  return Math.round((new Date(y, m - 1, d) - new Date(t.getFullYear(), t.getMonth(), t.getDate())) / 86400000);
};

export default function CreditsView({ docs, clients, ships, onOpenDoc }) {
  const toast = useToast();
  const refresh = useRefresh();
  const { data: requests = [] } = useCreditRequests();
  const [picked, setPicked] = useState({});
  const [asking, setAsking] = useState(null);

  const nameOf = (id) => clients.find((c) => c.id === id)?.name || "—";
  const shipFor = (d) => ships.find((s) => s.file_number === d.file && s.client_id === d.clientId) || ships.find((s) => d.file && s.file_number === d.file);

  const rows = useMemo(() => docs.filter(awaitingCredit).map((d) => {
    const s = shipFor(d);
    const eta = s ? s.eta || s.planned_eta || "" : "";
    return { d, eta, days: daysTo(eta), amount: calc(d).total, archived: !!s?.anf_received };
  }).sort((a, b) => (a.eta || "9999").localeCompare(b.eta || "9999")), [docs, ships]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = rows.reduce((a, r) => a + r.amount, 0);
  const sel = rows.filter((r) => picked[r.d.id]);
  const selTotal = sel.reduce((a, r) => a + r.amount, 0);
  const allOn = rows.length > 0 && sel.length === rows.length;
  const today = todayIso();
  const todays = requests.filter((r) => r.date === today);
  const earlier = requests.filter((r) => r.date !== today);

  const undo = async (req) => {
    if (!window.confirm(`Undo ${req.no}? Its ${req.notes.length} pro forma${req.notes.length === 1 ? "" : "s"} go back to Awaiting credit.`)) return;
    try {
      await api.delete(`/credit-requests/${req.id}`);
      await refresh("documents", "credit-requests");
      toast(`${req.no} undone`);
    } catch { toast("Couldn't undo the request", { error: true }); }
  };
  const download = async (req) => {
    try { await downloadCreditRequest(req); } catch { toast("Download failed", { error: true }); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div className="oo-kpis" style={{ gridTemplateColumns: "repeat(3, minmax(0,1fr))" }}>
        <div className="oo-kpi" style={{ background: "var(--amb-bg)", color: "var(--amb-fg)" }} data-testid="await-total">
          <span>Still to be credited</span><span className="n" style={{ fontSize: 26 }}>{money("ZAR", total)}</span>
          <span style={{ fontSize: 12, opacity: 0.85 }}>{rows.length} freight statement{rows.length === 1 ? "" : "s"} accepted, not yet credited</span>
        </div>
        <div className="oo-kpi" style={{ background: "var(--sub)", border: "1px solid var(--line2)" }}>
          <span style={{ color: "var(--ink2)" }}>Arrived (ETA passed)</span>
          <span className="n" style={{ fontSize: 26 }}>{money("ZAR", rows.filter((r) => r.days !== null && r.days <= 0).reduce((a, r) => a + r.amount, 0))}</span>
          <span style={{ fontSize: 12, color: "var(--mute)" }}>{rows.filter((r) => r.days !== null && r.days <= 0).length} file{rows.filter((r) => r.days !== null && r.days <= 0).length === 1 ? "" : "s"} — likely invoiced to the client already</span>
        </div>
        <div className="oo-kpi" style={{ background: "var(--accent-soft)", color: "var(--accent-ink)" }}>
          <span>Requested today</span>
          <span className="n" style={{ fontSize: 26 }}>{money("ZAR", todays.reduce((a, r) => a + r.total, 0))}</span>
          <span style={{ fontSize: 12, opacity: 0.85 }}>{todays.reduce((a, r) => a + r.notes.length, 0)} credit note{todays.reduce((a, r) => a + r.notes.length, 0) === 1 ? "" : "s"} in {todays.length} request{todays.length === 1 ? "" : "s"}</span>
        </div>
      </div>

      <div className="oo-card scroll">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "18px 20px 12px", flexWrap: "wrap" }}>
          <div className="oo-card-title">
            <h2 className="oo-h2">Awaiting credit</h2>
            <span className="oo-sub">Clearfreight freight statements marked Accepted. Tick the ones whose client has been invoiced, then request the credit notes.</span>
          </div>
          <button type="button" className="oo-btn primary" disabled={!sel.length} onClick={() => setAsking(sel)} data-testid="request-credit">
            {sel.length ? `Request credit · ${sel.length} file${sel.length === 1 ? "" : "s"} · ${money("ZAR", selTotal)}` : "Tick files to credit"}
          </button>
        </div>
        <div style={{ minWidth: 900 }}>
          <div className="oo-grid-head" style={{ gridTemplateColumns: COLS }}>
            <input type="checkbox" checked={allOn} onChange={() => setPicked(allOn ? {} : Object.fromEntries(rows.map((r) => [r.d.id, true])))} title="Select all" />
            <span>Client</span><span>File #</span><span>Pro forma</span><span>ETA</span><span className="r">Days</span><span className="r">Amount</span><span>Invoice Nº</span>
          </div>
          {rows.map(({ d, eta, days, amount, archived }, i) => (
            <div key={d.id} className="oo-grid-row" style={{ gridTemplateColumns: COLS, fontSize: 14, background: picked[d.id] ? "var(--accent-soft)" : undefined, animationDelay: `${Math.min(i, 12) * 30}ms` }} data-testid={`await-${d.file}`}>
              <input type="checkbox" checked={!!picked[d.id]} onChange={() => setPicked({ ...picked, [d.id]: !picked[d.id] })} />
              <span className="oo-ellipsis" style={{ fontWeight: 600 }}>{nameOf(d.clientId)}</span>
              <span className="mono" style={{ fontSize: 13 }}>{d.file || "—"}</span>
              <button type="button" className="oo-link mono" style={{ justifySelf: "start", fontSize: 13 }} onClick={() => onOpenDoc(d)}>{d.no}</button>
              <span className="mono" style={{ fontSize: 13, color: "var(--ink2)" }}>{eta ? dmy(eta) : "—"}</span>
              <span className="mono r" style={{ fontSize: 12, color: days !== null && days <= 0 ? "var(--grn-fg)" : "var(--mute)" }}>
                {days === null ? "—" : days <= 0 ? (archived ? "ANF" : "Arrived") : `${days}d`}
              </span>
              <span className="mono r" style={{ fontWeight: 600 }}>{money("ZAR", amount)}</span>
              <span className="mono" style={{ fontSize: 13, color: d.fsInvoice ? "var(--ink2)" : "var(--faint)" }}>{d.fsInvoice || "not set"}</span>
            </div>
          ))}
          {rows.length > 0 && (
            <div className="oo-grid-row" style={{ gridTemplateColumns: COLS, fontSize: 14, fontWeight: 600, background: "var(--sub)" }}>
              <span /><span>Total · {rows.length} file{rows.length === 1 ? "" : "s"}</span><span /><span /><span /><span />
              <span className="mono r">{money("ZAR", total)}</span><span />
            </div>
          )}
          {!rows.length && (
            <div className="oo-empty">
              <b>Nothing waiting for credit</b>
              <span className="oo-sub">Clearfreight pro formas appear here once you mark them Accepted.</span>
            </div>
          )}
        </div>
      </div>

      <div className="oo-card">
        <div className="oo-card-head">
          <div className="oo-card-title">
            <h2 className="oo-h2">Credit note requests</h2>
            <span className="oo-sub">Each request downloads as your credit note workbook: the CREDIT NOTE REQUEST list plus a PRO-FORMA CREDIT NOTE per file.</span>
          </div>
        </div>
        {[["Today", todays], ["Earlier", earlier]].filter(([, l]) => l.length).map(([label, list]) => (
          <div key={label} style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ padding: "10px 24px 6px", fontSize: 12, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--mute)", borderTop: "1px solid var(--line2)" }}>{label}</span>
            {list.map((r) => (
              <div key={r.id} className="oo-prio-row" data-testid={`creq-${r.no}`}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 150 }}>
                  <b className="mono">{r.no}</b>
                  <span style={{ fontSize: 12, color: "var(--mute)" }}>{dmy(r.date)} · {r.notes.length} credit note{r.notes.length === 1 ? "" : "s"}</span>
                </div>
                <span style={{ flex: 1, fontSize: 13, color: "var(--ink2)", minWidth: 200 }}>{r.notes.map((n) => n.file).join(", ")}</span>
                <span className="mono" style={{ fontWeight: 600 }}>{money("ZAR", r.total)}</span>
                <button type="button" className="oo-btn sm" onClick={() => download(r)}>Download Excel</button>
                <button type="button" className="oo-link" style={{ color: "var(--red-fg)" }} onClick={() => undo(r)}>Undo</button>
              </div>
            ))}
          </div>
        ))}
        {!requests.length && <div className="oo-empty"><span className="oo-sub">No credit note requests yet.</span></div>}
      </div>

      {asking && (
        <CreditModal
          rows={asking}
          nameOf={nameOf}
          onClose={() => setAsking(null)}
          onDone={async (req) => {
            setAsking(null);
            setPicked({});
            await refresh("documents", "credit-requests");
            toast(`${req.no} · ${req.notes.length} credit note${req.notes.length === 1 ? "" : "s"} · ${money("ZAR", req.total)} — workbook downloaded`);
            download(req);
          }}
        />
      )}
    </div>
  );
}

/* Only the two 6-digit invoice numbers are typed. The amount is the freight statement's
   total; account, client name, code, description and VAT (none) never change. */
const SIX = /^\d{6}$/;

function CreditModal({ rows, nameOf, onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState(() => Object.fromEntries(rows.map(({ d }) => [d.id, { fs: d.fsInvoice || "", client: d.clientInvoice || "" }])));
  const [busy, setBusy] = useState(false);
  const set = (id, k) => (e) => setF({ ...f, [id]: { ...f[id], [k]: e.target.value.replace(/\D/g, "").slice(0, 6) } });
  const missing = rows.filter(({ d }) => !SIX.test(f[d.id].fs) || !SIX.test(f[d.id].client)).length;
  const total = rows.reduce((a, { amount }) => a + amount, 0);
  const G = "84px minmax(110px,1fr) 120px 130px 130px";

  const create = async () => {
    if (missing) { toast("Both invoice numbers need 6 digits for every file", { error: true }); return; }
    setBusy(true);
    try {
      const { data } = await api.post("/credit-requests", {
        date: todayIso(),
        notes: rows.map(({ d, amount }) => ({ docId: d.id, amount, fs_invoice: f[d.id].fs, client_invoice: f[d.id].client })),
      });
      onDone(data);
    } catch (e) {
      toast(e?.response?.data?.detail || "Couldn't create the credit notes", { error: true });
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} wide>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h2>Request credit notes</h2>
        <span style={{ fontSize: 14, color: "var(--mute)" }}>
          Only the two invoice numbers are needed. Account 5613 · FREIGHT STATEMENT · 30050 FORWARDING · no VAT — the amount is the freight statement's total.
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: "55vh", overflowY: "auto" }}>
        <div className="oo-grid-head" style={{ gridTemplateColumns: G, padding: "8px 4px", borderRadius: 8 }}>
          <span>File #</span><span>Client</span><span className="r">Amount</span><span>Invoice Nº to be credited</span><span>Recovered on invoice</span>
        </div>
        {rows.map(({ d, amount }) => (
          <div key={d.id} style={{ display: "grid", gridTemplateColumns: G, gap: 14, alignItems: "center", padding: "0 4px" }} data-testid={`cn-row-${d.file}`}>
            <span className="mono" style={{ fontWeight: 600 }}>{d.file || "—"}</span>
            <span className="oo-ellipsis" style={{ fontSize: 13, color: "var(--ink2)" }}>{nameOf(d.clientId)} · {d.no}</span>
            <span className="mono r" style={{ fontWeight: 600 }}>{money("ZAR", amount)}</span>
            <input className="oo-input mono" value={f[d.id].fs} onChange={set(d.id, "fs")} placeholder="320890" inputMode="numeric" maxLength={6} data-testid="cn-fs"
              style={{ borderColor: f[d.id].fs && !SIX.test(f[d.id].fs) ? "var(--amb-fg)" : undefined }} />
            <input className="oo-input mono" value={f[d.id].client} onChange={set(d.id, "client")} placeholder="321045" inputMode="numeric" maxLength={6} data-testid="cn-client"
              style={{ borderColor: f[d.id].client && !SIX.test(f[d.id].client) ? "var(--amb-fg)" : undefined }} />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, fontSize: 14 }}>
        <span style={{ color: missing ? "var(--amb-fg)" : "var(--ink2)" }}>{missing ? `${missing} file${missing === 1 ? "" : "s"} still need${missing === 1 ? "s" : ""} both 6-digit invoice numbers` : "Ready"}</span>
        <b className="mono">Total {money("ZAR", total)}</b>
      </div>
      <div className="oo-modal-actions">
        <button type="button" className="oo-btn foot" style={{ padding: "11px 18px" }} onClick={onClose}>Cancel</button>
        <button type="button" className="oo-btn primary foot" style={{ padding: "11px 20px" }} onClick={create} disabled={busy} data-testid="cn-create">
          Create {rows.length} credit note{rows.length === 1 ? "" : "s"} & download
        </button>
      </div>
    </Modal>
  );
}
