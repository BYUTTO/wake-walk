// Insert-only telemetry.
//
// Carried from filtration-walk unchanged in structure, and for the same reason: the
// walkthrough is the demo, but what a department would eventually pay for is knowing
// that 40% of a class never walked past 7 D, or that nobody ever pressed the tilt key.
// Collected from day one so that conversation has data behind it instead of a promise.
//
// Deliberately NOT the Supabase JS SDK — two POSTs against the REST endpoint keeps the
// project's zero-dependency, zero-build property intact.
//
// PRIVACY: no accounts, no cookies, no IP collection, no fingerprinting. The session id
// is a random UUID generated in the browser, kept in memory, thrown away when the tab
// closes. It links events within one visit and to nothing else, ever.
//
// UNCONFIGURED IS A VALID STATE. With no Supabase credentials this runs in local mode:
// events accumulate on window.__wake.events and nothing leaves the machine. That is the
// correct behaviour for a laptop demo in a room with no wifi, which will happen.

const CONFIG = globalThis.__WAKE_CONFIG ?? {};
const ENABLED = Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);

const sessionId = crypto.randomUUID();
const localEvents = [];
let queue = [];
let flushTimer = null;
let failed = false;

async function post(table, rows) {
  if (!ENABLED || failed) return;
  try {
    const res = await fetch(`${CONFIG.supabaseUrl}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: CONFIG.supabaseAnonKey,
        Authorization: `Bearer ${CONFIG.supabaseAnonKey}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(rows),
      keepalive: true,
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  } catch (err) {
    // Telemetry must never be able to break the demo. One failure disables it for the
    // rest of the session rather than retrying into a dead endpoint on every keypress
    // in front of an audience.
    failed = true;
    console.warn('[telemetry] disabled after failure:', err.message);
  }
}

export function startSession() {
  post('wake_sessions', [{
    id: sessionId,
    started_at: new Date().toISOString(),
    user_agent: navigator.userAgent,
    referrer: document.referrer || null,
  }]);
  return sessionId;
}

/** Record an event. Batched on a 4 s timer. */
export function record(eventType, { target = null, dwellMs = null, pos = null } = {}) {
  const row = {
    session_id: sessionId,
    event_type: eventType,
    target,
    dwell_ms: dwellMs === null ? null : Math.round(dwellMs),
    pos: pos ? { x: +pos.x.toFixed(1), y: +pos.y.toFixed(1), z: +pos.z.toFixed(1) } : null,
    created_at: new Date().toISOString(),
  };

  localEvents.push(row);
  if (!ENABLED) return;

  queue.push(row);
  if (!flushTimer) flushTimer = setTimeout(flush, 4000);
}

export function flush() {
  clearTimeout(flushTimer);
  flushTimer = null;
  if (!queue.length) return;
  const batch = queue;
  queue = [];
  post('wake_events', batch);
}

// Last-chance flush. visibilitychange rather than unload, which modern browsers no
// longer fire reliably; the fetch above sets keepalive so it survives teardown.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}

export const telemetryMode = ENABLED ? 'supabase' : 'local';
export { localEvents, sessionId };
