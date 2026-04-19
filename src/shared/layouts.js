// ============================================================
// layouts.js — Shared display layout dimensions
// Fargo Fire Department station display Workers
//
// SOURCE OF TRUTH: ffd-station-display-utils repo
// Do not edit the copy in any Worker's src/shared/ directory —
// it will be overwritten on the next sync.
//
// These dimensions match the Raspberry Pi display hardware
// column widths. Do not change unless display hardware changes.
//
// Usage:
//   import { LAYOUTS, DEFAULT_LAYOUT } from './shared/layouts.js';
//   const layoutKey = (layoutParam in LAYOUTS) ? layoutParam : DEFAULT_LAYOUT;
//   const layout    = LAYOUTS[layoutKey];
//   const { width, height } = layout;
// ============================================================

// Pixel dimensions for each display column layout.
// full:  standalone full-screen display (1920x1075)
// wide:  single-column full-width layout (1735x720)
// split: two-column layout — default for most workers (852x720)
// tri:   three-column layout (558x720)
export const LAYOUTS = {
  full:  { width: 1920, height: 1075 },
  wide:  { width: 1735, height: 720  },
  split: { width: 852,  height: 720  },
  tri:   { width: 558,  height: 720  },
};

// Fallback layout key used when ?layout= parameter is missing or invalid.
// Individual workers may override this by using their own DEFAULT_LAYOUT
// constant — this export is provided as a convenience default only.
export const DEFAULT_LAYOUT = 'split';