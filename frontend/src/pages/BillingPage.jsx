import { useState } from "react";
import { pinSort, useClients, useDocuments } from "@/lib/data";
import { calc, makeDoc, money } from "@/lib/billingCalc";
import { DOC_STATUS_HUE, DOC_TYPE_HUE, Pill, Seg, dmy, useToast } from "@/lib/ui";
import DocBuilder, { nextDocNumber } from "@/components/DocBuilder";

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

  const nameOf = (id) => clients.find((c) => c.id === id)?.name;
  const q = search.trim().toLowerCase();
  const rows = docs
    .filter((d) => matches(d, filter))
    .filter((d) => !q || `${nameOf(d.clientId) || ""} ${d.no} ${d.file || ""} ${d.ref || ""}`.toLowerCase().includes(q))
    .slice()
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  const newDoc = async (type) => {
    const c = pinSort(clients)[0];
    try {
      const no = await nextDocNumber(type);
      setOpen(makeDoc(type === "quote" ? "imp" : "fcl", type, { no, clientId: c?.id || "", entity: c?.company || "Clearfreight" }));
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
          <button type="button" className="oo-btn primary lg" onClick={() => newDoc("pfi")}>+ New pro forma</button>
        </div>
      </div>

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
              <span className="mono" style={{ fontSize: 13, fontWeight: 500 }}>{d.no}</span>
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

      {open && <DocBuilder key={open.id || open.no} initial={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
