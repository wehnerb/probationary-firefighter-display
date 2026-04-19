// ============================================================
// colors.js — Shared design tokens
// Fargo Fire Department station display Workers
//
// SOURCE OF TRUTH: ffd-station-display-utils repo
// Do not edit the copy in any Worker's src/shared/ directory —
// it will be overwritten on the next sync.
//
// These values define the FFD station display design language.
// A change here propagates to all workers on next sync.
//
// Note: DARK_BG_COLOR is also exported from constants.js for
// backward compatibility. Once all workers import from colors.js,
// constants.js will be retired.
//
// Usage:
//   import {
//     DARK_BG_COLOR,
//     FONT_STACK,
//     ACCENT_COLOR,
//     TEXT_PRIMARY,
//     TEXT_SECONDARY,
//     TEXT_TERTIARY,
//     BORDER_SUBTLE,
//     BORDER_STRONG,
//     CARD_BASE,
//     CARD_ELEVATED,
//     CARD_HEADER,
//     CARD_RECESSED,
//   } from './shared/colors.js';
// ============================================================

// Background color applied when ?bg=dark is set on any display Worker.
// Used for browser-based testing against a solid dark background.
// Matches the Raspberry Pi display hardware's charcoal texture approximation.
// Also exported from constants.js for backward compatibility.
export const DARK_BG_COLOR = '#111111';

// Typography
// Primary font stack — Segoe UI preferred (Windows/display hardware),
// falling back to Arial then Helvetica for Linux (Raspberry Pi).
// External font CDN loading is unreliable on Pi hardware — do not add
// web fonts here without hardware testing first.
export const FONT_STACK = '"Segoe UI", Arial, Helvetica, sans-serif';

// FFD brand red — used functionally only:
//   - Alert/urgent left border stripes
//   - Section header bars (weather conditions panel)
//   - Title dividers and underlines
//   - Accent dividers in info panels
// Never used as a decorative top border or purely ornamental element.
export const ACCENT_COLOR = '#C8102E';

// Text hierarchy — white at decreasing opacity levels.
// PRIMARY:   body text, values, titles
// SECONDARY: labels, metadata, subdued content
// TERTIARY:  timestamps, hints, least-important content
export const TEXT_PRIMARY   = 'rgba(255,255,255,0.92)';
export const TEXT_SECONDARY = 'rgba(255,255,255,0.68)';
export const TEXT_TERTIARY  = 'rgba(255,255,255,0.38)';

// Borders — white at two opacity levels.
// SUBTLE: standard card borders, dividers between sections
// STRONG: emphasized separators, today-panel borders
export const BORDER_SUBTLE = 'rgba(255,255,255,0.10)';
export const BORDER_STRONG = 'rgba(255,255,255,0.18)';

// Card elevation hierarchy — white fill at increasing opacity.
// Higher opacity = visually higher / more prominent surface.
// RECESSED: subtly inset cells within a card (e.g. day column bodies)
// BASE:     standard card surface
// ELEVATED: slightly raised blocks within a card
// HEADER:   today/primary panel header — highest card-level elevation
export const CARD_RECESSED = 'rgba(255,255,255,0.03)';
export const CARD_BASE     = 'rgba(255,255,255,0.06)';
export const CARD_ELEVATED = 'rgba(255,255,255,0.10)';
export const CARD_HEADER   = 'rgba(255,255,255,0.17)';