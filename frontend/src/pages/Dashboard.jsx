import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { CARRIER_STYLES } from "@/lib/api";
import { Ship, Users, AlertTriangle, PackageCheck, ArrowRight, BellRing, Check, Search, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

const SHIP_STATUS_STYLES = {
  Planned: "bg-slate-500/10 text-slate-300 border-slate-500/30",
  Booked: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  Shipped: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
};

const SHIP_SORT_OPTIONS = [
  { value: "arrival_asc", label: "Arriving soonest" },
  { value: "departure_asc", label: "Departing soonest" },
  { value: "arrival_desc", label: "Arriving latest" },
  { value: "departure_desc", label: "Departing latest" },
  { value: "client_az", label: "Client (A–Z)" },
  { value: "client_za", label: "Client (Z–A)" },
];

function daysUntil(iso) {
  if (!iso) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return Math.round((d - today) / 86400000);
}

function dayLabel(days) {
  if (days === null || days === undefined) return "—";
  if (days < 0) return `${Math.abs(days)}d ago`;
  if (days === 0) return "today";
  return `in ${days}d`;
}

function compareDays(a, b, dir) {
  const infA = a === null || a === undefined;
  const infB = b === null || b === undefined;
  if (infA && infB) return 0;
  if (infA) return 1;
  if (infB) return -1;
  return dir === "asc" ? a - b : b - a;
}

function Stat({ label, value, icon: Icon, tone = "cyan", testid }) {
  const tones = {
    cyan: "bg-cyan-500/10 border-cyan-500/25 text-cyan-300",
    amber: "bg-amber-500/10 border-amber-500/25 text-amber-300",
    rose: "bg-rose-500/10 border-rose-500/25 text-rose-300",
    emerald: "bg-emerald-500/10 border-emerald-500/25 text-emerald-300",
    slate: "bg-slate-800/40 border-slate-700 text-slate-300",
  };
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-5" data-testid={testid}>
      <div className="flex items-start justify-between">
        <div>
          <div className="font-mono text-[10px] tracking-widest uppercase text-slate-500">{label}</div>
          <div className="mt-2 text-3xl font-semibold text-slate-100 tabular-nums">{value}</div>
        </div>
        <div className={`h-9 w-9 rounded-md border flex items-center justify-center ${tones[tone]}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [clients, setClients] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [shipments, setShipments] = useState([]);
  const [shipSearch, setShipSearch] = useState("");
  const [shipCompany, setShipCompany] = useState("all");
  const [shipStatus, setShipStatus] = useState("all");
  const [shipSort, setShipSort] = useState("arrival_asc");

  useEffect(() => {
    (async () => {
      try {
        const [s, c, r, sh] = await Promise.all([
          api.get("/dashboard/stats"),
          api.get("/clients"),
          api.get("/dashboard/reminders"),
          api.get("/shipments", { params: { include_anf: false } }),
        ]);
        setStats(s.data);
        setClients(c.data);
        setReminders(r.data?.reminders || []);
        setShipments(sh.data || []);
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  const maxCarrier = Math.max(1, ...(stats?.carriers?.map((c) => c.count) || [1]));

  const clientLookup = useMemo(() => {
    const m = {};
    clients.forEach((c) => { m[c.id] = c; });
    return m;
  }, [clients]);

  const enrichedShipments = useMemo(() => {
    return shipments.map((s) => {
      const client = clientLookup[s.client_id];
      const arrivalIso = s.eta || s.planned_eta || null;
      const departureIso = s.sob_date || (s.etd_tba ? null : s.planned_etd) || null;
      return {
        ...s,
        client_name: client?.name || "—",
        client_company: client?.company || "Patuma",
        arrival_iso: arrivalIso,
        departure_iso: departureIso,
        arrival_days: daysUntil(arrivalIso),
        departure_days: daysUntil(departureIso),
      };
    });
  }, [shipments, clientLookup]);

  const visibleShipments = useMemo(() => {
    const q = shipSearch.trim().toLowerCase();
    let list = enrichedShipments.filter((s) => {
      if (shipCompany !== "all" && s.client_company !== shipCompany) return false;
      if (shipStatus !== "all" && s.status !== shipStatus) return false;
      if (q) {
        const hay = `${s.client_name} ${s.supplier} ${s.vessel_name} ${s.second_vessel_name || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const sorters = {
      arrival_asc: (a, b) => compareDays(a.arrival_days, b.arrival_days, "asc") || a.client_name.localeCompare(b.client_name),
      arrival_desc: (a, b) => compareDays(a.arrival_days, b.arrival_days, "desc") || a.client_name.localeCompare(b.client_name),
      departure_asc: (a, b) => compareDays(a.departure_days, b.departure_days, "asc") || a.client_name.localeCompare(b.client_name),
      departure_desc: (a, b) => compareDays(a.departure_days, b.departure_days, "desc") || a.client_name.localeCompare(b.client_name),
      client_az: (a, b) => a.client_name.localeCompare(b.client_name) || compareDays(a.arrival_days, b.arrival_days, "asc"),
      client_za: (a, b) => b.client_name.localeCompare(a.client_name) || compareDays(a.arrival_days, b.arrival_days, "asc"),
    };
    return [...list].sort(sorters[shipSort] || sorters.arrival_asc);
  }, [enrichedShipments, shipCompany, shipStatus, shipSearch, shipSort]);

  const ackReport = async (shipmentId) => {
    try {
      await api.post(`/shipments/${shipmentId}/ack-cargo-report`);
      setReminders((prev) => prev.filter((r) => r.shipment_id !== shipmentId));
      toast.success("Cargo reporting marked done");
    } catch {
      toast.error("Failed to mark as done");
    }
  };

  return (
    <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1600px] mx-auto">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-cyan-400/80 mb-1.5">
            Overview
          </div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-100">Ocean Freight Command</h1>
          <p className="text-sm text-slate-400 mt-1.5 max-w-2xl">
            Track FCL &amp; LCL shipments across MSC, Maersk, ONE, COSCO, Hapag Lloyd, PIL, CMA CGM and Vanguard.
            Generate per-client daily status reports on demand.
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/clients">
            <Button variant="outline" className="border-slate-700 hover:bg-slate-800" data-testid="go-clients-button">
              Manage clients <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-8">
        <Stat testid="stat-clients" label="Active clients" value={stats?.total_clients ?? "—"} icon={Users} tone="cyan" />
        <Stat testid="stat-active" label="Active shipments" value={stats?.active_shipments ?? "—"} icon={Ship} tone="emerald" />
        <Stat testid="stat-delayed" label="Delayed" value={stats?.delayed ?? "—"} icon={AlertTriangle} tone="rose" />
        <Stat testid="stat-reminders" label="Cargo reports due" value={reminders.length} icon={BellRing} tone="amber" />
      </div>

      {reminders.length > 0 && (
        <div className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/5 p-5" data-testid="reminders-panel">
          <div className="flex items-center gap-2 mb-3">
            <BellRing className="h-4 w-4 text-amber-400" />
            <div className="text-xs font-semibold uppercase tracking-wide text-amber-300">Cargo reporting due</div>
          </div>
          <p className="text-xs text-slate-400 mb-4">
            FCL: 2 days before ETD (2nd vessel if transhipment). LCL: 10 days before ETA. Stays listed until you mark it done.
          </p>
          <div className="divide-y divide-amber-500/10">
            {reminders.map((r) => {
              const overdue = r.days_left < 0;
              const dueToday = r.days_left === 0;
              return (
                <div key={r.shipment_id} className="flex items-center justify-between gap-3 py-2.5" data-testid={`reminder-${r.shipment_id}`}>
                  <div className="min-w-0 flex items-baseline gap-2.5 flex-wrap">
                    <span className="text-base font-medium text-slate-100 truncate">{r.client_name}</span>
                    <span className="font-mono text-sm text-slate-300">{r.file_number || "No file #"}</span>
                    <span className={`font-mono text-xs tabular-nums ${overdue ? "text-rose-300" : dueToday ? "text-amber-300" : "text-amber-200/70"}`}>
                      {overdue ? `${Math.abs(r.days_left)}d overdue` : dueToday ? "due today" : `due in ${r.days_left}d`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm" variant="outline"
                      onClick={() => ackReport(r.shipment_id)}
                      className="h-7 text-xs border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10"
                      data-testid={`ack-reminder-${r.shipment_id}`}
                    >
                      <Check className="h-3.5 w-3.5 mr-1" /> Done
                    </Button>
                    <Link to={`/clients/${r.client_id}`} className="text-xs text-cyan-400 hover:text-cyan-300" data-testid={`reminder-open-${r.shipment_id}`}>Open →</Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mb-6 rounded-lg border border-slate-800 bg-slate-900/40 p-5" data-testid="all-shipments-panel">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Shipments</div>
            <h2 className="text-lg font-semibold text-slate-100">All shipments — arrivals &amp; departures</h2>
          </div>
          <Ship className="h-4 w-4 text-slate-500" />
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="relative">
            <Search className="h-3.5 w-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <Input
              value={shipSearch}
              onChange={(e) => setShipSearch(e.target.value)}
              placeholder="Search client, supplier, vessel…"
              data-testid="ship-search-input"
              className="h-9 pl-8 w-56 bg-slate-900 border-slate-800 text-xs"
            />
          </div>
          <div className="flex items-center gap-0.5 rounded-md border border-slate-800 bg-slate-900/60 p-0.5">
            {["all", "Clearfreight", "Patuma"].map((opt) => (
              <button
                key={opt}
                onClick={() => setShipCompany(opt)}
                data-testid={`ship-filter-company-${opt.toLowerCase()}`}
                className={`px-3 py-1.5 text-xs font-medium rounded ${shipCompany === opt ? "bg-cyan-500/15 text-cyan-300" : "text-slate-400 hover:text-slate-200"}`}
              >
                {opt === "all" ? "All" : opt}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-0.5 rounded-md border border-slate-800 bg-slate-900/60 p-0.5">
            {["all", "Planned", "Booked", "Shipped"].map((opt) => (
              <button
                key={opt}
                onClick={() => setShipStatus(opt)}
                data-testid={`ship-filter-status-${opt.toLowerCase()}`}
                className={`px-3 py-1.5 text-xs font-medium rounded ${shipStatus === opt ? "bg-cyan-500/15 text-cyan-300" : "text-slate-400 hover:text-slate-200"}`}
              >
                {opt === "all" ? "All" : opt}
              </button>
            ))}
          </div>
          <div className="sm:ml-auto">
            <Select value={shipSort} onValueChange={setShipSort}>
              <SelectTrigger className="w-48 h-9 bg-slate-900 border-slate-800 text-xs" data-testid="ship-sort-select"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-800">
                {SHIP_SORT_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {visibleShipments.length === 0 ? (
          <div className="text-sm text-slate-500 py-8 text-center">
            {shipments.length === 0 ? "No active shipments yet." : "No shipments match these filters."}
          </div>
        ) : (
          <div className="max-h-[520px] overflow-y-auto divide-y divide-slate-800/80 -mx-1">
            {visibleShipments.map((s) => (
              <Link
                key={s.id}
                to={`/clients/${s.client_id}`}
                data-testid={`all-ship-${s.id}`}
                className="flex items-center gap-3 py-2.5 px-1 hover:bg-slate-900/60 transition-colors rounded-md"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="text-sm font-semibold text-slate-100 truncate">{s.client_name}</span>
                    {s.file_number && (
                      <span className="text-lg font-bold font-mono text-cyan-300 tracking-tight truncate" data-testid={`all-ship-filenum-${s.id}`}>
                        {s.file_number}
                      </span>
                    )}
                    <span className={`text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border ${SHIP_STATUS_STYLES[s.status] || SHIP_STATUS_STYLES.Booked}`}>
                      {s.status}
                    </span>
                    {s.supplier && <span className="text-xs text-slate-500 truncate">{s.supplier}</span>}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5 truncate">
                    {s.vessel_name || <span className="italic text-slate-600">No vessel</span>}
                    {s.second_vessel_name && ` → ${s.second_vessel_name}`}
                  </div>
                </div>
                <div className="hidden md:flex items-center gap-6 shrink-0 text-right">
                  <div className="w-32">
                    <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500 flex items-center justify-end gap-1">
                      <ArrowUpFromLine className="h-2.5 w-2.5" /> Departs
                    </div>
                    <div className={`text-xl font-mono font-semibold mt-0.5 ${s.sob_date ? "text-emerald-300" : "text-slate-200"}`}>
                      {s.departure_iso || (s.etd_tba ? "TBA" : "—")}
                    </div>
                  </div>
                  <div className="w-32">
                    <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500 flex items-center justify-end gap-1">
                      <ArrowDownToLine className="h-2.5 w-2.5" /> Arrives
                    </div>
                    <div className="text-xl font-mono font-semibold mt-0.5 text-slate-100">{s.arrival_iso || "—"}</div>
                    {s.arrival_iso && (
                      <div className={`text-xs mt-0.5 ${s.arrival_days < 0 ? "text-rose-300" : s.arrival_days <= 3 ? "text-amber-300" : "text-slate-500"}`}>
                        {dayLabel(s.arrival_days)}
                      </div>
                    )}
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-slate-600 shrink-0" />
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        {/* Carrier distribution */}
        <div className="lg:col-span-2 rounded-lg border border-slate-800 bg-slate-900/40 p-5" data-testid="carrier-breakdown">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Carriers</div>
              <h2 className="text-lg font-semibold text-slate-100">Live volume by carrier</h2>
            </div>
            <PackageCheck className="h-4 w-4 text-slate-500" />
          </div>
          {!stats?.carriers?.length && (
            <div className="text-sm text-slate-500 py-8 text-center">
              No active shipments yet. Add clients and shipments to see distribution.
            </div>
          )}
          <div className="space-y-2.5">
            {stats?.carriers?.map((c) => (
              <div key={c.carrier} className="flex items-center gap-3">
                <div className={`w-28 shrink-0 text-xs font-mono px-2 py-1 rounded border text-center ${CARRIER_STYLES[c.carrier] || CARRIER_STYLES.Other}`}>
                  {c.carrier || "Other"}
                </div>
                <div className="flex-1 h-6 bg-slate-900 rounded-sm overflow-hidden border border-slate-800">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-500/70 to-cyan-400/40 border-r border-cyan-400"
                    style={{ width: `${(c.count / maxCarrier) * 100}%` }}
                  />
                </div>
                <div className="w-10 text-right font-mono text-sm text-slate-300 tabular-nums">{c.count}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Clients quick list */}
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5" data-testid="clients-quicklist">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Clients</div>
              <h2 className="text-lg font-semibold text-slate-100">Recent clients</h2>
            </div>
            <Link to="/clients" className="text-xs text-cyan-400 hover:text-cyan-300" data-testid="all-clients-link">
              All →
            </Link>
          </div>
          {clients.length === 0 && (
            <div className="text-sm text-slate-500 py-6">
              No clients yet. <Link to="/clients" className="text-cyan-400">Add one →</Link>
            </div>
          )}
          <ul className="space-y-1.5">
            {clients.slice(0, 8).map((c) => (
              <li key={c.id}>
                <Link
                  to={`/clients/${c.id}`}
                  data-testid={`client-quick-${c.id}`}
                  className="flex items-center justify-between px-3 py-2 rounded-md border border-slate-800 hover:border-cyan-500/40 hover:bg-slate-900 transition-colors"
                >
                  <span className="text-sm text-slate-200">{c.name}</span>
                  <ArrowRight className="h-3.5 w-3.5 text-slate-500" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
