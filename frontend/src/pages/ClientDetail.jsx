import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, API, CARRIERS, CARRIER_STYLES, OPTIONAL_COLUMNS, QUICK_COMMENTS, STATUS_STYLES, carrierTrackUrl } from "@/lib/api";
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
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  ArrowLeft, Plus, ExternalLink, FileSpreadsheet, FileText, MessageSquarePlus, PackageCheck,
  Ship, Trash2, Copy, Anchor,
} from "lucide-react";

const emptyShipment = {
  supplier: "", order_booking_file: "", file_number: "", cargo_type: "FCL", status: "Booked",
  sob_date: "", vessel_name: "", tracking_doc_number: "", carrier: "MSC",
  pol: "", pod: "", eta: "", planned_etd: "", planned_eta: "",
  second_vessel_name: "", second_vessel_etd: "",
  final_destination: "", comments: "",
  hbill_released: null, expected_freight_rate: "",
};

function StatusBadge({ status }) {
  return (
    <span className={`text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border ${STATUS_STYLES[status] || STATUS_STYLES.Booked}`}>
      {status}
    </span>
  );
}

function CarrierBadge({ carrier }) {
  return (
    <span className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border ${CARRIER_STYLES[carrier] || CARRIER_STYLES.Other}`}>
      {carrier || "Other"}
    </span>
  );
}

function VesselCell({ ship }) {
  const openCarrier = async () => {
    const num = (ship.tracking_doc_number || "").trim();
    if (!num) { toast.info("No tracking number"); return; }
    try { await navigator.clipboard.writeText(num); } catch {}
    toast.success(`${num} copied — paste in ${ship.carrier}'s tracking field`);
    window.open(carrierTrackUrl(ship.carrier, num), "_blank", "noopener,noreferrer");
  };
  return (
    <div className="min-w-[180px] leading-tight">
      <div className="font-semibold text-slate-100 text-sm truncate">
        {ship.vessel_name || <span className="text-slate-600 italic font-normal">no vessel</span>}
        {ship.second_vessel_name && <span className="text-[10px] text-slate-500 font-normal ml-1">(1st)</span>}
      </div>
      {ship.second_vessel_name && (
        <div className="text-xs text-slate-300 mt-0.5">
          {ship.second_vessel_name} <span className="text-[10px] text-slate-500">(2nd)</span>
        </div>
      )}
      {ship.tracking_doc_number && (
        <div className="mt-1 flex items-center gap-1.5">
          <button
            onClick={openCarrier}
            data-testid={`track-trace-link-${ship.id}`}
            title={`Open ${ship.carrier} tracking & copy number`}
            className="font-mono text-[11px] font-semibold px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/10 inline-flex items-center gap-1"
          >
            {ship.tracking_doc_number}
            <ExternalLink className="h-3 w-3" />
          </button>
          <button
            onClick={() => { navigator.clipboard.writeText(ship.tracking_doc_number); toast.success("Copied"); }}
            className="text-slate-500 hover:text-slate-300"
            data-testid={`copy-doc-${ship.id}`}
            title="Copy tracking doc"
          >
            <Copy className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}

function ShipmentForm({ value, onChange, showOptional }) {
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
            {["Booked", "Shipped", "Delayed"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
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
        <Input value={value.vessel_name} onChange={(e) => set({ vessel_name: e.target.value })} className="mt-1 bg-slate-900 border-slate-800" data-testid="ship-vessel-input" placeholder="e.g. MSC Maya" />
      </div>
      <div>
        <Label className="text-xs uppercase tracking-wider font-mono text-slate-400">Planned ETD (1st vessel)</Label>
        <Input type="date" value={value.planned_etd || ""} onChange={(e) => set({ planned_etd: e.target.value })} className="mt-1 bg-slate-900 border-slate-800" data-testid="ship-planned-etd-input" />
      </div>
      <div>
        <Label className="text-xs uppercase tracking-wider font-mono text-slate-400">2nd Vessel (transhipment)</Label>
        <Input value={value.second_vessel_name || ""} onChange={(e) => set({ second_vessel_name: e.target.value })} className="mt-1 bg-slate-900 border-slate-800" data-testid="ship-second-vessel-input" placeholder="Optional" />
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
        <Label className="text-xs uppercase tracking-wider font-mono text-slate-400">ETA (free text for report)</Label>
        <Input value={value.eta || ""} onChange={(e) => set({ eta: e.target.value })} className="mt-1 bg-slate-900 border-slate-800" data-testid="ship-eta-input" placeholder="e.g. 10.10.2026" />
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

  const load = async () => {
    const [c, s] = await Promise.all([
      api.get(`/clients/${clientId}`),
      api.get(`/shipments`, { params: { client_id: clientId } }),
    ]);
    setClient(c.data);
    setShipments(s.data);
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
      setForm({ ...emptyShipment });
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
      planned_etd: s.planned_etd || "", planned_eta: s.planned_eta || "",
      second_vessel_name: s.second_vessel_name || "", second_vessel_etd: s.second_vessel_etd || "",
      final_destination: s.final_destination || "", comments: s.comments || "",
      hbill_released: s.hbill_released ?? null,
      expected_freight_rate: s.expected_freight_rate || "",
    });
    setOpenEdit(true);
  };

  const removeShip = async (id) => {
    try { await api.delete(`/shipments/${id}`); toast.success("Deleted"); load(); }
    catch { toast.error("Delete failed"); }
  };

  const markAnf = async (s) => {
    const nextComment = s.comments && !s.comments.includes("ANF received")
      ? `${s.comments}${s.comments.endsWith(".") ? "" : "."} ANF received. Docs to Ops.`
      : (s.comments || "ANF received. Docs to Ops.");
    await patchShip(s.id, { anf_received: true, comments: nextComment });
    toast.success("Marked ANF received — will drop off next report");
  };

  const insertQuickComment = (s, snippet) => {
    const base = s.comments?.trim();
    const next = base ? `${base}${base.endsWith(".") ? " " : ". "}${snippet}` : snippet;
    patchShip(s.id, { comments: next });
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
          <div className="font-mono text-[11px] tracking-widest uppercase text-cyan-400/80 mt-2">/client · status report</div>
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
              <Button className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-medium" data-testid="add-shipment-button">
                <Plus className="mr-1.5 h-4 w-4" /> New shipment
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-slate-950 border-slate-800 max-w-3xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="text-slate-100">New shipment for {client.name}</DialogTitle>
                <DialogDescription className="text-slate-400">Enter tracking info. Track-trace.com deep link will use the doc number.</DialogDescription>
              </DialogHeader>
              <ShipmentForm value={form} onChange={setForm} showOptional={showOptional} />
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
        <div className="rounded-lg border border-slate-800 bg-slate-950 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full data-table text-sm">
              <thead>
                <tr className="bg-slate-900/90 border-b border-slate-800">
                  {[
                    "Supplier", "Order / Booking file", "File #", "Status",
                    ...(showOptional.sob_date ? ["SOB date"] : []),
                    "Vessel",
                    ...(showOptional.pol ? ["POL"] : []),
                    "POD", "ETA",
                    ...(showOptional.final_destination ? ["Destination"] : []),
                    "Comments",
                    ...(showOptional.hbill_released ? ["H/bill"] : []),
                    ...(showOptional.expected_freight_rate ? ["Freight $"] : []),
                    "Actions",
                  ].map((h) => (
                    <th key={h} className="text-left px-3 py-2.5 text-[10px] font-mono uppercase tracking-widest text-slate-500 border-r border-slate-800 last:border-r-0 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleShipments.map((s, idx) => (
                  <tr
                    key={s.id}
                    className={`border-b border-slate-800 align-top ${s.anf_received ? "bg-purple-500/5" : idx % 2 === 0 ? "bg-slate-950" : "bg-slate-900/40"}`}
                    data-testid={`shipment-row-${s.id}`}
                  >
                    <td className="px-3 py-2.5 text-slate-200 max-w-[180px]">{s.supplier}</td>
                    <td className="px-3 py-2.5 text-slate-300 max-w-[260px] whitespace-pre-wrap text-xs leading-relaxed">{s.order_booking_file}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-300 whitespace-nowrap">{s.file_number}</td>
                    <td className="px-3 py-2.5"><StatusBadge status={s.status} /></td>
                    {showOptional.sob_date && <td className="px-3 py-2.5 font-mono text-xs text-slate-300 whitespace-nowrap">{s.sob_date}</td>}
                    <td className="px-3 py-2.5">
                      <VesselCell ship={s} />
                      <div className="mt-1.5"><CarrierBadge carrier={s.carrier} /></div>
                    </td>
                    {showOptional.pol && <td className="px-3 py-2.5 text-slate-300 whitespace-nowrap">{s.pol}</td>}
                    <td className="px-3 py-2.5 text-slate-300 whitespace-nowrap">{s.pod}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-300 whitespace-nowrap">{s.eta}</td>
                    {showOptional.final_destination && <td className="px-3 py-2.5 text-slate-300 whitespace-nowrap">{s.final_destination}</td>}
                    <td className="px-3 py-2.5 min-w-[280px] max-w-[420px]">
                      <Textarea
                        value={s.comments || ""}
                        onChange={(e) => setShipments((prev) => prev.map((x) => x.id === s.id ? { ...x, comments: e.target.value } : x))}
                        onBlur={(e) => patchShip(s.id, { comments: e.target.value })}
                        rows={2}
                        className="bg-slate-900/60 border-slate-800 text-xs min-h-[52px] resize-y"
                        data-testid={`comments-textarea-${s.id}`}
                      />
                      <Popover>
                        <PopoverTrigger asChild>
                          <button className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-cyan-400 hover:text-cyan-300" data-testid={`quick-comment-${s.id}`}>
                            <MessageSquarePlus className="h-3 w-3" /> Insert preset
                          </button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-72 bg-slate-950 border-slate-800 p-2">
                          <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500 px-2 py-1">Quick comments</div>
                          {QUICK_COMMENTS.map((q) => (
                            <button
                              key={q}
                              onClick={() => insertQuickComment(s, q)}
                              className="block w-full text-left px-2 py-1.5 rounded text-xs text-slate-300 hover:bg-slate-900"
                              data-testid={`preset-${s.id}-${q.slice(0, 10).replace(/\s+/g, "-")}`}
                            >
                              {q}
                            </button>
                          ))}
                        </PopoverContent>
                      </Popover>
                    </td>
                    {showOptional.hbill_released && (
                      <td className="px-3 py-2.5">
                        {s.hbill_released === true ? <span className="text-emerald-400 text-xs">Yes</span> :
                         s.hbill_released === false ? <span className="text-rose-400 text-xs">No</span> :
                         <span className="text-slate-500 text-xs">—</span>}
                      </td>
                    )}
                    {showOptional.expected_freight_rate && <td className="px-3 py-2.5 font-mono text-xs text-slate-300 whitespace-nowrap">{s.expected_freight_rate}</td>}
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1">
                        {!s.anf_received ? (
                          <Button size="sm" variant="ghost" onClick={() => markAnf(s)} className="h-7 px-2 text-purple-300 hover:bg-purple-500/10" data-testid={`mark-anf-${s.id}`} title="Mark ANF received. Docs to Ops.">
                            <PackageCheck className="h-3.5 w-3.5" />
                          </Button>
                        ) : (
                          <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/40">ANF</span>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => startEdit(s)} className="h-7 px-2 text-slate-400 hover:text-slate-200" data-testid={`edit-shipment-${s.id}`}>Edit</Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-slate-500 hover:text-rose-400" data-testid={`delete-shipment-${s.id}`}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
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
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Edit dialog */}
      <Dialog open={openEdit} onOpenChange={setOpenEdit}>
        <DialogContent className="bg-slate-950 border-slate-800 max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-slate-100">Edit shipment</DialogTitle>
          </DialogHeader>
          <ShipmentForm value={form} onChange={setForm} showOptional={showOptional} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenEdit(false)} className="border-slate-700">Cancel</Button>
            <Button onClick={submitEdit} className="bg-cyan-500 hover:bg-cyan-400 text-slate-950" data-testid="save-edit-shipment">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
