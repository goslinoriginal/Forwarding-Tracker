import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { roeFor, useRoe } from "@/lib/data";
import { todayIso } from "@/lib/ui";
import { isWorkday } from "@/lib/holidays";
import RoeModal, { skippedToday, snoozed } from "@/components/RoeModal";
import { useFinder } from "@/components/ShipmentFinder";

const ROE_ASK_HOUR = 10; // rates usually arrive by 10:00

const NAV = [
  { to: "/", label: "Dashboard", match: (p) => p === "/" },
  { to: "/clients", label: "Clients", match: (p) => p.startsWith("/clients") },
  { to: "/billing", label: "Quotes & invoices", match: (p) => p.startsWith("/billing") },
  { to: "/settings", label: "Settings", match: (p) => p.startsWith("/settings") },
];

export default function AppShell({ children }) {
  const navigate = useNavigate();
  const { openFinder } = useFinder();
  const { pathname } = useLocation();

  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);

  // From 10:00 on working days, ask for the day's ROE until it's captured
  const { data: rates, isSuccess } = useRoe();
  const [today, setToday] = useState(todayIso);
  const todays = roeFor(rates, today);
  const [roeOpen, setRoeOpen] = useState(null);
  useEffect(() => {
    if (!isSuccess) return undefined;
    const check = () => {
      const t = todayIso();
      setToday(t);
      if (new Date().getHours() < ROE_ASK_HOUR || !isWorkday(t)) return;
      if (rates.some((r) => r.date === t) || skippedToday(t) || snoozed()) return;
      setRoeOpen((o) => o || "daily");
    };
    check();
    const id = setInterval(check, 60000);
    return () => clearInterval(id);
  }, [isSuccess, rates]);

  return (
    <div className="oo-app">
      <aside className="oo-side">
        <div className="oo-logo" role="img" aria-label="C-Freight Portal" />
        <button type="button" className="oo-side-search" onClick={() => openFinder()} data-testid="side-search">
          <span>Search shipments</span><kbd>/</kbd>
        </button>
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
