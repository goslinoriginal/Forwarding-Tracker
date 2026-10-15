// Invoicing totals from the saved pro formas (drafts included).
import { calc, r2 } from "@/lib/billingCalc";

const pad = (n) => String(n).padStart(2, "0");
export const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthLabel = (key, withYear) => {
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS[m - 1]}${withYear ? ` ${y}` : ""}`;
};

export const PERIODS = [
  { value: "month", label: "This month" },
  { value: "last", label: "Last month" },
  { value: "year", label: "This year" },
  { value: "all", label: "All time" },
];

export function inPeriod(iso, period, now = new Date()) {
  if (!iso) return period === "all";
  const key = iso.slice(0, 7);
  if (period === "month") return key === monthKey(now);
  if (period === "last") return key === monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  if (period === "year") return iso.slice(0, 4) === String(now.getFullYear());
  return true;
}

/** One pro forma's figures: total incl. VAT, excl. VAT, VAT and revenue (our own fees, type R). */
export function docFigures(d) {
  const c = calc(d);
  const revenue = r2(c.lines.filter((l) => !l.off && l.type === "R").reduce((a, l) => a + l.zar, 0));
  return { total: c.total, sub: c.sub, vat: c.vat, revenue };
}

const blank = () => ({ n: 0, total: 0, sub: 0, revenue: 0, Draft: 0, Sent: 0, Paid: 0, nDraft: 0, nSent: 0, nPaid: 0, last: "" });
function add(t, d, f) {
  const st = ["Draft", "Sent", "Paid"].includes(d.status) ? d.status : "Draft";
  t.n += 1;
  t.total = r2(t.total + f.total);
  t.sub = r2(t.sub + f.sub);
  t.revenue = r2(t.revenue + f.revenue);
  t[st] = r2(t[st] + f.total);
  t[`n${st}`] += 1;
  if ((d.date || "") > t.last) t.last = d.date || "";
}

/** Totals for a period, per client and per entity, from the saved pro formas. */
export function invoiceStats(docs, { period = "month", entity = "", now = new Date() } = {}) {
  const pf = (docs || []).filter((d) => d.type === "pfi" && (!entity || d.entity === entity));
  const all = blank();
  const byClient = {};
  const byEntity = {};
  pf.filter((d) => inPeriod(d.date, period, now)).forEach((d) => {
    const f = docFigures(d);
    add(all, d, f);
    add((byClient[d.clientId || ""] ||= blank()), d, f);
    add((byEntity[d.entity || "—"] ||= blank()), d, f);
  });
  return { all, byClient, byEntity };
}

/** Pro forma totals for the last `n` months, oldest first. */
export function monthlyTotals(docs, { n = 12, entity = "", clientId = "", now = new Date() } = {}) {
  const keys = Array.from({ length: n }, (_, i) => monthKey(new Date(now.getFullYear(), now.getMonth() - (n - 1 - i), 1)));
  const sums = Object.fromEntries(keys.map((k) => [k, blank()]));
  (docs || [])
    .filter((d) => d.type === "pfi" && (!entity || d.entity === entity) && (!clientId || d.clientId === clientId))
    .forEach((d) => { const k = (d.date || "").slice(0, 7); if (sums[k]) add(sums[k], d, docFigures(d)); });
  return keys.map((k) => ({ key: k, ...sums[k] }));
}
