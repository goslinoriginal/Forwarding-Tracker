import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
import { clientEmail, roeDay, roeFor, shipmentLegs, useClients, useRefresh, useRoe, useShipments } from "@/lib/data";
import {
  DEF_OF, ENTITIES, GROUPS, INCO, Ln, PFI_TERMS, QUOTE_TERMS, SYM, TPL, calc, ecDesc, fmt, money, num, parseOrder,
} from "@/lib/billingCalc";
import { Seg, copyText, dmy, isoPlusDays, useToast } from "@/lib/ui";

/* Full-screen quote / pro forma builder: capture on the left, a live printable
   preview (or the EasyClear line list) on the right, split by a draggable handle. */

const SPLIT_KEY = "oceanops.split";
const readSplit = () => { try { const v = Number(JSON.parse(localStorage.getItem(SPLIT_KEY))); return v >= 25 && v <= 75 ? v : 50; } catch { return 50; } };

function F({ label, children }) {
  return <label className="oo-field"><span>{label}</span>{children}</label>;
}

export async function nextDocNumber(type) {
  const { data } = await api.get("/documents/next-number", { params: { type } });
  return data.no;
}

const JHB_RE = /jhb|johannesburg|city deep|kaserne|gauteng/i;

/** Everything a quote / pro forma can take from the status report for one file. */
export function fromShipment(s, client) {
  const o = parseOrder(s.order_booking_file);
  const cargoTpl = s.cargo_type === "LCL" ? "lcl" : "fcl";
  const dest = s.final_destination || s.pod || "";
  return {
    clientId: s.client_id,
    entity: client?.company || "Clearfreight",
    att: client?.email_greeting || "",
    file: s.file_number || "",
    ref: o.ref || "",
    commodity: o.commodity || "",
    units: o.units || "",
    unitType: o.unitType || "Crates",
    cbm: o.cbm || "",
    kgs: o.kgs || "",
    cntrs: o.cntrs || s.fcl_count || "1",
    pol: s.pol || "",
    pod: dest || "Durban",
    vessel: shipmentLegs(s).map((l) => l.name).filter(Boolean).join(" / "),
    sob: s.sob_date || "",
    eta: s.eta || s.planned_eta || "",
    jhb: JHB_RE.test(dest),
    cargoTpl,
  };
}

