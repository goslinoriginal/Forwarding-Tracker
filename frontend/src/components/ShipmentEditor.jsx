import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, CARRIERS, carrierTrackUrl, clipboardTrackingNumber } from "@/lib/api";
import {
  displayStatus, downloadReport, openReportEmail, receivedLabel, shipmentLegs, statusLabel,
  useClients, useRefresh, useReportLog, useSettings, useShipments, useVessels,
  isGroupClient,
} from "@/lib/data";
import { STATUS_HUE, Pill, copyText, dmy, nowHm, parseDayInput, todayIso, useToast } from "@/lib/ui";

/* The status report editor: a full-screen sheet listing a client's active shipments
   on the left and one shipment's form on the right. Edits are held as per-shipment
   drafts until saved, so you can hop between files and save at the end. */

const EditorContext = createContext({ openEditor: () => {} });
export const useEditor = () => useContext(EditorContext);

const ORD = ["2nd", "3rd", "4th", "5th", "6th"];
const NEW_ID = "__new__";

function toForm(s) {
  const legs = shipmentLegs(s).slice(1).map((l) => ({ name: l.name, etd: l.etd || "", sob: l.sob || "" }));
  return {
    file_number: s.file_number || "", supplier: s.supplier || "", order_booking_file: s.order_booking_file || "",
    cargo_type: s.cargo_type || "FCL", carrier: s.carrier || "Other", vessel_name: s.vessel_name || "",
    planned_etd: s.planned_etd || "", etd_tba: !!s.etd_tba, legs,
    tracking_doc_number: s.tracking_doc_number || "", sob_date: dmy(s.sob_date || ""), eta: s.eta || s.planned_eta || "",
    pol: s.pol || "", pod: s.pod || "", final_destination: s.final_destination || "",
    expected_freight_rate: s.expected_freight_rate || "", copy_docs_status: s.copy_docs_status || "",
    hbill: s.hbill_released === true ? "Yes" : s.hbill_released === false ? "No" : "",
    comment_note: s.comment_note || "",
    comment_lead: s.comment_lead || "",
    end_client: s.end_client || "", handover_party: s.handover_party || "", fcl_count: s.fcl_count || "",
    obill_refs: s.obill_refs || "", doc_draft_bills: s.doc_draft_bills || "",
    doc_copy_invoices: s.doc_copy_invoices || "", doc_original_invoices: s.doc_original_invoices || "",
  };
}

function toPayload(f) {
  const legs = f.legs.filter((l) => l.name.trim() || l.etd || l.sob);
  const [second, ...rest] = legs;
  return {
    file_number: f.file_number.trim(), supplier: f.supplier.trim(), order_booking_file: f.order_booking_file.trim(),
    cargo_type: f.cargo_type, carrier: f.carrier, vessel_name: f.vessel_name.trim(),
    planned_etd: f.etd_tba ? "" : f.planned_etd, etd_tba: f.etd_tba,
    second_vessel_name: second ? second.name.trim() : "", second_vessel_etd: second ? second.etd : "", second_vessel_sob_date: second ? second.sob : "",
    extra_vessels: rest.map((l) => ({ name: l.name.trim(), planned_etd: l.etd || null, sob_date: l.sob || null })),
    tracking_doc_number: f.tracking_doc_number.trim(), sob_date: parseDayInput(f.sob_date),
    eta: f.eta, pol: f.pol.trim(), pod: f.pod.trim(), final_destination: f.final_destination.trim(),
    expected_freight_rate: f.expected_freight_rate.trim(), copy_docs_status: f.copy_docs_status.trim(),
    hbill_released: f.hbill === "Yes" ? true : f.hbill === "No" ? false : null,
    comment_note: f.comment_note.trim(),
    comment_lead: f.comment_lead.trim(),
    end_client: f.end_client.trim(), handover_party: f.handover_party.trim(), fcl_count: f.fcl_count.trim(),
    obill_refs: f.obill_refs.trim(), doc_draft_bills: f.doc_draft_bills,
    doc_copy_invoices: f.doc_copy_invoices, doc_original_invoices: f.doc_original_invoices,
  };
}

