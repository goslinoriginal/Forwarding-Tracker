import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({ baseURL: API });

export const CARRIERS = ["MSC", "Maersk", "ONE", "COSCO", "Hapag Lloyd", "PIL", "CMA CGM", "Vanguard", "Other"];

export const OPTIONAL_COLUMNS = [
  { key: "sob_date", label: "SOB date / RCG" },
  { key: "pol", label: "Port of loading" },
  { key: "final_destination", label: "Final destination" },
  { key: "hbill_released", label: "H/bill released by supplier" },
  { key: "copy_docs_status", label: "Copy docs status" },
  { key: "expected_freight_rate", label: "Expected freight rate" },
];

export const COMPANIES = [
  { key: "Patuma", label: "Patuma Freight (PTY) LTD" },
  { key: "Clearfreight", label: "Clearfreight (PTY) LTD" },
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

// Ocean bill of lading numbers are entered with the carrier's SCAC prefix, but the
// carrier's own tracking page wants the number without it. The patterns only match
// the B/L format, so container numbers that share the prefix (e.g. MAEU + 7 digits,
// a Maersk container) are left untouched.
const OBL_PREFIX = [
  { carrier: "Maersk", prefix: "MAEU", pattern: /^MAEU\d{9}$/ },
  { carrier: "ONE", prefix: "ONEY", pattern: /^ONEY[A-Z0-9]{8,}$/ },
  { carrier: "COSCO", prefix: "COSU", pattern: /^COSU\d{8,}$/ },
];

const oblMatch = (docNumber) => {
  const n = (docNumber || "").trim().toUpperCase();
  return OBL_PREFIX.find((o) => o.pattern.test(n)) || null;
};

/** The number as the carrier wants it typed: SCAC prefix removed from ocean B/L numbers. */
export function clipboardTrackingNumber(carrier, docNumber) {
  const n = (docNumber || "").trim();
  const m = oblMatch(n);
  return m ? n.slice(m.prefix.length) : n;
}

export function trackTraceUrl(docNumber) {
  if (!docNumber) return "https://www.track-trace.com/container";
  return `https://www.track-trace.com/container?number=${encodeURIComponent(docNumber.trim())}`;
}

/** The carrier's tracking page for this number. A recognised B/L prefix decides the
 *  carrier even if the Carrier field was left on something else. */
export function carrierTrackUrl(carrier, docNumber) {
  const m = oblMatch(docNumber);
  const fn = CARRIER_TRACK_URL[m ? m.carrier : carrier] || CARRIER_TRACK_URL.Other;
  return fn(clipboardTrackingNumber(carrier, docNumber));
}
