// ============================================================
// constants.js — Shared display constants
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

// Background color applied when ?bg=dark is set on any display Worker.
// Used for browser-based testing against a solid dark background.
// Matches the Raspberry Pi display hardware's charcoal texture approximation.
export const DARK_BG_COLOR = '#111111';
