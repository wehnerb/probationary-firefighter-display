// =============================================================================
// probationary-firefighter-display — Cloudflare Worker
// =============================================================================
// Fetches probationary firefighter bios from Google Sheets (structured data)
// and Google Drive (photos) and renders a styled HTML spotlight page for fire
// station displays.
//
// Display behavior:
//   - One firefighter shown per rotation slot (photo left, info right)
//   - Only firefighters hired within the past HIRE_ACTIVE_DAYS are shown
//   - Rotation anchored to ROTATION_ANCHOR, advancing at 7:30 AM Central
//   - After the last firefighter the list loops back to the first
//   - Blank fields and Q&A answers are silently omitted from the display
//
// Data sources:
//   - Firefighter data: Google Sheets (tab defined by SHEET_TAB_NAME)
//   - Photos:           Google Drive folder (GOOGLE_DRIVE_FOLDER_ID secret)
//
// Sheet structure:
//   Fixed reserved columns (identified by header name, case-insensitive):
//     Name, Badge, Hire Date, Shift, Rank, Photo, Hometown
//   All remaining columns are treated as dynamic Q&A pairs:
//     Column header = question text, cell value = answer text
//   Blank answer cells are ignored — their question is not displayed.
//
// Caching strategy:
//   - meta http-equiv="refresh" set to seconds until next 7:30 AM Central
//   - Cache-Control: no-store on all HTML responses
//   - Upstream API calls always fetched fresh per Worker invocation
//
// Security:
//   - All credentials stored as Cloudflare Worker secrets — never in source
//   - URL parameters sanitized before use
//   - All user-provided content HTML-escaped before injection into pages
//   - No X-Frame-Options header — this Worker is loaded as a full-screen
//     iframe by the display system; SAMEORIGIN causes immediate white screens
//   - Drive photos fetched server-side and embedded as base64 data URIs;
//     the display browser never contacts Google Drive directly
// =============================================================================


// -----------------------------------------------------------------------------
// CONFIGURATION — edit values in this section only for routine operation.
// No other section should require changes.
// -----------------------------------------------------------------------------

// Number of consecutive calendar days each firefighter displays before
// advancing to the next. Matches the daily-message-display rotation unit.
const ROTATION_DAYS = 3;

// Anchor date for the rotation cycle (YYYY-MM-DD, Central time).
// Matches the daily-message-display anchor so both Workers share the same
// rotation boundaries. Do not change unless intentionally resetting the cycle.
const ROTATION_ANCHOR = '2026-01-23';

// Time of day when the display advances to the next firefighter, in
// America/Chicago time. Matches the department shift change time.
// { hour: 24-hour integer, minute: 0-59 integer }
const ROTATION_TIME = { hour: 7, minute: 30 };

// Number of calendar days after hire date a firefighter remains active on
// the display. 365 = exactly one year.
const HIRE_ACTIVE_DAYS = 365;

// Default layout when no ?layout= parameter is provided.
// Options: 'full', 'wide', 'split', 'tri'
const DEFAULT_LAYOUT = 'wide';

// Layout pixel dimensions — must match the rest of the display system.
// Do not change unless display hardware changes.
const LAYOUTS = {
  full:  { width: 1920, height: 1075 },
  wide:  { width: 1735, height: 720  },
  split: { width: 852,  height: 720  },
  tri:   { width: 558,  height: 720  },
};

// Reserved column header names (lowercase). These are read as named fields.
// Every other column header in the sheet is treated as a Q&A question.
// Hometown is grouped with the fixed fields at the top of the info panel.
const FIXED_COLUMNS = new Set(['name', 'badge', 'hire date', 'shift', 'rank', 'photo', 'hometown']);

// FFD brand red — used for the title bar (full layout only) and accent divider.
const ACCENT_COLOR = '#C8102E';

// Dark background color used when ?bg=dark is specified. Approximates the
// dark charcoal texture of the station display system background, making
// text and layout easier to evaluate when testing in a browser.
const DARK_BG_COLOR = '#111111';

// Name of the data tab in the Google Sheet.
// Update this constant if the tab is ever renamed.
const SHEET_TAB_NAME = 'Firefighters';

// Google OAuth2 scope for Sheets and Drive API access.
// drive.readonly covers both APIs with a single token.
const GOOGLE_AUTH_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

// How long the error/retry page waits before reloading (seconds).
const ERROR_RETRY_SECONDS = 60;

// Minimum meta-refresh interval in seconds. Prevents the refresh from becoming
// unreasonably short if the Worker runs just before 7:30 AM.
const MIN_REFRESH_SECONDS = 300;

// Workers Cache API version. Increment this integer to immediately invalidate
// all cached pages — useful after code changes that affect the rendered output.
const CACHE_VERSION = 1;


// =============================================================================
// MAIN WORKER ENTRY POINT
// =============================================================================

