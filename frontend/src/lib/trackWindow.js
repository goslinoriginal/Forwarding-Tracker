// Carrier tracking opens in its own window — one window, reused for every "Track"
// click — so it can sit on a second screen while the status report is edited here.
// In Chrome / Edge the first open asks once to "manage windows on all your displays";
// allowed, the window is placed on the other screen automatically.

const NAME = "cfreight-tracking";
let win = null;

async function otherScreen() {
  if (!("getScreenDetails" in window)) return null;
  try {
    const d = await window.getScreenDetails();
    return d.screens.find((s) => s !== d.currentScreen) || null;
  } catch {
    return null; // permission refused or not available
  }
}

export function openTracking(url) {
  // Already open (and still ours): just show the new shipment in it
  if (win && !win.closed) {
    try { win.location.href = url; win.focus(); return; } catch { /* fall through and reopen */ }
  }
  const s = window.screen;
  const w = Math.round(s.availWidth * 0.9);
  const h = Math.round(s.availHeight * 0.9);
  // Open a blank window first (needs the click, so it can't wait), place it, then load the page
  win = window.open("about:blank", NAME, `popup,width=${w},height=${h},left=${(s.availLeft || 0) + 40},top=${(s.availTop || 0) + 40}`);
  if (!win) { window.open(url, "_blank", "noopener,noreferrer"); return; } // pop-ups blocked: plain tab
  // Don't keep the page waiting on Chrome's one-time "allow" question
  Promise.race([otherScreen(), new Promise((r) => setTimeout(() => r(null), 1500))])
    .then((o) => {
      if (!o) return;
      try {
        win.moveTo(o.availLeft, o.availTop);
        win.resizeTo(o.availWidth, o.availHeight);
      } catch { /* ignore */ }
    })
    .finally(() => {
      try { win.location.href = url; } catch { window.open(url, NAME); }
    });
}
