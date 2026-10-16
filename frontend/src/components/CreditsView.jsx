import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { downloadCreditList, downloadCreditNote, useCreditLists, useCreditNotes, useRefresh } from "@/lib/data";
import { awaitingCredit, calc, money } from "@/lib/billingCalc";
import { Modal, dmy, todayIso, useToast } from "@/lib/ui";

/* Clearfreight freight statements get credited once the shipment's client has been
   invoiced. Credit notes are done file by file — each downloads as its own
   PRO-FORMA CREDIT NOTE (two copies, to file with the invoice) — and every one joins
   the open CREDIT NOTE REQUEST list. Printing the list closes that batch. */

const COLS = "minmax(150px,1.3fr) 84px 96px 92px 70px 124px 96px";
const LIST_COLS = "84px 110px 110px minmax(120px,1fr) 124px 190px";

const daysTo = (iso) => {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date();
  return Math.round((new Date(y, m - 1, d) - new Date(t.getFullYear(), t.getMonth(), t.getDate())) / 86400000);
};
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

export default function CreditsView({ docs, clients, ships, onOpenDoc }) {
  const toast = useToast();
  const refresh = useRefresh();
  const { data: notes = [] } = useCreditNotes();
  const { data: lists = [] } = useCreditLists();
  const [crediting, setCrediting] = useState(null);
  const [printing, setPrinting] = useState(false);

  const nameOf = (id) => clients.find((c) => c.id === id)?.name || "—";
  const shipFor = (d) => ships.find((s) => s.file_number === d.file && s.client_id === d.clientId) || ships.find((s) => d.file && s.file_number === d.file);

  const rows = useMemo(() => docs.filter(awaitingCredit).map((d) => {
    const s = shipFor(d);
    const eta = s ? s.eta || s.planned_eta || "" : "";
    return { d, eta, days: daysTo(eta), amount: calc(d).total, archived: !!s?.anf_received };
  }).sort((a, b) => (a.eta || "9999").localeCompare(b.eta || "9999")), [docs, ships]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = rows.reduce((a, r) => a + r.amount, 0);
  const arrived = rows.filter((r) => r.days !== null && r.days <= 0);
  const open = notes.filter((n) => !n.listId).slice().reverse(); // oldest first, like the list prints
  const openTotal = open.reduce((a, n) => a + n.amount, 0);
  const reload = () => refresh("documents", "credit-notes", "credit-lists");

  const download = async (fn, x) => { try { await fn(x); } catch { toast("Download failed", { error: true }); } };
  const undo = async (n) => {
    if (!window.confirm(`Undo the credit note for file ${n.file}? It goes back to Awaiting credit.`)) return;
    try { await api.delete(`/credit-notes/${n.id}`); await reload(); toast(`File ${n.file} back to Awaiting credit`); } catch (e) { toast(e?.response?.data?.detail || "Couldn't undo", { error: true }); }
  };
  const printList = async () => {
    if (!window.confirm(`Print the list of ${plural(open.length, "credit note")} (${money("ZAR", openTotal)})? The list is then cleared for the next batch.`)) return;
    setPrinting(true);
    try {
      const { data } = await api.post("/credit-lists", { date: todayIso() });
      await reload();
      toast(`${data.no} downloaded · ${plural(data.notes.length, "credit note")} · list cleared for the next batch`);
      await download(downloadCreditList, data);
    } catch (e) { toast(e?.response?.data?.detail || "Couldn't print the list", { error: true }); }
    finally { setPrinting(false); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div className="oo-kpis" style={{ gridTemplateColumns: "repeat(3, minmax(0,1fr))" }}>
        <div className="oo-kpi" style={{ background: "var(--amb-bg)", color: "var(--amb-fg)" }} data-testid="await-total">
          <span>Still to be credited</span><span className="n" style={{ fontSize: 26 }}>{money("ZAR", total)}</span>
          <span style={{ fontSize: 12, opacity: 0.85 }}>{plural(rows.length, "freight statement")} accepted, not yet credited</span>
        </div>
        <div className="oo-kpi" style={{ background: "var(--sub)", border: "1px solid var(--line2)" }}>
          <span style={{ color: "var(--ink2)" }}>Arrived (ETA passed)</span>
          <span className="n" style={{ fontSize: 26 }}>{money("ZAR", arrived.reduce((a, r) => a + r.amount, 0))}</span>
          <span style={{ fontSize: 12, color: "var(--mute)" }}>{plural(arrived.length, "file")} — likely invoiced to the client already</span>
        </div>
        <div className="oo-kpi" style={{ background: "var(--accent-soft)", color: "var(--accent-ink)" }}>
          <span>On the current list</span><span className="n" style={{ fontSize: 26 }}>{money("ZAR", openTotal)}</span>
          <span style={{ fontSize: 12, opacity: 0.85 }}>{plural(open.length, "credit note")} — not printed yet</span>
        </div>
      </div>

      <div className="oo-card scroll">
        <div className="oo-card-head">
          <div className="oo-card-title">
            <h2 className="oo-h2">Awaiting credit</h2>
            <span className="oo-sub">Clearfreight freight statements marked Accepted. Once the client has been invoiced, click Credit, type the two invoice numbers, and print the credit note (2 copies).</span>
          </div>
        </div>
        <div style={{ minWidth: 820 }}>
          <div className="oo-grid-head" style={{ gridTemplateColumns: COLS }}>
            <span>Client</span><span>File #</span><span>Pro forma</span><span>ETA</span><span className="r">Days</span><span className="r">Amount</span><span />
          </div>
          {rows.map(({ d, eta, days, amount, archived }, i) => (
            <div key={d.id} className="oo-grid-row" style={{ gridTemplateColumns: COLS, fontSize: 14, animationDelay: `${Math.min(i, 12) * 30}ms` }} data-testid={`await-${d.file}`}>
              <span className="oo-ellipsis" style={{ fontWeight: 600 }}>{nameOf(d.clientId)}</span>
              <span className="mono" style={{ fontSize: 13 }}>{d.file || "—"}</span>
              <button type="button" className="oo-link mono" style={{ justifySelf: "start", fontSize: 13 }} onClick={() => onOpenDoc(d)}>{d.no}</button>
              <span className="mono" style={{ fontSize: 13, color: "var(--ink2)" }}>{eta ? dmy(eta) : "—"}</span>
              <span className="mono r" style={{ fontSize: 12, color: days !== null && days <= 0 ? "var(--grn-fg)" : "var(--mute)" }}>
                {days === null ? "—" : days <= 0 ? (archived ? "ANF" : "Arrived") : `${days}d`}
              </span>
              <span className="mono r" style={{ fontWeight: 600 }}>{money("ZAR", amount)}</span>
              <button type="button" className="oo-btn primary sm" style={{ justifySelf: "end" }} onClick={() => setCrediting({ d, amount })} data-testid={`credit-${d.file}`}>Credit</button>
            </div>
          ))}
          {rows.length > 0 && (
            <div className="oo-grid-row" style={{ gridTemplateColumns: COLS, fontSize: 14, fontWeight: 600, background: "var(--sub)" }}>
              <span>Total · {plural(rows.length, "file")}</span><span /><span /><span /><span />
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

      <div className="oo-card scroll">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "20px 24px 12px", flexWrap: "wrap" }}>
          <div className="oo-card-title">
            <h2 className="oo-h2">Current list</h2>
            <span className="oo-sub">The CREDIT NOTE REQUEST for this batch. Printing it clears the list for the next batch.</span>
          </div>
          <button type="button" className="oo-btn primary" disabled={!open.length || printing} onClick={printList} data-testid="print-list">
            {open.length ? `Print list · ${plural(open.length, "credit note")} · ${money("ZAR", openTotal)}` : "No credit notes yet"}
          </button>
        </div>
        {open.length > 0 && (
          <div style={{ minWidth: 760 }}>
            <div className="oo-grid-head" style={{ gridTemplateColumns: LIST_COLS }}>
              <span>File #</span><span>Inv. Nº</span><span>Recovered on</span><span>Client</span><span className="r">Amount</span><span />
            </div>
            {open.map((n) => (
              <div key={n.id} className="oo-grid-row" style={{ gridTemplateColumns: LIST_COLS, fontSize: 14 }} data-testid={`open-${n.file}`}>
                <span className="mono" style={{ fontWeight: 600 }}>{n.file}</span>
                <span className="mono">{n.fs_invoice}</span>
                <span className="mono" style={{ color: "var(--ink2)" }}>{n.client_invoice}</span>
                <span className="oo-ellipsis" style={{ color: "var(--ink2)" }}>{nameOf(n.clientId)} · {n.docNo}</span>
                <span className="mono r" style={{ fontWeight: 600 }}>{money("ZAR", n.amount)}</span>
                <span style={{ display: "flex", gap: 12, justifyContent: "flex-end", alignItems: "center" }}>
                  <button type="button" className="oo-link" onClick={() => download(downloadCreditNote, n)}>Credit note again</button>
                  <button type="button" className="oo-link" style={{ color: "var(--red-fg)" }} onClick={() => undo(n)}>Undo</button>
                </span>
              </div>
            ))}
            <div className="oo-grid-row" style={{ gridTemplateColumns: LIST_COLS, fontSize: 14, fontWeight: 600, background: "var(--sub)" }}>
              <span>Total</span><span /><span /><span /><span className="mono r">{money("ZAR", openTotal)}</span><span />
            </div>
          </div>
        )}
        {!open.length && <div className="oo-empty" style={{ paddingTop: 16 }}><span className="oo-sub">Credit notes you do appear here until the list is printed.</span></div>}
      </div>

      {lists.length > 0 && (
        <div className="oo-card">
          <div className="oo-card-head">
            <div className="oo-card-title"><h2 className="oo-h2">Printed lists</h2><span className="oo-sub">Earlier batches, in case you need to print one again.</span></div>
          </div>
          {lists.map((l) => (
            <div key={l.id} className="oo-prio-row" data-testid={`list-${l.no}`}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 140 }}>
                <b className="mono">{l.no}</b>
                <span style={{ fontSize: 12, color: "var(--mute)" }}>{dmy(l.date)} · {plural(l.notes.length, "credit note")}</span>
              </div>
              <span style={{ flex: 1, fontSize: 13, color: "var(--ink2)", minWidth: 200 }}>{l.notes.map((n) => n.file).join(", ")}</span>
              <span className="mono" style={{ fontWeight: 600 }}>{money("ZAR", l.total)}</span>
              <button type="button" className="oo-btn sm" onClick={() => download(downloadCreditList, l)}>Download list</button>
            </div>
          ))}
        </div>
      )}

      {crediting && (
        <CreditModal
          row={crediting}
          nameOf={nameOf}
          onClose={() => setCrediting(null)}
          onDone={async (note) => {
            setCrediting(null);
            await reload();
            toast(`Credit note for file ${note.file} · ${money("ZAR", note.amount)} — downloaded (2 copies) and added to the list`);
            download(downloadCreditNote, note);
          }}
        />
      )}
    </div>
  );
}