export default {
  async fetch(request, env) {

    // Reject non-GET requests with a generic status to reduce attack surface.
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405 });
    }

    // Parse and validate the layout URL parameter before the try block so the
    // error page renderer always has a valid layout to work with.
    const url         = new URL(request.url);
    const layoutParam = sanitizeParam(url.searchParams.get('layout')) || DEFAULT_LAYOUT;
    const layoutKey   = (layoutParam in LAYOUTS) ? layoutParam : DEFAULT_LAYOUT;
    const layout      = LAYOUTS[layoutKey];

    // ?bg=dark renders a dark background instead of transparent. Intended for
    // browser-based testing where the display system background is not present.
    // Production display URLs should never include this parameter.
    const darkBg = url.searchParams.get('bg') === 'dark';

    // Compute the rotation block index synchronously before the cache check.
    // The block index is stable for ROTATION_DAYS days at a time and serves
    // as the cache key discriminator — when it changes, the old cache entry
    // is naturally bypassed and a fresh page is generated and cached.
    const todayStr   = getTodayString();
    const blockIndex = getBlockIndex(todayStr);

    // --- Workers Cache API ---
    // The rendered page is expensive to generate: JWT signing, OAuth token
    // exchange, Sheets fetch, Drive folder listing, and photo base64 encoding
    // all occur on every cache miss. Caching prevents these operations from
    // running on every display screen request.
    //
    // Cache key includes CACHE_VERSION (for manual invalidation), layoutKey
    // (each layout renders differently), and blockIndex (rotates every 3 days).
    // ?bg=dark requests bypass the cache entirely — they are for browser-based
    // testing only and must not pollute the production cache.
    const cache    = caches.default;
    const cacheKey = new Request(
      'https://prob-display-cache.internal/v' + CACHE_VERSION +
      '/' + layoutKey + '/' + blockIndex,
      { method: 'GET' }
    );

    if (!darkBg) {
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
    }

    try {
      // Obtain a Google OAuth2 access token. The drive.readonly scope covers
      // both the Google Sheets API and the Google Drive API so a single token
      // handles all upstream requests.
      const accessToken = await getAccessToken(
        env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        env.GOOGLE_PRIVATE_KEY
      );

      // Fetch firefighter records and the Drive photo map in parallel.
      const [firefighters, photoMap] = await Promise.all([
        fetchFirefighters(env, accessToken),
        buildPhotoMap(env, accessToken),
      ]);

      // Filter to firefighters hired within the past HIRE_ACTIVE_DAYS, then
      // sort by hire date ascending, then badge number ascending. A consistent
      // stable sort ensures the same firefighter always occupies the same
      // rotation slot on a given day regardless of when the Worker runs.
      const active = firefighters
        .filter(ff => isActive(ff.hireDate, todayStr))
        .sort((a, b) => {
          if (a.hireDate !== b.hireDate) return a.hireDate.localeCompare(b.hireDate);
          // Within the same hire date, sort by badge number numerically.
          // Firefighters with no badge number sort after those with one.
          const badgeA = a.badge ? parseInt(a.badge, 10) : Infinity;
          const badgeB = b.badge ? parseInt(b.badge, 10) : Infinity;
          return badgeA - badgeB;
        });

      if (active.length === 0) {
        return renderNoActivePage(layout, layoutKey, darkBg);
      }

      // Select the current firefighter from the active list using the rotation
      // block index computed before the cache check. Modulo wraps the index
      // after the last firefighter so the list loops continuously.
      const firefighter = active[blockIndex % active.length];

      // Look up the firefighter's photo in the Drive map (case-insensitive).
      // A missing or unmatched photo filename is logged but not fatal — the
      // page renders with a silhouette placeholder instead.
      let photoData = null;
      if (firefighter.photo) {
        const fileId = photoMap.get(firefighter.photo.toLowerCase());
        if (fileId) {
          photoData = await fetchPhotoData(fileId, accessToken);
        } else {
          console.error(
            'Photo not found in Drive folder for "' + firefighter.name +
            '": ' + firefighter.photo
          );
        }
      }

      // Calculate seconds until the next 7:30 AM Central rotation for the
      // meta-refresh interval. Clamp to the minimum to avoid very short
      // intervals near the rotation boundary.
      const refreshSeconds = Math.max(
        MIN_REFRESH_SECONDS,
        getSecondsUntilNextRotation()
      );

      const html = buildFirefighterPage(
        firefighter, photoData, layout, layoutKey, refreshSeconds, darkBg
      );

      const response = new Response(html, {
        status: 200,
        headers: {
          'Content-Type':           'text/html; charset=utf-8',
          // no-store prevents the browser from caching the HTML page itself.
          // The meta-refresh interval controls how often the display reloads.
          'Cache-Control':          'no-store',
          'X-Content-Type-Options': 'nosniff',
          // NOTE: X-Frame-Options is intentionally NOT set here.
          // This Worker is embedded as a full-screen iframe by the display
          // system. Adding X-Frame-Options: SAMEORIGIN would cause immediate
          // white screens on every station display.
        },
      });

      // Store a separately-headered copy in the Workers Cache API.
      // The TTL is 3 days — long enough to cover an entire rotation block.
      // The block index in the cache key naturally invalidates the entry when
      // the rotation advances so no explicit purge is ever required.
      // ?bg=dark requests are never cached.
      if (!darkBg) {
        const responseToCache = new Response(html, {
          status: 200,
          headers: {
            'Content-Type':           'text/html; charset=utf-8',
            'Cache-Control':          'public, max-age=' + (3 * 24 * 3600),
            'X-Content-Type-Options': 'nosniff',
          },
        });
        await cache.put(cacheKey, responseToCache);
      }

      return response;

    } catch (err) {
      // Log the full error server-side but return only a generic message to
      // the client to avoid leaking implementation details.
      console.error('Worker unhandled error:', err);
      return renderErrorPage('SYSTEM ERROR', 'Retrying shortly', layout, layoutKey, darkBg);
    }
  },
};


