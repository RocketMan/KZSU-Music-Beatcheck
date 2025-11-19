/**
 * fetch-with-retries.js
 *
 * Usage (CommonJS):
 *   const fetchWithRetry = require('./fetch-with-retries');
 *   const res = await fetchWithRetry(url, { method: 'GET', headers, timeoutMs: 15000, retries: 3 });
 *
 * Behaviour:
 * - Enforces timeout per attempt via AbortController.
 * - Retries on transient network errors and on 429/5xx responses.
 * - Honors Retry-After header when present.
 * - Exponential backoff with jitter.
 * - Logs diagnostics (status, truncated body, error.code).
 */

const DEFAULT_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 15000);
const DEFAULT_RETRIES = Number(process.env.FETCH_RETRIES || 3); // total attempts = retries + 1
const DEFAULT_BACKOFF_BASE = Number(process.env.FETCH_BACKOFF_BASE_MS || 500); // ms base
const MAX_RETRY_AFTER_SECS = Number(process.env.FETCH_MAX_RETRY_AFTER_SECS || 120);

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function isTransientError(err) {
  if (!err) return false;
  const transientCodes = new Set([
    "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND", "EPIPE", "ECONNREFUSED"
  ]);
  if (err.code && transientCodes.has(err.code)) return true;
  if (err.name === "FetchError" || err.name === "AbortError") return true;
  return false;
}

function jitter(ms) {
  const factor = 0.3;
  const delta = Math.floor(ms * factor * Math.random());
  return ms - Math.floor(delta / 2) + delta;
}

async function readResponseSnippet(res, max = 1000) {
  try {
    const text = await res.text();
    return text.slice(0, max);
  } catch (e) {
    return `<failed to read response body: ${e && e.message ? e.message : e}>`;
  }
}

module.exports = async function fetchWithRetry(url, opts = {}) {
  const timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  const retries = Number.isInteger(opts.retries) ? opts.retries : DEFAULT_RETRIES;
  const backoffBase = Number.isInteger(opts.backoffBase) ? opts.backoffBase : DEFAULT_BACKOFF_BASE;

  const fetchOptions = Object.assign({}, opts);
  delete fetchOptions.timeoutMs;
  delete fetchOptions.retries;
  delete fetchOptions.backoffBase;

  let attempt = 0;
  let lastErr = null;

  while (attempt <= retries) {
    attempt += 1;
    const attemptTag = `attempt ${attempt}/${retries + 1}`;

    const controller = new AbortController();
    const signal = controller.signal;
    if (!fetchOptions.signal) fetchOptions.signal = signal;

    let timer = null;
    try {
      timer = setTimeout(() => controller.abort(), timeoutMs);
      console.debug(`[fetch-with-retries] ${attemptTag} -> ${url}`);

      const res = await fetch(url, fetchOptions);
      clearTimeout(timer);

      if (res.ok) return res;

      // Non-OK: log and conditionally retry
      const status = res.status;
      const statusText = res.statusText || "";
      const bodySnippet = await readResponseSnippet(res, 1500);
      console.error(`[fetch-with-retries] ${attemptTag} -> HTTP ${status} ${statusText} for ${url}`);
      console.error(`[fetch-with-retries] response body (truncated):\n${bodySnippet}`);

      if ((status === 429 || (status >= 500 && status < 600)) && attempt <= retries) {
        const ra = res.headers && (res.headers.get && res.headers.get("retry-after"));
        let waitMs = 0;
        if (ra) {
          const raInt = parseInt(ra, 10);
          if (!isNaN(raInt)) {
            const secs = Math.min(raInt, MAX_RETRY_AFTER_SECS);
            waitMs = secs * 1000;
          } else {
            const retryDate = Date.parse(ra);
            if (!isNaN(retryDate)) {
              const secs = Math.floor((retryDate - Date.now()) / 1000);
              waitMs = Math.max(0, Math.min(secs, MAX_RETRY_AFTER_SECS)) * 1000;
            }
          }
        }
        if (waitMs <= 0) {
          const base = backoffBase * Math.pow(2, attempt - 1);
          waitMs = jitter(base);
        }
        console.warn(`[fetch-with-retries] server rate/err ${status}; retrying after ${Math.round(waitMs)}ms`);
        await sleep(waitMs);
        continue;
      }

      // Non-retryable non-OK: return response for caller
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      console.error(`[fetch-with-retries] ${attemptTag} threw: name=${err && err.name} message=${err && err.message} code=${err && err.code || ""}`);
      if (err && err.stack) {
        const stackLines = (err.stack || "").split("\n").slice(0, 6).join("\n");
        console.error(`[fetch-with-retries] stack (truncated):\n${stackLines}`);
      }
      if (err && err.name === "AbortError") {
        console.warn(`[fetch-with-retries] ${attemptTag} aborted by timeout (${timeoutMs}ms)`);
      }

      if (isTransientError(err) && attempt <= retries) {
        const base = backoffBase * Math.pow(2, attempt - 1);
        const waitMs = jitter(base);
        console.warn(`[fetch-with-retries] transient network error, retrying after ${Math.round(waitMs)}ms`);
        await sleep(waitMs);
        continue;
      }

      throw err;
    } finally {
      if (fetchOptions && fetchOptions.signal === signal) delete fetchOptions.signal;
      if (timer) clearTimeout(timer);
    }
  }

  const e = lastErr || new Error(`fetch-with-retries: failed to fetch ${url}`);
  throw e;
};
