import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

const NAV = [
  { to: "/", label: "Dashboard", match: (p) => p === "/" },
  { to: "/clients", label: "Clients", match: (p) => p.startsWith("/clients") },
  { to: "/billing", label: "Quotes & invoices", match: (p) => p.startsWith("/billing") },
  { to: "/settings", label: "Settings", match: (p) => p.startsWith("/settings") },
];

export default function AppShell({ children }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);

  return (
    <div className="oo-app">
      <aside className="oo-side">
        <div className="oo-logo" role="img" aria-label="C-Freight Portal" />
        <nav className="oo-nav">
          {NAV.map((n) => (
            <button
              key={n.to}
              type="button"
              className={`oo-nav-btn ${n.match(pathname) ? "on" : ""}`}
              onClick={() => navigate(n.to)}
              data-testid={`nav-${n.to.slice(1) || "dashboard"}`}
            >
              <span className="dot" />
              {n.label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="oo-main">
        <div className="oo-panel">{children}</div>
      </main>
    </div>
  );
}