// =============================================================================
// DATE, ROTATION, AND ACTIVE-STATUS HELPERS
// =============================================================================
// The rotation functions below are copied directly from daily-message-display
// to guarantee identical 7:30 AM Central boundaries and DST behavior across
// both Workers. Do not modify the logic without also updating the other Worker.

// Returns today's date string (YYYY-MM-DD) in America/Chicago time.
// Before ROTATION_TIME (7:30 AM Central), returns yesterday's date so the
// rotation doesn't advance until 7:30 AM rather than at midnight.
function getTodayString() {
  const now   = new Date();
  const parts = {};

  for (const part of new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year:     'numeric',
    month:    '2-digit',
    day:      '2-digit',
    hour:     'numeric',
    minute:   'numeric',
    hour12:   false,
  }).formatToParts(now)) {
    if (part.type !== 'literal') {
      parts[part.type] = parseInt(part.value, 10);
    }
  }

  // If before ROTATION_TIME, use yesterday's date so the rotation
  // doesn't advance until 7:30 AM Central rather than at midnight.
  const secondsSinceMidnight = parts.hour * 3600 + parts.minute * 60;
  const rotationSecondOfDay  = ROTATION_TIME.hour * 3600 + ROTATION_TIME.minute * 60;

  if (secondsSinceMidnight < rotationSecondOfDay) {
    // Before 7:30 AM — step back one day
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Chicago',
      year:     'numeric',
      month:    '2-digit',
      day:      '2-digit',
    }).format(yesterday);
  }

  // 7:30 AM or later — use today's date
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year:     'numeric',
    month:    '2-digit',
    day:      '2-digit',
  }).format(now);
}

// Returns the number of whole calendar days elapsed since ROTATION_ANCHOR
// in America/Chicago time. Returns 0 if called before the anchor date.
// Both strings are treated as UTC midnight — they are already Central date
// strings (YYYY-MM-DD) so no offset conversion is needed for day counting.
function getDaysElapsed(todayStr) {
  const anchor   = new Date(ROTATION_ANCHOR + 'T00:00:00Z');
  const today    = new Date(todayStr        + 'T00:00:00Z');
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.max(0, Math.floor((today - anchor) / msPerDay));
}

// Returns the zero-based index of the current ROTATION_DAYS-day block.
// Use as: active[getBlockIndex(todayStr) % active.length]
function getBlockIndex(todayStr) {
  return Math.floor(getDaysElapsed(todayStr) / ROTATION_DAYS);
}

// Returns the number of seconds until the next ROTATION_TIME in Central time.
// DST-safe: Intl.DateTimeFormat with America/Chicago handles spring and fall
// transitions correctly so the boundary always falls at 7:30 AM local time.
function getSecondsUntilNextRotation() {
  const now   = new Date();
  const parts = {};

  for (const part of new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour:     'numeric',
    minute:   'numeric',
    second:   'numeric',
    hour12:   false,
  }).formatToParts(now)) {
    if (part.type !== 'literal') {
      parts[part.type] = parseInt(part.value, 10);
    }
  }

  const secondsSinceMidnight =
    parts.hour * 3600 + parts.minute * 60 + parts.second;

  const rotationSecondOfDay =
    ROTATION_TIME.hour * 3600 + ROTATION_TIME.minute * 60;

  let secondsUntil = rotationSecondOfDay - secondsSinceMidnight;

  // If today's rotation time has already passed, target tomorrow's.
  if (secondsUntil <= 0) {
    secondsUntil += 24 * 3600;
  }

  return secondsUntil;
}

// Returns true if the firefighter is within HIRE_ACTIVE_DAYS of their hire
// date. Both date strings are in YYYY-MM-DD format (Central time).
// A firefighter hired today (daysOn = 0) is active; one hired exactly
// HIRE_ACTIVE_DAYS ago is no longer active.
function isActive(hireDateStr, todayStr) {
  if (!hireDateStr) return false;
  const hire     = new Date(hireDateStr + 'T00:00:00Z');
  const today    = new Date(todayStr    + 'T00:00:00Z');
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysOn   = Math.floor((today - hire) / msPerDay);
  return daysOn >= 0 && daysOn < HIRE_ACTIVE_DAYS;
}

// Formats a YYYY-MM-DD date string as "Month D, YYYY" (e.g. "January 19, 2026").
// Using noon UTC avoids any DST-related date boundary edge cases.
function formatHireDate(dateStr) {
  if (!dateStr) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year:     'numeric',
    month:    'long',
    day:      'numeric',
  }).format(new Date(dateStr + 'T12:00:00Z'));
}


// =============================================================================
// GOOGLE SERVICE ACCOUNT AUTHENTICATION
// =============================================================================
// Generates a short-lived Google OAuth2 access token from service account
// credentials stored as Worker secrets. Uses RSA-SHA256 JWT signing via the
// Web Crypto API built into Cloudflare Workers — no external dependencies.
// Copied from daily-message-display, which shares the same service account.
//
// Required secrets:
//   GOOGLE_SERVICE_ACCOUNT_EMAIL — service account email address
//   GOOGLE_PRIVATE_KEY           — RSA private key from Google Cloud JSON key

