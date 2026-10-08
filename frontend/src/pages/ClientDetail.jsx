import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, API, CARRIERS, CARRIER_STYLES, OPTIONAL_COLUMNS, QUICK_COMMENTS, STATUS_STYLES, carrierTrackUrl, clipboardTrackingNumber } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  ArrowLeft, Plus, ExternalLink, FileSpreadsheet, FileText, MessageSquarePlus, PackageCheck,
  Ship, Trash2, Copy, Anchor, CalendarClock, Sailboat, AlertTriangle, MoreVertical, Pencil,
} from "lucide-react";

const emptyShipment = {
  supplier: "", order_booking_file: "", file_number: "", cargo_type: "FCL", status: "Booked",
  sob_date: "", vessel_name: "", tracking_doc_number: "", carrier: "MSC",
  pol: "", pod: "", eta: "", planned_etd: "", etd_tba: false, planned_eta: "",
  second_vessel_name: "", second_vessel_etd: "",
  final_destination: "", comments: "",
  hbill_released: null, expected_freight_rate: "", copy_docs_status: "",
};

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isEtdOverdue(s) {
  return !!s.planned_etd && !s.sob_date && !s.etd_tba && s.planned_etd < todayISO();
}

const STATUS_STYLES_LOCAL = {
  Planned: "bg-slate-500/10 text-slate-300 border-slate-500/30",
  Booked: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  Shipped: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  Delayed: "bg-rose-500/10 text-rose-300 border-rose-500/30",
};

function StatusBadge({ status }) {
  return (
    <span className={`text-xs font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border ${STATUS_STYLES_LOCAL[status] || STATUS_STYLES_LOCAL.Booked}`}>
      {status}
    </span>
  );
}

function Field({ label, children, className = "" }) {
  if (children === null || children === undefined || children === "") return null;
  return (
    <div className={`min-w-[88px] ${className}`}>
      <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">{label}</div>
      <div className="text-base text-slate-200 mt-0.5 break-words leading-snug">{children}</div>
    </div>
  );
}

function CarrierBadge({ carrier }) {
  return (
    <span className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border ${CARRIER_STYLES[carrier] || CARRIER_STYLES.Other}`}>
      {carrier || "Other"}
    </span>
  );
}

function toISO(d) {
  if (!d) return "";
  const dt = new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function DatePickerButton({ label, icon: Icon, tone, onPick, testid, disabled }) {
  const [open, setOpen] = useState(false);
  const tones = {
    rose: "text-rose-300 hover:bg-rose-500/10 border-rose-500/30",
    emerald: "text-emerald-300 hover:bg-emerald-500/10 border-emerald-500/30",
    amber: "text-amber-300 hover:bg-amber-500/10 border-amber-500/30",
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          disabled={disabled}
          data-testid={testid}
          title={label}
          className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded border text-xs font-mono uppercase tracking-wider transition-colors ${tones[tone]} ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto bg-slate-950 border-slate-800 p-0">
        <div className="px-3 py-2 border-b border-slate-800 text-[10px] font-mono uppercase tracking-widest text-slate-500">
          Pick date for: {label}
        </div>
        <Calendar
          mode="single"
          onSelect={(d) => {
            if (!d) return;
            setOpen(false);
            onPick(toISO(d));
          }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}

function VesselInput({ value, onChange, vessels, placeholder, testid }) {
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    const q = (value || "").trim().toLowerCase();
    const pool = q ? vessels.filter((v) => v.toLowerCase().includes(q) && v.toLowerCase() !== q) : vessels;
    return pool.slice(0, 8);
  }, [value, vessels]);
  return (
    <Popover open={open && matches.length > 0} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Input
          value={value || ""}
          onChange={(e) => { onChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          autoComplete="off"
          className="mt-1 bg-slate-900 border-slate-800"
          data-testid={testid}
          placeholder={placeholder}
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="w-[--radix-popover-trigger-width] p-1 bg-slate-950 border-slate-800"
      >
        {matches.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => { onChange(v); setOpen(false); }}
            className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-cyan-500/10 text-slate-200 truncate"
          >
            {v}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function VesselCell({ ship }) {
  const openCarrier = async () => {
    const num = (ship.tracking_doc_number || "").trim();
    if (!num) { toast.info("No tracking number"); return; }
    const copyNum = clipboardTrackingNumber(ship.carrier, num);
    try { await navigator.clipboard.writeText(copyNum); } catch {}
    toast.success(`${copyNum} copied — paste in ${ship.carrier}'s tracking field`);
    window.open(carrierTrackUrl(ship.carrier, num), "_blank", "noopener,noreferrer");
  };
  return (
    <div className="leading-tight">
      <div className="font-semibold text-slate-100 text-base truncate">
        {ship.vessel_name || <span className="text-slate-600 italic font-normal">no vessel</span>}
      </div>
      {ship.second_vessel_name && (
        <div className="text-sm text-slate-300 truncate">{ship.second_vessel_name}</div>
      )}
      {ship.tracking_doc_number && (
        <div className="mt-1 flex items-center gap-1">
          <button
            onClick={openCarrier}
            data-testid={`track-trace-link-${ship.id}`}
            title={`Open ${ship.carrier} tracking & copy number`}
            className="font-mono text-xs font-semibold px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/10 inline-flex items-center gap-1 truncate max-w-[140px]"
          >
            <span className="truncate">{ship.tracking_doc_number}</span>
            <ExternalLink className="h-3 w-3 shrink-0" />
          </button>
        </div>
      )}
    </div>
  );
}

