import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, API } from "@/lib/api";
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
export function openReportEmail(client) {
  const to = (client.email_to || client.contact_email || "").trim();
  if (!to) return false;
  const cc = (client.email_cc || "").trim();
  const greetingName = (client.email_greeting || client.name || "").trim();
  const params = new URLSearchParams();
  if (cc) params.set("cc", cc);
  params.set("subject", `Status Report - ${client.name}`);
  params.set("body", `Dear ${greetingName},\n\nPlease see attached Status Report for your pending shipments.\n\nThanks.`);
  window.location.href = `mailto:${encodeURIComponent(to)}?${params.toString().replace(/\+/g, "%20")}`;
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
