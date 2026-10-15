import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, OPTIONAL_COLUMNS } from "@/lib/api";
import { clientEmail, displayStatus, pinSort, useClients, useRefresh, useReportLog, useShipments } from "@/lib/data";
import { COMPANY_HUE, Pill, Seg, useToast } from "@/lib/ui";
import ClientModal from "@/components/ClientModal";
import ImportModal from "@/components/ImportModal";

const SORTS = [
  { value: "name_asc", label: "Name (A–Z)" },
  { value: "name_desc", label: "Name (Z–A)" },
  { value: "most", label: "Most active shipments" },
  { value: "fewest", label: "Fewest active shipments" },
  { value: "on_water", label: "On the water first" },
  { value: "delayed", label: "Most delayed first" },
];
const ACTIVITY = [
  { value: "any", label: "Any" },
  { value: "active", label: "With active shipments" },
  { value: "none", label: "No active shipments" },
];

const COLS = "minmax(200px,1.6fr) 130px 70px 80px 120px minmax(160px,1.4fr) 60px 36px 36px 20px";

export default function ClientsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const refresh = useRefresh();
  const { data: clients = [] } = useClients();
  const { data: ships = [] } = useShipments();
  const { data: sent = {} } = useReportLog();
  const [filter, setFilter] = useState("All");
  const [hasDelays, setHasDelays] = useState(false);
  const [unsent, setUnsent] = useState(false);
  const [onWater, setOnWater] = useState(false);
  const [activity, setActivity] = useState("any");
  const [sort, setSort] = useState("name_asc");
  const [search, setSearch] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const active = ships.filter((s) => !s.anf_received);
  const countFor = (id) => active.filter((s) => s.client_id === id).length;
  const delayedFor = (id) => active.filter((s) => s.client_id === id && displayStatus(s) === "Delayed").length;
  const matches = (c, f) => f === "All" || (f === "Pinned" ? !!c.pinned : c.company === f);
  const q = search.trim().toLowerCase();
  const sorted = pinSort(clients);
  const pinList = sorted.filter((c) => c.pinned).map((c) => c.id);
  const onWaterFor = (id) => active.filter((s) => s.client_id === id && s.status === "Shipped").length;
  const byName = (a, b) => a.name.localeCompare(b.name);
  const cmp = {
    name_asc: byName,
    name_desc: (a, b) => byName(b, a),
    most: (a, b) => countFor(b.id) - countFor(a.id) || byName(a, b),
    fewest: (a, b) => countFor(a.id) - countFor(b.id) || byName(a, b),
    on_water: (a, b) => onWaterFor(b.id) - onWaterFor(a.id) || byName(a, b),
    delayed: (a, b) => delayedFor(b.id) - delayedFor(a.id) || byName(a, b),
  }[sort];
  const filtered = sorted
    .filter((c) => matches(c, filter))
    .filter((c) => activity === "any" || (activity === "active" ? countFor(c.id) > 0 : countFor(c.id) === 0))
    .filter((c) => !hasDelays || delayedFor(c.id) > 0)
    .filter((c) => !onWater || onWaterFor(c.id) > 0)
    .filter((c) => !unsent || (!sent[c.id] && !c.internal))
    .filter((c) => !q || `${c.name} ${clientEmail(c)}`.toLowerCase().includes(q));
  // Pinned clients stay on top in their own order; everyone else follows the chosen sort
  const rows = [...filtered.filter((c) => c.pinned), ...filtered.filter((c) => !c.pinned).sort(cmp)];

  const patch = async (c, body, msg) => {
    try {
      await api.patch(`/clients/${c.id}`, body);
      await refresh("clients");
      toast(msg);
    } catch { toast("Couldn't update the client", { error: true }); }
  };

  const movePin = async (id, dir) => {
    const o = pinList.slice();
    const i = o.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j], o[i]];
    try {
      await api.post("/clients/pin-order", { ids: o });
      await refresh("clients");
    } catch { toast("Couldn't reorder", { error: true }); }
  };

  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };

  return (
    <div className="oo-page" data-screen-label="Clients">
      <div className="oo-head">
        <div className="oo-head-text">
          <h1 className="oo-h1">Clients</h1>
          <p className="oo-lead">Each client gets its own report profile and columns.</p>
        </div>
        <div className="oo-actions">
          <button type="button" className="oo-btn lg" onClick={() => setImportOpen(true)} data-testid="import-reports-button">Import status reports</button>
          <button type="button" className="oo-btn primary lg" onClick={() => setNewOpen(true)} data-testid="add-client-button">+ New client</button>
        </div>
      </div>

      <div className="oo-toolbar">
        <Seg
          value={filter}
          onChange={setFilter}
          options={["All", "Pinned", "Patuma", "Clearfreight"].map((f) => ({ value: f, label: f, count: clients.filter((c) => matches(c, f)).length }))}
        />
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" className={`oo-chipbtn ${hasDelays ? "on" : ""}`} onClick={() => setHasDelays(!hasDelays)}>Has delays</button>
          <button type="button" className={`oo-chipbtn ${onWater ? "on" : ""}`} onClick={() => setOnWater(!onWater)}>On the water</button>
          <button type="button" className={`oo-chipbtn ${unsent ? "on" : ""}`} onClick={() => setUnsent(!unsent)}>Report not sent</button>
        </div>
        <input className="oo-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search clients or email…" />
      </div>
      <div className="oo-toolbar" style={{ marginTop: -14 }}>
        <span className="oo-sub">Shipments</span>
        <Seg value={activity} onChange={setActivity} options={ACTIVITY.map((a) => ({ ...a, count: clients.filter((c) => a.value === "any" || (a.value === "active" ? countFor(c.id) > 0 : countFor(c.id) === 0)).length }))} />
        <label style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <span className="oo-sub">Sort</span>
          <select className="oo-input" style={{ width: 230, borderRadius: 999, padding: "9px 14px" }} value={sort} onChange={(e) => setSort(e.target.value)}>
            {SORTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      </div>

      <div className="oo-card scroll">
        <div style={{ minWidth: 1000 }}>
          <div className="oo-grid-head" style={{ gridTemplateColumns: COLS }}>
            <span>Client</span><span>Entity</span><span className="r">Active</span><span className="r">Delayed</span><span>Today's report</span><span>Extra columns</span>
            <span className="c">Order</span><span className="c">Priority</span><span className="c">Pin</span><span />
          </div>
          {rows.map((c, i) => {
            const t = sent[c.id];
            const dl = delayedFor(c.id);
            const pi = pinList.indexOf(c.id);
            const extra = OPTIONAL_COLUMNS.filter((o) => c.optional_columns?.[o.key]).map((o) => o.label);
            return (
              <div
                key={c.id}
                className="oo-grid-row click"
                style={{ gridTemplateColumns: COLS, background: c.pinned ? "var(--sub)" : "transparent", animationDelay: `${Math.min(i, 12) * 30}ms` }}
                onClick={() => navigate(`/clients/${c.id}`)}
                data-testid={`client-row-${c.id}`}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{c.name}</span>
                  <span className="oo-ellipsis" style={{ fontSize: 12, color: "var(--mute)" }}>{clientEmail(c) || "—"}</span>
                </div>
                <Pill hue={COMPANY_HUE[c.company]}>{c.company}</Pill>
                <span className="mono r">{countFor(c.id)}</span>
                <span className="mono r" style={{ color: dl ? "var(--red-fg)" : "var(--faint)" }}>{dl}</span>
                {c.internal ? <Pill>Internal</Pill> : t ? <Pill tone="grn">Sent {t}</Pill> : <Pill style={{ color: "var(--mute)" }}>Not sent</Pill>}
                <span className="oo-ellipsis" style={{ fontSize: 12, color: "var(--mute)" }}>{extra.length ? extra.join(" · ") : "Standard only"}</span>
                <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                  {c.pinned && (
                    <>
                      <button type="button" className="oo-sq" title="Move up" disabled={pi <= 0} onClick={stop(() => movePin(c.id, -1))}>↑</button>
                      <button type="button" className="oo-sq" title="Move down" disabled={pi === pinList.length - 1} onClick={stop(() => movePin(c.id, 1))}>↓</button>
                    </>
                  )}
                </div>
                <button
                  type="button"
                  className={`oo-roundbtn flag ${c.flagged ? "on" : ""}`}
                  title={c.flagged ? "Remove priority flag" : "Flag as priority"}
                  onClick={stop(() => patch(c, { flagged: !c.flagged }, c.flagged ? `${c.name} unflagged` : `${c.name} flagged as priority`))}
                >
                  {c.flagged ? "⚑" : "⚐"}
                </button>
                <button
                  type="button"
                  className={`oo-roundbtn pin ${c.pinned ? "on" : ""}`}
                  title={c.pinned ? "Unpin" : "Pin to top"}
                  onClick={stop(() => patch(c, { pinned: !c.pinned }, c.pinned ? `${c.name} unpinned` : `${c.name} pinned`))}
                >
                  {c.pinned ? "★" : "☆"}
                </button>
                <span className="oo-chev">›</span>
              </div>
            );
          })}
          {!rows.length && (
            <div className="oo-empty">
              <b>{clients.length ? "No clients match" : "No clients yet"}</b>
              <span className="oo-sub">{clients.length ? "Clear a filter or the search." : "Add your first client to start a status report."}</span>
            </div>
          )}
        </div>
      </div>

      {newOpen && <ClientModal onClose={() => setNewOpen(false)} onSaved={() => refresh("clients")} />}
      {importOpen && <ImportModal onClose={() => setImportOpen(false)} onDone={() => refresh()} />}
    </div>
  );
}
