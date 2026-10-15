import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { displayStatus, etaText, etdText, shipmentLegs, statusLabel, useClients, useShipments } from "@/lib/data";
import { CARRIER_HUE, Modal, Pill, STATUS_HUE, Toggle, copyText, useChip, useToast } from "@/lib/ui";
import { useEditor } from "@/components/ShipmentEditor";

/* Find shipments across every client — by vessel (any leg), carrier, file #,
   container / B/L number, supplier or client. Used for vessel notices (port
   omissions, delays) and the dashboard's carrier bars. */

const FinderCtx = createContext({ openFinder: () => {} });
export const useFinder = () => useContext(FinderCtx);

const ORD = ["", "1st", "2nd", "3rd", "4th", "5th", "6th"];
const norm = (t) => String(t || "").toLowerCase().replace(/\s+/g, " ").trim();

export function FinderProvider({ children }) {
  const [opts, setOpts] = useState(null);
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && tag !== "input" && tag !== "textarea" && tag !== "select" && !e.target.isContentEditable) {
        e.preventDefault();
        setOpts((o) => o || {});
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <FinderCtx.Provider value={{ openFinder: (o) => setOpts(o || {}) }}>
      {children}
      {opts && <ShipmentFinder key={JSON.stringify(opts)} carrier={opts.carrier} query={opts.query} onClose={() => setOpts(null)} />}
    </FinderCtx.Provider>
  );
}

