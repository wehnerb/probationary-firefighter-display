// ============================================================
// alert-colors.js — Shared NWS weather alert color tokens
// Fargo Fire Department station display Workers
//
// SOURCE OF TRUTH: ffd-station-display-utils repo
// Do not edit the copy in any Worker's src/shared/ directory —
// it will be overwritten on the next sync.
//
// Three severity levels matching NWS alert classification:
//   WARNING  — extreme or severe (most critical, red)
//   WATCH    — moderate (elevated concern, orange)
//   ADVISORY — minor (awareness, yellow)
//
// Used by calendar-display and weather-display for both
// full-width alert banners and per-day alert badges.
//
// Usage:
//   import {
//     ALERT_WARNING_BG, ALERT_WARNING_BORDER, ALERT_WARNING_TEXT,
//     ALERT_WATCH_BG,   ALERT_WATCH_BORDER,   ALERT_WATCH_TEXT,
//     ALERT_ADVISORY_BG, ALERT_ADVISORY_BORDER, ALERT_ADVISORY_TEXT,
//   } from './shared/alert-colors.js';
// ============================================================

// WARNING — extreme / severe alerts (highest priority)
// Dark red background, FFD red left border, light red text.
export const ALERT_WARNING_BG     = 'rgba(50,0,0,0.55)';
export const ALERT_WARNING_BORDER = '#C8102E';
export const ALERT_WARNING_TEXT   = '#ffaaaa';

// WATCH — moderate alerts (elevated concern)
// Dark orange background, amber left border, light orange text.
export const ALERT_WATCH_BG     = 'rgba(50,25,0,0.55)';
export const ALERT_WATCH_BORDER = '#d68910';
export const ALERT_WATCH_TEXT   = '#ffd08a';

// ADVISORY — minor alerts (awareness level)
// Dark yellow background, dark gold left border, light yellow text.
export const ALERT_ADVISORY_BG     = 'rgba(40,40,0,0.55)';
export const ALERT_ADVISORY_BORDER = '#b7950b';
export const ALERT_ADVISORY_TEXT   = '#e0d890';