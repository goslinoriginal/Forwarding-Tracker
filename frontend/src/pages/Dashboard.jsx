import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { displayStatus, pinSort, useClients, useRefresh, useReminders, useReportLog, useShipments } from "@/lib/data";
import { CARGO_HUE, CARRIER_HUE, Pill, dm, greeting, longToday, useToast } from "@/lib/ui";
import { useEditor } from "@/components/ShipmentEditor";

const REMINDER_COLS = "44px 1.2fr 80px 1.3fr 1.4fr 64px 1.5fr 72px 96px 60px";

function triggerText(r) {
  if ((r.cargo_type || "FCL").toUpperCase() === "LCL") return "LCL · 10 days before ETA";
  return (r.kind || "").includes("2nd vessel") ? "FCL · 2 days before ETD (2nd vessel)" : "FCL · 2 days before ETD";
}

function DaysPill({ days }) {
  if (days < 0) return <Pill tone="red" style={{ justifySelf: "end" }}>{-days}d overdue</Pill>;
  if (days === 0) return <Pill tone="amb" style={{ justifySelf: "end" }}>Today</Pill>;
  return <Pill style={{ justifySelf: "end" }}>{days} day{days === 1 ? "" : "s"}</Pill>;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const toast = useToast();
  const refresh = useRefresh();
  const { openEditor } = useEditor();
  const { data: clients = [] } = useClients();
  const { data: ships = [] } = useShipments();
  const { data: reminders = [] } = useReminders();
  const { data: sent = {} } = useReportLog();

  const active = ships.filter((s) => !s.anf_received);
  const countFor = (id) => active.filter((s) => s.client_id === id).length;
  const delayedFor = (id) => active.filter((s) => s.client_id === id && displayStatus(s) === "Delayed").length;
  const delayed = active.filter((s) => displayStatus(s) === "Delayed").length;
  const sorted = pinSort(clients);
  // Clients with nothing left to monitor (all shipments archived) stay off the daily list
  const monitored = sorted.filter((c) => countFor(c.id) > 0 || c.flagged);
  const openClient = (id) => navigate(`/clients/${id}`);

  const tick = async (r) => {
    try {
      await api.post(`/shipments/${r.shipment_id}/ack-cargo-report`);
      await refresh("reminders");
      toast(`Cargo report done · ${r.file_number || r.supplier}`, {
        undo: async () => { await api.post(`/shipments/${r.shipment_id}/unack-cargo-report`); refresh("reminders"); },
      });
    } catch { toast("Couldn't update the reminder", { error: true }); }
  };

  const priority = sorted.filter((c) => c.flagged).map((c) => {
    const dl = delayedFor(c.id);
    const due = reminders.filter((r) => r.client_id === c.id);
    const over = due.filter((r) => r.days_left <= 0).length;
    const t = sent[c.id];
    const items = [];
    if (dl) items.push({ label: `${dl} delayed`, tone: "red" });
    if (over) items.push({ label: `${over} cargo report${over > 1 ? "s" : ""} due today/overdue`, tone: "amb" });
    if (due.length - over) items.push({ label: `${due.length - over} cargo report${due.length - over > 1 ? "s" : ""} upcoming` });
    if (!t) items.push({ label: "Daily report not sent" });
    if (!items.length) items.push({ label: `All clear · sent ${t}`, tone: "grn" });
    return { c, items, notSent: !t };
  });

  const counts = {};
  active.forEach((s) => { const k = s.carrier || "Other"; counts[k] = (counts[k] || 0) + 1; });
  const max = Math.max(1, ...Object.values(counts));
  const carriers = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  const sentCount = monitored.filter((c) => sent[c.id]).length;

  return (
    <div className="oo-page" data-screen-label="Dashboard">
      <div className="oo-head">
        <div className="oo-head-text">
          <span className="oo-sub">{longToday()}</span>
          <h1 className="oo-h1">{greeting()}</h1>
          <p className="oo-lead">
            {active.length} active shipment{active.length === 1 ? "" : "s"} across {monitored.length} client{monitored.length === 1 ? "" : "s"} · {reminders.length} cargo report{reminders.length === 1 ? "" : "s"} due.
          </p>
        </div>
        <button type="button" className="oo-btn" style={{ padding: "11px 18px" }} onClick={() => navigate("/clients")}>Manage clients →</button>
      </div>

      <div className="oo-kpis">
        <div className="oo-kpi" style={{ background: "var(--accent-soft)", color: "var(--accent-ink)", animationDelay: ".04s" }}><span>Active clients</span><span className="n">{monitored.length}</span></div>
        <div className="oo-kpi" style={{ background: "var(--sub)", border: "1px solid var(--line2)", animationDelay: ".08s" }}><span style={{ color: "var(--ink2)" }}>Active shipments</span><span className="n">{active.length}</span></div>
        <div className="oo-kpi" style={{ background: "var(--red-bg)", color: "var(--red-fg)", animationDelay: ".12s" }}><span>Delayed</span><span className="n">{delayed}</span></div>
        <div className="oo-kpi" style={{ background: "var(--amb-bg)", color: "var(--amb-fg)", animationDelay: ".16s" }}><span>Cargo reports due</span><span className="n">{reminders.length}</span></div>
      </div>

      {priority.length > 0 && (
        <div className="oo-card fade-up" style={{ animationDelay: ".18s" }}>
          <div className="oo-card-head">
            <div className="oo-card-title">
              <h2 className="oo-h2" style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ color: "var(--red-fg)" }}>⚑</span>Priority clients</h2>
              <span className="oo-sub">Flag clients in the Clients list to keep them here.</span>
            </div>
          </div>
          {priority.map(({ c, items, notSent }) => (
            <div key={c.id} className="oo-prio-row">
              <button type="button" className="oo-namebtn" style={{ flex: "none", minWidth: 180 }} onClick={() => openClient(c.id)}>
                <b>{c.name}</b><span>{c.company} · {countFor(c.id)} active</span>
              </button>
              <div style={{ flex: 1, display: "flex", gap: 6, flexWrap: "wrap" }}>
                {items.map((it) => <Pill key={it.label} tone={it.tone} size="lg">{it.label}</Pill>)}
              </div>
              {notSent && <button type="button" className="oo-btn primary sm" onClick={() => openEditor(c.id)}>Do report</button>}
              <button type="button" className="oo-link" onClick={() => openClient(c.id)}>Open →</button>
            </div>
          ))}
        </div>
      )}

      {reminders.length > 0 && (
        <div className="oo-card fade-up" style={{ animationDelay: ".2s" }}>
          <div className="oo-card-head">
            <div className="oo-card-title">
              <h2 className="oo-h2">Cargo reporting due</h2>
              <span className="oo-sub">Tick once reported and it clears. FCL: 2 days before ETD (2nd vessel if transhipment) · LCL: 10 days before ETA</span>
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 1000 }}>
              <div className="oo-grid-head" style={{ gridTemplateColumns: REMINDER_COLS, gap: 12, padding: "10px 24px", borderTop: "1px solid var(--line2)", borderBottom: "none" }}>
                <span>Done</span><span>Client</span><span>File #</span><span>Supplier</span><span>Vessel</span><span>Type</span><span>Trigger</span><span className="r">Target</span><span className="r">Days left</span><span />
              </div>
              {reminders.map((r, i) => (
                <div key={r.shipment_id} className="oo-grid-row" style={{ gridTemplateColumns: REMINDER_COLS, gap: 12, padding: "12px 24px", borderTop: "1px solid var(--line2)", borderBottom: "none", fontSize: 14, animationDelay: `${Math.min(i, 12) * 30}ms` }}>
                  <button type="button" className="oo-check" title="Mark cargo report done" onClick={() => tick(r)}>✓</button>
                  <span className="oo-ellipsis" style={{ fontWeight: 600 }}>{r.client_name}</span>
                  <span className="mono" style={{ fontSize: 13, fontWeight: 500 }}>{r.file_number || "—"}</span>
                  <span className="oo-ellipsis" style={{ color: "var(--ink2)" }}>{r.supplier}</span>
                  <span className="oo-ellipsis" style={{ color: "var(--ink2)", fontSize: 13 }}>{r.vessel_name || "—"}</span>
                  <Pill hue={CARGO_HUE[r.cargo_type] ?? 255} size="xs" style={{ fontFamily: "var(--mono)" }}>{r.cargo_type}</Pill>
                  <span style={{ fontSize: 13, color: "var(--mute)" }}>{triggerText(r)}</span>
                  <span className="mono r" style={{ fontSize: 13, color: "var(--ink2)" }}>{dm(r.target_date)}</span>
                  <DaysPill days={r.days_left} />
                  <button type="button" className="oo-link" style={{ justifySelf: "end" }} onClick={() => openEditor(r.client_id, r.shipment_id)}>Open →</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="oo-split">
        <div className="oo-card pad fade-up" style={{ animationDelay: ".24s" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <h2 className="oo-h2">Today's reports</h2>
            <span className="oo-sub">{sentCount} of {monitored.length} sent</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {monitored.map((c) => {
              const t = sent[c.id];
              return (
                <div key={c.id} className="oo-list-row">
                  <button type="button" className="oo-namebtn" onClick={() => openClient(c.id)}>
                    <b>{c.name}</b><span>{c.company} · {countFor(c.id)} active</span>
                  </button>
                  {t ? <Pill tone="grn" size="lg">Sent {t}</Pill> : <Pill size="lg" style={{ color: "var(--mute)" }}>Not sent</Pill>}
                  {!t && <button type="button" className="oo-btn primary sm" onClick={() => openEditor(c.id)}>Do report</button>}
                </div>
              );
            })}
            {!monitored.length && <span className="oo-sub" style={{ padding: "12px 14px" }}>No clients with active shipments.</span>}
          </div>
        </div>
        <div className="oo-card pad fade-up" style={{ animationDelay: ".28s" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <h2 className="oo-h2">Volume by carrier</h2>
            <span className="oo-sub">Active only</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {carriers.map((k, i) => (
              <div key={k} className="oo-bar-row">
                <span className="mono" style={{ fontSize: 12, color: "var(--ink2)" }}>{k}</span>
                <div className="oo-bar">
                  <div style={{ width: `${(counts[k] / max) * 100}%`, background: `oklch(0.62 0.12 ${CARRIER_HUE[k] ?? 250})`, animationDelay: `${i * 60 + 200}ms` }} />
                </div>
                <span className="mono r" style={{ fontSize: 13, color: "var(--ink2)" }}>{counts[k]}</span>
              </div>
            ))}
            {!carriers.length && <span className="oo-sub">No active shipments.</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
