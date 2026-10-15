import { createContext, useContext, useEffect, useState } from "react";

// Dark mode is a per-device preference (the navy Clearfreight theme).
const KEY = "oceanops.dark";
const ThemeContext = createContext({ dark: false, toggle: () => {} });

function readDark() {
  try { return JSON.parse(localStorage.getItem(KEY)) === true; } catch { return false; }
}

export function ThemeProvider({ children }) {
  const [dark, setDark] = useState(readDark);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    try { localStorage.setItem(KEY, JSON.stringify(dark)); } catch {}
  }, [dark]);

  const toggle = () => setDark((d) => !d);
  return <ThemeContext.Provider value={{ dark, toggle }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
