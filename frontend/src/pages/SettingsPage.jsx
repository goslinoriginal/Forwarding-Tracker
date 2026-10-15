import { useState } from "react";
import { api, OPTIONAL_COLUMNS } from "@/lib/api";
import { useClients, useRefresh, useSettings } from "@/lib/data";
import { ENTITIES } from "@/lib/billingCalc";
import { Seg, Toggle, useChip, useToast } from "@/lib/ui";
import { useTheme } from "@/lib/theme";

export default function SettingsPage() {
  const toast = useToast();
  const chip = useChip();
  const refresh = useRefresh();
  const { dark, toggle } = useTheme();
  const { data: clients = [] } = useClients();
  const { data: settings } = useSettings();
  const [newPreset, setNewPreset] = useState("");

  const update = async (patch) => {
    try {
      await api.put("/settings", patch);
      await refresh("settings");
    } catch { toast("Couldn't save the setting", { error: true }); }
  };

  const cols = settings?.default_columns || {};
  const presets = settings?.quick_comments || [];
  const addPreset = () => {
    const v = newPreset.trim();
    if (!v) return;
    update({ quick_comments: [...presets, v] });
    setNewPreset("");
  };

  return (
    <div className="oo-page narrow" data-screen-label="Settings">
      <div className="oo-head-text">
        <h1 className="oo-h1">Settings</h1>
        <p className="oo-lead">Defaults for new clients and the daily report.</p>
      </div>

      <section className="oo-set" style={{ padding: "22px 26px", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div className="oo-card-title"><h2>Appearance</h2><span className="oo-sub">Dark mode uses a navy theme. Saved on this device.</span></div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 500 }}>Dark mode</span>
          <Toggle size="lg" on={dark} onChange={toggle} title="Toggle dark mode" />
        </div>
      </section>

      <section className="oo-set">
        <div className="oo-card-title"><h2>Report entities</h2><span className="oo-sub">The company named and branded on each client's report.</span></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 12 }}>
          {ENTITIES.map((e) => {
            const n = clients.filter((c) => c.company === e.key).length;
            return (
              <div key={e.key} className="oo-entity">
                <span className="ini" style={chip(e.h)}>{e.key[0]}</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{e.label}</span>
                  <span style={{ fontSize: 12, color: "var(--mute)" }}>{n} client{n === 1 ? "" : "s"}</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="oo-set" style={{ gap: 12 }}>
        <div className="oo-card-title" style={{ paddingBottom: 6 }}><h2>Default report columns</h2><span className="oo-sub">Applied to new clients. Change per client from their report.</span></div>
        {OPTIONAL_COLUMNS.map((o) => (
          <div key={o.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderTop: "1px solid var(--line2)", fontSize: 14 }}>
            <span>{o.label}</span>
            <Toggle on={!!cols[o.key]} onChange={() => update({ default_columns: { ...cols, [o.key]: !cols[o.key] } })} />
          </div>
        ))}
      </section>

      <section className="oo-set">
        <div className="oo-card-title"><h2>Export format</h2><span className="oo-sub">What "Send report" attaches.</span></div>
        <Seg
          size="lg"
          value={settings?.export_format || "PDF + Excel"}
          onChange={(v) => update({ export_format: v })}
          options={["PDF", "Excel", "PDF + Excel"].map((f) => ({ value: f, label: f }))}
        />
      </section>

      <section className="oo-set" style={{ gap: 16 }}>
        <div className="oo-card-title"><h2>Quick comment presets</h2><span className="oo-sub">Shown when writing a shipment update.</span></div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {presets.map((p, i) => (
            <span key={`${p}-${i}`} className="oo-chiprm">
              {p.trim()}
              <button type="button" title="Remove" onClick={() => update({ quick_comments: presets.filter((_, j) => j !== i) })}>×</button>
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="oo-search"
            style={{ maxWidth: "none", padding: "11px 16px" }}
            value={newPreset}
            onChange={(e) => setNewPreset(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addPreset(); }}
            placeholder="Add a preset, e.g. Customs hold at Durban."
          />
          <button type="button" className="oo-btn primary" style={{ padding: "11px 18px" }} onClick={addPreset}>Add</button>
        </div>
      </section>
    </div>
  );
}
