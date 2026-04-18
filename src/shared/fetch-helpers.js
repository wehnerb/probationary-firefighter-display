// ============================================================
// fetch-helpers.js — Shared fetch utilities
// Fargo Fire Department station display Workers
//
// SOURCE OF TRUTH: ffd-station-display-utils repo
// Do not edit the copy in any Worker's src/shared/ directory —
// it will be overwritten on the next sync.
//
// String concatenation used throughout (no template literals)
// to match the project-wide pattern that avoids smart-quote
// corruption when editing in GitHub's browser editor.
// ============================================================

// Wraps fetch() with an AbortController timeout so that a stalled
// upstream endpoint cannot hang a Worker indefinitely.
//
// Parameters:
//   url        — the request URL string
//   options    — standard fetch() options object (headers, cf, etc.)
//   timeoutMs  — milliseconds before the request is aborted (default 8000)
//
// Usage:
//   import { fetchWithTimeout } from './shared/fetch-helpers.js';
//   const res = await fetchWithTimeout(url, { headers: {...} }, 8000);
//
// The timeout is cleared immediately if the fetch resolves or rejects
// before the deadline, so there is no timer leak on fast responses.
//
// On abort, fetch() throws a DOMException with name 'AbortError'.
// Callers should catch this and treat it the same as any other
// network failure — return null or a fallback value, log the host
// and error name (not the full URL, which may contain secrets).
export function fetchWithTimeout(url, options, timeoutMs) {
  var controller = new AbortController();
  var timeoutId  = setTimeout(function() { controller.abort(); }, timeoutMs || 8000);
  return fetch(url, Object.assign({}, options, { signal: controller.signal }))
    .finally(function() { clearTimeout(timeoutId); });
}
