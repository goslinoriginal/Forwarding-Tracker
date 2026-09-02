import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({ baseURL: API });

export const CARRIERS = ["MSC", "Maersk", "ONE", "COSCO", "Hapag Lloyd", "PIL", "CMA CGM", "Vanguard", "Other"];

export const CARRIER_STYLES = {
  MSC: "bg-yellow-500/15 text-yellow-300 border-yellow-500/40",
  Maersk: "bg-sky-500/15 text-sky-300 border-sky-500/40",
  ONE: "bg-pink-500/15 text-pink-300 border-pink-500/40",
  COSCO: "bg-blue-500/15 text-blue-300 border-blue-500/40",
  "Hapag Lloyd": "bg-orange-500/15 text-orange-300 border-orange-500/40",
  PIL: "bg-red-500/15 text-red-300 border-red-500/40",
  "CMA CGM": "bg-blue-600/20 text-blue-200 border-blue-500/40",
  Vanguard: "bg-purple-500/15 text-purple-300 border-purple-500/40",
  Other: "bg-slate-700/30 text-slate-300 border-slate-600/40",
};

export const STATUS_STYLES = {
  Booked: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  Shipped: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  Delayed: "bg-rose-500/10 text-rose-300 border-rose-500/30",
};

export const OPTIONAL_COLUMNS = [
  { key: "sob_date", label: "SOB Date / RCG" },
  { key: "pol", label: "POL (Port of Loading)" },
  { key: "final_destination", label: "Final Destination" },
  { key: "hbill_released", label: "H/bill Released by Supplier" },
  { key: "expected_freight_rate", label: "Expected Freight Rate" },
];

export const QUICK_COMMENTS = [
  "Planned ETD ",
  "Vessel delayed slightly. Now planned ETD ",
  "Vessel changed by S/Line. Now planned ETD ",
  "Awaiting confirmation of departure.",
  "Shipped on board ",
  "H/bill released by supplier.",
  "H/bill NOT released by supplier.",
  "ANF received. Docs to Ops.",
];

export function trackTraceUrl(docNumber) {
  if (!docNumber) return "https://www.track-trace.com/container";
  return `https://www.track-trace.com/container?number=${encodeURIComponent(docNumber.trim())}`;
}