async function getAccessToken(email, rawPrivateKey) {

  // Step 1 — Build the JWT header and payload.
  const now     = Math.floor(Date.now() / 1000);
  const header  = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss:   email,
    scope: GOOGLE_AUTH_SCOPE,
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  }));

  const signingInput = header + '.' + payload;

  // Step 2 — Import the RSA private key via the Web Crypto API.
  // The key arrives from the GitHub secret with literal \n sequences;
  // convert them to real newlines before stripping the PEM envelope.
  const pemString = rawPrivateKey.replace(/\\n/g, '\n');
  const pemBody   = pemString
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace('-----BEGIN RSA PRIVATE KEY-----', '')
    .replace('-----END RSA PRIVATE KEY-----', '')
    .replace(/\n/g, '')
    .trim();

  const binaryKey = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  // Step 3 — Sign the JWT.
  // arrayBufferToBase64url uses a byte-by-byte loop to avoid call-stack
  // overflow on large buffers like RSA signatures.
  const signatureBuf = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const jwt = signingInput + '.' + arrayBufferToBase64url(signatureBuf);

  // Step 4 — Exchange the signed JWT for a short-lived access token.
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + jwt,
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error('Token exchange failed (' + tokenRes.status + '): ' + errText);
  }

  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

// Encodes a string to base64url format (used in JWT construction).
function base64url(str) {
  return btoa(str)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// Converts an ArrayBuffer to base64url using a safe byte-by-byte loop.
// The spread operator can throw a RangeError on large buffers — this avoids it.
function arrayBufferToBase64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}


// =============================================================================
// GOOGLE SHEETS — fetch firefighter records
// =============================================================================

// Reads all rows from the Firefighters tab. Fixed columns are mapped by name;
// every remaining column is treated as a Q&A pair with the header as the
// question and the cell value as the answer. Blank answer cells are omitted.
async function fetchFirefighters(env, accessToken) {
  const sheetUrl =
    'https://sheets.googleapis.com/v4/spreadsheets/' +
    encodeURIComponent(env.GOOGLE_SHEET_ID) +
    '/values/' +
    encodeURIComponent(SHEET_TAB_NAME) +
    '?majorDimension=ROWS';

  const res = await fetch(sheetUrl, {
    headers: { 'Authorization': 'Bearer ' + accessToken },
    cf: { cacheTtl: 0 }, // always fetch fresh data on each Worker invocation
  });

  if (!res.ok) {
    console.error('Sheets API error (' + res.status + '): ' + await res.text());
    return [];
  }

  const data = await res.json();
  const rows = data.values || [];

  if (rows.length < 2) return []; // empty sheet or header row only

  // Map each column header to its zero-based index (case-insensitive).
  const rawHeaders = rows[0];
  const headers    = rawHeaders.map(h => (h || '').trim().toLowerCase());

  // Locate fixed column indices by name.
  const col = name => headers.indexOf(name.toLowerCase());

  const nameCol     = col('name');
  const badgeCol    = col('badge');
  const hireDateCol = col('hire date');
  const shiftCol    = col('shift');
  const rankCol     = col('rank');
  const photoCol    = col('photo');
  const hometownCol = col('hometown');

  // Name and Hire Date are the minimum required columns. If either is missing
  // the Worker cannot function correctly — log and return empty rather than
  // producing incorrect output.
  if (nameCol === -1 || hireDateCol === -1) {
    console.error(
      'Google Sheet is missing required columns. ' +
      'Expected at minimum: "Name" and "Hire Date". ' +
      'Columns found: ' + rawHeaders.join(', ')
    );
    return [];
  }

  // Collect Q&A column definitions in original sheet order. All columns not
  // in FIXED_COLUMNS are treated as questions. Column order in the sheet
  // determines the order questions appear on the display.
  const qaColumns = [];
  for (let i = 0; i < rawHeaders.length; i++) {
    if (!FIXED_COLUMNS.has(headers[i])) {
      qaColumns.push({ index: i, question: rawHeaders[i].trim() });
    }
  }

  const firefighters = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];

    // Read a cell by column index. Returns an empty string if the column
    // index is -1 (column not in sheet) or the cell is missing/blank.
    const cell = idx => (idx !== -1 && row[idx] ? String(row[idx]).trim() : '');

    const name     = cell(nameCol);
    const hireDate = cell(hireDateCol);

    // Skip rows with no name or hire date — likely blank rows in the sheet.
    if (!name || !hireDate) continue;

    // Validate hire date format. A malformed date would break active-status
    // and rotation calculations, so log and skip the row.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(hireDate)) {
      console.error(
        'Row ' + (i + 1) + ' skipped — invalid hire date format: "' + hireDate +
        '". Expected YYYY-MM-DD.'
      );
      continue;
    }

    // Collect non-blank Q&A pairs in column order. Blank answers are already
    // filtered here so the HTML builder never receives an empty answer.
    const qa = [];
    for (const { index, question } of qaColumns) {
      const answer = cell(index);
      if (answer) {
        qa.push({ question, answer });
      }
    }

    firefighters.push({
      name,
      badge:    cell(badgeCol),
      hireDate,
      shift:    cell(shiftCol),
      rank:     cell(rankCol),
      photo:    cell(photoCol),
      hometown: cell(hometownCol),
      qa,
    });
  }

  return firefighters;
}