function ShipmentForm({ value, onChange, showOptional, vessels }) {
  const set = (patch) => onChange({ ...value, ...patch });
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <Label className="text-xs uppercase tracking-wider font-mono text-slate-400">Supplier</Label>
        <Input value={value.supplier} onChange={(e) => set({ supplier: e.target.value })} className="mt-1 bg-slate-900 border-slate-800" data-testid="ship-supplier-input" />
      </div>
      <div>
        <Label className="text-xs uppercase tracking-wider font-mono text-slate-400">File #</Label>
        <Input value={value.file_number} onChange={(e) => set({ file_number: e.target.value })} className="mt-1 bg-slate-900 border-slate-800" data-testid="ship-filenum-input" placeholder="e.g. 158064" />
      </div>
      <div className="md:col-span-2">
        <Label className="text-xs uppercase tracking-wider font-mono text-slate-400">Order / Booking file</Label>
        <Textarea rows={2} value={value.order_booking_file} onChange={(e) => set({ order_booking_file: e.target.value })} className="mt-1 bg-slate-900 border-slate-800" data-testid="ship-order-input" placeholder="e.g. ZN26148-1, 2x20' FCLs, 50 Plts, 50865.99 Kgs" />
      </div>
      <div>
        <Label className="text-xs uppercase tracking-wider font-mono text-slate-400">Cargo type</Label>
        <Select value={value.cargo_type || "FCL"} onValueChange={(v) => set({ cargo_type: v })}>
          <SelectTrigger className="mt-1 bg-slate-900 border-slate-800" data-testid="ship-cargo-type-select"><SelectValue /></SelectTrigger>
          <SelectContent className="bg-slate-900 border-slate-800">
            <SelectItem value="FCL">FCL (Full Container)</SelectItem>
            <SelectItem value="LCL">LCL (Groupage)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs uppercase tracking-wider font-mono text-slate-400">Status</Label>
        <Select value={value.status} onValueChange={(v) => set({ status: v })}>
          <SelectTrigger className="mt-1 bg-slate-900 border-slate-800" data-testid="ship-status-select"><SelectValue /></SelectTrigger>
          <SelectContent className="bg-slate-900 border-slate-800">
            {["Planned", "Booked", "Shipped"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs uppercase tracking-wider font-mono text-slate-400">Carrier</Label>
        <Select value={value.carrier} onValueChange={(v) => set({ carrier: v })}>
          <SelectTrigger className="mt-1 bg-slate-900 border-slate-800" data-testid="ship-carrier-select"><SelectValue /></SelectTrigger>
          <SelectContent className="bg-slate-900 border-slate-800">
            {CARRIERS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs uppercase tracking-wider font-mono text-slate-400">Vessel name (1st)</Label>
        <VesselInput value={value.vessel_name} onChange={(v) => set({ vessel_name: v })} vessels={vessels} testid="ship-vessel-input" placeholder="e.g. MSC Maya" />
      </div>
      <div>
        <div className="flex items-center justify-between">
          <Label className="text-xs uppercase tracking-wider font-mono text-slate-400">Planned ETD (1st vessel)</Label>
          <button
            type="button"
            onClick={() => set({ etd_tba: !value.etd_tba, planned_etd: value.etd_tba ? value.planned_etd : "" })}
            data-testid="ship-etd-tba-toggle"
            className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border ${value.etd_tba ? "bg-amber-500/15 border-amber-500/40 text-amber-200" : "border-slate-800 text-slate-500 hover:text-slate-300"}`}
          >
            ETD TBA
          </button>
        </div>
        {value.etd_tba ? (
          <div className="mt-1 h-9 flex items-center px-3 rounded-md border border-amber-500/30 bg-amber-500/5 text-amber-200 text-sm">TBA — no date yet</div>
        ) : (
          <Input type="date" value={value.planned_etd || ""} onChange={(e) => set({ planned_etd: e.target.value })} className="mt-1 bg-slate-900 border-slate-800" data-testid="ship-planned-etd-input" />
        )}
      </div>
      <div>
        <Label className="text-xs uppercase tracking-wider font-mono text-slate-400">2nd Vessel (transhipment)</Label>
        <VesselInput value={value.second_vessel_name || ""} onChange={(v) => set({ second_vessel_name: v })} vessels={vessels} testid="ship-second-vessel-input" placeholder="Optional" />
      </div>
      <div>
        <Label className="text-xs uppercase tracking-wider font-mono text-slate-400">Planned ETD (2nd vessel)</Label>
        <Input type="date" value={value.second_vessel_etd || ""} onChange={(e) => set({ second_vessel_etd: e.target.value })} className="mt-1 bg-slate-900 border-slate-800" data-testid="ship-second-etd-input" />
      </div>
      <div>
        <Label className="text-xs uppercase tracking-wider font-mono text-slate-400">Tracking doc # (B/L, Container, Booking)</Label>
        <Input value={value.tracking_doc_number} onChange={(e) => set({ tracking_doc_number: e.target.value })} className="mt-1 bg-slate-900 border-slate-800 font-mono" data-testid="ship-tracking-input" placeholder="MEDU12345678" />
      </div>
      <div>
        <Label className="text-xs uppercase tracking-wider font-mono text-slate-400">Planned ETA</Label>
        <Input type="date" value={value.planned_eta || ""} onChange={(e) => set({ planned_eta: e.target.value })} className="mt-1 bg-slate-900 border-slate-800" data-testid="ship-planned-eta-input" />
      </div>
      {showOptional.sob_date && (
        <div>
          <Label className="text-xs uppercase tracking-wider font-mono text-slate-400">SOB date / RCG</Label>
          <Input value={value.sob_date || ""} onChange={(e) => set({ sob_date: e.target.value })} className="mt-1 bg-slate-900 border-slate-800" data-testid="ship-sob-input" placeholder="e.g. 19.08.2026" />
        </div>
      )}
      {showOptional.pol && (
        <div>
          <Label className="text-xs uppercase tracking-wider font-mono text-slate-400">POL (Port of loading)</Label>
          <Input value={value.pol || ""} onChange={(e) => set({ pol: e.target.value })} className="mt-1 bg-slate-900 border-slate-800" data-testid="ship-pol-input" placeholder="e.g. Shanghai" />
        </div>
      )}
      <div>
        <Label className="text-xs uppercase tracking-wider font-mono text-slate-400">POD (Port of discharge)</Label>
        <Input value={value.pod} onChange={(e) => set({ pod: e.target.value })} className="mt-1 bg-slate-900 border-slate-800" data-testid="ship-pod-input" placeholder="e.g. Durban" />
      </div>
      <div>
        <Label className="text-xs uppercase tracking-wider font-mono text-slate-400">ETA</Label>
        <Input type="date" value={value.eta || ""} onChange={(e) => set({ eta: e.target.value })} className="mt-1 bg-slate-900 border-slate-800" data-testid="ship-eta-input" />
      </div>
      {showOptional.final_destination && (
        <div>
          <Label className="text-xs uppercase tracking-wider font-mono text-slate-400">Final destination</Label>
          <Input value={value.final_destination || ""} onChange={(e) => set({ final_destination: e.target.value })} className="mt-1 bg-slate-900 border-slate-800" data-testid="ship-dest-input" placeholder="Optional" />
        </div>
      )}
      {showOptional.expected_freight_rate && (
        <div>
          <Label className="text-xs uppercase tracking-wider font-mono text-slate-400">Expected freight rate</Label>
          <Input value={value.expected_freight_rate || ""} onChange={(e) => set({ expected_freight_rate: e.target.value })} className="mt-1 bg-slate-900 border-slate-800" data-testid="ship-rate-input" placeholder="$3500/20'" />
        </div>
      )}
      {showOptional.copy_docs_status && (
        <div>
          <Label className="text-xs uppercase tracking-wider font-mono text-slate-400">Copy docs status</Label>
          <Input value={value.copy_docs_status || ""} onChange={(e) => set({ copy_docs_status: e.target.value })} className="mt-1 bg-slate-900 border-slate-800" data-testid="ship-copy-docs-input" placeholder="e.g. Copies sent 05.09." />
        </div>
      )}
      {showOptional.hbill_released && (
        <div>
          <Label className="text-xs uppercase tracking-wider font-mono text-slate-400">H/bill released by supplier</Label>
          <Select
            value={value.hbill_released === null || value.hbill_released === undefined ? "unknown" : value.hbill_released ? "yes" : "no"}
            onValueChange={(v) => set({ hbill_released: v === "unknown" ? null : v === "yes" })}
          >
            <SelectTrigger className="mt-1 bg-slate-900 border-slate-800" data-testid="ship-hbill-select"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-800">
              <SelectItem value="unknown">Unknown</SelectItem>
              <SelectItem value="yes">Yes</SelectItem>
              <SelectItem value="no">No</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="md:col-span-2">
        <Label className="text-xs uppercase tracking-wider font-mono text-slate-400">Comments</Label>
        <Textarea rows={3} value={value.comments} onChange={(e) => set({ comments: e.target.value })} className="mt-1 bg-slate-900 border-slate-800" data-testid="ship-comments-input" placeholder="e.g. Awaiting confirmation of departure." />
      </div>
    </div>
  );
}

export default function ClientDetail() {
  const { clientId } = useParams();
  const [client, setClient] = useState(null);
  const [shipments, setShipments] = useState([]);
  const [openAdd, setOpenAdd] = useState(false);
  const [openEdit, setOpenEdit] = useState(false);
  const [editingShip, setEditingShip] = useState(null);
  const [form, setForm] = useState({ ...emptyShipment });
  const [showArchived, setShowArchived] = useState(false);
  const [vessels, setVessels] = useState([]);

  const load = async () => {
    const [c, s, v] = await Promise.all([
      api.get(`/clients/${clientId}`),
      api.get(`/shipments`, { params: { client_id: clientId } }),
      api.get(`/vessels`),
    ]);
    setClient(c.data);
    setShipments(s.data);
    setVessels(v.data.vessels || []);
  };

  useEffect(() => { load(); }, [clientId]);

  const showOptional = client?.optional_columns || {};
  const activeShipments = useMemo(() => shipments.filter((s) => !s.anf_received), [shipments]);
  const archivedShipments = useMemo(() => shipments.filter((s) => s.anf_received), [shipments]);
  const visibleShipments = showArchived ? shipments : activeShipments;

  const submitAdd = async () => {
    if (!form.vessel_name && !form.tracking_doc_number && !form.supplier) {
      toast.error("Add at least supplier or vessel/tracking info");
      return;
    }
    try {
      await api.post("/shipments", { ...form, client_id: clientId });
      toast.success("Shipment added");
      setOpenAdd(false);
      setForm({ ...emptyShipment, pod: client?.default_pod || "" });
      load();
    } catch { toast.error("Failed to save"); }
  };

  const submitEdit = async () => {
    try {
      await api.patch(`/shipments/${editingShip.id}`, form);
      toast.success("Updated");
      setOpenEdit(false);
      setEditingShip(null);
      load();
    } catch { toast.error("Update failed"); }
  };

  const patchShip = async (id, patch) => {
    try {
      await api.patch(`/shipments/${id}`, patch);
      load();
    } catch { toast.error("Update failed"); }
  };

  const startEdit = (s) => {
    setEditingShip(s);
    setForm({
      supplier: s.supplier || "", order_booking_file: s.order_booking_file || "",
      file_number: s.file_number || "", cargo_type: s.cargo_type || "FCL",
      status: s.status || "Booked",
      sob_date: s.sob_date || "", vessel_name: s.vessel_name || "",
      tracking_doc_number: s.tracking_doc_number || "", carrier: s.carrier || "Other",
      pol: s.pol || "", pod: s.pod || "", eta: s.eta || "",
      planned_etd: s.planned_etd || "", etd_tba: !!s.etd_tba, planned_eta: s.planned_eta || "",
      second_vessel_name: s.second_vessel_name || "", second_vessel_etd: s.second_vessel_etd || "",
      final_destination: s.final_destination || "", comments: s.comments || "",
      hbill_released: s.hbill_released ?? null,
      expected_freight_rate: s.expected_freight_rate || "",
      copy_docs_status: s.copy_docs_status || "",
    });
    setOpenEdit(true);
  };

  const removeShip = async (id) => {
    try { await api.delete(`/shipments/${id}`); toast.success("Deleted"); load(); }
    catch { toast.error("Delete failed"); }
  };

  const markAnf = async (s) => {
    await patchShip(s.id, { anf_received: true });
    toast.success("Marked ANF received — will drop off next report");
  };

  const setVesselSailed = async (s, vesselNum, isoDate) => {
    try {
      await api.post(`/shipments/${s.id}/vessel-status`, { vessel: vesselNum, sailed: true, date: isoDate });
      toast.success(`${vesselNum === 1 ? "1st" : "2nd"} vessel marked as sailed`);
      load();
    } catch { toast.error("Failed to mark sailed"); }
  };

  const setVesselUnsailed = async (s, vesselNum) => {
    try {
      await api.post(`/shipments/${s.id}/vessel-status`, { vessel: vesselNum, sailed: false });
      toast.success(`${vesselNum === 1 ? "1st" : "2nd"} vessel unmarked`);
      load();
    } catch { toast.error("Failed to unmark"); }
  };

  const insertQuickComment = async (s, snippet) => {
    try {
      await api.post(`/shipments/${s.id}/append-comment`, { snippet });
      load();
    } catch { toast.error("Failed to append comment"); }
  };

  const downloadReport = async (fmt) => {
    try {
      const res = await fetch(`${API}/reports/${clientId}/${fmt}`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `status-report-${client?.name?.replace(/\s+/g, "_") || "client"}.${fmt}`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast.success(`${fmt.toUpperCase()} downloaded`);
    } catch (e) { toast.error("Export failed"); }
  };

  const optionalToggles = OPTIONAL_COLUMNS;
  const saveClientToggles = async (patch) => {
    const next = { ...client.optional_columns, ...patch };
    setClient({ ...client, optional_columns: next });
    try { await api.patch(`/clients/${clientId}`, { optional_columns: next }); toast.success("Columns updated"); }
    catch { toast.error("Failed to update columns"); }
  };

  if (!client) return <div className="px-8 py-12 text-slate-500 text-sm">Loading client…</div>;

  return (
    <div className="px-4 md:px-6 py-6 md:py-8 max-w-[1800px] mx-auto">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
        <div className="min-w-0">
          <Link to="/clients" className="inline-flex items-center gap-1 text-xs font-mono text-slate-500 hover:text-slate-300" data-testid="back-clients">
            <ArrowLeft className="h-3 w-3" /> Back to clients
          </Link>
          <div className="text-xs font-semibold uppercase tracking-wide text-cyan-400/80 mt-2 flex items-center gap-2">
            <span>Status report</span>
            <span className={`px-1.5 py-0.5 rounded border font-mono normal-case ${client.company === "Clearfreight" ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30" : "bg-cyan-500/10 text-cyan-300 border-cyan-500/30"}`}>
              {client.company || "Patuma"}
            </span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-100 truncate flex items-center gap-3">
            <Anchor className="h-6 w-6 text-cyan-400" /> {client.name}
          </h1>
          <p className="text-sm text-slate-400 mt-1.5">
            {activeShipments.length} active · {archivedShipments.length} archived (ANF received) · Report ready to export.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="border-slate-700 hover:bg-slate-800" data-testid="column-settings-button">
                <FileSpreadsheet className="mr-1.5 h-4 w-4" /> Report columns
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 bg-slate-950 border-slate-800">
              <div className="text-xs font-mono uppercase tracking-wider text-slate-500 mb-3">Optional columns for {client.name}</div>
              <div className="space-y-2">
                {optionalToggles.map((col) => (
                  <label key={col.key} className="flex items-center justify-between px-2.5 py-2 rounded border border-slate-800 bg-slate-900/60">
                    <span className="text-sm text-slate-200">{col.label}</span>
                    <Switch
                      checked={!!client.optional_columns?.[col.key]}
                      onCheckedChange={(v) => saveClientToggles({ [col.key]: v })}
                      data-testid={`toggle-${col.key}`}
                    />
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <Button variant="outline" onClick={() => downloadReport("xlsx")} className="border-slate-700 hover:bg-slate-800" data-testid="export-excel-button">
            <FileSpreadsheet className="mr-1.5 h-4 w-4" /> Excel
          </Button>
          <Button variant="outline" onClick={() => downloadReport("pdf")} className="border-slate-700 hover:bg-slate-800" data-testid="export-pdf-button">
            <FileText className="mr-1.5 h-4 w-4" /> PDF
          </Button>
          <Dialog open={openAdd} onOpenChange={setOpenAdd}>
            <DialogTrigger asChild>
              <Button
                onClick={() => setForm({ ...emptyShipment, pod: client?.default_pod || "" })}
                className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-medium"
                data-testid="add-shipment-button"
              >
                <Plus className="mr-1.5 h-4 w-4" /> New shipment
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-slate-950 border-slate-800 max-w-3xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="text-slate-100">New shipment for {client.name}</DialogTitle>
                <DialogDescription className="text-slate-400">Enter tracking info. Track-trace.com deep link will use the doc number.</DialogDescription>
              </DialogHeader>
              <ShipmentForm value={form} onChange={setForm} showOptional={showOptional} vessels={vessels} />
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpenAdd(false)} className="border-slate-700" data-testid="cancel-shipment-button">Cancel</Button>
                <Button onClick={submitAdd} className="bg-cyan-500 hover:bg-cyan-400 text-slate-950" data-testid="save-shipment-button">Add shipment</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <label className="flex items-center gap-2 text-xs text-slate-400">
          <Switch checked={showArchived} onCheckedChange={setShowArchived} data-testid="show-archived-toggle" />
          <span className="font-mono uppercase tracking-wider">Show ANF-archived</span>
        </label>
      </div>

      {visibleShipments.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-800 p-16 text-center bg-slate-900/30" data-testid="empty-shipments">
          <Ship className="h-8 w-8 mx-auto text-slate-600 mb-3" />
          <h3 className="text-slate-200 font-semibold">No shipments yet</h3>
          <p className="text-sm text-slate-500 mt-1">Add the first shipment for {client.name}.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {visibleShipments.map((s) => {
            const overdue = isEtdOverdue(s);
            return (
              <div
                key={s.id}
                className={`rounded-lg border p-3 transition-colors ${
                  overdue ? "border-amber-500/40 bg-amber-500/5" :
                  s.anf_received ? "border-purple-500/20 bg-purple-500/5" :
                  "border-slate-800 bg-slate-900/40"
                }`}
                data-testid={`shipment-row-${s.id}`}
              >
                {overdue && (
                  <div className="mb-3 flex flex-wrap items-center gap-2.5 px-3 py-2 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-200 text-sm" data-testid={`etd-overdue-${s.id}`}>
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span className="font-medium">Planned ETD {s.planned_etd} has passed — did it sail?</span>
                    <div className="ml-auto flex flex-wrap gap-1.5">
                      <DatePickerButton label="Yes, sailed" icon={Sailboat} tone="emerald" onPick={(iso) => setVesselSailed(s, 1, iso)} testid={`mark-first-sailed-${s.id}`} />
                      <DatePickerButton label="New ETD" icon={CalendarClock} tone="amber" onPick={(iso) => patchShip(s.id, { planned_etd: iso })} testid={`new-etd-${s.id}`} />
                      <button
                        onClick={() => patchShip(s.id, { etd_tba: true })}
                        data-testid={`mark-etd-tba-${s.id}`}
                        className="inline-flex items-center h-8 px-2.5 rounded border text-xs font-mono uppercase tracking-wider text-amber-300 hover:bg-amber-500/10 border-amber-500/30"
                      >
                        Mark TBA
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-slate-100 text-lg truncate" data-testid={`shipment-supplier-${s.id}`}>
                      {s.supplier || "Unnamed supplier"}
                    </h3>
                    <StatusBadge status={s.status} />
                    {s.anf_received && (
                      <span className="text-xs font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/40">ANF received</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {!overdue && (
                      s.sob_date ? (
                        <button
                          onClick={() => setVesselUnsailed(s, 1)}
                          data-testid={`unmark-first-sailed-${s.id}`}
                          title="Unmark 1st vessel as sailed"
                          className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded border text-xs font-mono uppercase tracking-wider bg-emerald-500/20 border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/30"
                        >
                          <Sailboat className="h-3.5 w-3.5" /> 1st SOB
                        </button>
                      ) : (
                        <DatePickerButton
                          label="1st Sailed" icon={Sailboat} tone="emerald"
                          onPick={(iso) => setVesselSailed(s, 1, iso)}
                          testid={`mark-first-sailed-${s.id}`}
                          disabled={s.anf_received}
                        />
                      )
                    )}
                    {s.etd_tba && !overdue && !s.sob_date && !s.anf_received && (
                      <DatePickerButton
                        label="Set ETD" icon={CalendarClock} tone="amber"
                        onPick={(iso) => patchShip(s.id, { planned_etd: iso })}
                        testid={`set-etd-from-tba-${s.id}`}
                      />
                    )}
                    {s.second_vessel_name ? (
                      s.second_vessel_sob_date ? (
                        <button
                          onClick={() => setVesselUnsailed(s, 2)}
                          data-testid={`unmark-second-sailed-${s.id}`}
                          title="Unmark 2nd vessel as sailed"
                          className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded border text-xs font-mono uppercase tracking-wider bg-emerald-500/20 border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/30"
                        >
                          <Sailboat className="h-3.5 w-3.5" /> 2nd SOB
                        </button>
                      ) : (
                        <DatePickerButton
                          label="2nd Sailed" icon={Sailboat} tone="emerald"
                          onPick={(iso) => setVesselSailed(s, 2, iso)}
                          testid={`mark-second-sailed-${s.id}`}
                          disabled={s.anf_received}
                        />
                      )
                    ) : null}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-slate-400 hover:text-slate-200" data-testid={`shipment-menu-${s.id}`}>
                          <MoreVertical className="h-5 w-5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="bg-slate-950 border-slate-800 w-48">
                        <DropdownMenuItem onClick={() => startEdit(s)} data-testid={`edit-shipment-${s.id}`} className="text-sm text-slate-200 focus:bg-slate-800 focus:text-slate-100 cursor-pointer">
                          <Pencil className="h-4 w-4 mr-2" /> Edit
                        </DropdownMenuItem>
                        {!s.anf_received && (
                          <DropdownMenuItem onClick={() => markAnf(s)} data-testid={`mark-anf-${s.id}`} className="text-sm text-purple-300 focus:bg-purple-500/10 focus:text-purple-200 cursor-pointer">
                            <PackageCheck className="h-4 w-4 mr-2" /> Mark ANF received
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator className="bg-slate-800" />
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <DropdownMenuItem onSelect={(e) => e.preventDefault()} data-testid={`delete-shipment-${s.id}`} className="text-sm text-rose-400 focus:bg-rose-500/10 focus:text-rose-300 cursor-pointer">
                              <Trash2 className="h-4 w-4 mr-2" /> Delete
                            </DropdownMenuItem>
                          </AlertDialogTrigger>
                          <AlertDialogContent className="bg-slate-950 border-slate-800">
                            <AlertDialogHeader>
                              <AlertDialogTitle className="text-slate-100">Delete shipment?</AlertDialogTitle>
                              <AlertDialogDescription className="text-slate-400">This can&apos;t be undone.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel className="border-slate-700 bg-slate-900">Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => removeShip(s.id)} className="bg-rose-600 hover:bg-rose-500" data-testid={`confirm-delete-ship-${s.id}`}>Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                {s.order_booking_file && (
                  <div className="mt-1 text-sm text-slate-400 whitespace-pre-wrap leading-snug">{s.order_booking_file}</div>
                )}

                <div className="mt-2.5 flex flex-wrap gap-x-7 gap-y-2">
                  <Field label="File #">{s.file_number}</Field>
                  <Field label="Vessel"><VesselCell ship={s} /></Field>
                  {showOptional.sob_date && <Field label="SOB / RCG">{s.sob_date}</Field>}
                  {showOptional.pol && <Field label="POL">{s.pol}</Field>}
                  <Field label="POD">{s.pod}</Field>
                  <Field label="DBN Port ETA">{s.eta}</Field>
                  {showOptional.final_destination && <Field label="Final destination">{s.final_destination}</Field>}
                  {showOptional.expected_freight_rate && <Field label="Rate">{s.expected_freight_rate}</Field>}
                  {showOptional.hbill_released && (
                    <Field label="H/bill released">
                      {s.hbill_released === true ? <span className="text-emerald-400">Yes</span> :
                       s.hbill_released === false ? <span className="text-rose-400">No</span> :
                       <span className="text-slate-500">—</span>}
                    </Field>
                  )}
                  {showOptional.copy_docs_status && (
                    <div className="min-w-[140px]">
                      <div className="text-[9px] font-mono uppercase tracking-widest text-slate-500 mb-0.5">Copy docs</div>
                      <Input
                        value={s.copy_docs_status || ""}
                        onChange={(e) => setShipments((prev) => prev.map((x) => x.id === s.id ? { ...x, copy_docs_status: e.target.value } : x))}
                        onBlur={(e) => patchShip(s.id, { copy_docs_status: e.target.value })}
                        className="bg-slate-900/60 border-slate-800 text-sm h-7 w-full"
                        placeholder="—"
                        data-testid={`copy-docs-${s.id}`}
                      />
                    </div>
                  )}
                </div>

                <div className="mt-2.5 text-base text-slate-300 bg-slate-950/50 border border-slate-800/80 rounded-md px-3 py-2 leading-snug" data-testid={`comments-view-${s.id}`}>
                  {s.comments || <span className="text-slate-600 italic">Auto-generated from vessel status</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Edit dialog */}
      <Dialog open={openEdit} onOpenChange={setOpenEdit}>
        <DialogContent className="bg-slate-950 border-slate-800 max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-slate-100">Edit shipment</DialogTitle>
          </DialogHeader>
          <ShipmentForm value={form} onChange={setForm} showOptional={showOptional} vessels={vessels} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenEdit(false)} className="border-slate-700">Cancel</Button>
            <Button onClick={submitEdit} className="bg-cyan-500 hover:bg-cyan-400 text-slate-950" data-testid="save-edit-shipment">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
