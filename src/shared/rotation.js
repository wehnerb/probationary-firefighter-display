// ============================================================
// rotation.js — Rotation and date helpers
// Fargo Fire Department station display Workers
//
// SOURCE OF TRUTH: ffd-station-display-utils repo
// Do not edit the copy in any Worker's src/shared/ directory —
// it will be overwritten on the next sync.
//
// Provides DST-safe date/time helpers for the display rotation
// system. All functions use America/Chicago via Intl.DateTimeFormat
// so DST transitions in spring and fall are handled correctly.
//
// Usage:
//   import {
//     getTodayString,
//     getDaysElapsed,
//     getBlockIndex,
//     getSecondsUntilNextRotation,
//     formatHireDate,
//   } from './shared/rotation.js';
// ============================================================

// Returns today's date string (YYYY-MM-DD) in America/Chicago time.
// Before rotationTime, returns yesterday's date so the rotation
// does not advance until the configured time rather than at midnight.
//
// @param {object} rotationTime - { hour: number, minute: number }
// @returns {string} YYYY-MM-DD date string in Central time
export function getTodayString(rotationTime) {
  var now   = new Date();
  var parts = {};

  var formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year:     'numeric',
    month:    '2-digit',
    day:      '2-digit',
    hour:     'numeric',
    minute:   'numeric',
    hour12:   false,
  });

  for (var i = 0; i < formatter.formatToParts(now).length; i++) {
    var part = formatter.formatToParts(now)[i];
    if (part.type !== 'literal') {
      parts[part.type] = parseInt(part.value, 10);
    }
  }

  var secondsSinceMidnight = parts.hour * 3600 + parts.minute * 60;
  var rotationSecondOfDay  = rotationTime.hour * 3600 + rotationTime.minute * 60;

  if (secondsSinceMidnight < rotationSecondOfDay) {
    var yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Chicago',
      year:     'numeric',
      month:    '2-digit',
      day:      '2-digit',
    }).format(yesterday);
  }

  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year:     'numeric',
    month:    '2-digit',
    day:      '2-digit',
  }).format(now);
}

// Returns the number of whole calendar days elapsed since the
// anchor date in America/Chicago time. Returns 0 if called
// before the anchor date.
//
// Both strings are YYYY-MM-DD in Central time, treated as UTC
// midnight for consistent integer-day arithmetic.
//
// @param {string} todayStr      - YYYY-MM-DD from getTodayString()
// @param {string} rotationAnchor - YYYY-MM-DD anchor date
// @returns {number} whole days elapsed since anchor
export function getDaysElapsed(todayStr, rotationAnchor) {
  var anchor   = new Date(rotationAnchor + 'T00:00:00Z');
  var today    = new Date(todayStr       + 'T00:00:00Z');
  var msPerDay = 1000 * 60 * 60 * 24;
  return Math.max(0, Math.floor((today - anchor) / msPerDay));
}

// Returns the zero-based index of the current rotation block.
// Use as: pool[getBlockIndex(todayStr, anchor, days) % pool.length]
//
// @param {string} todayStr      - YYYY-MM-DD from getTodayString()
// @param {string} rotationAnchor - YYYY-MM-DD anchor date
// @param {number} rotationDays  - days per rotation block
// @returns {number} zero-based block index
export function getBlockIndex(todayStr, rotationAnchor, rotationDays) {
  return Math.floor(getDaysElapsed(todayStr, rotationAnchor) / rotationDays);
}

// Returns the number of seconds until the next rotation time
// in America/Chicago time. DST-safe via Intl.DateTimeFormat.
//
// @param {object} rotationTime - { hour: number, minute: number }
// @returns {number} seconds until next rotation boundary
export function getSecondsUntilNextRotation(rotationTime) {
  var now   = new Date();
  var parts = {};

  var formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour:     'numeric',
    minute:   'numeric',
    second:   'numeric',
    hour12:   false,
  });

  for (var i = 0; i < formatter.formatToParts(now).length; i++) {
    var part = formatter.formatToParts(now)[i];
    if (part.type !== 'literal') {
      parts[part.type] = parseInt(part.value, 10);
    }
  }

  var secondsSinceMidnight =
    parts.hour * 3600 + parts.minute * 60 + parts.second;

  var rotationSecondOfDay =
    rotationTime.hour * 3600 + rotationTime.minute * 60;

  var secondsUntil = rotationSecondOfDay - secondsSinceMidnight;

  if (secondsUntil <= 0) {
    secondsUntil += 24 * 3600;
  }

  return secondsUntil;
}

// Formats a YYYY-MM-DD date string as a human-readable date,
// e.g. "January 19, 2026". Using noon UTC avoids DST-related
// date boundary edge cases.
//
// @param {string} dateStr - YYYY-MM-DD date string
// @returns {string} formatted date or empty string if invalid
export function formatHireDate(dateStr) {
  if (!dateStr) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year:     'numeric',
    month:    'long',
    day:      'numeric',
  }).format(new Date(dateStr + 'T12:00:00Z'));
}