// =============================================================================
// GOOGLE DRIVE — photo map and fetching
// =============================================================================

// Fetches the list of image files in the configured Drive folder and returns
// a Map of lowercase filename → Drive file ID. Using lowercase keys enables
// case-insensitive lookup when matching the Photo column value from the sheet.
// pageSize=200 is generous for a probationary firefighter roster; if the
// department ever exceeds 200 photos in this folder, pagination will be needed.
async function buildPhotoMap(env, accessToken) {
  const query =
    "'" + env.GOOGLE_DRIVE_FOLDER_ID + "' in parents" +
    " and mimeType != 'application/vnd.google-apps.folder'" +
    " and trashed = false";

  const driveUrl =
    'https://www.googleapis.com/drive/v3/files' +
    '?q=' + encodeURIComponent(query) +
    '&fields=files(id,name,mimeType)' +
    '&pageSize=200';

  const res = await fetch(driveUrl, {
    headers: { 'Authorization': 'Bearer ' + accessToken },
    cf: { cacheTtl: 0 },
  });

  if (!res.ok) {
    console.error('Drive API error (' + res.status + '): ' + await res.text());
    return new Map();
  }

  const data  = await res.json();
  const files = data.files || [];
  const map   = new Map();

  for (const file of files) {
    // Only map recognized image MIME types as a defense-in-depth measure even
    // though the query already excludes folders and Google Apps file types.
    if (!file.mimeType || !file.mimeType.startsWith('image/')) continue;
    map.set(file.name.toLowerCase(), file.id);
  }

  return map;
}

// Fetches a Drive file's binary content and returns it as a base64 data URI
// for inline embedding. The display browser never contacts Drive directly.
// Returns null on any failure so the page renders with a silhouette placeholder
// rather than crashing the entire Worker.
async function fetchPhotoData(fileId, accessToken) {
  try {
    const res = await fetch(
      'https://www.googleapis.com/drive/v3/files/' +
        encodeURIComponent(fileId) + '?alt=media',
      { headers: { 'Authorization': 'Bearer ' + accessToken } }
    );

    if (!res.ok) {
      console.error(
        'Photo fetch failed (' + res.status + ') for Drive file ID: ' + fileId
      );
      return null;
    }

    // Convert binary response to base64 in fixed-size chunks to avoid
    // call-stack overflow on large images (same safe pattern as other Workers).
    const arrayBuffer = await res.arrayBuffer();
    const bytes       = new Uint8Array(arrayBuffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }

    const mimeType = res.headers.get('content-type') || 'image/jpeg';
    return {
      dataUri: 'data:' + mimeType + ';base64,' + btoa(binary),
      mimeType,
    };

  } catch (err) {
    console.error('Photo fetch exception for Drive file ID "' + fileId + '":', err);
    return null;
  }
}


// =============================================================================
// INPUT HELPERS
// =============================================================================

// Sanitizes a URL parameter value to prevent injection attacks.
// Allows only alphanumeric characters, hyphens, and underscores.
function sanitizeParam(value) {
  if (!value || typeof value !== 'string') return null;
  return value.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 50);
}

// Escapes a string for safe insertion into HTML content.
// Applied to all values sourced from the Google Sheet before injection.
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


// =============================================================================
// HTML PAGE BUILDERS
// =============================================================================

