// In-memory supplier API request/response log ring buffer.
// Used by Admin → Settings → API Request Logs to debug GDS/aggregator calls
// without needing SSH access to PM2 logs.

const MAX_ENTRIES = 200;
const MAX_BODY_CHARS = 20000;

const entries = []; // newest last
let seq = 0;

const SECRET_KEYS = /^(password|pass|secret|token|authorization|apikey|api_key|client_secret|basic_auth)$/i;

function redact(value, depth = 0) {
  if (value == null || depth > 6) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map(v => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEYS.test(k) ? '***redacted***' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function stringify(value) {
  if (value == null) return null;
  try {
    const s = typeof value === 'string' ? value : JSON.stringify(redact(value), null, 2);
    return s.length > MAX_BODY_CHARS ? `${s.slice(0, MAX_BODY_CHARS)}\n… truncated (${s.length} chars total)` : s;
  } catch {
    return String(value);
  }
}

/**
 * Record one supplier API call.
 * @param {object} e
 * @param {string} e.provider  e.g. 'triplover'
 * @param {string} e.operation e.g. 'Search'
 * @param {string} [e.url]
 * @param {number} [e.status]  HTTP status
 * @param {boolean} e.ok
 * @param {number} [e.durationMs]
 * @param {any} [e.request]
 * @param {any} [e.response]
 * @param {string} [e.error]   actionable error message
 * @param {string} [e.hint]    what the admin should do about it
 */
function logApiCall(e) {
  const entry = {
    id: ++seq,
    at: new Date().toISOString(),
    provider: e.provider || 'unknown',
    operation: e.operation || '',
    url: e.url || '',
    status: e.status ?? null,
    ok: !!e.ok,
    durationMs: e.durationMs ?? null,
    error: e.error || null,
    hint: e.hint || null,
    request: stringify(e.request),
    response: stringify(e.response),
  };
  entries.push(entry);
  while (entries.length > MAX_ENTRIES) entries.shift();

  const tag = `[${entry.provider}] ${entry.operation} ${entry.status ?? ''} ${entry.durationMs ?? '?'}ms`;
  if (entry.ok) console.log(`${tag} OK`);
  else console.error(`${tag} FAILED — ${entry.error}${entry.hint ? ` | Hint: ${entry.hint}` : ''}`);

  return entry;
}

function getApiLogs({ provider, operation, onlyErrors, limit = 50 } = {}) {
  let list = entries.slice().reverse();
  if (provider) list = list.filter(l => l.provider === provider);
  if (operation) list = list.filter(l => l.operation === operation);
  if (onlyErrors) list = list.filter(l => !l.ok);
  return list.slice(0, Math.min(Number(limit) || 50, MAX_ENTRIES));
}

function clearApiLogs(provider) {
  if (!provider) { entries.length = 0; return; }
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].provider === provider) entries.splice(i, 1);
  }
}

/** Map a raw supplier failure into an actionable message + hint for the admin UI. */
function describeFailure({ status, message, body, operation }) {
  const raw = String(message || '').trim();
  const lower = raw.toLowerCase();
  const bodyText = typeof body === 'string' ? body : (() => { try { return JSON.stringify(body); } catch { return ''; } })();
  const hay = `${lower} ${String(bodyText).toLowerCase()}`;

  if (lower.includes('aborted') || lower.includes('timeout') || lower.includes('timed out')) {
    return { error: `${operation} timed out before the supplier responded.`, hint: 'The supplier (UAT) is slow or unreachable. Retry; if it repeats, raise the timeout or pause this API in API Control.' };
  }
  if (lower.includes('not configured') || lower.includes('disabled')) {
    return { error: raw, hint: 'Open Admin → Settings → API Integrations, fill in the credentials and set Enabled = true, then Save.' };
  }
  if (lower.includes('authentication failed') || status === 401 || status === 403) {
    return { error: 'Supplier rejected the credentials (unauthorized).', hint: 'Re-check API Email / Password and the Base URL for this environment (UAT vs Production), then Save to refresh the token.' };
  }
  if (status === 404) {
    return { error: `Endpoint not found (404) for ${operation}.`, hint: 'The Base URL / Search Base URL is likely wrong — confirm both URLs with the supplier.' };
  }
  if (hay.includes('duplicate')) {
    return { error: 'Supplier blocked this as a duplicate booking.', hint: 'Change passenger name/route or ask the supplier to clear the duplicate-check on this account.' };
  }
  if (hay.includes('checkduplicatebooking') || status === 500) {
    return { error: raw || `Supplier internal error (500) during ${operation}.`, hint: 'This is a fault on the supplier side. Send them this log entry (time, operation, request payload) to fix it.' };
  }
  if (hay.includes('price') && hay.includes('change')) {
    return { error: raw, hint: 'Fare changed at the supplier — re-run Reprice and confirm the new fare before booking.' };
  }
  if (status === 429) {
    return { error: 'Rate limited by the supplier (429).', hint: 'Reduce search frequency or ask the supplier to raise your rate limit.' };
  }
  return { error: raw || `${operation} failed.`, hint: 'Check the request/response payload below and share it with the supplier if it is unclear.' };
}

module.exports = { logApiCall, getApiLogs, clearApiLogs, describeFailure, redact };
