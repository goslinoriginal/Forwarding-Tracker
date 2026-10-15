import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
import { clientEmail, clientEmailLabel, composeEmail, roeDay, roeFor, shipmentLegs, useClients, useDocuments, useRefresh, useRoe, useShipments } from "@/lib/data";
import {
  DEF_OF, ENTITIES, GROUPS, INCO, Ln, PFI_TERMS, QUOTE_TERMS, SYM, TPL, calc, dotDecimal, ecDesc, equipmentText, fmt, money, num, parseOrder,
} from "@/lib/billingCalc";
import { offReason } from "@/lib/holidays";
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
    equipment: equipmentText(s.order_booking_file, s.cargo_type, s.fcl_count),
    bl: s.tracking_doc_number || "",
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

const QUOTE_CARRY = ["commodity", "pol", "via", "transit", "freq", "inco", "ref", "att", "prep"];

/** A pro forma for a file that had a quote. The pro forma is a freight statement, so it
 *  starts from the standard rate sheet — the quote is only linked, to be shown alongside.
 *  Descriptive details (commodity, POL…) come from the quote; the shipment's own details
 *  from the status report win. */
export function pfiFromQuote(quote, ship, client) {
  const base = Object.fromEntries(QUOTE_CARRY.filter((k) => quote[k]).map((k) => [k, quote[k]]));
  const fill = ship ? fromShipment(ship, client) : {};
  const tpl = fill.cargoTpl || (["fcl", "lcl", "eu"].includes(quote.tpl) ? quote.tpl : "fcl");
  delete fill.cargoTpl;
  const shipVals = Object.fromEntries(Object.entries(fill).filter(([, v]) => v !== "" && v !== false));
  return {
    ...base,
    clientId: quote.clientId,
    entity: quote.entity,
    ...shipVals,
    tpl,
    markup: String(TPL[tpl].markup),
    lines: TPL[tpl].lines(),
    file: ship?.file_number || quote.file || "",
    quoteId: quote.id,
    quoteNo: quote.no,
  };
}

