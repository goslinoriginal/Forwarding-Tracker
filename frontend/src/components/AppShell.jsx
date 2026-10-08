import { NavLink, useNavigate } from "react-router-dom";
import { Anchor, LayoutDashboard, Users, Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/theme";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, testid: "nav-dashboard" },
  { to: "/clients", label: "Clients", icon: Users, testid: "nav-clients" },
];

export default function AppShell({ children }) {
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  return (
    <div className="min-h-screen flex bg-slate-950 dark:bg-slate-950 text-slate-200 dark:text-slate-200 light:bg-slate-50 light:text-slate-900">
      {/* Sidebar */}
      <aside className="hidden md:flex md:w-64 flex-col border-r border-slate-900 dark:border-slate-900 light:border-slate-200 bg-slate-950/95 dark:bg-slate-950/95 light:bg-white sticky top-0 h-screen">
        <div className="px-5 py-5 border-b border-slate-900 dark:border-slate-900 light:border-slate-200 flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-md bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
              <Anchor className="h-4 w-4 text-cyan-500 dark:text-cyan-400" strokeWidth={2.4} />
            </div>
            <div className="leading-tight">
              <div className="font-mono text-[11px] tracking-widest uppercase text-cyan-500/80 dark:text-cyan-400/80">Ocean OPS</div>
              <div className="font-semibold text-sm">Freight Tracker</div>
            </div>
          </div>
          <button
            onClick={toggle}
            data-testid="theme-toggle"
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            className="h-8 w-8 rounded-md border border-slate-800 dark:border-slate-800 light:border-slate-300 hover:bg-cyan-500/10 hover:text-cyan-500 dark:hover:text-cyan-300 flex items-center justify-center transition-colors"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
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
