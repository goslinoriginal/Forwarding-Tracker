import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, API } from "@/lib/api";
import { nextWorkday } from "@/lib/holidays";
import { copyText, dm, todayIso } from "@/lib/ui";

/* ---------- Queries ---------- */
export const useClients = () =>
  useQuery({ queryKey: ["clients"], queryFn: async () => (await api.get("/clients")).data });

export const useShipments = () =>
  useQuery({ queryKey: ["shipments"], queryFn: async () => (await api.get("/shipments")).data });

export const useReminders = () =>
  useQuery({ queryKey: ["reminders"], queryFn: async () => (await api.get("/dashboard/reminders")).data.reminders });

export const useReportLog = () =>
  useQuery({ queryKey: ["report-log", todayIso()], queryFn: async () => (await api.get("/report-log", { params: { date: todayIso() } })).data });

export const useRoe = () =>
  useQuery({ queryKey: ["roe"], queryFn: async () => (await api.get("/roe")).data.rates });

/** A weekend or public holiday uses the next working day's ROE. */
export const roeDay = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || "") ? nextWorkday(iso) : "");

/** The captured rates that apply to a date: { date, usd, eur } or null. */
export const roeFor = (rates, iso) => (rates || []).find((r) => r.date === roeDay(iso)) || null;

export const useSettings = () =>
  useQuery({ queryKey: ["settings"], queryFn: async () => (await api.get("/settings")).data });

export const useDocuments = () =>
  useQuery({ queryKey: ["documents"], queryFn: async () => (await api.get("/documents")).data });

export const useCreditNotes = () =>
  useQuery({ queryKey: ["credit-notes"], queryFn: async () => (await api.get("/credit-notes")).data });
export const useCreditLists = () =>
  useQuery({ queryKey: ["credit-lists"], queryFn: async () => (await api.get("/credit-lists")).data });

async function saveDownload(path, name) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error("Download failed");
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
/** One PRO-FORMA CREDIT NOTE (two copies, two pages), dated today — PDF to print, or Excel. */
export const downloadCreditNote = (n, fmt = "pdf") => saveDownload(`/credit-notes/${n.id}/${fmt}?date=${todayIso()}`, `Pro-forma Credit Note ${n.file}.${fmt}`);
/** A printed CREDIT NOTE REQUEST list — PDF to print, or Excel. */
export const downloadCreditList = (l, fmt = "pdf") => saveDownload(`/credit-lists/${l.id}/${fmt}`, `Credit Note Request - Forwarding ${l.date} (${l.no}).${fmt}`);

export const useVessels = () =>
  useQuery({ queryKey: ["vessels"], queryFn: async () => (await api.get("/vessels")).data.vessels || [] });

/** Refetch whatever a change could have touched. */
export function useRefresh() {
  const qc = useQueryClient();
  return (...keys) => Promise.all((keys.length ? keys : ["clients", "shipments", "reminders", "report-log"]).map((k) => qc.invalidateQueries({ queryKey: [k] })));
}

/* ---------- Shipment helpers ---------- */

/** Every vessel leg in order: 1st (vessel_name), 2nd, then extra_vessels. */
export function shipmentLegs(s) {
  const legs = [{ num: 1, name: s.vessel_name || "", etd: s.planned_etd || "", sob: s.sob_date || "", state: s.first_vessel_state }];
  if ((s.second_vessel_name || "").trim() || s.second_vessel_etd || s.second_vessel_sob_date) {
    legs.push({ num: 2, name: s.second_vessel_name || "", etd: s.second_vessel_etd || "", sob: s.second_vessel_sob_date || "", state: s.second_vessel_state });
  }
  (s.extra_vessels || []).forEach((ev, i) => legs.push({ num: 3 + i, name: ev.name || "", etd: ev.planned_etd || "", sob: ev.sob_date || "", state: ev.state }));
  return legs;
}

/** The backend only stores Planned / Booked / Shipped. A shipment counts as Delayed
 *  while it hasn't sailed and the shipping line has pushed out a vessel's ETD. */
export function displayStatus(s) {
  if (s.anf_received) return "ANF";
  if (s.status !== "Shipped" && shipmentLegs(s).some((l) => !l.sob && l.state === "delayed")) return "Delayed";
  return s.status || "Planned";
}

/** "Received" wording: FCL closes on the ANF, LCL on the SOB's. */
export const receivedLabel = (cargo) => ((cargo || "").toUpperCase() === "LCL" ? "SOB's received" : "ANF received");
export const statusLabel = (st, cargo) => (st === "ANF" ? receivedLabel(cargo) : st);

/** ETD shown in tables: last leg's ETD for transhipments, TBA when flagged. */
export function etdText(s) {
  if (s.etd_tba && !s.sob_date) return "TBA";
  const legs = shipmentLegs(s);
  const last = legs[legs.length - 1];
  return dm((legs.length > 1 && last.etd) || s.planned_etd) || "—";
}

export const etaText = (s) => dm(s.eta || s.planned_eta) || "—";

/* ---------- Report downloads ---------- */
/** Downloads a status report. `old` gives the original operational layout; `endClient`
 *  gives one end client's share of a group report (e.g. "Country Mushrooms"). */