/** The status the shipment will have once the draft is saved (mirrors the backend). */
function draftStatus(f) {
  if (parseDayInput(f.sob_date)) return "Shipped";
  if (f.vessel_name.trim() || f.planned_etd || f.tracking_doc_number.trim()) return "Booked";
  return "Planned";
}

export function EditorProvider({ children }) {
  const [state, setState] = useState(null); // { clientId, shipId }
  const openEditor = useCallback((clientId, shipId) => setState({ clientId, shipId: shipId || null }), []);
  return (
    <EditorContext.Provider value={{ openEditor }}>
      {children}
      {state && <ShipmentEditor {...state} onClose={() => setState(null)} />}
    </EditorContext.Provider>
  );
}

function Field({ label, span, children }) {
  return (
    <label className="oo-field" style={span ? { gridColumn: `span ${span}` } : undefined}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function ShipmentEditor({ clientId, shipId, onClose }) {
  const toast = useToast();
  const refresh = useRefresh();
  const { data: clients = [] } = useClients();
  const { data: ships = [] } = useShipments();
  const { data: sent = {} } = useReportLog();
  const { data: settings } = useSettings();
  const { data: vessels = [] } = useVessels();
  const client = clients.find((c) => c.id === clientId);

  // Rail order is fixed when the editor opens so saving doesn't reshuffle it.
  const [order, setOrder] = useState(() => ships.filter((s) => s.client_id === clientId).map((s) => s.id).reverse());
  const [editId, setEditId] = useState(() => {
    if (shipId === NEW_ID) return NEW_ID;
    return shipId || ships.filter((s) => s.client_id === clientId && !s.anf_received).map((s) => s.id).reverse()[0] || NEW_ID;
  });
  const [drafts, setDrafts] = useState({});
  const [hasNew, setHasNew] = useState(editId === NEW_ID);
  const [busy, setBusy] = useState(false);

  const byId = useMemo(() => Object.fromEntries(ships.map((s) => [s.id, s])), [ships]);
  const railShips = order.map((id) => byId[id]).filter((s) => s && (!s.anf_received || s.id === editId));
  const blank = useMemo(() => toForm({ pod: client?.default_pod || "" }), [client]);
  const railIds = [...(hasNew ? [NEW_ID] : []), ...railShips.map((s) => s.id)];

  const baseForm = (id) => (id === NEW_ID ? blank : byId[id] ? toForm(byId[id]) : blank);
  const formOf = (id) => drafts[id] || baseForm(id);
  const isDirty = (id) => !!drafts[id] && JSON.stringify(drafts[id]) !== JSON.stringify(baseForm(id));
  const fm = formOf(editId);
  const current = byId[editId];
  const idx = Math.max(0, railIds.indexOf(editId));
  const dirtyCount = railIds.filter(isDirty).length;

  const upd = (fn) => setDrafts((d) => ({ ...d, [editId]: fn(d[editId] || baseForm(editId)) }));
  const set = (k) => (e) => { const v = e.target.value; upd((f) => ({ ...f, [k]: v })); };
  const goIdx = (i) => { const n = railIds[(i + railIds.length) % railIds.length]; if (n) setEditId(n); };

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!client) return null;

  const commit = async (id) => {
    if (id !== NEW_ID && !isDirty(id)) return id;
    const payload = toPayload(formOf(id));
    // Handovers: fill the clearing agent from the client's handover list when left blank
    if (!payload.handover_party && payload.end_client) {
      const parties = client.handover_parties || {};
      const key = Object.keys(parties).find((k) => k.toLowerCase() === payload.end_client.toLowerCase())
        || Object.keys(parties).find((k) => k.toLowerCase().split(" ")[0] === payload.end_client.toLowerCase().split(" ")[0]);
      if (key) payload.handover_party = parties[key];
    }
    let savedId = id;
    if (id === NEW_ID) {
      if (!payload.supplier && !payload.vessel_name && !payload.tracking_doc_number && !payload.file_number) {
        throw new Error("Add at least a file #, supplier or vessel");
      }
      const { data } = await api.post("/shipments", { ...payload, client_id: clientId, status: "Booked" });
      savedId = data.id;
      setHasNew(false);
      setOrder((o) => [savedId, ...o]);
    } else {
      await api.patch(`/shipments/${id}`, payload);
    }
    setDrafts((d) => { const n = { ...d }; delete n[id]; return n; });
    return savedId;
  };

  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } catch (e) {
      const detail = e?.response?.data?.detail;
      toast(typeof detail === "string" ? detail : e?.response ? "Couldn't save — please check the dates" : e.message || "Something went wrong", { error: true });
    }
    finally { setBusy(false); }
  };

  const save = (next) => run(async () => {
    const id = await commit(editId);
    await refresh();
    toast(`File ${fm.file_number || "shipment"} saved`);
    if (next) goIdx(idx + 1); else setEditId(id);
  });

  const revert = () => {
    if (editId === NEW_ID) { setHasNew(false); setDrafts((d) => { const n = { ...d }; delete n[NEW_ID]; return n; }); goIdx(idx + 1); return; }
    setDrafts((d) => { const n = { ...d }; delete n[editId]; return n; });
    toast("Changes discarded");
  };

  const markAnf = () => run(async () => {
    const id = await commit(editId);
    await api.patch(`/shipments/${id}`, { anf_received: true });
    await refresh();
    toast(`${receivedLabel(formOf(editId).cargo_type)} — drops off the next report`);
    goIdx(idx + 1);
  });

  const remove = () => run(async () => {
    if (!current) return;
    if (!window.confirm(`Delete file ${current.file_number || current.supplier}? This can't be undone.`)) return;
    await api.delete(`/shipments/${current.id}`);
    await refresh();
    toast(`File ${current.file_number || ""} deleted`);
    const rest = railIds.filter((x) => x !== current.id);
    if (rest.length) setEditId(rest[Math.min(idx, rest.length - 1)]); else onClose();
  });

  const sendReport = () => run(async () => {
    let saved = 0;
    for (const id of railIds) {
      if (isDirty(id) && id !== NEW_ID) { await commit(id); saved++; }
    }
    const fmt = settings?.export_format || "PDF + Excel";
    if (fmt.includes("PDF")) await downloadReport(client, "pdf");
    if (fmt.includes("Excel")) await downloadReport(client, "xlsx");
    if (client.internal) {
      // Internal group reports aren't emailed to anyone or tracked as "sent"
      await refresh();
      toast(`Report downloaded${saved ? ` · ${saved} edit${saved > 1 ? "s" : ""} saved` : ""}`);
      return;
    }
    await api.post(`/clients/${client.id}/report-sent`, { date: todayIso(), time: nowHm() });
    await refresh();
    const mailed = await openReportEmail(client, settings);
    toast(
      (mailed ? `Email opened — ${mailed.pasted ? "press Ctrl+V to paste the message above your signature, then " : ""}attach the downloaded report` : "Report downloaded and marked sent · add the client's email addresses in their profile")
      + (saved ? ` · ${saved} edit${saved > 1 ? "s" : ""} saved` : ""),
    );
  });

  const copyAndTrack = (e) => {
    e.preventDefault();
    const n = fm.tracking_doc_number.trim();
    if (!n) { toast("No tracking number on this file"); return; }
    const copy = clipboardTrackingNumber(fm.carrier, n);
    copyText(copy);
    window.open(carrierTrackUrl(fm.carrier, n), "_blank", "noopener,noreferrer");
    toast(`${copy} copied`);
  };

  const status = current?.anf_received ? "ANF" : current && !isDirty(editId) ? displayStatus(current) : draftStatus(fm);
  const sentT = sent[client.id];
  const presets = settings?.quick_comments || [];
  const appendNote = (t) => upd((f) => ({ ...f, comment_note: (f.comment_note.trim() ? f.comment_note.trim() + " " : "") + t }));
  const autoComment = current ? (current.comments || "").replace(/^\s*\d{1,2}\.\d{1,2}\s*-\s*/, "").replace(fm.comment_lead.trim(), "").replace(fm.comment_note.trim(), "").trim() : "";

  return (
    <div className="oo-sheet" data-screen-label="Status report editor">
      <header className="oo-sheet-head">
        <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
          <button type="button" className="oo-circle" onClick={onClose} title="Close (Esc)">←</button>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-.02em" }}>{client.name}</span>
            <span className="oo-sub">
              Status report · {railShips.length} shipment{railShips.length === 1 ? "" : "s"}
              {dirtyCount ? ` · ${dirtyCount} unsaved` : ""}
            </span>
          </div>
        </div>
        <div className="oo-actions">
          <button type="button" className="oo-btn" onClick={() => run(async () => { await downloadReport(client, "xlsx"); toast("Excel downloaded"); })}>Excel</button>
          <button type="button" className="oo-btn" onClick={() => run(async () => { await downloadReport(client, "pdf"); toast("PDF downloaded"); })}>PDF</button>
          <button type="button" className="oo-btn primary" onClick={sendReport} disabled={busy}>{client.internal ? "Download report" : sentT ? "Resend report" : "Send report"}</button>
        </div>
      </header>

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <nav className="oo-rail">
          <span className="oo-sub" style={{ fontSize: 12, padding: "4px 10px 8px" }}>Shipments</span>
          {railIds.map((id, i) => {
            const s = byId[id];
            const f = formOf(id);
            const st = id === NEW_ID ? "Planned" : displayStatus(s);
            return (
              <button key={id} type="button" className={`oo-rail-item ${id === editId ? "on" : ""}`} style={{ animationDelay: `${i * 25}ms` }} onClick={() => setEditId(id)}>
                <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, width: "100%" }}>
                  <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{f.file_number || (id === NEW_ID ? "New file" : "—")}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {(isDirty(id) || id === NEW_ID) && <span style={{ fontSize: 11, color: "var(--amb-fg)" }}>● unsaved</span>}
                    <Pill hue={STATUS_HUE[st]} size="xs">{st === "ANF" ? (f.cargo_type === "LCL" ? "SOB's" : "ANF") : st}</Pill>
                  </span>
                </span>
                <span className="oo-ellipsis" style={{ fontSize: 13, color: "var(--ink2)", width: "100%" }}>{f.supplier || "—"}</span>
              </button>
            );
          })}
          {!hasNew && (
            <button type="button" className="oo-dashed" style={{ margin: "8px 10px", fontSize: 13 }} onClick={() => { setHasNew(true); setEditId(NEW_ID); }}>
              + New shipment
            </button>
          )}
        </nav>

        <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "auto", padding: "18px 24px", display: "flex", flexDirection: "column" }}>
          <div key={editId} style={{ flex: "1 0 auto", display: "flex", flexDirection: "column", gap: 14, animation: "fadeUp .35s var(--ease) both" }}>
            <div style={{ flex: "none", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span className="oo-sub">{idx + 1} / {railIds.length}</span>
                <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-.02em" }}>
                  <span className="mono">{fm.file_number || (editId === NEW_ID ? "New file" : "—")}</span> · {fm.supplier || "—"}
                </h2>
                <Pill hue={STATUS_HUE[status]} dot>{statusLabel(status, fm.cargo_type)}</Pill>
              </div>
              {fm.tracking_doc_number && (
                <a href={carrierTrackUrl(fm.carrier, fm.tracking_doc_number)} className="oo-track" onClick={copyAndTrack}>
                  <span className="mono">{fm.tracking_doc_number}</span><span>Copy &amp; track ↗</span>
                </a>
              )}
            </div>

            <div className="oo-edit-card">
              <div className="oo-form4">
                <Field label="File #"><input className="oo-input mono" value={fm.file_number} onChange={set("file_number")} /></Field>
                <Field label="Supplier"><input className="oo-input" value={fm.supplier} onChange={set("supplier")} /></Field>
                <Field label="Cargo type">
                  <select className="oo-input" value={fm.cargo_type} onChange={set("cargo_type")}>
                    <option value="FCL">FCL (Full Container)</option>
                    <option value="LCL">LCL (Groupage)</option>
                  </select>
                </Field>
                <Field label="Status (set automatically)">
                  <div className="oo-input ro" title="Planned until a vessel or ETD is added, Booked once it is, Shipped when the 1st vessel has an SOB date.">
                    {statusLabel(status, fm.cargo_type)}
                  </div>
                </Field>

                <Field label="Order" span={2}>
                  <textarea className="oo-input" rows={Math.min(4, Math.max(1, fm.order_booking_file.split("\n").length))} value={fm.order_booking_file} onChange={set("order_booking_file")} />
                </Field>
                <Field label="Carrier">
                  <select className="oo-input" value={fm.carrier} onChange={set("carrier")}>
                    {CARRIERS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="Vessel name (1st)"><input className="oo-input" list="oo-vessels" value={fm.vessel_name} onChange={set("vessel_name")} /></Field>

                <div className="oo-field">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, height: 16 }}>
                    <span className="oo-label">Planned ETD (1st vessel)</span>
                    <button type="button" className={`oo-tba ${fm.etd_tba ? "on" : ""}`} onClick={() => upd((f) => ({ ...f, etd_tba: !f.etd_tba }))}>ETD TBA</button>
                  </div>
                  <input type="date" className="oo-input" value={fm.etd_tba ? "" : fm.planned_etd} onChange={set("planned_etd")} disabled={fm.etd_tba} />
                </div>
                <Field label="ETA"><input type="date" className="oo-input" value={fm.eta} onChange={set("eta")} /></Field>
                <Field label="Tracking doc # (B/L, container, booking)"><input className="oo-input mono" value={fm.tracking_doc_number} onChange={set("tracking_doc_number")} /></Field>
                <Field label="SOB date / RCG"><input className="oo-input" value={fm.sob_date} onChange={set("sob_date")} placeholder="dd.mm. or RCG" /></Field>

                {fm.legs.length > 0 && (
                  <div style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 8 }}>
                    {fm.legs.map((l, i) => {
                      const setLeg = (k) => (e) => { const v = e.target.value; upd((f) => ({ ...f, legs: f.legs.map((x, j) => (j === i ? { ...x, [k]: v } : x)) })); };
                      return (
                        <div key={i} className="oo-leg">
                          <Field label={`${ORD[i] || `${i + 2}th`} vessel (transhipment)`}><input className="oo-input" list="oo-vessels" value={l.name} onChange={setLeg("name")} placeholder="Vessel name" /></Field>
                          <Field label="Planned ETD"><input type="date" className="oo-input" value={l.etd} onChange={setLeg("etd")} /></Field>
                          <Field label="Sailed (SOB)"><input type="date" className="oo-input" value={l.sob} onChange={setLeg("sob")} /></Field>
                          <button type="button" className="oo-x" title="Remove vessel" onClick={() => upd((f) => ({ ...f, legs: f.legs.filter((_, j) => j !== i) }))}>×</button>
                        </div>
                      );
                    })}
                  </div>
                )}

                <Field label="Port of loading"><input className="oo-input" value={fm.pol} onChange={set("pol")} /></Field>
                <Field label="Port of discharge"><input className="oo-input" value={fm.pod} onChange={set("pod")} /></Field>
                <Field label="Copy docs status"><input className="oo-input" value={fm.copy_docs_status} onChange={set("copy_docs_status")} /></Field>
                <span />

                {isGroupClient(client) && (
                  <>
                    <Field label={client.report_layout === "mushrooms" ? "End client (report split)" : "Client"}>
                      <input className="oo-input" list="oo-end-clients" value={fm.end_client} onChange={set("end_client")} placeholder={client.report_layout === "mushrooms" ? "e.g. Country Mushrooms" : "e.g. Ecolab"} />
                    </Field>
                    {client.report_layout === "handovers" ? (
                      <>
                        <Field label="Handover party">
                          <input className="oo-input" value={fm.handover_party} onChange={set("handover_party")} placeholder={(client.handover_parties || {})[fm.end_client] || "Clearing agent"} />
                        </Field>
                        <span /><span />
                      </>
                    ) : (
                      <>
                        <Field label="No. of FCLs"><input className="oo-input" value={fm.fcl_count} onChange={set("fcl_count")} /></Field>
                        <Field label="O/Bill — containers & refs" span={2}><input className="oo-input mono" value={fm.obill_refs} onChange={set("obill_refs")} placeholder="MSNU1521512, MSBU3417644, NLRTM-XEN-SE-002420" /></Field>
                        <Field label="Draft/Copy bills received"><input type="date" className="oo-input" value={fm.doc_draft_bills} onChange={set("doc_draft_bills")} /></Field>
                        <Field label="Copy invoices & phyto's received"><input type="date" className="oo-input" value={fm.doc_copy_invoices} onChange={set("doc_copy_invoices")} /></Field>
                        <Field label="Original invoices & phyto's received"><input type="date" className="oo-input" value={fm.doc_original_invoices} onChange={set("doc_original_invoices")} /></Field>
                        <span />
                      </>
                    )}
                  </>
                )}
                <Field label="Final destination"><input className="oo-input" value={fm.final_destination} onChange={set("final_destination")} /></Field>
                <Field label="Expected freight rate"><input className="oo-input" value={fm.expected_freight_rate} onChange={set("expected_freight_rate")} /></Field>
                <Field label="H/bill released by supplier">
                  <select className="oo-input" value={fm.hbill} onChange={set("hbill")}>
                    <option value="">—</option><option value="Yes">Yes</option><option value="No">No</option>
                  </select>
                </Field>
                <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", minWidth: 0 }}>
                  <button
                    type="button"
                    className="oo-dashed"
                    style={{ height: 38, borderRadius: 11, fontSize: 13, color: "var(--ink2)", alignSelf: "stretch", padding: "0 14px" }}
                    onClick={() => upd((f) => ({ ...f, legs: [...f.legs, { name: "", etd: "", sob: "" }] }))}
                  >
                    + Add vessel (transhipment)
                  </button>
                </div>
              </div>

              <div style={{ flex: 1, minHeight: 120, display: "flex", flexDirection: "column", gap: 8 }}>
                <span className="oo-label">Comments</span>
                <input
                  className="oo-input"
                  value={fm.comment_lead}
                  onChange={set("comment_lead")}
                  placeholder={isGroupClient(client) ? "Starts with, e.g. BVB/Country. Copy Docs received." : "Optional — text before the automatic comment"}
                />
                {autoComment && (
                  <div style={{ fontSize: 13, color: "var(--ink2)", lineHeight: 1.5 }} title="Written automatically from the vessel dates and sailings">
                    <span style={{ color: "var(--mute)" }}>Auto · </span>{autoComment}
                  </div>
                )}
                <textarea className="oo-input" style={{ flex: 1, minHeight: 70 }} value={fm.comment_note} onChange={set("comment_note")} placeholder="Anything to add after the automatic comment, e.g. H/bill released by supplier." />
                {presets.length > 0 && (
                  <div style={{ flex: "none", display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {presets.map((p) => <button key={p} type="button" className="oo-preset" onClick={() => appendNote(p)}>{p.trim()}</button>)}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <footer className="oo-sheet-foot">
        {current && !fm.sob_date && !current.anf_received && (
          <button type="button" className="oo-btn foot" style={{ background: "var(--grn-bg)", color: "var(--grn-fg)" }} onClick={() => upd((f) => ({ ...f, sob_date: dmy(todayIso()) }))}>
            Mark sailed today
          </button>
        )}
        {current && !current.anf_received && (
          <button type="button" className="oo-btn foot" style={{ background: "var(--pur-bg)", color: "var(--pur-fg)" }} onClick={markAnf}>{receivedLabel(fm.cargo_type)}</button>
        )}
        {current && <button type="button" className="oo-btn danger" onClick={remove}>Delete</button>}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <button type="button" className="oo-btn foot" onClick={() => goIdx(idx - 1)}>← Prev</button>
          <button type="button" className="oo-btn ghost" onClick={revert}>Cancel</button>
          <button type="button" className="oo-btn soft foot" style={{ paddingLeft: 18, paddingRight: 18 }} onClick={() => save(false)} disabled={busy}>Save</button>
          <button type="button" className="oo-btn primary foot" style={{ paddingLeft: 20, paddingRight: 20, fontWeight: 600 }} onClick={() => save(true)} disabled={busy}>Save &amp; next →</button>
        </div>
      </footer>
      <datalist id="oo-vessels">{vessels.map((v) => <option key={v} value={v} />)}</datalist>
      <datalist id="oo-end-clients">
        {[...new Set(ships.filter((s) => s.client_id === clientId && s.end_client).map((s) => s.end_client))].map((v) => <option key={v} value={v} />)}
      </datalist>
    </div>
  );
}

export { NEW_ID };
