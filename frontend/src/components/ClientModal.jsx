import { useState } from "react";
import { api } from "@/lib/api";
import { parseRecipients, reportEmail, useSettings } from "@/lib/data";
import { Modal, Seg, Toggle, useToast } from "@/lib/ui";

const ENTITIES = [{ value: "Patuma", label: "Patuma" }, { value: "Clearfreight", label: "Clearfreight" }];

/** New client (name, email, entity) or, with `client`, the full client profile. */
export default function ClientModal({ client, onClose, onSaved, onDeleted }) {
  const toast = useToast();
  const editing = !!client;
  const [f, setF] = useState(() => ({
    name: client?.name || "", contact_email: client?.contact_email || "", company: client?.company || "Patuma",
    email_to: client?.email_to || "", email_cc: client?.email_cc || "", email_greeting: client?.email_greeting || "",
    email_subject: client?.email_subject || "", email_body: client?.email_body || "",
    default_pod: client?.default_pod || "", notes: client?.notes || "",
    internal: !!client?.internal,
    // One "Client = Handover party" per line
    parties: Object.entries(client?.handover_parties || {}).map(([k, v]) => `${k} = ${v}`).join("\n"),
  }));
  const isHandovers = client?.report_layout === "handovers";
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const { data: settings } = useSettings();
  const nTo = parseRecipients(f.email_to).length;
  const nCc = parseRecipients(f.email_cc).length;
  const mail = reportEmail({ ...client, ...f }, settings);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async () => {
    const name = f.name.trim();
    if (!name) { toast("Client name is required", { error: true }); return; }
    setBusy(true);
    try {
      const { parties, ...rest } = f;
      const payload = { ...rest, name, contact_email: f.contact_email.trim() };
      if (isHandovers) {
        payload.handover_parties = Object.fromEntries(
          parties.split("\n").map((line) => line.split("=")).filter((p) => p[0].trim()).map(([k, ...v]) => [k.trim(), v.join("=").trim()]),
        );
      }
      const { data } = editing
        ? await api.patch(`/clients/${client.id}`, payload)
        : await api.post("/clients", { name, contact_email: payload.contact_email, company: f.company });
      toast(editing ? `${name} updated` : `${name} added`);
      onSaved?.(data);
      onClose();
    } catch {
      toast("Couldn't save the client", { error: true });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete ${client.name} and all of its shipments? This can't be undone.`)) return;
    try {
      await api.delete(`/clients/${client.id}`);
      toast(`${client.name} deleted`);
      onDeleted?.();
    } catch {
      toast("Couldn't delete the client", { error: true });
    }
  };

  return (
    <Modal onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h2>{editing ? "Client profile" : "New client"}</h2>
        <span style={{ fontSize: 14, color: "var(--mute)" }}>
          {editing ? "Report branding, email recipients and defaults." : "Columns start from your defaults in Settings."}
        </span>
      </div>
      <label className="oo-field" style={{ gap: 8 }}>
        <span style={{ fontSize: 13, color: "var(--ink)" }}>Client name</span>
        <input className="oo-input big" value={f.name} onChange={set("name")} placeholder="e.g. Flange 2000" autoFocus />
      </label>
      <label className="oo-field" style={{ gap: 8 }}>
        <span style={{ fontSize: 13, color: "var(--ink)" }}>Contact email</span>
        <input className="oo-input big" value={f.contact_email} onChange={set("contact_email")} placeholder="ops@client.com" />
      </label>
      <div className="oo-field" style={{ gap: 8 }}>
        <span style={{ fontSize: 13, color: "var(--ink)" }}>Report entity</span>
        <Seg size="lg" options={ENTITIES} value={f.company} onChange={(v) => setF({ ...f, company: v })} />
      </div>
      {editing && (
        <>
          <div className="oo-field" style={{ gap: 10 }}>
            <span style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500 }}>Status report email</span>
            <span className="oo-sub" style={{ fontSize: 12 }}>Only the client's addresses — the Clearfreight To and CC from Settings are added automatically. Paste straight from Outlook; separate with ; , or new lines.</span>
          </div>
          <label className="oo-field">
            <span>Client To {nTo ? `· ${nTo} address${nTo === 1 ? "" : "es"}` : ""}</span>
            <textarea className="oo-input" rows={3} style={{ resize: "vertical", fontSize: 13 }} value={f.email_to} onChange={set("email_to")} placeholder={"paul@tsicom.co.za; Jane Smith <jane@tsicom.co.za>"} data-testid="client-email-to" />
          </label>
          <label className="oo-field">
            <span>Client CC (optional) {nCc ? `· ${nCc} address${nCc === 1 ? "" : "es"}` : ""}</span>
            <textarea className="oo-input" rows={2} style={{ resize: "vertical", fontSize: 13 }} value={f.email_cc} onChange={set("email_cc")} />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label className="oo-field"><span>Greeting name(s) · {"{name}"}</span><input className="oo-input" value={f.email_greeting} onChange={set("email_greeting")} placeholder="e.g. Roland and Jessica" /></label>
            <label className="oo-field"><span>Default port of discharge</span><input className="oo-input" value={f.default_pod} onChange={set("default_pod")} placeholder="Durban" /></label>
          </div>
          <label className="oo-field">
            <span>Subject — blank uses the default</span>
            <input className="oo-input" value={f.email_subject} onChange={set("email_subject")} placeholder={settings?.email_default_subject || "Status Report - {client}"} />
          </label>
          <label className="oo-field">
            <span>Message — blank uses the default · {"{name}"} = greeting, {"{client}"} = client name</span>
            <textarea className="oo-input" rows={5} style={{ resize: "vertical", fontSize: 13 }} value={f.email_body} onChange={set("email_body")} placeholder={settings?.email_default_body || ""} data-testid="client-email-body" />
          </label>
          <button type="button" className="oo-link" style={{ alignSelf: "flex-start" }} onClick={() => setPreview(!preview)}>{preview ? "Hide email preview" : "Preview the email"}</button>
          {preview && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "12px 14px", borderRadius: 12, background: "var(--sub)", fontSize: 12, lineHeight: 1.5 }} data-testid="email-preview">
              <span><b>To:</b> {mail.to.map((r) => r.email).join("; ") || "—"}</span>
              <span><b>CC:</b> {mail.cc.map((r) => r.email).join("; ") || "—"}</span>
              <span><b>Subject:</b> {mail.subject}</span>
              <span style={{ whiteSpace: "pre-wrap", paddingTop: 6, borderTop: "1px solid var(--line2)" }}>{mail.body}</span>
            </div>
          )}
          <label className="oo-field"><span>Notes</span><textarea className="oo-input" rows={3} value={f.notes} onChange={set("notes")} /></label>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div className="oo-card-title">
              <span style={{ fontSize: 14, fontWeight: 500 }}>Internal group report</span>
              <span className="oo-sub">Not emailed to anyone and left off the daily "report not sent" list.</span>
            </div>
            <Toggle on={f.internal} onChange={(v) => setF({ ...f, internal: v })} />
          </div>
          {isHandovers && (
            <label className="oo-field">
              <span>Handover parties — one per line: Client = Clearing agent</span>
              <textarea className="oo-input mono" rows={6} style={{ fontSize: 12, resize: "vertical" }} value={f.parties} onChange={set("parties")} placeholder={"Ecolab = DSV\nMitco = Freitan Logistics"} />
            </label>
          )}
        </>
      )}
      <div className="oo-modal-actions">
        {editing && <button type="button" className="oo-btn danger" style={{ marginRight: "auto" }} onClick={remove}>Delete client</button>}
        <button type="button" className="oo-btn foot" style={{ padding: "11px 18px" }} onClick={onClose}>Cancel</button>
        <button type="button" className="oo-btn primary foot" style={{ padding: "11px 20px" }} onClick={save} disabled={busy}>
          {editing ? "Save" : "Create client"}
        </button>
      </div>
    </Modal>
  );
}