export async function downloadReport(client, fmt, { old = false, endClient = "" } = {}) {
  const qs = endClient ? `?end_client=${encodeURIComponent(endClient)}` : "";
  const res = await fetch(`${API}/reports/${client.id}/${fmt}${old ? "" : "-modern"}${qs}`);
  if (!res.ok) throw new Error("Export failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const name = (endClient || client.name || "client").replace(/[^A-Za-z0-9._-]+/g, "_");
  a.download = `${old ? "shipping-report" : "status-report"}-${name}-${todayIso()}.${fmt}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const isGroupClient = (c) => !!c && c.report_layout && c.report_layout !== "standard";

export async function fetchEndClients(clientId) {
  const res = await fetch(`${API}/reports/${clientId}/end-clients`);
  return res.ok ? (await res.json()).end_clients : [];
}

/* Where "Send" opens the new email. Saved per computer.
   mailto – the computer's default mail app: Outlook (classic), once it's the mailto default in Windows (default)
   owa    – a new email in Outlook on the web */
const MAIL_KEY = "oceanops.mailApp";
export const getMailApp = () => { try { return localStorage.getItem(MAIL_KEY) || "mailto"; } catch { return "mailto"; } };
export const setMailApp = (v) => { try { localStorage.setItem(MAIL_KEY, v); } catch {} };

/** Every address in text pasted from Outlook: "Name <a@b.com>; 'c@d.com', e@f.com" → [{ name, email }]. */
export function parseRecipients(text) {
  const out = [];
  const seen = new Set();
  const re = /(?:([^;,<>\n]*?)\s*<\s*([^<>\s;,]+@[^<>\s;,]+)\s*>)|([^\s;,<>"']+@[^\s;,<>"']+)/g;
  let m;
  while ((m = re.exec(String(text || "")))) {
    const email = (m[2] || m[3]).replace(/^['"]+|['".]+$/g, "");
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: (m[1] || "").replace(/^['"\s]+|['"\s]+$/g, ""), email });
  }
  return out;
}
const mergeRecipients = (...lists) => parseRecipients(lists.filter(Boolean).join(";"));

/** Opens a ready-to-send email with To, CC and subject filled in.
 *  Outlook desktop leaves out your signature when an app fills in the message, so there
 *  the message is copied to the clipboard instead — paste it above the signature (Ctrl+V). */
export async function composeEmail({ to, cc, subject, body }) {
  const toL = parseRecipients(to).map((r) => r.email);
  const ccL = parseRecipients(cc).filter((r) => !toL.includes(r.email)).map((r) => r.email);
  if (getMailApp() === "owa") {
    const q = [["to", toL.join(";")], ["cc", ccL.join(";")], ["subject", subject], ["body", body]]
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("&");
    window.open(`https://outlook.office.com/mail/deeplink/compose?${q}`, "_blank", "noopener");
    return { ok: true };
  }
  if (body) await copyText(body);
  const params = [["cc", ccL.join(";")], ["subject", subject]].filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
  window.location.href = `mailto:${toL.join(";")}?${params.join("&")}`;
  return { ok: true, pasted: !!body };
}

/** Fills {name} and {client} in a subject or message template. */
export const fillTemplate = (tpl, client) =>
  String(tpl || "").replace(/\{name\}/gi, (client.email_greeting || client.name || "").trim()).replace(/\{client\}/gi, client.name || "");

/** The status-report email for a client: their own addresses plus the defaults from Settings. */
export function reportEmail(client, settings) {
  const s = settings || {};
  return {
    to: mergeRecipients(client.email_to || client.contact_email, s.email_default_to),
    cc: mergeRecipients(client.email_cc, s.email_default_cc),
    subject: fillTemplate((client.email_subject || "").trim() || s.email_default_subject || "Status Report - {client}", client),
    body: fillTemplate((client.email_body || "").trim() || s.email_default_body || "Dear {name},\n\nPlease see attached Status Report for your pending shipments.\n\nThanks.", client),
  };
}

export function openReportEmail(client, settings) {
  if (!parseRecipients(client.email_to || client.contact_email).length) return false;
  const e = reportEmail(client, settings);
  const fmt = (list) => list.map((r) => (r.name ? `${r.name} <${r.email}>` : r.email)).join("; ");
  return composeEmail({ to: fmt(e.to), cc: fmt(e.cc), subject: e.subject, body: e.body });
}

/* ---------- Clients ---------- */

/** Pinned clients first (in their saved order), then everyone else alphabetically. */
export function pinSort(clients) {
  return clients
    .map((c, i) => [c, i])
    .sort(([a, ai], [b, bi]) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      if (a.pinned) return (a.pin_order ?? 999) - (b.pin_order ?? 999) || ai - bi;
      return ai - bi;
    })
    .map(([c]) => c);
}

/** The client's own addresses, "a@b.com; c@d.com". */
export const clientEmail = (c) => parseRecipients(c.email_to || c.contact_email).map((r) => r.email).join("; ");
/** Short label for lists: first address, plus how many more. */
export const clientEmailLabel = (c) => {
  const l = parseRecipients(c.email_to || c.contact_email);
  return l.length ? `${l[0].email}${l.length > 1 ? ` +${l.length - 1}` : ""}` : "";
};
