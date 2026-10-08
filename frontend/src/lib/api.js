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
  { key: "sob_date", label: "SOB DATE/RCG" },
  { key: "pol", label: "POL (Port of Loading)" },
  { key: "final_destination", label: "Final Destination" },
  { key: "hbill_released", label: "H/bill Released by Supplier" },
  { key: "copy_docs_status", label: "Copy Docs Status" },
  { key: "expected_freight_rate", label: "Expected Freight Rate" },
];

export const COMPANIES = [
  { key: "Patuma", label: "Patuma Freight (PTY) LTD" },
  { key: "Clearfreight", label: "Clearfreight (PTY) LTD" },
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

export const CARRIER_TRACK_URL = {
  MSC: (n) => `https://www.msc.com/en/track-a-shipment?agencyPath=mscu&searchNumber=${encodeURIComponent(n)}`,
  Maersk: (n) => `https://www.maersk.com/tracking/${encodeURIComponent(n)}`,
  ONE: (n) => `https://ecomm.one-line.com/one-ecom/manage-shipment/cargo-tracking?trakNoParam=${encodeURIComponent(n)}`,
  COSCO: (n) => `https://elines.coscoshipping.com/ebusiness/cargoTracking?trackingType=BOOKING&number=${encodeURIComponent(n)}`,
  "Hapag Lloyd": (n) => `https://www.hapag-lloyd.com/en/online-business/track/track-by-container-solution.html?container=${encodeURIComponent(n)}`,
  PIL: () => "https://www.pilship.com/en/tracking",
  "CMA CGM": (n) => `https://www.cma-cgm.com/ebusiness/tracking/search?SearchBy=Container&Reference=${encodeURIComponent(n)}`,
  Vanguard: (n) => `https://www.track-trace.com/container?number=${encodeURIComponent(n)}`,
  Other: (n) => `https://www.track-trace.com/container?number=${encodeURIComponent(n)}`,
};

// Carriers whose master/booking number is entered with a SCAC-style prefix that
// should be stripped before copying to clipboard — the carrier's own tracking
// page doesn't want it re-typed.
const CARRIER_NUMBER_PREFIX = {
  Maersk: "MAEU",
  ONE: "ONEY",
  COSCO: "COSU",
};

// The number itself is the source of truth for its prefix — a SCAC code like
// MAEU/ONEY/COSU identifies the carrier regardless of what's selected in the
// Carrier dropdown, so stripping/routing never silently no-ops just because
// that field was left on a different value.
const PREFIX_TO_CARRIER = Object.fromEntries(
  Object.entries(CARRIER_NUMBER_PREFIX).map(([carrier, prefix]) => [prefix, carrier])
);

function detectCarrierFromNumber(docNumber) {
  const upper = (docNumber || "").trim().toUpperCase();
  for (const [prefix, carrier] of Object.entries(PREFIX_TO_CARRIER)) {
    if (upper.startsWith(prefix)) return carrier;
  }
  return null;
}

export function clipboardTrackingNumber(carrier, docNumber) {
  const n = (docNumber || "").trim();
  const effectiveCarrier = detectCarrierFromNumber(n) || carrier;
  const prefix = CARRIER_NUMBER_PREFIX[effectiveCarrier];
  if (prefix && n.toUpperCase().startsWith(prefix)) {
    return n.slice(prefix.length);
  }
  return n;
}

export function trackTraceUrl(docNumber) {
  if (!docNumber) return "https://www.track-trace.com/container";
  return `https://www.track-trace.com/container?number=${encodeURIComponent(docNumber.trim())}`;
}

export function carrierTrackUrl(carrier, docNumber) {
  const effectiveCarrier = detectCarrierFromNumber(docNumber) || carrier;
  const fn = CARRIER_TRACK_URL[effectiveCarrier] || CARRIER_TRACK_URL.Other;
  return fn(docNumber ? docNumber.trim() : "");
}