export default function DocBuilder({ initial, onClose }) {
  const toast = useToast();
  const refresh = useRefresh();
  const { data: clients = [] } = useClients();
  const { data: ships = [] } = useShipments();
  const { data: rates = [] } = useRoe();
  const { data: allDocs = [] } = useDocuments();
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
      composeEmail({ to, cc: client.email_cc, subject: `${tl} ${d.no} – ${client.name}`, body: `Dear ${client.email_greeting || client.name},\n\nPlease find attached ${isQ ? "our quotation" : "the pro forma invoice"} ${d.no} (total ${money("ZAR", c.total)} incl. VAT).\n\nKind regards.` });
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
    const q = await save({ status: "Accepted" });
    const no = await nextDocNumber("pfi");
    const ship = dc.file ? ships.find((x) => x.client_id === dc.clientId && x.file_number === dc.file) : null;
    setDc((d) => ({
      ...pfiFromQuote({ ...d, id: q.id, no: q.no }, ship, client),
      id: null, type: "pfi", no, date: isoPlusDays(0), until: isoPlusDays(7), notes: PFI_TERMS, status: "Draft", entered: {},
      usdSob: "", usdToday: "", eurSob: "", eurToday: "", roeAuto: {},
    }));
    toast(`Quote ${q.no} accepted · pro forma ${no} started — the quote is shown alongside`);
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
  // Copy one quoted charge into the pro forma (same charge → update its rate, else add it)
  const applyQuoteLine = (ql) => {
    const key = (l) => (l.ec || l.desc || "").trim().toUpperCase();
    const match = dc.lines.find((l) => key(l) === key(ql));
    const pick = { cur: ql.cur, basis: ql.basis, rate: ql.rate, base: ql.base, vat: ql.vat, type: ql.type, of: ql.of };
    setD((d) => ({ lines: match ? d.lines.map((l) => (l.id === match.id ? { ...l, ...pick } : l)) : [...d.lines, Ln(ql.group, ql.code, ql.desc, ql.ec, ql.cur, ql.basis, ql.rate, { ...pick })] }));
    toast(match ? `${ql.desc}: rate from the quote` : `${ql.desc} added from the quote`);
  };
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
  // The pro forma is a freight statement: no email, payment due or terms on it
  const party = [[isQ ? "To" : "Client", client.name || "—"], ["Attention", dc.att], ["Date", dmy(dc.date)], isQ && ["Valid until", dmy(dc.until)], ["Ref no", dc.ref], ["File", dc.file], ["Prepared by", dc.prep], isQ && ["Email", clientEmailLabel(client)]].filter((p) => p && p[1]);
  const shipInfo = [["Containers", dc.equipment], ["Total weight", dc.kgs && `${dc.kgs} KGS`], ["Total volume", dc.cbm && `${dc.cbm} CBM`], ["B/L no.", dc.bl], ["Commodity", dc.commodity], ["ETD / POL", dc.pol], ["ETA / POD", dc.pod], ["Via", dc.via], ["Transit time", dc.transit], ["Vessel", dc.vessel], ["SOB date", dmy(dc.sob)], ["ETA", dmy(dc.eta)], ["Frequency", dc.freq], ["Terms", dc.inco]].filter((p) => p[1]);
  // ROE comparison: SOB date vs today, the higher one, then the markup (foreign amounts only)
  const markupPct = num(dc.markup);
  const roeCols = [["USD", dc.usdSob, dc.usdToday, c.roe.USD], ["EUR", dc.eurSob, dc.eurToday, c.roe.EUR]]
    .filter(([cur]) => live.some((l) => l.cur === cur && l.basis !== "pct"))
    .map(([cur, sob, today, used]) => ({ cur, sob: num(sob), today: num(today), high: Math.max(num(sob), num(today)), used }));
  // EasyClear wants these five, in this order
  const ecShip = [
    ["Vessel", (dc.vessel || "").split(" / ").pop().trim().toUpperCase()],
    ["B/L number", (dc.bl || "").toUpperCase()],
    ["Containers", (dc.equipment || "").toUpperCase()],
    ["Weight", dc.kgs ? `${dotDecimal(dc.kgs)} KGS` : ""],
    ["Volume", dc.cbm ? `${dotDecimal(dc.cbm)} CBM` : ""],
  ];
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
          {!isQ && dc.quoteNo && <QuoteRef quote={allDocs.find((x) => x.id === dc.quoteId)} no={dc.quoteNo} pfiTotal={c.total} onUse={applyQuoteLine} />}
          {isQ && dc.id && (() => {
            const used = allDocs.filter((x) => x.type === "pfi" && x.quoteId === dc.id);
            if (!used.length && !dc.file) return null;
            return (
              <div className="oo-note">
                <b>{dc.file ? `Linked to file ${dc.file}` : "Not linked to a file yet"}</b>
                <span>{used.length ? `Used for pro forma ${used.map((x) => x.no).join(", ")}` : "New pro formas for this file will offer to use this quote."}</span>
              </div>
            );
          })()}
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
              {isQ && <F label="Valid until"><input type="date" className="oo-input b" value={dc.until} onChange={on("until")} /></F>}
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
              <F label={isQ ? "Linked file # (once accepted)" : "Linked file #"}>
                <input
                  className="oo-input b mono"
                  list="oo-file-options"
                  value={dc.file || ""}
                  onChange={(e) => (isQ ? setD({ file: e.target.value.trim() }) : setFile(e.target.value.trim()))}
                  placeholder={isQ ? "Type when the client accepts" : "File number"}
                  data-testid="doc-file"
                />
                <datalist id="oo-file-options">
                  {shipsFor.filter((s) => s.file_number).map((s) => <option key={s.id} value={s.file_number}>{s.supplier || s.end_client || ""}</option>)}
                </datalist>
              </F>
              <F label="Commodity"><input className="oo-input b" value={dc.commodity} onChange={on("commodity")} placeholder="e.g. Pumps (non haz)" /></F>
              <F label="Containers"><input className="oo-input b" value={dc.equipment || ""} onChange={on("equipment")} placeholder="e.g. 2x20' FCLs / 1x40' HC LCL" /></F>
              <F label="B/L (master) number"><input className="oo-input b mono" value={dc.bl || ""} onChange={on("bl")} placeholder="e.g. ONEYNB6JIT441700" /></F>
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
              <span style={{ fontSize: 12, color: "var(--mute)" }}>The higher of SOB-date and today’s ROE is used, plus the markup — which only affects foreign-currency (USD/EUR) charges. Filled from the daily rates you capture.</span>
            </div>
            {[["SOB date", dc.sob, "usdSob", "eurSob"], ["Invoice date", dc.date, "usdToday", "eurToday"]].filter(([, iso]) => iso).map(([label, iso, uk, ek]) => {
              const day = roeDay(iso);
              const got = roeFor(rates, iso);
              const typed = (dc[uk] || dc[ek]) && !got;
              return (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12, color: "var(--ink2)" }}>
                  <span>
                    {label} {dmy(iso)}{day !== iso ? ` (${offReason(iso)} → ${dmy(day)})` : ""}:{" "}
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
            <h3>{isQ ? <>Terms &amp; status</> : "Status"}</h3>
            {isQ && <textarea className="oo-input b" rows={6} style={{ resize: "vertical" }} value={dc.notes} onChange={on("notes")} placeholder="Terms and conditions…" />}
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
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "var(--sub)", fontSize: 12, fontWeight: 500, color: "var(--mute)" }}>
                    <span>Shipment details — top to bottom</span>
                    <button type="button" className="oo-link" style={{ fontSize: 12 }} onClick={() => flash(ecShip.map((x) => x[1]).join("\n"), "ship")}>{copied === "ship" ? "Copied ✓" : "Copy all 5"}</button>
                  </div>
                  {ecShip.map(([k, v], i) => (
                    <div key={k} style={{ display: "grid", gridTemplateColumns: "110px minmax(0,1fr)", alignItems: "center", gap: 10, padding: "4px 14px", borderTop: "1px solid var(--line2)" }}>
                      <span style={{ fontSize: 12, color: "var(--mute)" }}>{k}</span>
                      {v ? (
                        <button type="button" className={`oo-ec-cell mono ${copied === `s${i}` ? "copied" : ""}`} style={{ fontWeight: 500 }} title={`Copy ${k.toLowerCase()}`} onClick={() => flash(v, `s${i}`)} data-testid={`ec-ship-${i}`}>{v}</button>
                      ) : <span style={{ fontSize: 12, color: "var(--amb-fg)", padding: "6px 0" }}>Not filled in</span>}
                    </div>
                  ))}
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
                {roeCols.length > 0 && (
                  <div className="oo-roe-cmp" style={{ gridTemplateColumns: `minmax(0,1fr) repeat(${roeCols.length}, 90px)` }} data-testid="roe-compare">
                    <span className="k" style={{ gridColumn: "1 / -1" }}>Rate of exchange</span>
                    <span />
                    {roeCols.map((r) => <span key={r.cur} className="r k">{r.cur}</span>)}
                    <span>SOB date{dc.sob ? ` (${dmy(roeDay(dc.sob))})` : ""}</span>
                    {roeCols.map((r) => <span key={r.cur} className={`mono r ${r.sob && r.sob >= r.today ? "hi" : ""}`}>{r.sob ? r.sob.toFixed(4) : "—"}</span>)}
                    <span>Today ({dmy(dc.date)})</span>
                    {roeCols.map((r) => <span key={r.cur} className={`mono r ${r.today && r.today > r.sob ? "hi" : ""}`}>{r.today ? r.today.toFixed(4) : "—"}</span>)}
                    <span>Higher of the two + {markupPct}%</span>
                    {roeCols.map((r) => <span key={r.cur} className="mono r" style={{ fontWeight: 700 }}>{r.used ? r.used.toFixed(4) : "—"}</span>)}
                    <span style={{ gridColumn: "1 / -1", fontSize: 9, color: "#6b7385" }}>The {markupPct}% applies to the rate of exchange only, so only to foreign-currency amounts.</span>
                  </div>
                )}
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
                {isQ && (dc.notes || "").trim() && (
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

/* The quote this file had — shown for reference while doing the pro forma. */
function QuoteRef({ quote, no, pfiTotal, onUse }) {
  const [open, setOpen] = useState(true);
  if (!quote) return <div className="oo-note" data-testid="based-on-quote"><b>Quote {no} for this file</b><span>The quote has been deleted.</span></div>;
  const qc = calc(quote);
  const rows = qc.lines.filter((l) => !l.off && (l.zar || num(l.rate)));
  const facts = [["Date", dmy(quote.date)], ["Status", quote.status], ["Route", [quote.pol, quote.pod].filter(Boolean).join(" → ")], ["Commodity", quote.commodity], ["CBM / KGS", [quote.cbm, quote.kgs].filter(Boolean).join(" / ")], ["Terms", quote.inco]].filter((f) => f[1]);
  return (
    <div className="oo-note" style={{ gap: 10 }} data-testid="based-on-quote">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <b>There was a quote for this file: {quote.no}</b>
        <button type="button" className="oo-link" style={{ fontSize: 12 }} onClick={() => setOpen(!open)}>{open ? "Hide" : "Show quote"}</button>
      </div>
      <span>Quoted {money("ZAR", qc.total)} · this pro forma {money("ZAR", pfiTotal)}. Check the quote — use any rate you need.</span>
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 12px", borderRadius: 10, background: "var(--panel)", color: "var(--ink)" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", fontSize: 12 }}>
            {facts.map(([k, v]) => <span key={k}><span style={{ color: "var(--mute)" }}>{k}</span> {v}</span>)}
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {rows.map((l) => (
              <div key={l.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto 40px", gap: 10, alignItems: "center", padding: "5px 0", borderTop: "1px solid var(--line2)", fontSize: 12 }}>
                <span className="oo-ellipsis">{l.desc}</span>
                <span className="mono" style={{ color: "var(--ink2)" }}>{l.basis === "pct" ? `${l.rate}%` : `${l.cur} ${fmt(num(l.rate))}${l.basis === "cbm" ? "/cbm" : l.basis === "cntr" ? "/cntr" : ""}`}</span>
                <span className="mono" style={{ minWidth: 86, textAlign: "right" }}>{money("ZAR", l.zar)}</span>
                <button type="button" className="oo-link" style={{ fontSize: 12, justifySelf: "end" }} title="Copy this rate into the pro forma" onClick={() => onUse(l)}>Use</button>
              </div>
            ))}
            {!rows.length && <span style={{ fontSize: 12, color: "var(--mute)" }}>No charges on the quote.</span>}
          </div>
        </div>
      )}
    </div>
  );
}
