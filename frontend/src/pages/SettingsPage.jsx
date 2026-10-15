import { useState } from "react";
import { api, OPTIONAL_COLUMNS } from "@/lib/api";
import { getMailApp, parseRecipients, setMailApp, useClients, useRefresh, useRoe, useSettings } from "@/lib/data";
import { ENTITIES } from "@/lib/billingCalc";
import { Seg, Toggle, dmy, todayIso, useChip, useToast } from "@/lib/ui";
import RoeModal from "@/components/RoeModal";
import { useTheme } from "@/lib/theme";

export default function SettingsPage() {
  const toast = useToast();
  const chip = useChip();
  const refresh = useRefresh();
  const { dark, toggle } = useTheme();
  const { data: clients = [] } = useClients();
  const { data: settings } = useSettings();
  const [newPreset, setNewPreset] = useState("");
  const { data: rates = [] } = useRoe();
  const [roeEdit, setRoeEdit] = useState(null);
  const [roeAll, setRoeAll] = useState(false);
  const [mailApp, setMail] = useState(getMailApp);
  const [mailDraft, setMailDraft] = useState(null); // edits to the default recipients / message
  const EMAIL_KEYS = ["email_default_to", "email_default_cc", "email_default_subject", "email_default_body"];
  const mailVals = mailDraft || Object.fromEntries(EMAIL_KEYS.map((k) => [k, settings?.[k] || ""]));
  const setMailVal = (k) => (e) => setMailDraft({ ...mailVals, [k]: e.target.value });
  const saveMail = async () => { await update(mailDraft); setMailDraft(null); toast("Email defaults saved"); };
  const count = (t) => { const n = parseRecipients(t).length; return n ? ` · ${n} address${n === 1 ? "" : "es"}` : ""; };

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

      <section className="oo-set" style={{ gap: 14 }}>
        <div className="oo-card-title"><h2>Email</h2><span className="oo-sub">Where "Send report" and "Send to client" open the new email, with To, CC, subject and wording filled in. Saved on this computer.</span></div>
        <Seg
          size="lg"
          value={mailApp}
          onChange={(v) => { setMail(v); setMailApp(v); toast(v === "owa" ? "Emails open in Outlook on the web" : "Emails open in this computer's mail app"); }}
          options={[{ value: "mailto", label: "Outlook desktop (classic)" }, { value: "owa", label: "Outlook on the web" }]}
        />
        <span style={{ fontSize: 13, color: "var(--ink2)", lineHeight: 1.5 }}>
          {mailApp === "owa"
            ? "Opens a new email in a browser tab at outlook.office.com — the mailbox you're already signed into, so there's no sign-in screen."
            : "Opens a new email in Outlook (classic) with your signature, and copies the message so Ctrl+V pastes it above the signature. If the new Outlook opens instead (or asks you to sign in), set it once in Windows: Settings → Apps → Default apps → search “mailto” → choose Outlook (classic)."}
        </span>
        <div className="oo-card-title" style={{ paddingTop: 10, borderTop: "1px solid var(--line2)" }}>
          <h2 style={{ fontSize: 16 }}>Added to every status report email</h2>
          <span className="oo-sub">The client's own addresses (in their profile) go first, then these.</span>
        </div>
        <label className="oo-field"><span>To{count(mailVals.email_default_to)}</span><textarea className="oo-input" rows={3} style={{ resize: "vertical", fontSize: 13 }} value={mailVals.email_default_to} onChange={setMailVal("email_default_to")} data-testid="default-to" /></label>
        <label className="oo-field"><span>CC{count(mailVals.email_default_cc)}</span><textarea className="oo-input" rows={4} style={{ resize: "vertical", fontSize: 13 }} value={mailVals.email_default_cc} onChange={setMailVal("email_default_cc")} /></label>
        <label className="oo-field"><span>Default subject · {"{client}"} = client name</span><input className="oo-input" value={mailVals.email_default_subject} onChange={setMailVal("email_default_subject")} /></label>
        <label className="oo-field"><span>Default message · {"{name}"} = greeting name(s) from the client's profile</span><textarea className="oo-input" rows={5} style={{ resize: "vertical", fontSize: 13 }} value={mailVals.email_default_body} onChange={setMailVal("email_default_body")} /></label>
        {mailDraft && (
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="oo-btn sm" onClick={() => setMailDraft(null)}>Cancel</button>
            <button type="button" className="oo-btn primary sm" onClick={saveMail} data-testid="save-email-defaults">Save email defaults</button>
          </div>
        )}
      </section>

      <section className="oo-set" style={{ gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
          <div className="oo-card-title"><h2>Rates of exchange</h2><span className="oo-sub">Captured daily and pulled into pro formas: the SOB date's (a weekend or public holiday uses the next working day) and the invoice date's. You're asked for them from 10:00 each working day.</span></div>
          <button type="button" className="oo-btn sm" onClick={() => setRoeEdit({ day: todayIso(), existing: null })}>+ Add a day</button>
        </div>
        {!rates.length && <span className="oo-sub">No rates captured yet.</span>}
        {rates.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div className="oo-grid-head" style={{ gridTemplateColumns: "1.2fr 1fr 1fr 60px", padding: "8px 4px" }}><span>Date</span><span className="r">USD</span><span className="r">EUR</span><span /></div>
            {(roeAll ? rates : rates.slice(0, 10)).map((r) => (
              <div key={r.date} className="oo-grid-row" style={{ gridTemplateColumns: "1.2fr 1fr 1fr 60px", padding: "9px 4px", fontSize: 14 }}>
                <span className="mono">{dmy(r.date)}</span>
                <span className="mono r">{r.usd || "—"}</span>
                <span className="mono r">{r.eur || "—"}</span>
                <button type="button" className="oo-link" style={{ justifySelf: "end" }} onClick={() => setRoeEdit({ day: r.date, existing: r })}>Edit</button>
              </div>
            ))}
            {rates.length > 10 && <button type="button" className="oo-link" style={{ alignSelf: "flex-start", marginTop: 6 }} onClick={() => setRoeAll(!roeAll)}>{roeAll ? "Show fewer" : `Show all ${rates.length} days`}</button>}
          </div>
        )}
        {roeEdit && <RoeModal day={roeEdit.day} existing={roeEdit.existing} onClose={() => setRoeEdit(null)} />}
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