// Builds the firefighter spotlight page.
//
// Layout arrangement:
//   wide / full  — photo on the left (~42% width), info panel on the right
//   split / tri  — photo stacked on top (~38% of height), info panel below
//
// The "PROBATIONARY FIREFIGHTERS" title bar is rendered only in the full
// layout. Wide, split, and tri layouts have a title bar provided by the
// display system — adding one here would be redundant.
//
// Info panel content order:
//   1. Firefighter name (large, bold)
//   2. Rank / title (if present)
//   3. Red accent divider
//   4. Fixed fields: Hire Date, Shift, Badge, Hometown (each omitted if blank)
//   5. Larger gap
//   6. Q&A pairs distributed evenly across remaining vertical space
//
// If no photo is available, a generic person silhouette SVG is shown in the
// photo column so the layout remains consistent regardless of photo status.
//
// outerPad applies equal spacing between the display edges and all content,
// including the space between the photo and the left/top/bottom edges.
// The full-layout title bar spans the full width above the outer padding.
//
// darkBg: when true, renders DARK_BG_COLOR instead of transparent. Used for
// browser-based testing where the display system background is not present.
// String concatenation used throughout to prevent smart-quote corruption when
// the file is edited in GitHub's browser editor.
function buildFirefighterPage(firefighter, photoData, layout, layoutKey, refreshSeconds, darkBg) {
  const { width, height } = layout;

  const isWideFamily = (layoutKey === 'wide' || layoutKey === 'full');
  const showTitle    = (layoutKey === 'full');

  // --- Proportional font sizing ---
  // All sizes are derived from the smaller layout dimension so the page
  // scales consistently across wide, full, split, and tri layouts.
  const minDim        = Math.min(width, height);
  const nameFontSize  = Math.floor(minDim * 0.058); // e.g. 720px * 0.058 = 42px
  const rankFontSize  = Math.floor(minDim * 0.032); // e.g. 720px * 0.032 = 23px
  const fieldFontSize = Math.floor(minDim * 0.029); // fixed fields (hire date, shift, badge, hometown)
  const qaFontSize    = Math.floor(minDim * 0.026); // Q&A question/answer pairs
  const titleFontSize = Math.floor(minDim * 0.034); // full layout title bar only

  // --- Outer padding ---
  // Applied as a margin on the content area on all four sides, creating a
  // consistent gap between the display edges and all content. This includes
  // the gap between the photo and the left/top/bottom edges of the display.
  // The full-layout title bar spans the full width outside this padding.
  const outerPad = Math.floor(minDim * 0.022); // e.g. 720px * 0.022 = ~16px

  // --- Title bar geometry (full layout only) ---
  // Title bar spans full width above the outer-padded content area.
  const titleBarHeight = showTitle ? Math.floor(height * 0.072) : 0; // ~77px at 1075px

  // --- Content area geometry ---
  // Subtract outer padding from all sides so the photo and info panel sit
  // within the padded region. The title bar height is excluded from the top.
  const availableWidth  = width  - 2 * outerPad;
  const availableHeight = height - titleBarHeight - 2 * outerPad;

  // Photo and info dimensions differ by layout family.
  // Wide/full: horizontal split. Split/tri: vertical stack.
  const photoWidth  = isWideFamily ? Math.floor(availableWidth * 0.42) : availableWidth;
  const photoHeight = isWideFamily ? availableHeight                    : Math.floor(availableHeight * 0.38);
  const infoWidth   = isWideFamily ? (availableWidth - photoWidth)      : availableWidth;
  const infoHeight  = isWideFamily ? availableHeight                    : (availableHeight - photoHeight);

  // Padding inside the info panel, proportional to its own dimensions.
  const padH = Math.floor(infoWidth  * 0.05);
  const padV = Math.floor(infoHeight * 0.05);

  // --- Fixed field rows ---
  // Displayed in a consistent order: Hire Date → Shift → Badge → Hometown.
  // Any field whose value is blank is omitted entirely.
  let fixedFieldsHtml = '';

  const hireFormatted = formatHireDate(firefighter.hireDate);
  if (hireFormatted) {
    fixedFieldsHtml +=
      '<div class="field-row">' +
      '<span class="field-label">Hire Date: </span>' +
      '<span class="field-value">' + escapeHtml(hireFormatted) + '</span>' +
      '</div>';
  }
  if (firefighter.shift) {
    fixedFieldsHtml +=
      '<div class="field-row">' +
      '<span class="field-label">Shift: </span>' +
      '<span class="field-value">' + escapeHtml(firefighter.shift) + '</span>' +
      '</div>';
  }
  if (firefighter.badge) {
    fixedFieldsHtml +=
      '<div class="field-row">' +
      '<span class="field-label">Badge: </span>' +
      '<span class="field-value">' + escapeHtml(firefighter.badge) + '</span>' +
      '</div>';
  }
  if (firefighter.hometown) {
    fixedFieldsHtml +=
      '<div class="field-row">' +
      '<span class="field-label">Hometown: </span>' +
      '<span class="field-value">' + escapeHtml(firefighter.hometown) + '</span>' +
      '</div>';
  }

  // --- Q&A rows ---
  // Blank answers were already removed during sheet parsing so every entry
  // here has a non-empty answer. Questions appear in original column order.
  // Rows are wrapped in .qa-section which uses flexbox space-evenly to
  // distribute them across whatever vertical space remains after the fixed
  // fields, filling the panel naturally regardless of how many questions exist.
  let qaHtml = '';
  for (let qi = 0; qi < firefighter.qa.length; qi++) {
    const question = firefighter.qa[qi].question;
    const answer   = firefighter.qa[qi].answer;
    qaHtml +=
      '<div class="qa-row">' +
      '<span class="qa-label">' + escapeHtml(question) + ': </span>' +
      '<span class="qa-value">' + escapeHtml(answer) + '</span>' +
      '</div>';
  }

  // --- Photo block ---
  // If no photo is available, a generic person silhouette SVG is shown so
  // the layout remains visually consistent. The silhouette uses a dark
  // background with a neutral gray figure matching the display aesthetic.
  const photoHtml = photoData
    ? '<img src="' + photoData.dataUri + '" alt="Photo of ' +
        escapeHtml(firefighter.name) + '">'
    : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 260" ' +
        'style="width:100%;height:100%;display:block;">' +
        '<rect width="200" height="260" fill="#1a1a1a"/>' +
        '<circle cx="100" cy="82" r="46" fill="#555"/>' +
        '<path d="M0,260 C0,165 38,145 100,140 C162,145 200,165 200,260 Z" fill="#555"/>' +
        '</svg>';

  // --- Title bar (full layout only) ---
  const titleHtml = showTitle
    ? '<div class="title-bar">PROBATIONARY FIREFIGHTERS</div>'
    : '';

  // --- CSS ---
  const css =
    '*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }' +

    // Background: transparent in production so the display system texture shows
    // through. Dark (#111111) when ?bg=dark is set for browser-based testing.
    'html, body {' +
    '  width: '            + width  + 'px;' +
    '  height: '           + height + 'px;' +
    '  overflow: hidden;' +
    '  background: ' + (darkBg || layoutKey === 'full' ? DARK_BG_COLOR : 'transparent') + ';' +
    '  font-family: "Segoe UI", Arial, Helvetica, sans-serif;' +
    '}' +

    // Title bar — full layout only; spans the full width outside outer padding
    '.title-bar {' +
    '  width: 100%;' +
    '  height: '                + titleBarHeight + 'px;' +
    '  background: '            + ACCENT_COLOR   + ';' +
    '  display: flex;' +
    '  align-items: center;' +
    '  justify-content: center;' +
    '  font-size: '             + titleFontSize  + 'px;' +
    '  font-weight: 700;' +
    '  letter-spacing: 0.12em;' +
    '  text-transform: uppercase;' +
    '  color: #ffffff;' +
    '}' +

    // Outer padding wrapper — creates a consistent gap between display edges
    // and all content on all four sides, including around the photo
    '.outer {' +
    '  padding: ' + outerPad + 'px;' +
    '  width: '   + width    + 'px;' +
    '  height: '  + (height - titleBarHeight) + 'px;' +
    '}' +

    // Content row/column container — sized to the available area after padding
    '.content {' +
    '  display: flex;' +
    '  flex-direction: ' + (isWideFamily ? 'row' : 'column') + ';' +
    '  width: '          + availableWidth  + 'px;' +
    '  height: '         + availableHeight + 'px;' +
    '}' +

    // Photo column — no internal padding; outer padding handles edge spacing
    '.photo-col {' +
    '  flex: 0 0 ' + photoWidth  + 'px;' +
    '  width: '    + photoWidth  + 'px;' +
    '  height: '   + photoHeight + 'px;' +
    '  overflow: hidden;' +
    '}' +
    // Image fills the column; anchored to top so faces are not cropped
    '.photo-col img {' +
    '  width: 100%;' +
    '  height: 100%;' +
    '  object-fit: cover;' +
    '  object-position: center top;' +
    '  display: block;' +
    '}' +

    // Info panel — flex column so .qa-section can grow to fill remaining space
    '.info-col {' +
    '  flex: 1;' +
    '  width: '    + infoWidth  + 'px;' +
    '  height: '   + infoHeight + 'px;' +
    '  padding: '  + padV + 'px ' + padH + 'px;' +
    '  overflow: hidden;' +
    '  display: flex;' +
    '  flex-direction: column;' +
    '}' +

    // Firefighter name
    '.name {' +
    '  font-size: '     + nameFontSize + 'px;' +
    '  font-weight: 700;' +
    '  color: #ffffff;' +
    '  line-height: 1.15;' +
    '  margin-bottom: ' + Math.floor(nameFontSize * 0.18) + 'px;' +
    '  flex-shrink: 0;' +
    '}' +

    // Rank / title
    '.rank {' +
    '  font-size: '     + rankFontSize + 'px;' +
    '  font-weight: 400;' +
    '  color: rgba(255,255,255,0.75);' +
    '  margin-bottom: ' + Math.floor(rankFontSize * 0.45) + 'px;' +
    '  flex-shrink: 0;' +
    '}' +

    // Red accent divider between name/rank and fixed fields
    '.divider {' +
    '  width: 55%;' +
    '  height: 2px;' +
    '  background: ' + ACCENT_COLOR + ';' +
    '  margin-bottom: ' + Math.floor(fieldFontSize * 0.65) + 'px;' +
    '  opacity: 0.85;' +
    '  flex-shrink: 0;' +
    '}' +

    // Fixed field rows (Hire Date, Shift, Badge, Hometown)
    '.field-row {' +
    '  font-size: '     + fieldFontSize + 'px;' +
    '  line-height: 1.5;' +
    '  margin-bottom: ' + Math.floor(fieldFontSize * 0.12) + 'px;' +
    '  flex-shrink: 0;' +
    '}' +
    '.field-label {' +
    '  font-weight: 700;' +
    '  color: #ffffff;' +
    '}' +
    '.field-value {' +
    '  font-weight: 400;' +
    '  color: rgba(255,255,255,0.75);' +
    '}' +

    // Q&A section — grows to fill all remaining vertical space, then
    // distributes questions evenly within that space using space-evenly.
    // Fewer questions get larger gaps; more questions get smaller gaps.
    '.qa-section {' +
    '  flex: 1;' +
    '  display: flex;' +
    '  flex-direction: column;' +
    '  justify-content: space-evenly;' +
    '  overflow: hidden;' +
    '  margin-top: ' + Math.floor(fieldFontSize * 1.2) + 'px;' +
    '}' +

    // Q&A pair rows — no fixed margin; spacing handled by space-evenly
    '.qa-row {' +
    '  font-size: '  + qaFontSize + 'px;' +
    '  line-height: 1.4;' +
    '}' +
    '.qa-label {' +
    '  font-weight: 700;' +
    '  color: #ffffff;' +
    '}' +
    '.qa-value {' +
    '  font-weight: 400;' +
    '  color: rgba(255,255,255,0.75);' +
    '}';

  // --- Assemble final HTML ---
  return (
    '<!DOCTYPE html>' +
    '<html lang="en">' +
    '<head>' +
    '<meta charset="UTF-8">' +
    '<meta http-equiv="refresh" content="' + refreshSeconds + '">' +
    '<meta name="viewport" content="width=' + width + ', height=' + height + '">' +
    '<title>Probationary Firefighters</title>' +
    '<style>' + css + '</style>' +
    '</head>' +
    '<body>' +
    titleHtml +
    '<div class="outer">' +
      '<div class="content">' +
        '<div class="photo-col">' + photoHtml + '</div>' +
        '<div class="info-col">' +
          '<div class="name">' + escapeHtml(firefighter.name) + '</div>' +
          (firefighter.rank
            ? '<div class="rank">' + escapeHtml(firefighter.rank) + '</div>'
            : '') +
          '<div class="divider"></div>' +
          fixedFieldsHtml +
          (qaHtml
            ? '<div class="qa-section">' + qaHtml + '</div>'
            : '') +
        '</div>' +
      '</div>' +
    '</div>' +
    '</body>' +
    '</html>'
  );
}

