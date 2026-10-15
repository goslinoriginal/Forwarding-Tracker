// Quote / pro forma calculations, rate-sheet templates and EasyClear formatting.
// Ported from the Ocean Ops prototype; the source rate sheets are
// Pro-Forma-O-freight.xlsx and CLE Import Seafreight Estimate 2025.xlsx.
import { isoPlusDays } from "@/lib/ui";

export const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
export const fmt = (n) => (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const SYM = { ZAR: "R", USD: "US$", EUR: "EU" };
export const money = (cur, n) => `${SYM[cur] || ""} ${fmt(n)}`;
export const num = (v) => parseFloat(String(v == null ? "" : v).replace(/\s/g, "").replace(",", ".").replace(/[^\d.-]/g, "")) || 0;

export const INCO = ["EXW", "FCA", "FOB", "CFR", "CIF", "DAP", "DDP"];
export const GROUPS = [["freight", "Freight charges"], ["customs", "Customs duties & VAT"], ["local", "Port & local charges"], ["fees", "Agency & service fees"]];
export const DEF_OF = { freight: ["freight"], customs: ["freight"], local: ["freight"], fees: ["freight", "customs", "local"] };
export const ENTITIES = [
  { key: "Patuma", label: "Patuma Freight (PTY) LTD", h: 240 },
  { key: "Clearfreight", label: "Clearfreight (PTY) LTD", h: 200 },
];

let LN = 0;
export const Ln = (group, code, desc, ec, cur, basis, rate, o) => ({
  id: `l${++LN}${Math.random().toString(36).slice(2, 6)}`,
  group, code, desc, ec, cur, basis, rate: String(rate), base: "", vat: false, type: "D",
  of: basis === "pct" ? DEF_OF[group] : null,
  ...(o || {}),
});

export const PFI_TERMS = "Payment required before release of cargo.\nAmounts in foreign currency converted at the ROE shown; final amount payable is determined by the ROE ruling at the time of payment. E & OE.";
export const QUOTE_TERMS = "ESTIMATE VALID FOR 30 DAYS ONLY.\nR20 000.00 PROVIDED FOR DEPOT HANDLING AND STORAGE DUE TO CUSTOMS STOP ETC.\nESTIMATE EXCLUDES ANY CHARGES THAT MAY OCCUR DUE TO CUSTOMS STOPS ETC.\nPAYMENT TERMS ARE BASED ON 30 DAYS FROM MONTHLY STATEMENT.\nESTIMATE UP TO DELIVERY POINT, IMPORTER TO ARRANGE OWN LABOUR FOR UNPACK.\nTRANSPORTER ONLY ALLOWS 3 HOURS, THEREAFTER IMPORTER TO PAY STANDING TIME.\nESTIMATE EXCLUDES ANY MARINE INSURANCE.\nThis estimate is based on current rates and on information supplied by the carriers and authorities concerned, and is subject to change without notice. E & OE.";

export const TPL = {
  fcl: { label: "FCL pro forma", pTitle: "PRO-FORMA FREIGHT STATEMENT", qTitle: "SEAFREIGHT QUOTATION – FCL", markup: 4, lines: () => [
    Ln("freight", "30050", "Ocean freight", "O/FREIGHT", "USD", "cntr", 0),
    Ln("freight", "30050", "BAF", "BAF", "USD", "cntr", 0),
    Ln("freight", "30050", "Low sulphur", "LSS", "USD", "flat", 0),
    Ln("freight", "30050", "ALH fee", "ALH FEE", "USD", "flat", 35),
    Ln("freight", "30050", "Origin landsides", "ORIGIN LANDSIDES", "USD", "flat", 0),
    Ln("freight", "30050", "B/Lading fee", "B/LADING FEE", "USD", "flat", 40),
    Ln("local", "30050", "Collect fee", "COLLECT FEE", "ZAR", "pct", 5),
    Ln("local", "30070", "RCG fee", "RCG FEES", "ZAR", "flat", 350),
    Ln("local", "30050", "Release fee", "RELEASE FEE", "ZAR", "flat", 490)] },
  lcl: { label: "LCL pro forma", pTitle: "PRO-FORMA FREIGHT STATEMENT", qTitle: "SEAFREIGHT QUOTATION – LCL", markup: 4, lines: () => [
    Ln("freight", "30050", "Ocean freight", "O/FREIGHT", "USD", "cbm", 0),
    Ln("freight", "30050", "BAF", "BAF", "USD", "cbm", 0),
    Ln("freight", "30050", "Low sulphur", "LSS", "USD", "cbm", 0),
    Ln("freight", "30050", "ALH fee", "ALH FEE", "USD", "flat", 45),
    Ln("freight", "30050", "B/Lading fee", "B/LADING FEE", "USD", "flat", 40),
    Ln("freight", "30050", "Origin landsides", "ORIGIN LANDSIDES", "USD", "flat", 0),
    Ln("local", "30050", "Collect fee", "COLLECT FEE", "ZAR", "pct", 5),
    Ln("local", "30050", "Cargo dues", "CARGO DUES", "ZAR", "cbm", 130),
    Ln("local", "30050", "Unpack", "UNPACK", "ZAR", "cbm", 590),
    Ln("local", "30050", "Transfer to JHB", "TRANSFER TO JHB", "ZAR", "cbm", 610, { jhb: true }),
    Ln("local", "30050", "Depot handling", "DEPOT HANDLING", "ZAR", "depot", 80, { base: "100" }),
    Ln("local", "30070", "RCG fee", "RCG FEES", "ZAR", "flat", 350),
    Ln("local", "30050", "Release fee", "RELEASE FEE", "ZAR", "flat", 490)] },
  eu: { label: "FCL Europe pro forma (USD + EUR)", pTitle: "PRO-FORMA FREIGHT STATEMENT", qTitle: "SEAFREIGHT QUOTATION – FCL", markup: 0, lines: () => [
    Ln("freight", "30050", "Emergency fuel surcharge", "EMERGENCY FUEL SURCHARGE", "USD", "cntr", 0),
    Ln("freight", "30050", "Sea freight to SA port", "O/FREIGHT", "USD", "cntr", 0),
    Ln("freight", "30050", "Peak season surcharge", "PEAK SEASON SURCHARGE", "USD", "cntr", 0),
    Ln("freight", "30050", "ISPS port security fee", "ISPS", "USD", "cntr", 15),
    Ln("freight", "30050", "ALH fee", "ALH FEE", "USD", "flat", 35),
    Ln("freight", "30050", "Customs handling (origin)", "CUSTOMS HANDLING", "EUR", "flat", 77.5),
    Ln("freight", "30050", "B/Lading fee", "B/LADING FEE", "EUR", "flat", 55),
    Ln("freight", "30050", "Emissions trading", "EMISSIONS TRADING", "EUR", "cntr", 70),
    Ln("freight", "30050", "Transport to FOB", "TRANSPORT TO FOB", "EUR", "cntr", 0),
    Ln("local", "30050", "Collect fee", "COLLECT FEE", "ZAR", "pct", 1.75),
    Ln("local", "30070", "RCG fee", "RCG FEES", "ZAR", "flat", 350),
    Ln("local", "30050", "Release fee", "RELEASE FEE", "ZAR", "flat", 100)] },
  imp: { label: "Import estimate (door to door)", pTitle: "PRO-FORMA FREIGHT STATEMENT", qTitle: "SEAFREIGHT IMPORT ESTIMATE", markup: 0, lines: () => [
    Ln("freight", "30050", "Ocean freight", "O/FREIGHT", "USD", "cbm", 0),
    Ln("freight", "30050", "BAF", "BAF", "USD", "cbm", 0),
    Ln("freight", "30050", "Bill of lading fee", "B/LADING FEE", "USD", "flat", 40),
    Ln("freight", "30050", "ALH fee", "ALH FEE", "USD", "flat", 45),
    Ln("freight", "30050", "RCG fee", "RCG FEES", "ZAR", "flat", 350),
    Ln("freight", "30050", "Origin landsides", "ORIGIN LANDSIDES", "EUR", "flat", 0),
    Ln("freight", "30050", "CAF", "CAF", "ZAR", "pct", 4),
    Ln("freight", "30050", "Collect fee", "COLLECT FEE", "ZAR", "pct", 5),
    Ln("customs", "30009", "Customs duty", "CUSTOMS DUTY", "ZAR", "flat", 0),
    Ln("customs", "30009", "Sch 1 Part 2B", "SCH 1 PART 2B", "ZAR", "flat", 0),
    Ln("customs", "30010", "VAT as per bill of entry", "VAT AS PER BILL OF ENTRY", "ZAR", "flat", 0),
    Ln("local", "30022", "Cargo dues", "CARGO DUES", "ZAR", "cbm", 130, { vat: true }),
    Ln("local", "30022", "Unpack charges", "UNPACK CHARGES", "ZAR", "cbm", 590, { vat: true }),
    Ln("local", "30022", "Depot handling", "DEPOT HANDLING", "ZAR", "flat", 684, { vat: true }),
    Ln("local", "30022", "Cartage", "CARTAGE", "ZAR", "cbm", 350, { vat: true }),
    Ln("local", "30022", "Fuel surcharge", "FUEL SURCHARGE", "ZAR", "flat", 0, { vat: true }),
    Ln("local", "30022", "EDI fee", "EDI FEE", "ZAR", "flat", 285, { vat: true }),
    Ln("local", "30022", "SARS query admin", "SARS QUERY ADMIN", "ZAR", "flat", 450, { vat: true }),
    Ln("local", "30022", "Transfer to JHB", "TRANSFER TO JHB", "ZAR", "cbm", 610, { vat: true, jhb: true }),
    Ln("fees", "10011", "Agency fee", "AGENCY FEE", "ZAR", "pct", 1.5, { vat: true, type: "R", min: 550, incVat: true }),
    Ln("fees", "10011", "Customs documentation", "CUSTOMS DOCUMENTATION", "ZAR", "flat", 570, { vat: true, type: "R" }),
    Ln("fees", "10014", "Communication fees", "COMMUNICATION FEES", "ZAR", "flat", 170, { vat: true, type: "R" })] },
};

/** Works out every line in ZAR plus the totals. */
export function calc(d) {
  const m = num(d.markup) / 100;
  const roeOf = (a, b) => { const v = Math.max(num(a), num(b)); return v ? Math.round(v * (1 + m) * 10000) / 10000 : 0; };
  const roe = { ZAR: 1, USD: roeOf(d.usdSob, d.usdToday), EUR: roeOf(d.eurSob, d.eurToday) };
  const cbm = Math.max(num(d.cbm), num(d.kgs) / 1000);
  const cn = num(d.cntrs) || 1;
  const out = [];
  (d.lines || []).forEach((l) => {
    const rate = num(l.rate);
    if (l.jhb && !d.jhb) { out.push({ ...l, off: true, units: 0, fc: 0, zar: 0, vatAmt: 0, roeV: 1, pctBase: 0 }); return; }
    let units = 1;
    let fc = 0;
    let zar = 0;
    let pctBase = 0;
    if (l.basis === "pct") {
      pctBase = out.filter((o) => !o.off && (l.of || DEF_OF[l.group]).includes(o.group)).reduce((a, o) => a + o.zar + (l.incVat ? o.vatAmt : 0), 0);
      zar = r2((pctBase * rate) / 100);
      if (l.min && zar < num(l.min)) zar = num(l.min);
      fc = zar;
    } else {
      units = l.basis === "cntr" ? cn : l.basis === "cbm" ? cbm : 1;
      fc = l.basis === "depot" ? r2(num(l.base) + rate * cbm) : r2(rate * units);
      zar = l.cur === "ZAR" ? fc : r2(fc * (roe[l.cur] || 0));
    }
    out.push({ ...l, units, fc, zar, vatAmt: l.vat ? r2(zar * 0.15) : 0, roeV: l.basis === "pct" ? 1 : roe[l.cur] || 0, pctBase });
  });
  const sub = r2(out.reduce((a, o) => a + o.zar, 0));
  const vat = r2(out.reduce((a, o) => a + o.vatAmt, 0));
  return { roe, cbm, cn, lines: out, sub, vat, total: r2(sub + vat) };
}

/** EasyClear description: upper-case label plus the foreign amount for FX lines. */
export const ecDesc = (l) =>
  (l.ec || l.desc || "").toUpperCase() + (l.basis !== "pct" && l.cur !== "ZAR" && l.fc ? ` (${l.cur === "USD" ? "US$" : "EU"}${l.fc.toFixed(2)})` : "");

const UNIT_NAMES = [
  [/^(ctns?|cartons?)$/i, "Cartons"], [/^(pkgs?|packages?)$/i, "Packages"], [/^(plts?|pallets?)$/i, "Pallets"],
  [/^(pcs|pieces?)$/i, "Pieces"], [/^cases?$/i, "Cases"], [/^drums?$/i, "Drums"], [/^rolls?$/i, "Rolls"],
  [/^sets?$/i, "Sets"], [/^crates?$/i, "Crates"], [/^bags?$/i, "Bags"], [/^boxe?s?$/i, "Boxes"],
];
const UNIT_RE = /(\d+)\s*(ctns?|cartons?|pkgs?|packages?|plts?|pallets?|pcs|pieces?|cases?|drums?|rolls?|sets?|crates?|bags?|boxe?s?)\b/i;

/** Reads the status report's order text, e.g. "SEHA12225, 11 PKGS, 4978 KGS, 12 CBM" or
 *  "2x20' FCL's, 160 Drums, 42060 Kgs, 60 Cbm ORDER NO 153615". Decimal commas are kept as typed. */
export function parseOrder(text) {
  const t = String(text || "");
  const out = {};
  const boxes = [...t.matchAll(/(\d+)\s*x\s*(20|40|45)\s*'?\s*(HC|HQ|OT|FR|RF)?/gi)];
  const cn = boxes.reduce((a, m) => a + Number(m[1]), 0);
  if (cn) out.cntrs = String(cn);
  out.boxes = boxes.map((m) => `${m[1]}x${m[2]}'${m[3] ? ` ${m[3].toUpperCase()}` : ""}`).join(" + ");
  const kg = t.match(/(\d[\d.,]*)\s*kgs?\b/i);
  if (kg) out.kgs = kg[1];
  const cbm = t.match(/(\d[\d.,]*)\s*cbm\b/i);
  if (cbm) out.cbm = cbm[1];
  const u = t.replace(/\d+\s*x\s*(?:20|40|45)\s*'/gi, "").match(UNIT_RE);
  if (u) {
    out.units = u[1];
    out.unitType = (UNIT_NAMES.find(([re]) => re.test(u[2])) || [null, u[2]])[1];
  }
  const model = t.match(/model:\s*(.+)/i);
  if (model) out.commodity = model[1].trim();
  const order = t.match(/(?:order\s*no\.?|o\/no\.?(?:'?s)?:?|inv\.?\s*no\.?)\s*:?\s*([^,\n]+)/i);
  if (order) out.ref = order[1].trim();
  else {
    // Leading references such as "ZN26170, ZN26184, ZN26195, 2x20' FCLs"
    const refs = [];
    for (const raw of t.split(/[,\n]/)) {
      const p = raw.trim().replace(/\s+\d+\s*x\s*(?:20|40|45)\s*'.*$/i, "");
      if (!/^[A-Z]/i.test(p) || !/\d/.test(p) || /kgs?\b|cbm\b|\bfcl|\blcl|model:/i.test(p) || UNIT_RE.test(p)) break;
      refs.push(p);
    }
    if (refs.length) out.ref = refs.join(", ");
  }
  return out;
}

/** "2x20' FCLs", "1x40' HC LCL", "LCL" — the containers and whether it's FCL or LCL. */
export function equipmentText(orderText, cargoType, fclCount) {
  const { boxes, cntrs } = parseOrder(orderText);
  const lcl = String(cargoType || "").toUpperCase() === "LCL" || /\bLCL\b/i.test(orderText || "");
  if (lcl) return boxes ? `${boxes} LCL` : "LCL";
  const n = Number(cntrs || fclCount) || 0;
  if (boxes) return `${boxes} FCL${n > 1 ? "s" : ""}`;
  return n ? `${n}x FCL${n > 1 ? "s" : ""}` : "FCL";
}

/** "1571,34" → "1571.34" for EasyClear. */
export const dotDecimal = (v) => String(v || "").trim().replace(/\s/g, "").replace(",", ".");

export function makeDoc(tpl, type, o) {
  return {
    id: null, type, tpl, no: "", clientId: "", entity: "Clearfreight",
    date: isoPlusDays(0), until: isoPlusDays(type === "quote" ? 30 : 7),
    file: "", ref: "", att: "", prep: "", commodity: "", units: "", unitType: "", equipment: "", bl: "", cbm: "", kgs: "",
    pol: "", pod: "Durban", via: "", transit: "", vessel: "", freq: "", inco: "FOB", cntrs: "1", jhb: false,
    usdSob: "", usdToday: "", eurSob: "", eurToday: "", markup: String(TPL[tpl].markup),
    lines: TPL[tpl].lines(), notes: type === "quote" ? QUOTE_TERMS : PFI_TERMS, status: "Draft", entered: {},
    ...(o || {}),
  };
}
