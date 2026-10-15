import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { roeFor, useRoe } from "@/lib/data";
import { todayIso } from "@/lib/ui";
import RoeModal, { skippedToday } from "@/components/RoeModal";

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

  // Ask for the day's ROE once, on working days, until it's captured
  const { data: rates, isSuccess } = useRoe();
  const today = todayIso();
  const dow = new Date().getDay();
  const todays = roeFor(rates, today);
  const [roeOpen, setRoeOpen] = useState(null);
  useEffect(() => {
    if (isSuccess && dow !== 0 && dow !== 6 && !rates.some((r) => r.date === today) && !skippedToday(today)) setRoeOpen("daily");
  }, [isSuccess]); // eslint-disable-line react-hooks/exhaustive-deps

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
        <button type="button" className="oo-roe-chip" onClick={() => setRoeOpen("edit")} title="Today's rates of exchange" data-testid="roe-chip">
          <span className="k">ROE today</span>
          {todays ? (
            <span className="mono">{[todays.usd && `$ ${todays.usd}`, todays.eur && `€ ${todays.eur}`].filter(Boolean).join(" · ")}</span>
          ) : (
            <span style={{ color: "var(--amb-fg)" }}>Not captured — add</span>
          )}
        </button>
      </aside>
      {roeOpen && <RoeModal day={today} existing={todays} daily={roeOpen === "daily"} onClose={() => setRoeOpen(null)} />}
      <main className="oo-main">
        <div className="oo-panel">{children}</div>
      </main>
    </div>
  );
}
