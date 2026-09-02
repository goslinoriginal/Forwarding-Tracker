import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { CARRIER_STYLES } from "@/lib/api";
import { Ship, Users, AlertTriangle, PackageCheck, Clock, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

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

  useEffect(() => {
    (async () => {
      try {
        const [s, c] = await Promise.all([api.get("/dashboard/stats"), api.get("/clients")]);
        setStats(s.data);
        setClients(c.data);
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  const maxCarrier = Math.max(1, ...(stats?.carriers?.map((c) => c.count) || [1]));

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
        <Stat testid="stat-booked" label="Booked / Pending" value={stats?.booked ?? "—"} icon={Clock} tone="amber" />
      </div>

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
