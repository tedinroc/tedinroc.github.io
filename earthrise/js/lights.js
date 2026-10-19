// EARTHRISE for Daedalus — "Earthrise no. 1,284 for Daedalus. This one was yours.": the client side of the global counter.
// main.js imports this module only when js/config.js has COUNTER_ENABLED = true, and only once a visitor has brought the
// Earth to the top themselves (drag, keys, or "Turn it for me"). With the flag off the page never loads it and makes no
// request beyond its own files. Server: functions/api/lights.js (Pages Function + D1, binding DB).
//
// One POST per browser session (sessionStorage): the answer is this visitor's number. After that — the Earth raised
// again, or the page reloaded in the same tab — it only GETs, to check the counter is still up, and shows the same number.
// Anything that goes wrong (no Functions deployed, no D1, a 503, a timeout, storage blocked) gives null: show nothing.

const API = new URL('../api/lights', import.meta.url);      // /api/lights (functions/api/lights.js)
const KEY = 'earthrise.light';
const TIMEOUT_MS = 8000;

function stored() {
  try { const n = Number(sessionStorage.getItem(KEY) || 0); return Number.isSafeInteger(n) && n > 0 ? n : null; } catch (e) { return null; }
}
function store(n) { try { sessionStorage.setItem(KEY, String(n)); } catch (e) { /* private mode: one POST per page load instead */ } }

async function call(method) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(API, { method, cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' }, signal: ctl.signal });
    return r.ok ? await r.json() : null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// → this visitor's light number, or null
export async function myLight() {
  const mine = stored();
  if (mine !== null) {
    const g = await call('GET');
    return g && Number.isSafeInteger(g.total) && g.total >= mine ? mine : null;
  }
  const p = await call('POST');
  if (!p || !Number.isSafeInteger(p.light) || p.light < 1) return null;
  store(p.light);
  return p.light;
}

// The line answers the opening "It has never once seen Earth.": from none to n, and this one was the visitor's. The first
// one is said in words (a "no. 1" would read like test data). docs/final_review.md #1.
export const lightLine = n => n === 1 ? "Daedalus's first earthrise. It was yours."
  : `Earthrise no. ${n.toLocaleString('en-US')} for Daedalus. This one was yours.`;
