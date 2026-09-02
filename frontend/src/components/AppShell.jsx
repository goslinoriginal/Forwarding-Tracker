import { NavLink, useNavigate } from "react-router-dom";
import { Anchor, LayoutDashboard, Users, ContainerIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, testid: "nav-dashboard" },
  { to: "/clients", label: "Clients", icon: Users, testid: "nav-clients" },
];

export default function AppShell({ children }) {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="hidden md:flex md:w-64 flex-col border-r border-slate-900 bg-slate-950/95 sticky top-0 h-screen">
        <div className="px-5 py-5 border-b border-slate-900 flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-md bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
            <Anchor className="h-4 w-4 text-cyan-400" strokeWidth={2.4} />
          </div>
          <div className="leading-tight">
            <div className="font-mono text-[11px] tracking-widest uppercase text-cyan-400/80">Ocean OPS</div>
            <div className="font-semibold text-sm text-slate-100">Freight Tracker</div>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              data-testid={item.testid}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors",
                  isActive
                    ? "bg-cyan-500/10 text-cyan-300 border border-cyan-500/25"
                    : "text-slate-400 hover:text-slate-100 hover:bg-slate-900 border border-transparent"
                )
              }
            >
              <item.icon className="h-4 w-4" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="p-4 border-t border-slate-900">
          <div className="rounded-md bg-slate-900/60 border border-slate-800 p-3">
            <div className="flex items-center gap-2 text-xs font-mono text-slate-500 uppercase tracking-wider">
              <ContainerIcon className="h-3.5 w-3.5" />
              <span>Carriers tracked</span>
            </div>
            <div className="mt-2 text-[11px] text-slate-500 leading-relaxed font-mono">
              MSC · MAERSK · ONE · COSCO<br/>HAPAG · PIL · CMA CGM · VGL
            </div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 relative">
        {/* Mobile top bar */}
        <div className="md:hidden flex items-center gap-2 px-4 py-3 border-b border-slate-900 bg-slate-950 sticky top-0 z-40">
          <button
            onClick={() => navigate("/")}
            className="h-8 w-8 rounded-md bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center"
            data-testid="mobile-home-button"
          >
            <Anchor className="h-4 w-4 text-cyan-400" />
          </button>
          <div className="text-sm font-semibold text-slate-100">Ocean OPS</div>
        </div>
        {children}
      </main>
    </div>
  );
}