// Renders a page when no firefighters are currently within their active year.
// Not cached — this is an unusual state that should resolve as soon as new
// hires are entered in the sheet, so it rechecks on every display refresh.
function renderNoActivePage(layout, layoutKey, darkBg) {
  const { width, height } = layout;
  const titleFont = Math.floor(Math.min(width, height) * 0.030);
  const subFont   = Math.floor(Math.min(width, height) * 0.020);

  return new Response(
    '<!DOCTYPE html>' +
    '<html lang="en">' +
    '<head>' +
    '<meta charset="UTF-8">' +
    '<meta http-equiv="refresh" content="' + ERROR_RETRY_SECONDS + '">' +
    '<title>Probationary Firefighters</title>' +
    '<style>' +
    '*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }' +
    'html, body {' +
    '  width: '     + width  + 'px;' +
    '  height: '    + height + 'px;' +
    '  overflow: hidden;' +
    '  background: ' + (darkBg || layoutKey === 'full' ? DARK_BG_COLOR : 'transparent') + ';' +
    '  font-family: "Segoe UI", Arial, Helvetica, sans-serif;' +
    '  display: flex; align-items: center; justify-content: center;' +
    '}' +
    '.err-wrap { display: flex; flex-direction: column; align-items: center; gap: ' + Math.floor(subFont * 0.6) + 'px; text-align: center; padding: 0 ' + Math.floor(width * 0.08) + 'px; }' +
    '.err-title { font-size: ' + titleFont + 'px; font-weight: 700; color: rgba(255,255,255,0.92); letter-spacing: 0.06em; }' +
    '.err-sub   { font-size: ' + subFont   + 'px; color: rgba(255,255,255,0.55); }' +
    '</style>' +
    '</head>' +
    '<body>' +
    '<div class="err-wrap">' +
    '<div class="err-title">NO ACTIVE PROBATIONARY FIREFIGHTERS</div>' +
    '<div class="err-sub">Check back when new hires are added to the roster</div>' +
    '</div>' +
    '</body>' +
    '</html>',
    {
      status: 200,
      headers: {
        'Content-Type':           'text/html; charset=utf-8',
        'Cache-Control':          'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    }
  );
}

// Renders a generic error page with a short retry interval.
// Not cached — error states should recheck on every display refresh.
function renderErrorPage(title, subtitle, layout, layoutKey, darkBg) {
  const { width, height } = layout;
  const titleFont = Math.floor(Math.min(width, height) * 0.030);
  const subFont   = Math.floor(Math.min(width, height) * 0.020);

  return new Response(
    '<!DOCTYPE html>' +
    '<html lang="en">' +
    '<head>' +
    '<meta charset="UTF-8">' +
    '<meta http-equiv="refresh" content="' + ERROR_RETRY_SECONDS + '">' +
    '<title>Probationary Firefighters</title>' +
    '<style>' +
    '*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }' +
    'html, body {' +
    '  width: '     + width  + 'px;' +
    '  height: '    + height + 'px;' +
    '  overflow: hidden;' +
    '  background: ' + (darkBg || layoutKey === 'full' ? DARK_BG_COLOR : 'transparent') + ';' +
    '  font-family: "Segoe UI", Arial, Helvetica, sans-serif;' +
    '  display: flex; align-items: center; justify-content: center;' +
    '}' +
    '.err-wrap { display: flex; flex-direction: column; align-items: center; gap: ' + Math.floor(subFont * 0.6) + 'px; text-align: center; padding: 0 ' + Math.floor(width * 0.08) + 'px; }' +
    '.err-title { font-size: ' + titleFont + 'px; font-weight: 700; color: rgba(255,255,255,0.92); letter-spacing: 0.06em; }' +
    '.err-sub   { font-size: ' + subFont   + 'px; color: rgba(255,255,255,0.55); }' +
    '</style>' +
    '</head>' +
    '<body>' +
    '<div class="err-wrap">' +
    '<div class="err-title">' + escapeHtml(title)    + '</div>' +
    '<div class="err-sub">'   + escapeHtml(subtitle) + '</div>' +
    '</div>' +
    '</body>' +
    '</html>',
    {
      status: 200,
      headers: {
        'Content-Type':           'text/html; charset=utf-8',
        'Cache-Control':          'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    }
  );
}