export default function DocBuilder({ initial, onClose }) {
  const toast = useToast();
  const refresh = useRefresh();
  const { data: clients = [] } = useClients();
  const { data: ships = [] } = useShipments();
  const { data: rates = [] } = useRoe();
  const [dc, setDc] = useState(initial);
  const [tab, setTab] = useState("doc");
  const [split, setSplit] = useState(readSplit);
  const [copied, setCopied] = useState(null);
  const copyTimer = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); clearTimeout(copyTimer.current); };
  }, [onClose]);

  // ROE comes from the rates captured each day: the SOB date's (a weekend SOB uses
  // the next Monday) and the invoice date's. Anything typed by hand is left alone.
  useEffect(() => {
    if (dc.status !== "Draft") return;
    setDc((d) => {
      const auto = d.roeAuto || {};
      const sobR = roeFor(rates, d.sob);
      const dayR = roeFor(rates, d.date);
      const want = { usdSob: sobR?.usd, eurSob: sobR?.eur, usdToday: dayR?.usd, eurToday: dayR?.eur };
      const patch = {};
      const next = { ...auto };
      Object.entries(want).forEach(([k, v]) => {
        const cur = d[k] || "";
        if (cur && cur !== auto[k]) return;
        next[k] = v || "";
        if (next[k] !== cur) patch[k] = next[k];
      });
      if (!Object.keys(patch).length && Object.keys(next).every((k) => next[k] === auto[k])) return d;
      return { ...d, ...patch, roeAuto: next };
    });
  }, [rates, dc.sob, dc.date, dc.status]);

  const setD = (patch) => setDc((d) => ({ ...d, ...(typeof patch === "function" ? patch(d) : patch) }));
  const setLine = (id, patch) => setD((d) => ({ lines: d.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
  const on = (k) => (e) => setD({ [k]: e.target.value });

  const isQ = dc.type === "quote";
  const tl = isQ ? "Quote" : "Pro forma";
  const tpl = TPL[dc.tpl] || TPL.fcl;
  const c = calc(dc);
  const client = clients.find((x) => x.id === dc.clientId) || {};
  const ent = ENTITIES.find((x) => x.key === dc.entity) || ENTITIES[0];
  const shipsFor = ships.filter((s) => s.client_id === dc.clientId);
  const roeTxt = (v) => (v ? v.toFixed(4) : "—");
  const usesEur = dc.lines.some((l) => l.cur === "EUR");

  /* ---------- Persistence ---------- */
  const save = async (extra) => {
    const nd = { ...dc, ...(extra || {}) };
    const { data } = nd.id ? await api.put(`/documents/${nd.id}`, nd) : await api.post("/documents", nd);
    setDc((d) => ({ ...d, ...extra, id: data.id, no: data.no }));
    refresh("documents");
    return data;
  };
  const guard = (fn) => async () => { try { await fn(); } catch { toast("Couldn't save the document", { error: true }); } };

  const guardRoe = (day, usd, eur) => async () => {
    try {
      await api.put(`/roe/${day}`, { usd, eur });
      await refresh("roe");
      toast(`ROE saved for ${dmy(day)}`);
    } catch { toast("Couldn't save the ROE", { error: true }); }
  };
  const onSave = guard(async () => { const d = await save(); toast(`${tl} ${d.no} saved`); });
  const onSend = guard(async () => {
    const d = await save({ status: dc.status === "Draft" ? "Sent" : dc.status });
    const to = clientEmail(client);
    if (to) {
      const params = new URLSearchParams({ subject: `${tl} ${d.no} – ${client.name}`, body: `Dear ${client.email_greeting || client.name},\n\nPlease find attached ${isQ ? "our quotation" : "the pro forma invoice"} ${d.no} (total ${money("ZAR", c.total)} incl. VAT).\n\nKind regards.` });
      window.location.href = `mailto:${encodeURIComponent(to)}?${params.toString().replace(/\+/g, "%20")}`;
    }
    toast(`${tl} ${d.no} marked sent${to ? ` · email to ${to} opened — attach the PDF` : ""}`);
  });
  const onDownload = guard(async () => {
    const d = await save();
    const paper = document.querySelector(".oo-sheet.doc .oo-paper");
    if (!paper) { setTab("doc"); toast("Switch to Document, then download again"); return; }
    let root = document.getElementById("oo-print-root");
    if (!root) { root = document.createElement("div"); root.id = "oo-print-root"; document.body.appendChild(root); }
    root.innerHTML = paper.outerHTML;
    const title = document.title;
    document.title = d.no;
    document.body.classList.add("printing-doc");
    const done = () => { document.body.classList.remove("printing-doc"); document.title = title; root.innerHTML = ""; window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    window.print();
    toast(`Choose "Save as PDF" to keep ${d.no}.pdf`);
  });
  const onConvert = guard(async () => {
    await save({ status: "Accepted" });
    const no = await nextDocNumber("pfi");
    setDc((d) => ({ ...d, id: null, type: "pfi", no, date: isoPlusDays(0), until: isoPlusDays(7), notes: PFI_TERMS, status: "Draft", entered: {}, lines: d.lines.map((l) => ({ ...l })) }));
    toast(`Quote accepted · pro forma ${no} created`);
  });
  const onDelete = guard(async () => {
    const old = dc;
    await api.delete(`/documents/${old.id}`);
    refresh("documents");
    onClose();
    toast(`${old.no} deleted`, { undo: async () => { await api.post("/documents", { ...old, id: undefined }); refresh("documents"); } });
  });

  const setType = async (k) => {
    if (dc.type === k) return;
    if (dc.id) { setD({ type: k }); return; }
    const no = await nextDocNumber(k);
    setD((d) => ({
      type: k, no, until: isoPlusDays(k === "quote" ? 30 : 7), status: "Draft",
      notes: d.notes === (d.type === "quote" ? QUOTE_TERMS : PFI_TERMS) ? (k === "quote" ? QUOTE_TERMS : PFI_TERMS) : d.notes,
    }));
  };

  const setTpl = (k) => {
    if (!TPL[k] || k === dc.tpl) return;
    const prev = dc;
    setD({ tpl: k, lines: TPL[k].lines(), markup: String(TPL[k].markup), entered: {} });
    toast(`Charges reset to ${TPL[k].label}`, { undo: () => setDc(prev) });
  };

  const setClient = (id) => {
    const x = clients.find((y) => y.id === id);
    if (x) setD({ clientId: x.id, entity: x.company, file: "" });
  };

  const setFile = (f) => {
    const s = shipsFor.find((x) => x.file_number === f);
    if (!s) { setD({ file: f }); return; }
    const { cargoTpl, ...fill } = fromShipment(s, client);
    // Keep anything already typed where the status report has nothing
    const patch = Object.fromEntries(Object.entries(fill).filter(([k, v]) => v !== "" || k === "file"));
    if (!dc.id && cargoTpl !== dc.tpl && dc.tpl !== "imp") Object.assign(patch, { tpl: cargoTpl, lines: TPL[cargoTpl].lines(), markup: String(TPL[cargoTpl].markup) });
    setD(patch);
    toast(`Filled from file ${f}`);
  };

  const startSplit = (e) => {
    e.preventDefault();
    let last = split;
    const move = (ev) => { last = Math.round(Math.min(75, Math.max(25, (ev.clientX / window.innerWidth) * 100)) * 10) / 10; setSplit(last); };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      try { localStorage.setItem(SPLIT_KEY, JSON.stringify(last)); } catch {}
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const flash = (text, key) => {
    copyText(text);
    setCopied(key);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(null), 1100);
  };

  /* ---------- Derived view data ---------- */
  const detailOf = (l) => {
    if (l.off) return "Off · not JHB cargo";
    if (l.basis === "pct") return `${l.rate}% of R ${fmt(l.pctBase)}${l.min ? ` · min R${l.min}` : ""}`;
    if (l.basis === "depot") return `R${l.base || 0} + R${l.rate} × ${c.cbm.toFixed(3)}`;
    const u = l.basis === "cntr" ? ` × ${c.cn}` : l.basis === "cbm" ? ` × ${c.cbm.toFixed(3)}` : "";
    return l.cur === "ZAR" ? (u ? `R${fmt(num(l.rate))}${u}` : "") : `${SYM[l.cur]}${fmt(l.fc)} × ${roeTxt(l.roeV)}`;
  };
  const groups = GROUPS.map(([g, label]) => {
    const rows = c.lines.filter((l) => l.group === g);
    if (!rows.length && g === "customs") return null;
    return { g, label, rows, sub: money("ZAR", rows.reduce((a, l) => a + l.zar, 0)) };
  }).filter(Boolean);
  const addLine = (g) => setD((d) => ({
    lines: [...d.lines, Ln(g, g === "fees" ? "10011" : g === "local" && d.tpl === "imp" ? "30022" : "30050", "", "", "ZAR", "flat", "", { vat: (g === "local" && d.tpl === "imp") || g === "fees", type: g === "fees" ? "R" : "D" })],
  }));

  const live = c.lines.filter((l) => !l.off && l.zar);
  const unitsTxt = (l) => (l.basis === "cntr" ? String(c.cn) : l.basis === "cbm" || l.basis === "depot" ? c.cbm.toFixed(3) : "1");
  const rateTxt = (l) => (l.basis === "pct" ? `${l.rate}%` : l.basis === "depot" ? `${l.base || 0}+${l.rate}` : fmt(num(l.rate)));
  const prevGroups = GROUPS.map(([g, label]) => {
    const rows = live.filter((l) => l.group === g);
    if (!rows.length) return null;
    return { g, label: `Total ${label.toLowerCase()}`, rows, sub: fmt(rows.reduce((a, l) => a + l.zar, 0)), vat: fmt(rows.reduce((a, l) => a + l.vatAmt, 0)) };
  }).filter(Boolean);
  const party = [[isQ ? "To" : "Client", client.name || "—"], ["Attention", dc.att], ["Date", dmy(dc.date)], [isQ ? "Valid until" : "Payment due", dmy(dc.until)], ["Ref no", dc.ref], ["File", dc.file], ["Prepared by", dc.prep], ["Email", clientEmail(client)]].filter((p) => p[1]);
  const shipInfo = [["Commodity", dc.commodity], ["Units", [dc.units, dc.unitType].filter(Boolean).join(" ")], ["CBM", dc.cbm], ["KGS", dc.kgs], ["ETD / POL", dc.pol], ["ETA / POD", dc.pod], ["Via", dc.via], ["Transit time", dc.transit], ["Vessel", dc.vessel], ["SOB date", dmy(dc.sob)], ["ETA", dmy(dc.eta)], ["Frequency", dc.freq], ["Terms", dc.inco], ["R.O.E.", `USD ${roeTxt(c.roe.USD)}${usesEur ? ` · EUR ${roeTxt(c.roe.EUR)}` : ""}`]].filter((p) => p[1]);
  const entered = dc.entered || {};
  const markEntered = (id, v) => setD((d) => ({ entered: { ...(d.entered || {}), [id]: v } }));
  const doneN = live.filter((l) => entered[l.id]).length;

  // Portalled to <body> so the page's entrance animation can't offset the sheet.
  return createPortal(
    <div className="oo-sheet doc" data-screen-label="Quote / pro forma builder">
      <header className="oo-sheet-head" style={{ padding: "14px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0, flexWrap: "wrap" }}>
          <button type="button" className="oo-circle" style={{ fontSize: 18 }} onClick={onClose} title="Close (Esc)">×</button>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-.01em" }}>{dc.id ? `${tl} ${dc.no}` : `New ${tl.toLowerCase()}`}</span>
            <span style={{ fontSize: 12, color: "var(--mute)" }}>{client.name || "—"} · {tpl.label} · {dc.status}</span>
          </div>
          <Seg value={dc.type} onChange={setType} options={[{ value: "quote", label: "Quote" }, { value: "pfi", label: "Pro forma" }]} />
        </div>
        <div className="oo-actions">
          {dc.id && <button type="button" className="oo-btn danger" onClick={onDelete}>Delete</button>}
          {isQ && dc.id && <button type="button" className="oo-btn" onClick={onConvert}>Convert to pro forma</button>}
          <button type="button" className="oo-btn" onClick={onDownload}>Download PDF</button>
          <button type="button" className="oo-btn" onClick={onSave}>Save draft</button>
          <button type="button" className="oo-btn primary" onClick={onSend}>Send to client</button>
        </div>
      </header>

      <div className="oo-builder" style={{ gridTemplateColumns: `minmax(0,${split}fr) 10px minmax(0,${100 - split}fr)` }}>
        <div className="oo-cap">
          <section className="oo-sec">
            <h3>Details</h3>
            <div className="oo-autogrid">
              <F label="Client">
                <select className="oo-input b" value={dc.clientId} onChange={(e) => setClient(e.target.value)}>
                  {!dc.clientId && <option value="">Choose…</option>}
                  {clients.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </F>
              <F label="Doc #"><input className="oo-input b" value={dc.no} onChange={on("no")} /></F>
              <F label="Date"><input type="date" className="oo-input b" value={dc.date} onChange={on("date")} /></F>
              <F label={isQ ? "Valid until" : "Payment due"}><input type="date" className="oo-input b" value={dc.until} onChange={on("until")} /></F>
              <F label="Rate sheet">
                <select className="oo-input b" value={dc.tpl} onChange={(e) => setTpl(e.target.value)}>
                  {Object.keys(TPL).map((k) => <option key={k} value={k}>{TPL[k].label}</option>)}
                </select>
              </F>
              <F label="Client ref / PO"><input className="oo-input b" value={dc.ref} onChange={on("ref")} placeholder="e.g. ZN26152" /></F>
              <F label="Attention"><input className="oo-input b" value={dc.att} onChange={on("att")} placeholder="Contact name" /></F>
              <F label="Prepared by"><input className="oo-input b" value={dc.prep} onChange={on("prep")} placeholder="Your name" /></F>
            </div>
            <div className="oo-field">
              <span>Issued by</span>
              <Seg value={dc.entity} onChange={(v) => setD({ entity: v })} options={ENTITIES.map((x) => ({ value: x.key, label: x.label }))} />
            </div>
          </section>

          <section className="oo-sec">
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <h3>Shipment</h3>
              <span style={{ fontSize: 12, color: "var(--mute)" }}>Link a file to fill the route. CBM and kgs drive per-cbm charges (chargeable = greater of cbm or kgs ÷ 1000).</span>
            </div>
            <div className="oo-autogrid">
              <F label="Linked file #">
                <select className="oo-input b" value={dc.file} onChange={(e) => setFile(e.target.value)}>
                  <option value="">None</option>
                  {shipsFor.filter((s) => s.file_number).map((s) => <option key={s.id} value={s.file_number}>{[s.file_number, s.supplier || s.end_client].filter(Boolean).join(" · ")}</option>)}
                </select>
              </F>
              <F label="Commodity"><input className="oo-input b" value={dc.commodity} onChange={on("commodity")} placeholder="e.g. Pumps (non haz)" /></F>
              <F label="Units"><input className="oo-input b" value={dc.units} onChange={on("units")} placeholder="e.g. 2" /></F>
              <F label="Unit type"><input className="oo-input b" value={dc.unitType} onChange={on("unitType")} placeholder="Crates" /></F>
              <F label="CBM"><input className="oo-input b" value={dc.cbm} onChange={on("cbm")} placeholder="0.000" inputMode="decimal" /></F>
              <F label="KGS"><input className="oo-input b" value={dc.kgs} onChange={on("kgs")} placeholder="0" inputMode="decimal" /></F>
              <F label="No. of containers"><input className="oo-input b" value={dc.cntrs} onChange={on("cntrs")} placeholder="1" inputMode="numeric" /></F>
              <F label="Incoterm">
                <select className="oo-input b" value={dc.inco} onChange={on("inco")}>{INCO.map((x) => <option key={x} value={x}>{x}</option>)}</select>
              </F>
              <F label="ETD / POL"><input className="oo-input b" value={dc.pol} onChange={on("pol")} placeholder="Port of loading" /></F>
              <F label="ETA / POD"><input className="oo-input b" value={dc.pod} onChange={on("pod")} placeholder="Port / final destination" /></F>
              <F label="Via"><input className="oo-input b" value={dc.via} onChange={on("via")} placeholder="Transhipment port" /></F>
              <F label="Transit time"><input className="oo-input b" value={dc.transit} onChange={on("transit")} placeholder="e.g. 27 days" /></F>
              <F label="Vessel"><input className="oo-input b" value={dc.vessel} onChange={on("vessel")} /></F>
              <F label="SOB date"><input type="date" className="oo-input b" value={dc.sob || ""} onChange={on("sob")} /></F>
              <F label="ETA"><input type="date" className="oo-input b" value={dc.eta || ""} onChange={on("eta")} /></F>
              <F label="Frequency"><input className="oo-input b" value={dc.freq} onChange={on("freq")} placeholder="Weekly" /></F>
            </div>
            <div className="oo-field">
              <span>Johannesburg cargo (applies Transfer to JHB)</span>
              <Seg value={!!dc.jhb} onChange={(v) => setD({ jhb: v })} options={[{ value: false, label: "No" }, { value: true, label: "Yes" }]} />
            </div>
          </section>

          <section className="oo-sec">
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <h3>Rates of exchange</h3>
              <span style={{ fontSize: 12, color: "var(--mute)" }}>The higher of SOB-date and today’s ROE is used, plus the markup. Filled from the daily rates you capture.</span>
            </div>
            {[["SOB date", dc.sob, "usdSob", "eurSob"], ["Invoice date", dc.date, "usdToday", "eurToday"]].filter(([, iso]) => iso).map(([label, iso, uk, ek]) => {
              const day = roeDay(iso);
              const got = roeFor(rates, iso);
              const typed = (dc[uk] || dc[ek]) && !got;
              return (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12, color: "var(--ink2)" }}>
                  <span>
                    {label} {dmy(iso)}{day !== iso ? ` (weekend → Monday ${dmy(day)})` : ""}:{" "}
                    {got ? <b className="mono">{[got.usd && `$ ${got.usd}`, got.eur && `€ ${got.eur}`].filter(Boolean).join(" · ")}</b> : <span style={{ color: "var(--amb-fg)" }}>no ROE captured for {dmy(day)}</span>}
                  </span>
                  {typed && (
                    <button type="button" className="oo-link" onClick={guardRoe(day, dc[uk], dc[ek])}>Save typed rates as {dmy(day)}’s ROE</button>
                  )}
                </div>
              );
            })}
            <div className="oo-autogrid">
              <F label="USD · SOB date ROE"><input className="oo-input b" value={dc.usdSob} onChange={on("usdSob")} placeholder="0.0000" inputMode="decimal" /></F>
              <F label="USD · today’s ROE"><input className="oo-input b" value={dc.usdToday} onChange={on("usdToday")} placeholder="0.0000" inputMode="decimal" /></F>
              <F label="EUR · SOB date ROE"><input className="oo-input b" value={dc.eurSob} onChange={on("eurSob")} placeholder="0.0000" inputMode="decimal" /></F>
              <F label="EUR · today’s ROE"><input className="oo-input b" value={dc.eurToday} onChange={on("eurToday")} placeholder="0.0000" inputMode="decimal" /></F>
              <F label="Markup %"><input className="oo-input b" value={dc.markup} onChange={on("markup")} placeholder="4" inputMode="decimal" /></F>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[`USD used ${roeTxt(c.roe.USD)}`, `EUR used ${roeTxt(c.roe.EUR)}`, `Chargeable ${c.cbm.toFixed(3)} cbm`, `${c.cn} container${c.cn === 1 ? "" : "s"}`].map((t) => (
                <span key={t} className="mono" style={{ fontSize: 12, fontWeight: 500, padding: "6px 12px", borderRadius: 999, background: "var(--accent-soft)", color: "var(--accent-ink)" }}>{t}</span>
              ))}
            </div>
          </section>

          <section className="oo-sec">
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <h3>Charges</h3>
              <span style={{ fontSize: 12, color: "var(--mute)" }}>Calculated as per the rate sheet. Zero lines are left off the document and EasyClear list.</span>
            </div>
            <div style={{ overflowX: "auto", margin: "0 -4px", padding: "0 4px" }}>
              <div style={{ minWidth: 500, display: "flex", flexDirection: "column", gap: 6 }}>
                <div className="oo-charge" style={{ fontSize: 11, fontWeight: 500, color: "var(--mute)", padding: "0 2px" }}>
                  <span>Description</span><span>Cur</span><span>Basis</span><span>Rate</span><span className="c">VAT</span><span className="r">ZAR</span><span />
                </div>
                {groups.map((g) => (
                  <div key={g.g} style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, padding: "0 2px 4px", borderBottom: "1px solid var(--line2)" }}>
                      <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--ink2)" }}>{g.label}</span>
                      <span className="mono" style={{ fontSize: 12, color: "var(--mute)" }}>{g.sub}</span>
                    </div>
                    {g.rows.map((l) => (
                      <div key={l.id} className="oo-charge" style={{ opacity: l.off ? 0.45 : 1 }}>
                        <input className="oo-input ln" value={l.desc} onChange={(e) => setLine(l.id, { desc: e.target.value, ec: "" })} placeholder="Charge" />
                        <select className="oo-input ln" value={l.basis === "pct" ? "ZAR" : l.cur} onChange={(e) => setLine(l.id, { cur: e.target.value })} disabled={l.basis === "pct"}>
                          <option value="USD">USD</option><option value="EUR">EUR</option><option value="ZAR">ZAR</option>
                        </select>
                        <select className="oo-input ln" value={l.basis} onChange={(e) => { const b = e.target.value; setLine(l.id, b === "pct" ? { basis: b, cur: "ZAR", of: l.of || DEF_OF[l.group] } : { basis: b }); }}>
                          <option value="flat">Flat</option><option value="cntr">Per container</option><option value="cbm">Per cbm</option><option value="depot">Flat + per cbm</option><option value="pct">% of charges</option>
                        </select>
                        <div style={{ display: "flex", gap: 4, alignItems: "center", minWidth: 0 }}>
                          {l.basis === "depot" && <input className="oo-input ln num" style={{ padding: "7px 5px" }} value={l.base} onChange={(e) => setLine(l.id, { base: e.target.value })} title="Flat amount" />}
                          <input className="oo-input ln num" value={l.rate} onChange={(e) => setLine(l.id, { rate: e.target.value })} inputMode="decimal" placeholder="0" title={l.basis === "pct" ? "Percentage" : l.basis === "depot" ? "Per cbm" : "Rate"} />
                        </div>
                        <button type="button" className={`oo-vat ${l.vat ? "on" : ""}`} title="15% VAT" onClick={() => setLine(l.id, { vat: !l.vat })}>{l.vat ? "✓" : ""}</button>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", minWidth: 0 }}>
                          <span className="mono" style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap" }}>{money("ZAR", l.zar)}</span>
                          <span className="oo-ellipsis" style={{ fontSize: 10, color: "var(--mute)", maxWidth: "100%" }}>{detailOf(l)}</span>
                        </div>
                        <button type="button" className="oo-rm" title="Remove line" onClick={() => setD((d) => ({ lines: d.lines.filter((x) => x.id !== l.id) }))}>×</button>
                      </div>
                    ))}
                    <button type="button" className="oo-dashed" onClick={() => addLine(g.g)}>+ Add line</button>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ alignSelf: "flex-end", display: "grid", gridTemplateColumns: "auto 140px", gap: "6px 24px", fontSize: 14, paddingTop: 10, borderTop: "1px solid var(--line2)", minWidth: 300 }}>
              <span className="muted">Total excl. VAT</span><span className="mono r">{money("ZAR", c.sub)}</span>
              <span className="muted">VAT 15%</span><span className="mono r">{money("ZAR", c.vat)}</span>
              <span style={{ fontWeight: 600 }}>Total incl. VAT</span><span className="mono r" style={{ fontWeight: 600 }}>{money("ZAR", c.total)}</span>
            </div>
          </section>

          <section className="oo-sec">
            <h3>Terms &amp; status</h3>
            <textarea className="oo-input b" rows={6} style={{ resize: "vertical" }} value={dc.notes} onChange={on("notes")} placeholder="Terms and conditions…" />
            <div className="oo-field">
              <span>Status</span>
              <Seg value={dc.status} onChange={(v) => setD({ status: v })} options={(isQ ? ["Draft", "Sent", "Accepted"] : ["Draft", "Sent", "Paid"]).map((s) => ({ value: s, label: s }))} />
            </div>
          </section>
        </div>

        <div className="oo-handle" onMouseDown={startSplit} title="Drag to resize"><span /></div>

        <div style={{ minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column", background: "var(--sub)" }}>
          <div style={{ flex: "none", padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
            <Seg value={tab} onChange={setTab} options={[{ value: "doc", label: "Document" }, { value: "ec", label: "EasyClear lines" }]} />
            {tab === "ec" && (
              <button
                type="button"
                className="oo-btn primary sm"
                onClick={() => flash(live.map((l) => [l.code, ecDesc(l), l.vat ? "S" : "Z", l.type, l.zar.toFixed(2)].join("\t")).join("\n"), "all")}
              >
                {copied === "all" ? "Copied ✓" : "Copy all rows"}
              </button>
            )}
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 20 }}>
            {tab === "ec" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12, animation: "fadeIn .25s both" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>EasyClear invoice lines</span>
                  <span style={{ fontSize: 12, color: "var(--mute)" }}>Click a cell to copy it, then paste into EasyClear. Copying an amount ticks the line off. VAT S = 15%, Z = zero rated · Type D = disbursement, R = revenue.</span>
                </div>
                <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 16, overflow: "hidden" }}>
                  <div className="oo-ec" style={{ padding: "10px 12px", fontSize: 11, fontWeight: 500, color: "var(--mute)", background: "var(--sub)" }}>
                    <span /><span>Code</span><span>Description</span><span>VAT</span><span>Type</span><span className="r">Amount</span>
                  </div>
                  {live.map((l) => {
                    const desc = ecDesc(l);
                    const amt = l.zar.toFixed(2);
                    const done = !!entered[l.id];
                    return (
                      <div key={l.id} className="oo-ec" style={{ background: done ? "var(--sub)" : "transparent" }}>
                        <button type="button" className={`oo-vat ${done ? "on" : ""}`} style={{ width: 22, height: 22, borderRadius: 6 }} title="Entered in EasyClear" onClick={() => markEntered(l.id, !done)}>{done ? "✓" : ""}</button>
                        <button type="button" className={`oo-ec-cell mono ${copied === `${l.id}c` ? "copied" : ""}`} title="Copy code" onClick={() => flash(l.code, `${l.id}c`)}>{l.code}</button>
                        <button type="button" className={`oo-ec-cell oo-ellipsis ${copied === `${l.id}d` ? "copied" : ""}`} style={{ fontWeight: 500, textDecoration: done ? "line-through" : "none" }} title="Copy description" onClick={() => flash(desc, `${l.id}d`)}>{desc}</button>
                        <span className="mono c" style={{ fontSize: 12, color: "var(--ink2)" }}>{l.vat ? "S" : "Z"}</span>
                        <span className="mono c" style={{ fontSize: 12, color: "var(--ink2)" }}>{l.type}</span>
                        <button type="button" className={`oo-ec-cell mono r ${copied === `${l.id}a` ? "copied" : ""}`} style={{ fontWeight: 500 }} title="Copy amount" onClick={() => { flash(amt, `${l.id}a`); markEntered(l.id, true); }}>{amt}</button>
                      </div>
                    );
                  })}
                  <div style={{ display: "grid", gridTemplateColumns: "auto 120px", gap: "4px 16px", justifyContent: "end", padding: "12px 18px", fontSize: 12 }}>
                    <span className="muted">Excl. VAT</span><span className="mono r">{fmt(c.sub)}</span>
                    <span className="muted">VAT</span><span className="mono r">{fmt(c.vat)}</span>
                    <span style={{ fontWeight: 600 }}>Invoice total</span><span className="mono r" style={{ fontWeight: 600 }}>{fmt(c.total)}</span>
                  </div>
                </div>
                <span className="oo-sub" style={{ fontSize: 12 }}>{doneN} of {live.length} lines entered in EasyClear</span>
              </div>
            ) : (
              <div className="oo-paper">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-.01em", color: `oklch(0.42 0.13 ${ent.h})` }}>{ent.label}</span>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, textAlign: "right" }}>
                    <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: ".05em" }}>{isQ ? tpl.qTitle : tpl.pTitle}</span>
                    <span className="mono" style={{ color: "#6b7385" }}>{dc.no}</span>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: "10px 16px", paddingBottom: 14, borderBottom: "1.5px solid #1c2333" }}>
                  {party.map(([k, v]) => <div key={k} className="kv"><span className="k">{k}</span><span style={{ fontWeight: 600 }}>{v}</span></div>)}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: "10px 16px", padding: "12px 14px", borderRadius: 6, background: "#f3f5f9" }}>
                  {shipInfo.map(([k, v]) => <div key={k} className="kv"><span className="k">{k}</span><span style={{ fontWeight: 500 }}>{v}</span></div>)}
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <div className="lines" style={{ padding: "0 0 7px", borderBottom: "1.5px solid #1c2333", fontSize: 9, letterSpacing: ".06em", textTransform: "uppercase", color: "#6b7385" }}>
                    <span>Description</span><span>Cur</span><span className="r">Rate</span><span className="r">Units</span><span className="r">R.O.E.</span><span className="r">Total ZAR</span><span className="r">VAT</span>
                  </div>
                  {prevGroups.map((g) => (
                    <div key={g.g} style={{ display: "flex", flexDirection: "column" }}>
                      {g.rows.map((l) => (
                        <div key={l.id} className="lines mono" style={{ padding: "6px 0", borderBottom: "1px solid #e6e9f0" }}>
                          <span style={{ fontFamily: "Geist, sans-serif", fontWeight: 500, minWidth: 0, overflowWrap: "anywhere" }}>{l.desc}</span>
                          <span>{l.basis === "pct" ? "ZAR" : l.cur}</span>
                          <span className="r">{rateTxt(l)}</span>
                          <span className="r">{unitsTxt(l)}</span>
                          <span className="r">{l.cur === "ZAR" || l.basis === "pct" ? "1" : roeTxt(l.roeV)}</span>
                          <span className="r">{fmt(l.zar)}</span>
                          <span className="r" style={{ color: "#6b7385" }}>{l.vat ? fmt(l.vatAmt) : "—"}</span>
                        </div>
                      ))}
                      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 110px 62px", gap: 8, padding: "7px 0 12px", fontWeight: 700 }}>
                        <span style={{ letterSpacing: ".04em", textTransform: "uppercase", fontSize: 10, paddingTop: 1 }}>{g.label}</span>
                        <span className="mono r">{g.sub}</span>
                        <span className="mono r" style={{ color: "#6b7385", fontWeight: 500 }}>{g.vat}</span>
                      </div>
                    </div>
                  ))}
                  {!live.length && <div style={{ padding: "18px 0", color: "#9aa1b0", textAlign: "center", borderBottom: "1px solid #e6e9f0" }}>No charges yet</div>}
                  <div style={{ alignSelf: "flex-end", display: "grid", gridTemplateColumns: "auto 120px", gap: "5px 24px", paddingTop: 8, minWidth: 260 }}>
                    <span style={{ color: "#6b7385" }}>Total excluding VAT</span><span className="mono r">{money("ZAR", c.sub)}</span>
                    <span style={{ color: "#6b7385" }}>Total VAT</span><span className="mono r">{money("ZAR", c.vat)}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, paddingTop: 6, borderTop: "1.5px solid #1c2333" }}>Total including VAT</span>
                    <span className="mono r" style={{ fontSize: 13, fontWeight: 700, paddingTop: 6, borderTop: "1.5px solid #1c2333" }}>{money("ZAR", c.total)}</span>
                  </div>
                </div>
                {(dc.notes || "").trim() && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingTop: 12, borderTop: "1px solid #e6e9f0" }}>
                    <span className="k">Terms and conditions</span>
                    <span style={{ whiteSpace: "pre-wrap", fontSize: 10 }}>{dc.notes}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
