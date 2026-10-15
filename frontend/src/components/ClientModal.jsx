import { useState } from "react";
import { api } from "@/lib/api";
import { Modal, Seg, useToast } from "@/lib/ui";

const ENTITIES = [{ value: "Patuma", label: "Patuma" }, { value: "Clearfreight", label: "Clearfreight" }];

/** New client (name, email, entity) or, with `client`, the full client profile. */
export default function ClientModal({ client, onClose, onSaved, onDeleted }) {
  const toast = useToast();
  const editing = !!client;
  const [f, setF] = useState(() => ({
    name: client?.name || "", contact_email: client?.contact_email || "", company: client?.company || "Patuma",
    email_to: client?.email_to || "", email_cc: client?.email_cc || "", email_greeting: client?.email_greeting || "",
    default_pod: client?.default_pod || "", notes: client?.notes || "",
  }));
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async () => {
    const name = f.name.trim();
    if (!name) { toast("Client name is required", { error: true }); return; }
    setBusy(true);
    try {
      const payload = { ...f, name, contact_email: f.contact_email.trim() };
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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label className="oo-field"><span>Status report email · To</span><input className="oo-input" value={f.email_to} onChange={set("email_to")} placeholder="a@client.com, b@client.com" /></label>
            <label className="oo-field"><span>CC</span><input className="oo-input" value={f.email_cc} onChange={set("email_cc")} /></label>
            <label className="oo-field"><span>Greeting name(s)</span><input className="oo-input" value={f.email_greeting} onChange={set("email_greeting")} placeholder="e.g. Roland and Jessica" /></label>
            <label className="oo-field"><span>Default port of discharge</span><input className="oo-input" value={f.default_pod} onChange={set("default_pod")} placeholder="Durban" /></label>
          </div>
          <label className="oo-field"><span>Notes</span><textarea className="oo-input" rows={3} value={f.notes} onChange={set("notes")} /></label>
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
