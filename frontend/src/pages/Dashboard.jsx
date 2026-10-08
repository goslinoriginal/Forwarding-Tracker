import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { CARRIER_STYLES } from "@/lib/api";
import { Ship, Users, AlertTriangle, PackageCheck, Clock, ArrowRight, BellRing, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

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

  useEffect(() => {
    (async () => {
      try {
        const [s, c, r] = await Promise.all([
          api.get("/dashboard/stats"),
          api.get("/clients"),
          api.get("/dashboard/reminders"),
        ]);
        setStats(s.data);
        setClients(c.data);
        setReminders(r.data?.reminders || []);
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  const maxCarrier = Math.max(1, ...(stats?.carriers?.map((c) => c.count) || [1]));

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
          <div className="font-mono text-[11px] tracking-widest uppercase text-cyan-400/80 mb-1.5">
            /operations · overview
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
            <div className="font-mono text-[10px] tracking-widest uppercase text-amber-300">/cargo reporting due</div>
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        {/* Carrier distribution */}
        <div className="lg:col-span-2 rounded-lg border border-slate-800 bg-slate-900/40 p-5" data-testid="carrier-breakdown">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="font-mono text-[10px] tracking-widest uppercase text-slate-500 mb-1">/carriers</div>
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
              <div className="font-mono text-[10px] tracking-widest uppercase text-slate-500 mb-1">/clients</div>
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