function ShipmentFinder({ carrier: initCarrier = "", query: initQuery = "", onClose }) {
  const navigate = useNavigate();
  const toast = useToast();
  const chip = useChip();
  const { openEditor } = useEditor();
  const { data: clients = [] } = useClients();
  const { data: ships = [] } = useShipments();
  const [q, setQ] = useState(initQuery);
  const [carrier, setCarrier] = useState(initCarrier);
  const [archived, setArchived] = useState(false);

  const nameOf = useMemo(() => Object.fromEntries(clients.map((c) => [c.id, c.name])), [clients]);
  const carriers = useMemo(() => [...new Set(ships.map((s) => s.carrier || "Other"))].sort(), [ships]);
  const needle = norm(q);

  const results = ships
    .filter((s) => archived || !s.anf_received)
    .filter((s) => !carrier || (s.carrier || "Other") === carrier)
    .map((s) => {
      const legs = shipmentLegs(s).filter((l) => l.name);
      const hitLegs = needle ? legs.filter((l) => norm(l.name).includes(needle)) : [];
      const other = [s.file_number, s.tracking_doc_number, s.obill_refs, s.supplier, s.end_client, s.order_booking_file, nameOf[s.client_id]].map(norm).join(" | ");
      const hit = !needle || hitLegs.length > 0 || other.includes(needle);
      return hit ? { s, legs, hitLegs } : null;
    })
    .filter(Boolean);

  const groups = [];
  results.forEach((r) => {
    let g = groups.find((x) => x.id === r.s.client_id);
    if (!g) { g = { id: r.s.client_id, name: nameOf[r.s.client_id] || "—", rows: [] }; groups.push(g); }
    g.rows.push(r);
  });
  groups.sort((a, b) => a.name.localeCompare(b.name));

  const open = (s) => { onClose(); openEditor(s.client_id, s.id); };
  const copyList = () => {
    const lines = groups.flatMap((g) => g.rows.map(({ s, legs, hitLegs }) => {
      const v = (hitLegs.length ? hitLegs : legs).map((l) => `${l.name}${legs.length > 1 ? ` (${ORD[l.num]} Vessel)` : ""}`).join(" / ");
      return [g.name, s.file_number, s.supplier || s.end_client, v, s.tracking_doc_number].filter(Boolean).join(" · ");
    }));
    copyText(lines.join("\n"));
    toast(`Copied ${lines.length} shipment${lines.length === 1 ? "" : "s"}`);
  };

  const title = carrier && !needle ? `${carrier} shipments` : "Find shipments";
  return (
    <Modal onClose={onClose} wide>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h2>{title}</h2>
        <span style={{ fontSize: 14, color: "var(--mute)" }}>Search by vessel (any leg), file #, container or B/L number, supplier or client.</span>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input className="oo-input big" style={{ flex: "1 1 260px" }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. MSC Pilar, 158373, MSMU3458170" autoFocus data-testid="finder-input" />
        <select className="oo-input big" style={{ flex: "0 0 170px" }} value={carrier} onChange={(e) => setCarrier(e.target.value)} data-testid="finder-carrier">
          <option value="">All carriers</option>
          {carriers.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--ink2)" }}>
          <span>Include archived</span>
          <Toggle on={archived} onChange={setArchived} />
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, fontSize: 13, color: "var(--ink2)" }}>
        <span data-testid="finder-summary">
          {results.length} shipment{results.length === 1 ? "" : "s"} · {groups.length} client{groups.length === 1 ? "" : "s"}
        </span>
        {results.length > 0 && <button type="button" className="oo-link" onClick={copyList}>Copy list</button>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, maxHeight: "58vh", overflowY: "auto", margin: "0 -4px", padding: "0 4px" }}>
        {groups.map((g) => (
          <div key={g.id} style={{ display: "flex", flexDirection: "column", border: "1px solid var(--line)", borderRadius: 14, overflow: "hidden" }}>
            <button
              type="button"
              onClick={() => { onClose(); navigate(`/clients/${g.id}`); }}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "var(--sub)", border: "none", font: "inherit", color: "inherit", cursor: "pointer", textAlign: "left" }}
            >
              <span style={{ fontWeight: 600 }}>{g.name}</span>
              <span style={{ fontSize: 12, color: "var(--mute)" }}>{g.rows.length} shipment{g.rows.length === 1 ? "" : "s"} · open client →</span>
            </button>
            {g.rows.map(({ s, legs, hitLegs }) => {
              const st = displayStatus(s);
              return (
                <button
                  key={s.id}
                  type="button"
                  className="oo-finder-row"
                  onClick={() => open(s)}
                  data-testid={`finder-row-${s.id}`}
                >
                  <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{s.file_number || "—"}</span>
                  <span className="oo-ellipsis" style={{ fontSize: 13 }}>{s.supplier || s.end_client || "—"}{s.supplier && s.end_client ? <span style={{ color: "var(--mute)" }}> · {s.end_client}</span> : null}</span>
                  <span style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 13, minWidth: 0 }}>
                    {(legs.length ? legs : [{ num: 1, name: "—" }]).map((l) => {
                      const on = hitLegs.includes(l);
                      return (
                        <span key={l.num} className="oo-ellipsis" style={{ fontWeight: on ? 600 : 400, color: on ? "var(--accent-ink)" : "var(--ink2)" }}>
                          {l.name}{legs.length > 1 ? <span style={{ fontWeight: 400, color: "var(--mute)" }}> ({ORD[l.num]} Vessel)</span> : null}
                        </span>
                      );
                    })}
                  </span>
                  <span className="mono oo-ellipsis" style={{ fontSize: 11, alignSelf: "start", padding: "2px 8px", borderRadius: 7, ...chip(CARRIER_HUE[s.carrier] ?? 250) }}>{s.carrier || "Other"}</span>
                  <Pill hue={STATUS_HUE[st]} dot>{statusLabel(st, s.cargo_type)}</Pill>
                  <span className="mono" style={{ fontSize: 12, color: "var(--ink2)" }}>{etdText(s)} → {etaText(s)}</span>
                </button>
              );
            })}
          </div>
        ))}
        {!results.length && (
          <div className="oo-empty">
            <b>No shipments found</b>
            <span className="oo-sub">{archived ? "Try part of the vessel name, e.g. just “Pilar”." : "Try part of the vessel name, or include archived shipments."}</span>
          </div>
        )}
      </div>
    </Modal>
  );
}
