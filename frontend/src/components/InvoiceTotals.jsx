import { useState } from "react";
import { money } from "@/lib/billingCalc";
import { PERIODS, invoiceStats, monthLabel, monthlyTotals } from "@/lib/billingStats";
import { COMPANY_HUE, Seg, dmy } from "@/lib/ui";

const ENT = [{ value: "", label: "All entities" }, { value: "Patuma", label: "Patuma" }, { value: "Clearfreight", label: "Clearfreight" }];
const COLS = "minmax(140px,1.4fr) 36px repeat(6, minmax(100px,1fr)) 84px";
const SORTS = { total: "Total", n: "Pro formas", revenue: "Revenue", Await: "Awaiting credit", last: "Last" };

/** Invoicing totals: KPIs for a period, a 12-month chart and a per-client table. */
export default function InvoiceTotals({ docs, clients, onShowClient }) {
  const [period, setPeriod] = useState("month");
  const [entity, setEntity] = useState("");
  const [sort, setSort] = useState("total");
  const { all, byClient, byEntity } = invoiceStats(docs, { period, entity });
  const months = monthlyTotals(docs, { entity });
  const max = Math.max(1, ...months.map((m) => m.total));
  const nameOf = (id) => clients.find((c) => c.id === id)?.name || "No client";
  const rows = Object.entries(byClient)
    .map(([id, t]) => ({ id, name: nameOf(id), ...t }))
    .sort((a, b) => (sort === "last" ? b.last.localeCompare(a.last) : b[sort] - a[sort]) || a.name.localeCompare(b.name));
  const periodLabel = PERIODS.find((p) => p.value === period).label.toLowerCase();

  const kpis = [
    { k: "Invoiced", v: money("ZAR", all.total), sub: `${all.n} pro forma${all.n === 1 ? "" : "s"} · incl. VAT`, style: { background: "var(--accent-soft)", color: "var(--accent-ink)" } },
    { k: "Excl. VAT", v: money("ZAR", all.sub), sub: `Average ${money("ZAR", all.n ? all.total / all.n : 0)} per pro forma`, style: { background: "var(--sub)", border: "1px solid var(--line2)" } },
    { k: "Revenue (our fees)", v: money("ZAR", all.revenue), sub: "Agency & service fee lines, excl. VAT", style: { background: "var(--grn-bg)", color: "var(--grn-fg)" } },
    { k: "Awaiting credit", v: money("ZAR", all.Await), sub: `${all.nAwait} Clearfreight freight statement${all.nAwait === 1 ? "" : "s"} accepted, not yet credited`, style: { background: "var(--amb-bg)", color: "var(--amb-fg)" } },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div className="oo-toolbar">
        <Seg value={period} onChange={setPeriod} options={PERIODS} />
        <Seg value={entity} onChange={setEntity} options={ENT} />
      </div>

      <div className="oo-kpis">
        {kpis.map((x, i) => (
          <div key={x.k} className="oo-kpi" style={{ ...x.style, animationDelay: `${0.04 * (i + 1)}s` }} data-testid={`inv-kpi-${i}`}>
            <span>{x.k}</span>
            <span className="n" style={{ fontSize: 26 }}>{x.v}</span>
            <span style={{ fontSize: 12, opacity: 0.85 }}>{x.sub}</span>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.6fr) minmax(0,1fr)", gap: 16 }} className="oo-two">
        <div className="oo-card pad">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <h2 className="oo-h2">Per month</h2>
            <span className="oo-sub">Last 12 months · incl. VAT · drafts included</span>
          </div>
          <div className="oo-months">
            {months.map((m, i) => (
              <div key={m.key} className="oo-month" title={`${monthLabel(m.key, true)}: ${money("ZAR", m.total)} · ${m.n} pro forma${m.n === 1 ? "" : "s"}`}>
                <span className="v mono">{m.total ? `${Math.round(m.total / 1000)}k` : ""}</span>
                <div className="col">
                  <div style={{ height: `${(m.total / max) * 100}%`, animationDelay: `${i * 40}ms` }}>
                    {m.Credited > 0 && <div className="paid" style={{ height: `${(m.Credited / m.total) * 100}%` }} />}
                  </div>
                </div>
                <span className="k">{monthLabel(m.key, m.key.endsWith("-01") || i === 0)}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--mute)" }}>
            <span><i className="oo-swatch" style={{ background: "var(--accent)" }} /> Invoiced</span>
            <span><i className="oo-swatch" style={{ background: "var(--grn-fg)" }} /> of which credited</span>
          </div>
        </div>
        <div className="oo-card pad">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <h2 className="oo-h2">Per entity</h2>
            <span className="oo-sub">{periodLabel}</span>
          </div>
          {Object.entries(byEntity).sort((a, b) => b[1].total - a[1].total).map(([e, t]) => (
            <div key={e} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 14 }}>
                <span style={{ fontWeight: 600 }}>{e}</span>
                <span className="mono">{money("ZAR", t.total)}</span>
              </div>
              <div className="oo-bar"><div style={{ width: `${(t.total / Math.max(1, all.total)) * 100}%`, background: `oklch(0.6 0.12 ${COMPANY_HUE[e] ?? 250})` }} /></div>
              <span style={{ fontSize: 12, color: "var(--mute)" }}>{t.n} pro forma{t.n === 1 ? "" : "s"} · revenue {money("ZAR", t.revenue)}</span>
            </div>
          ))}
          {!all.n && <span className="oo-sub">No pro formas {periodLabel}.</span>}
        </div>
      </div>

      <div className="oo-card scroll">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "18px 20px 12px", flexWrap: "wrap" }}>
          <div className="oo-card-title"><h2 className="oo-h2">Per client</h2><span className="oo-sub">Pro formas dated {periodLabel}, drafts included. Click a client to see their pro formas.</span></div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--ink2)" }}>
            Sort by
            <select className="oo-input" style={{ width: "auto", padding: "7px 10px" }} value={sort} onChange={(e) => setSort(e.target.value)}>
              {Object.entries(SORTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
        </div>
        <div style={{ minWidth: 980 }}>
          <div className="oo-grid-head" style={{ gridTemplateColumns: COLS }}>
            <span>Client</span><span className="r">#</span><span className="r">Total incl. VAT</span><span className="r">Excl. VAT</span><span className="r">Revenue</span><span className="r">Draft</span><span className="r">Awaiting credit</span><span className="r">Credited</span><span className="r">Last</span>
          </div>
          {rows.map((t, i) => (
            <div key={t.id} className="oo-grid-row click" style={{ gridTemplateColumns: COLS, fontSize: 14, animationDelay: `${Math.min(i, 12) * 30}ms` }} onClick={() => onShowClient(t.name)}>
              <span className="oo-ellipsis" style={{ fontWeight: 600 }}>{t.name}</span>
              <span className="mono r">{t.n}</span>
              <span className="mono r" style={{ fontWeight: 600 }}>{money("ZAR", t.total)}</span>
              <span className="mono r" style={{ color: "var(--ink2)" }}>{money("ZAR", t.sub)}</span>
              <span className="mono r" style={{ color: "var(--grn-fg)" }}>{money("ZAR", t.revenue)}</span>
              <span className="mono r" style={{ color: "var(--mute)" }}>{t.Draft ? money("ZAR", t.Draft) : "—"}</span>
              <span className="mono r" style={{ color: t.Await ? "var(--amb-fg)" : "var(--mute)" }}>{t.Await ? money("ZAR", t.Await) : "—"}</span>
              <span className="mono r" style={{ color: "var(--ink2)" }}>{t.Credited ? money("ZAR", t.Credited) : "—"}</span>
              <span className="mono r" style={{ fontSize: 12, color: "var(--ink2)" }}>{dmy(t.last)}</span>
            </div>
          ))}
          {rows.length > 0 && (
            <div className="oo-grid-row" style={{ gridTemplateColumns: COLS, fontSize: 14, fontWeight: 600, background: "var(--sub)" }}>
              <span>Total · {rows.length} client{rows.length === 1 ? "" : "s"}</span>
              <span className="mono r">{all.n}</span>
              <span className="mono r">{money("ZAR", all.total)}</span>
              <span className="mono r">{money("ZAR", all.sub)}</span>
              <span className="mono r">{money("ZAR", all.revenue)}</span>
              <span className="mono r">{money("ZAR", all.Draft)}</span>
              <span className="mono r">{money("ZAR", all.Await)}</span>
              <span className="mono r">{money("ZAR", all.Credited)}</span>
              <span />
            </div>
          )}
          {!rows.length && (
            <div className="oo-empty"><b>No pro formas {periodLabel}</b><span className="oo-sub">Try another period.</span></div>
          )}
        </div>
      </div>
    </div>
  );
}
