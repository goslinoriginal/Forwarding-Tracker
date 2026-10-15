import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, API } from "@/lib/api";
import { nextWorkday } from "@/lib/holidays";
import { dm, todayIso } from "@/lib/ui";

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

/** Opens the client's pre-filled status-report email in the mail app. */
/* Where "Send" opens the new email. Saved per computer.
   owa    – a new email in Outlook on the web (the account already signed in, in the browser)
   mailto – the computer's default mail app (set Outlook classic as the mailto default in Windows) */
const MAIL_KEY = "oceanops.mailApp";
export const getMailApp = () => { try { return localStorage.getItem(MAIL_KEY) || "owa"; } catch { return "owa"; } };
export const setMailApp = (v) => { try { localStorage.setItem(MAIL_KEY, v); } catch {} };

const recipients = (list) => String(list || "").split(/[;,]/).map((x) => x.trim()).filter(Boolean);

/** Opens a ready-to-send email: To, CC, subject and body filled in. */
export function composeEmail({ to, cc, subject, body }) {
  const toL = recipients(to);
  const ccL = recipients(cc);
  if (getMailApp() === "owa") {
    const q = [["to", toL.join(";")], ["cc", ccL.join(";")], ["subject", subject], ["body", body]]
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("&");
    window.open(`https://outlook.office.com/mail/deeplink/compose?${q}`, "_blank", "noopener");
    return;
  }
  const params = new URLSearchParams();
  if (ccL.length) params.set("cc", ccL.join(";"));
  if (subject) params.set("subject", subject);
  if (body) params.set("body", body);
  window.location.href = `mailto:${toL.map(encodeURIComponent).join(";")}?${params.toString().replace(/\+/g, "%20")}`;
}

export function openReportEmail(client) {
  const to = (client.email_to || client.contact_email || "").trim();
  if (!to) return false;
  const cc = (client.email_cc || "").trim();
  const greetingName = (client.email_greeting || client.name || "").trim();
  composeEmail({
    to, cc,
    subject: `Status Report - ${client.name}`,
    body: `Dear ${greetingName},\n\nPlease see attached Status Report for your pending shipments.\n\nThanks.`,
  });
  return true;
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

export const clientEmail = (c) => c.email_to || c.contact_email || "";
