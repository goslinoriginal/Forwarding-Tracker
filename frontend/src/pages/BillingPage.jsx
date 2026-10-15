import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import InvoiceTotals from "@/components/InvoiceTotals";
import { pinSort, useClients, useDocuments, useRefresh, useShipments } from "@/lib/data";
import { calc, makeDoc, money } from "@/lib/billingCalc";
import { DOC_STATUS_HUE, DOC_TYPE_HUE, Modal, Pill, Seg, dmy, useToast } from "@/lib/ui";
import DocBuilder, { fromShipment, nextDocNumber, pfiFromQuote } from "@/components/DocBuilder";
import { api } from "@/lib/api";

const COLS = "minmax(170px,1.4fr) 104px 96px minmax(150px,1.3fr) 76px 96px 130px 96px 20px";
const FILTERS = ["All", "Quotes", "Pro formas"];
const matches = (d, f) => f === "All" || (f === "Quotes" ? d.type === "quote" : d.type === "pfi");

export default function BillingPage() {
  const toast = useToast();
  const { data: docs = [] } = useDocuments();
  const { data: clients = [] } = useClients();
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(null);
  const [asking, setAsking] = useState(false);
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "totals" ? "totals" : "docs";
  const setView = (v) => setParams(v === "totals" ? { view: "totals" } : {}, { replace: true });

  const nameOf = (id) => clients.find((c) => c.id === id)?.name;
  const q = search.trim().toLowerCase();
  const rows = docs
    .filter((d) => matches(d, filter))
    .filter((d) => !q || `${nameOf(d.clientId) || ""} ${d.no} ${d.file || ""} ${d.ref || ""}`.toLowerCase().includes(q))
    .slice()
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  const refresh = useRefresh();
  const newDoc = async (type, ship, quote) => {
    try {
      const no = await nextDocNumber(type);
      if (quote) {
        const client = clients.find((x) => x.id === quote.clientId);
        setOpen(makeDoc(quote.tpl || "fcl", type, { no, ...pfiFromQuote(quote, ship, client) }));
        // The client accepted it: link the quote to this file and mark it accepted
        const file = ship?.file_number || quote.file || "";
        if (quote.file !== file || quote.status !== "Accepted") {
          await api.put(`/documents/${quote.id}`, { ...quote, file, status: "Accepted" });
          refresh("documents");
        }
      } else if (ship) {
        const { cargoTpl, ...fill } = fromShipment(ship, clients.find((x) => x.id === ship.client_id));
        setOpen(makeDoc(cargoTpl, type, { no, ...fill }));
      } else {
        const c = pinSort(clients)[0];
        setOpen(makeDoc(type === "quote" ? "imp" : "fcl", type, { no, clientId: c?.id || "", entity: c?.company || "Clearfreight" }));
      }
    } catch { toast("Couldn't start a new document", { error: true }); }
  };

  return (
    <div className="oo-page" data-screen-label="Quotes & invoices">
      <div className="oo-head">
        <div className="oo-head-text">
          <h1 className="oo-h1">Quotes &amp; invoices</h1>
          <p className="oo-lead">Quote clients and issue pro forma invoices.</p>
        </div>
        <div className="oo-actions">
          <button type="button" className="oo-btn lg" onClick={() => newDoc("quote")}>+ New quote</button>
          <button type="button" className="oo-btn primary lg" onClick={() => setAsking(true)}>+ New pro forma</button>
        </div>
      </div>

      <div style={{ display: "flex" }}>
        <Seg size="lg" value={view} onChange={setView} options={[{ value: "docs", label: "Quotes & pro formas" }, { value: "totals", label: "Invoiced totals" }]} />
      </div>

      {view === "totals" ? (
        <InvoiceTotals docs={docs} clients={clients} onShowClient={(name) => { setFilter("Pro formas"); setSearch(name); setView("docs"); }} />
      ) : (<>
      <div className="oo-toolbar">
        <Seg value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ value: f, label: f, count: docs.filter((d) => matches(d, f)).length }))} />
        <input className="oo-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search client, doc #, file #…" />
      </div>

      <div className="oo-card scroll">
        <div style={{ minWidth: 1000 }}>
          <div className="oo-grid-head" style={{ gridTemplateColumns: COLS }}>
            <span>Client</span><span>Doc #</span><span>Type</span><span>Route</span><span>File #</span><span>Date</span><span className="r">Total</span><span>Status</span><span />
          </div>
          {rows.map((d, i) => (
            <div
              key={d.id}
              className="oo-grid-row click"
              style={{ gridTemplateColumns: COLS, fontSize: 14, animationDelay: `${Math.min(i, 12) * 30}ms` }}
              onClick={() => setOpen({ ...d, lines: (d.lines || []).map((l) => ({ ...l })) })}
            >
              <span className="oo-ellipsis" style={{ fontWeight: 600 }}>{nameOf(d.clientId) || "—"}</span>
              <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                <span className="mono" style={{ fontSize: 13, fontWeight: 500 }}>{d.no}</span>
                {d.quoteNo && <span style={{ fontSize: 11, color: "var(--mute)" }}>from {d.quoteNo}</span>}
              </span>
              <Pill hue={DOC_TYPE_HUE[d.type]}>{d.type === "quote" ? "Quote" : "Pro forma"}</Pill>
              <span className="oo-ellipsis" style={{ color: "var(--ink2)", fontSize: 13 }}>{[d.pol, d.pod].filter(Boolean).join(" → ") || "—"}</span>
              <span className="mono" style={{ fontSize: 13, color: "var(--ink2)" }}>{d.file || "—"}</span>
              <span className="mono" style={{ fontSize: 13, color: "var(--ink2)" }}>{dmy(d.date) || "—"}</span>
              <span className="mono r" style={{ fontSize: 13, fontWeight: 500 }}>{money("ZAR", calc(d).total)}</span>
              <Pill hue={DOC_STATUS_HUE[d.status]}>{d.status}</Pill>
              <span className="oo-chev">›</span>
            </div>
          ))}
          {!rows.length && (
            <div className="oo-empty">
              <b>Nothing here yet</b>
              <span className="oo-sub">Create a quote or pro forma, or clear the search.</span>
            </div>
          )}
        </div>
      </div>

      </>)}

      {asking && (
        <FilePrompt
          clients={clients}
          onClose={() => setAsking(false)}
          docs={docs}
          onPick={(ship, quote) => { setAsking(false); newDoc("pfi", ship, quote); }}
        />
      )}
      {open && <DocBuilder key={open.id || open.no} initial={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/* "New pro forma" asks for the file number first and fills the pro forma from
   that shipment on the status report (client, order, kgs/cbm, route, vessel, SOB). */
function FilePrompt({ clients, docs, onClose, onPick }) {
  const { data: ships = [] } = useShipments();
  const [file, setFile] = useState("");
  const [pick, setPick] = useState(0);
  const q = file.trim().toLowerCase();
  const hits = q ? ships.filter((s) => (s.file_number || "").trim().toLowerCase() === q) : [];
  const nameOf = (id) => clients.find((c) => c.id === id)?.name || "—";
  const chosen = hits[Math.min(pick, hits.length - 1)];
  // Quotes already linked to this file, then this client's quotes not linked to any file yet
  const quotes = (docs || []).filter((d) => d.type === "quote").sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const linked = q ? quotes.filter((d) => (d.file || "").trim().toLowerCase() === q && (!chosen || d.clientId === chosen.client_id)) : [];
  const unlinked = chosen ? quotes.filter((d) => d.clientId === chosen.client_id && !(d.file || "").trim()).slice(0, 5) : [];
  const [quoteSel, setQuoteSel] = useState(null); // null = default (the linked quote, if any); "" = rate sheet
  const quoteId = quoteSel ?? (linked[0]?.id || "");
  const quote = quotes.find((d) => d.id === quoteId) || null;
  const go = () => { if (chosen || quote) onPick(chosen || null, quote); };

  return (
    <Modal onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h2>New pro forma</h2>
        <span style={{ fontSize: 14, color: "var(--mute)" }}>Enter the file number to pull its details from the status report.</span>
      </div>
      <label className="oo-field" style={{ gap: 8 }}>
        <span style={{ fontSize: 13, color: "var(--ink)" }}>File number</span>
        <input
          className="oo-input big mono"
          value={file}
          onChange={(e) => { setFile(e.target.value); setPick(0); setQuoteSel(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") go(); }}
          placeholder="e.g. 158373"
          inputMode="numeric"
          autoFocus
          data-testid="pfi-file-input"
        />
      </label>
      {q && !hits.length && <span className="oo-sub">No shipment on the status reports has file number {file.trim()}{linked.length ? " — you can still use the quote linked to it." : "."}</span>}
      {hits.map((s, i) => (
        <button
          key={s.id}
          type="button"
          onClick={() => setPick(i)}
          style={{
            textAlign: "left", display: "flex", flexDirection: "column", gap: 4, padding: "12px 14px", borderRadius: 12, cursor: "pointer", font: "inherit", color: "inherit",
            border: `1.5px solid ${chosen?.id === s.id ? "var(--accent)" : "var(--line)"}`, background: chosen?.id === s.id ? "var(--accent-soft)" : "var(--panel)",
          }}
        >
          <span style={{ fontWeight: 600 }}>{nameOf(s.client_id)}{[s.supplier, s.end_client && `for ${s.end_client}`].filter(Boolean).map((t) => <span key={t} style={{ fontWeight: 400, color: "var(--ink2)" }}> · {t}</span>)}</span>
          <span style={{ fontSize: 13, color: "var(--ink2)", whiteSpace: "pre-line" }}>{s.order_booking_file || "No order details"}</span>
          <span style={{ fontSize: 12, color: "var(--mute)" }}>
            {[s.cargo_type, s.vessel_name, s.final_destination || s.pod, s.sob_date && `SOB ${dmy(s.sob_date)}`, s.anf_received && "Archived"].filter(Boolean).join(" · ")}
          </span>
        </button>
      ))}
      {(chosen || linked.length > 0) && (
        <div className="oo-field" style={{ gap: 8 }} data-testid="quote-choice">
          <span style={{ fontSize: 13, color: "var(--ink)" }}>
            {linked.length ? `There was ${linked.length === 1 ? "a quote" : `${linked.length} quotes`} for this file — shown next to the pro forma for reference` : "Was there a quote? Link it to show it next to the pro forma"}
          </span>
          {[...linked, ...unlinked].map((d) => (
            <QuoteOption key={d.id} d={d} on={quoteId === d.id} linked={linked.includes(d)} onClick={() => setQuoteSel(d.id)} />
          ))}
          <QuoteOption on={!quoteId} onClick={() => setQuoteSel("")} />
        </div>
      )}
      <div className="oo-modal-actions">
        <button type="button" className="oo-btn" style={{ marginRight: "auto" }} onClick={() => onPick(null)}>Start blank</button>
        <button type="button" className="oo-btn foot" style={{ padding: "11px 18px" }} onClick={onClose}>Cancel</button>
        <button type="button" className="oo-btn primary foot" style={{ padding: "11px 20px" }} onClick={go} disabled={!chosen && !quote}>
          Create pro forma
        </button>
      </div>
    </Modal>
  );
}

function QuoteOption({ d, on, linked, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 12, cursor: "pointer", font: "inherit", color: "inherit",
        border: `1.5px solid ${on ? "var(--accent)" : "var(--line)"}`, background: on ? "var(--accent-soft)" : "var(--panel)",
      }}
      data-testid={d ? `quote-opt-${d.no}` : "quote-opt-none"}
    >
      {d ? (
        <>
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontWeight: 600 }}>{d.no} <span style={{ fontWeight: 400, color: "var(--mute)", fontSize: 12 }}>· {dmy(d.date)} · {d.status}{linked ? ` · file ${d.file}` : " · not linked to a file"}</span></span>
            <span style={{ fontSize: 12, color: "var(--ink2)" }}>{[d.pol, d.pod].filter(Boolean).join(" → ") || "—"}{d.commodity ? ` · ${d.commodity}` : ""}</span>
          </span>
          <span className="mono" style={{ fontSize: 13, fontWeight: 500 }}>{money("ZAR", calc(d).total)}</span>
        </>
      ) : (
        <span style={{ fontSize: 13 }}>No quote</span>
      )}
    </button>
  );
}
