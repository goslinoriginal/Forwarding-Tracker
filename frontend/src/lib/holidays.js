// South African public holidays — the same rules as the backend's _sa_holidays.
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseIso = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };

function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const g = Math.floor((8 * b + 13) / 25), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 19 * l) / 433);
  const month = Math.floor((h + l - 7 * m + 90) / 25);
  return new Date(y, month - 1, (h + l - 7 * m + 33 * month + 19) % 32);
}

const FIXED = [[1, 1, "New Year's Day"], [3, 21, "Human Rights Day"], [4, 27, "Freedom Day"], [5, 1, "Workers' Day"],
  [6, 16, "Youth Day"], [8, 9, "National Women's Day"], [9, 24, "Heritage Day"], [12, 16, "Day of Reconciliation"],
  [12, 25, "Christmas Day"], [12, 26, "Day of Goodwill"]];
const cache = {};

/** { "YYYY-MM-DD": name } — a holiday on a Sunday also gives the Monday off. */
export function saHolidays(y) {
  if (!cache[y]) {
    const out = {};
    FIXED.forEach(([m, d, name]) => {
      const day = new Date(y, m - 1, d);
      out[iso(day)] = name;
      if (day.getDay() === 0) out[iso(new Date(y, m - 1, d + 1))] = `${name} (observed)`;
    });
    const e = easter(y);
    out[iso(new Date(y, e.getMonth(), e.getDate() - 2))] = "Good Friday";
    out[iso(new Date(y, e.getMonth(), e.getDate() + 1))] = "Family Day";
    cache[y] = out;
  }
  return cache[y];
}

export const holidayName = (s) => saHolidays(Number(s.slice(0, 4)))[s] || "";
export const isWorkday = (s) => { const d = parseIso(s).getDay(); return d !== 0 && d !== 6 && !holidayName(s); };

/** The next working day on or after a date (weekends and public holidays skipped). */
export function nextWorkday(s) {
  const d = parseIso(s);
  while (!isWorkday(iso(d))) d.setDate(d.getDate() + 1);
  return iso(d);
}

/** Why a day isn't worked: "Saturday", "Good Friday", … or "". */
export function offReason(s) {
  const h = holidayName(s);
  if (h) return h;
  const d = parseIso(s).getDay();
  return d === 0 ? "Sunday" : d === 6 ? "Saturday" : "";
}