/* Only the two 6-digit invoice numbers are typed. The amount is the freight statement's
   total; account, client name, code, description and VAT (none) never change. */
const SIX = /^\d{6}$/;

function CreditModal({ row, nameOf, onClose, onDone }) {
  const toast = useToast();
  const { d, amount } = row;
  const [fs, setFs] = useState(d.fsInvoice || "");
  const [client, setClient] = useState(d.clientInvoice || "");
  const [busy, setBusy] = useState(false);
  const digits = (set) => (e) => set(e.target.value.replace(/\D/g, "").slice(0, 6));
  const ok = SIX.test(fs) && SIX.test(client);

  const create = async () => {
    if (!ok) { toast("Both invoice numbers need 6 digits", { error: true }); return; }
    setBusy(true);
    try {
      const { data } = await api.post("/credit-notes", { docId: d.id, amount, fs_invoice: fs, client_invoice: client, date: todayIso() });
      onDone(data);
    } catch (e) {
      toast(e?.response?.data?.detail || "Couldn't create the credit note", { error: true });
      setBusy(false);
    }
  };
  const box = (v) => ({ borderColor: v && !SIX.test(v) ? "var(--amb-fg)" : undefined, letterSpacing: ".08em" });

  return (
    <Modal onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h2>Credit file {d.file}</h2>
        <span style={{ fontSize: 14, color: "var(--mute)" }}>{nameOf(d.clientId)} · {d.no} · {money("ZAR", amount)} · dated today</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <label className="oo-field" style={{ gap: 8 }}>
          <span style={{ fontSize: 13, color: "var(--ink)" }}>Invoice Nº to be credited</span>
          <input className="oo-input big mono" value={fs} onChange={digits(setFs)} placeholder="6 digits" inputMode="numeric" maxLength={6} autoFocus style={box(fs)} data-testid="cn-fs" />
        </label>
        <label className="oo-field" style={{ gap: 8 }}>
          <span style={{ fontSize: 13, color: "var(--ink)" }}>Forwarding recovered on invoice</span>
          <input className="oo-input big mono" value={client} onChange={digits(setClient)} placeholder="6 digits" inputMode="numeric" maxLength={6} style={box(client)} onKeyDown={(e) => e.key === "Enter" && create()} data-testid="cn-client" />
        </label>
      </div>
      <span style={{ fontSize: 12, color: "var(--mute)" }}>Account 5613 · FREIGHT STATEMENT · 30050 FORWARDING · {money("ZAR", amount)} · no VAT. Downloads as one PRO-FORMA CREDIT NOTE with 2 copies, and goes on the current list.</span>
      <div className="oo-modal-actions">
        <button type="button" className="oo-btn foot" style={{ padding: "11px 18px" }} onClick={onClose}>Cancel</button>
        <button type="button" className="oo-btn primary foot" style={{ padding: "11px 20px" }} onClick={create} disabled={busy || !ok} data-testid="cn-create">Create credit note</button>
      </div>
    </Modal>
  );
}
