import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "@/lib/theme";

/* ---------- Hue chips ----------
   Chips are generated from a hue: soft tint + darker ink in light mode, deep tint +
   light ink on navy. A null hue falls back to the neutral fill. */
export function chipColors(h, dark) {
  if (h == null) return { background: "var(--fill)", color: "var(--ink2)" };
  return dark
    ? { background: `oklch(0.3 0.06 ${h})`, color: `oklch(0.86 0.09 ${h})` }
    : { background: `oklch(0.95 0.04 ${h})`, color: `oklch(0.44 0.12 ${h})` };
}

export function useChip() {
  const { dark } = useTheme();
  return useCallback((h) => chipColors(h, dark), [dark]);
}

export const CARRIER_HUE = { MSC: 95, Maersk: 230, ONE: 350, COSCO: 255, "Hapag Lloyd": 50, PIL: 22, "CMA CGM": 268, Vanguard: 305, Other: 250 };
export const STATUS_HUE = { Planned: null, Booked: 70, Shipped: 155, Delayed: 22, ANF: 300 };
export const COMPANY_HUE = { Patuma: 240, Clearfreight: 200 };
export const DOC_STATUS_HUE = { Draft: null, Sent: 240, Accepted: 155, Paid: 155 };
export const DOC_TYPE_HUE = { quote: 200, pfi: 300 };
export const CARGO_HUE = { LCL: 200, FCL: 255 };

export function Pill({ hue, tone, dot, size, children, style }) {
  const chip = useChip();
  const colors = tone ? { background: `var(--${tone}-bg)`, color: `var(--${tone}-fg)` } : chip(hue);
  return (
    <span className={`oo-pill ${size || ""}`} style={{ ...colors, ...style }}>
      {dot && <span className="d" />}
      {children}
    </span>
  );
}

export function Seg({ options, value, onChange, size }) {
  return (
    <div className={`oo-seg ${size || ""}`}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" className={o.value === value ? "on" : ""} onClick={() => onChange(o.value)}>
          {o.label}
          {o.count !== undefined && <span className="count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ on, onChange, size, title }) {
  return (
    <button type="button" title={title} className={`oo-toggle ${size || ""} ${on ? "on" : ""}`} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

export function Modal({ onClose, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // Portalled to <body> so the page's entrance animation can't offset it.
  return createPortal(
    <>
      <div className="oo-scrim" onClick={onClose} />
      <div className="oo-modal-wrap">
        <div className="oo-modal">{children}</div>
      </div>
    </>,
    document.body,
  );
}

/* ---------- Toast ----------
   One bottom-centre pill at a time; 2.8s, or 5s when it offers Undo. */
const ToastContext = createContext({ toast: () => {} });

export function ToastProvider({ children }) {
  const [t, setT] = useState(null);
  const timer = useRef(null);
  const toast = useCallback((msg, opts = {}) => {
    clearTimeout(timer.current);
    setT({ msg, undo: opts.undo || null, error: !!opts.error, key: Date.now() });
    timer.current = setTimeout(() => setT(null), opts.undo ? 5000 : 2800);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {t && (
        <div className="oo-toast" key={t.key} role="status">
          <span className={`ok ${t.error ? "err" : ""}`}>{t.error ? "!" : "✓"}</span>
          {t.msg}
          {t.undo && (
            <button type="button" onClick={() => { const u = t.undo; setT(null); u(); }}>Undo</button>
          )}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext).toast;
}

/* ---------- Clipboard ---------- */
export function copyText(text) {
  const fallback = () => {
    const a = document.createElement("textarea");
    a.value = text;
    a.style.position = "fixed";
    a.style.opacity = "0";
    document.body.appendChild(a);
    a.select();
    try { document.execCommand("copy"); } catch {}
    a.remove();
  };
  try {
    return navigator.clipboard.writeText(text).catch(fallback);
  } catch {
    fallback();
    return Promise.resolve();
  }
}

/* ---------- Dates ---------- */
const pad = (n) => String(n).padStart(2, "0");
export const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const isoPlusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const nowHm = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
/** YYYY-MM-DD -> DD.MM. (anything else is shown as-is) */
export const dm = (iso) => { const m = ISO.exec(iso || ""); return m ? `${m[3]}.${m[2]}.` : iso || ""; };
/** YYYY-MM-DD -> DD.MM.YYYY */
export const dmy = (iso) => { const m = ISO.exec(iso || ""); return m ? `${m[3]}.${m[2]}.${m[1]}` : iso || ""; };
/** Accepts DD.MM., DD.MM.YYYY, DD/MM/YYYY or ISO; returns ISO, or the text unchanged (e.g. "RCG"). */
export function parseDayInput(text) {
  const t = (text || "").trim();
  if (!t || ISO.test(t)) return t;
  const m = /^(\d{1,2})[./](\d{1,2})[./]?(\d{2,4})?$/.exec(t);
  if (!m) return t;
  let y = m[3] ? Number(m[3]) : new Date().getFullYear();
  if (y < 100) y += 2000;
  return `${y}-${pad(m[2])}-${pad(m[1])}`;
}
export function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning." : h < 18 ? "Good afternoon." : "Good evening.";
}
export function longToday() {
  return new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}
