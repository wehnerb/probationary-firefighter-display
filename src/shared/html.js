// ============================================================
// html.js — Shared HTML utility functions
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

// Escapes characters with special meaning in HTML to prevent XSS.
// Must be called on every dynamic string before HTML injection.
// Handles the five standard HTML escape sequences plus single quote.
//
// Usage:
//   import { escapeHtml } from './shared/html.js';
//   const safe = escapeHtml(userSuppliedString);
export function escapeHtml(str) {
  if (!str && str !== 0) return '';
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

// Sanitizes a URL parameter value to prevent injection attacks.
// Allows only alphanumeric characters, hyphens, and underscores.
// Caps length at 50 characters as a defense against oversize inputs.
// Returns null for missing or non-string input.
//
// Usage:
//   import { sanitizeParam } from './shared/html.js';
//   const layout = sanitizeParam(url.searchParams.get('layout'));
export function sanitizeParam(value) {
  if (!value || typeof value !== 'string') return null;
  return value.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 50);
}