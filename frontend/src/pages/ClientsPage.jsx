import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, OPTIONAL_COLUMNS, COMPANIES } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Plus, Settings2, Trash2, ArrowRight, FileSpreadsheet } from "lucide-react";

function ColumnToggles({ value, onChange }) {
  return (
    <div className="grid grid-cols-1 gap-2.5 mt-1">
      {OPTIONAL_COLUMNS.map((col) => (
        <label
          key={col.key}
          className="flex items-center justify-between px-3 py-2 rounded-md border border-slate-800 bg-slate-900/60"
        >
          <span className="text-sm text-slate-200">{col.label}</span>
          <Switch
            checked={!!value[col.key]}
            onCheckedChange={(v) => onChange({ ...value, [col.key]: v })}
            data-testid={`column-toggle-${col.key}`}
          />
        </label>
      ))}
    </div>
  );
}

const DEFAULT_TOGGLES = {
  sob_date: true,
  pol: false,
  final_destination: true,
  hbill_released: false,
  copy_docs_status: false,
  expected_freight_rate: false,
};

export default function ClientsPage() {
  const [clients, setClients] = useState([]);
  const [openAdd, setOpenAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", company: "Patuma", contact_email: "", notes: "", optional_columns: DEFAULT_TOGGLES });

  const load = async () => {
    const { data } = await api.get("/clients");
    setClients(data);
  };
  useEffect(() => { load(); }, []);

  const resetForm = () => setForm({ name: "", company: "Patuma", contact_email: "", notes: "", optional_columns: DEFAULT_TOGGLES });

  const submit = async () => {
    if (!form.name.trim()) { toast.error("Client name is required"); return; }
    try {
      if (editing) {
        await api.patch(`/clients/${editing.id}`, form);
        toast.success("Client updated");
      } else {
        await api.post("/clients", form);
        toast.success("Client added");
      }
      setOpenAdd(false);
      setEditing(null);
      resetForm();
      load();
    } catch (e) {
      toast.error("Failed to save client");
    }
  };

  const startEdit = (c) => {
    setEditing(c);
    setForm({
      name: c.name || "",
      company: c.company || "Patuma",
      contact_email: c.contact_email || "",
      notes: c.notes || "",
      optional_columns: { ...DEFAULT_TOGGLES, ...(c.optional_columns || {}) },
    });
    setOpenAdd(true);
  };

  const remove = async (id) => {
    try {
      await api.delete(`/clients/${id}`);
      toast.success("Client deleted");
      load();
    } catch (e) { toast.error("Delete failed"); }
  };

  return (
    <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1600px] mx-auto">
      <div className="flex items-end justify-between mb-8 gap-4">
        <div>
          <div className="font-mono text-[11px] tracking-widest uppercase text-cyan-400/80 mb-1.5">
            /operations · clients
          </div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-100">Client roster</h1>
          <p className="text-sm text-slate-400 mt-1.5">
            Configure per-client status report columns. Each client gets their own report profile.
          </p>
        </div>

        <Dialog open={openAdd} onOpenChange={(v) => { setOpenAdd(v); if (!v) { setEditing(null); resetForm(); } }}>
          <DialogTrigger asChild>
            <Button className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-medium" data-testid="add-client-button">
              <Plus className="mr-1.5 h-4 w-4" /> New client
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-slate-950 border-slate-800 max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-slate-100">{editing ? "Edit client" : "New client"}</DialogTitle>
              <DialogDescription className="text-slate-400">
                Toggle optional status report columns per client.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label className="text-slate-300 text-xs uppercase tracking-wider font-mono">Company (branding on report)</Label>
                <Select value={form.company} onValueChange={(v) => setForm({ ...form, company: v })}>
                  <SelectTrigger className="mt-1.5 bg-slate-900 border-slate-800" data-testid="client-company-select"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-800">
                    {COMPANIES.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-slate-300 text-xs uppercase tracking-wider font-mono">Client name</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Flange 2000"
                  data-testid="client-name-input"
                  className="mt-1.5 bg-slate-900 border-slate-800"
                />
              </div>
              <div>
                <Label className="text-slate-300 text-xs uppercase tracking-wider font-mono">Contact email</Label>
                <Input
                  value={form.contact_email}
                  onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
                  placeholder="ops@client.com"
                  data-testid="client-email-input"
                  className="mt-1.5 bg-slate-900 border-slate-800"
                />
              </div>
              <div>
                <Label className="text-slate-300 text-xs uppercase tracking-wider font-mono">Notes</Label>
                <Textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Internal notes about this client…"
                  data-testid="client-notes-input"
                  className="mt-1.5 bg-slate-900 border-slate-800"
                />
              </div>
              <div>
                <Label className="text-slate-300 text-xs uppercase tracking-wider font-mono flex items-center gap-2">
                  <Settings2 className="h-3.5 w-3.5" /> Report columns
                </Label>
                <ColumnToggles value={form.optional_columns} onChange={(v) => setForm({ ...form, optional_columns: v })} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpenAdd(false)} className="border-slate-700" data-testid="cancel-client-button">Cancel</Button>
              <Button onClick={submit} className="bg-cyan-500 hover:bg-cyan-400 text-slate-950" data-testid="save-client-button">
                {editing ? "Save changes" : "Create client"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {clients.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-800 p-16 text-center bg-slate-900/30">
          <FileSpreadsheet className="h-8 w-8 mx-auto text-slate-600 mb-3" />
          <h3 className="text-slate-200 font-semibold">No clients yet</h3>
          <p className="text-sm text-slate-500 mt-1">Add your first client to start tracking shipments.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {clients.map((c) => {
            const enabled = OPTIONAL_COLUMNS.filter((col) => c.optional_columns?.[col.key]);
            return (
              <div
                key={c.id}
                className="rounded-lg border border-slate-800 bg-slate-900/40 hover:border-cyan-500/40 transition-colors p-5 group"
                data-testid={`client-card-${c.id}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-[10px] tracking-widest uppercase text-slate-500 mb-1 flex items-center gap-2">
                      <span>/client</span>
                      <span className={`px-1.5 py-0.5 rounded border ${c.company === "Clearfreight" ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30" : "bg-cyan-500/10 text-cyan-300 border-cyan-500/30"}`}>
                        {c.company || "Patuma"}
                      </span>
                    </div>
                    <h3 className="text-lg font-semibold text-slate-100 truncate">{c.name}</h3>
                    {c.contact_email && <div className="text-xs text-slate-500 mt-0.5 truncate">{c.contact_email}</div>}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm" variant="ghost"
                      onClick={() => startEdit(c)}
                      className="h-8 w-8 p-0 text-slate-500 hover:text-cyan-300"
                      data-testid={`edit-client-${c.id}`}
                    >
                      <Settings2 className="h-4 w-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-slate-500 hover:text-rose-400" data-testid={`delete-client-${c.id}`}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="bg-slate-950 border-slate-800">
                        <AlertDialogHeader>
                          <AlertDialogTitle className="text-slate-100">Delete {c.name}?</AlertDialogTitle>
                          <AlertDialogDescription className="text-slate-400">
                            All shipments for this client will also be deleted. This can&apos;t be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="border-slate-700 bg-slate-900">Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => remove(c.id)} className="bg-rose-600 hover:bg-rose-500" data-testid={`confirm-delete-${c.id}`}>
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-1.5">
                  {enabled.length === 0 ? (
                    <span className="text-[11px] text-slate-500 font-mono">Standard columns only</span>
                  ) : enabled.map((col) => (
                    <span key={col.key} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/25">
                      + {col.label}
                    </span>
                  ))}
                </div>

                <Link
                  to={`/clients/${c.id}`}
                  data-testid={`open-client-${c.id}`}
                  className="mt-5 flex items-center justify-between text-sm text-cyan-400 hover:text-cyan-300"
                >
                  <span>Open status report</span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
