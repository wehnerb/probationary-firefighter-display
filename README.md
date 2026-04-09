# Probationary Firefighter Display

A Cloudflare Worker that renders a rotating probationary firefighter spotlight for fire station displays. Cycles through all active new hires — anyone hired within the past year — showing their photo and bio sourced from Google Sheets and Google Drive.

## 📄 System Documentation
Full documentation (architecture, setup, account transfer, IT reference): https://github.com/wehnerb/ffd-display-system-documentation

---

## Live URLs

| Environment | URL |
|---|---|
| Production | `https://probationary-firefighter-display.bwehner.workers.dev/` |
| Staging | `https://probationary-firefighter-display-staging.bwehner.workers.dev/` |

---

## URL Parameters

| Parameter | Default | Options | Description |
|---|---|---|---|
| `?layout=` | `wide` | `wide`, `full`, `split`, `tri` | Display layout |

| Layout | Width | Height |
|---|---|---|
| `full` | 1920px | 1075px |
| `wide` | 1735px | 720px |
| `split` | 852px | 720px |
| `tri` | 558px | 720px |

The `full` layout adds a "PROBATIONARY FIREFIGHTERS" title bar. All other layouts rely on the title bar provided by the display system.

---

## Rotation Logic

- One firefighter is shown per rotation slot
- Each firefighter displays for 3 consecutive days before advancing
- Rotation is anchored to **January 23, 2026** and advances at **7:30 AM Central** (DST-safe)
- After the last firefighter the list loops back to the first
- A firefighter is active for **365 days** from their hire date — they drop off automatically with no manual action needed
- The active list is sorted by hire date ascending, then name ascending, for a consistent stable order

---

## Data Sources

**Google Sheet:** Fire Station Display - Probationary Firefighter Information
- Tab name: `Firefighters`
- One row per firefighter

**Google Drive folder:** Fire Station Display - Probationary Firefighter Images
- One photo per firefighter
- Filename format: `firstnamelastname.jpg`
- Filename in the Drive folder must match the `Photo` column in the sheet (case-insensitive)

---

## Google Sheet Column Reference

The sheet uses a mix of fixed reserved columns and dynamic Q&A columns.

### Fixed columns (must use these exact header names)

| Column | Required | Notes |
|---|---|---|
| `Name` | Yes | Full name |
| `Hire Date` | Yes | Format: `YYYY-MM-DD` (e.g. `2026-01-19`) |
| `Rank` | No | e.g. `Probationary Firefighter` |
| `Shift` | No | `A`, `B`, `C`, `Days`, or `Recruit Academy` |
| `Badge` | No | Plain number |
| `Photo` | No | Filename of photo in Drive folder |
| `Hometown` | No | City, State |

### Dynamic Q&A columns

Any column not listed above is treated as a Q&A pair. The column header is the question and the cell value is the answer. Columns appear on the display in the same order they appear in the sheet. Blank cells are silently omitted — no empty rows are shown.

### Adding a new hire

1. Add a new row to the `Firefighters` tab with at minimum `Name` and `Hire Date`
2. Upload their photo to the Drive folder named `firstnamelastname.jpg`
3. Enter the filename in the `Photo` column
4. Fill in remaining fields — any blank field is omitted from the display

### Adding a new class with different questions

Add new column headers to row 1 for the new questions. Existing rows with no value in those columns will simply not show those questions. Old question columns with no values for the new class work the same way.

---

## Configuration (`src/index.js`)

| Constant | Default | Description |
|---|---|---|
| `ROTATION_DAYS` | `3` | Consecutive days each firefighter displays before advancing |
| `ROTATION_ANCHOR` | `2026-01-23` | Anchor date for rotation cycle — do not change unless resetting the cycle |
| `ROTATION_TIME` | `{ hour: 7, minute: 30 }` | Time of day rotation advances (Central time) |
| `HIRE_ACTIVE_DAYS` | `365` | Days after hire date a firefighter remains on the display |
| `DEFAULT_LAYOUT` | `wide` | Layout used when no `?layout=` parameter is provided |
| `SHEET_TAB_NAME` | `Firefighters` | Sheet tab name — update if the tab is ever renamed |
| `ACCENT_COLOR` | `#C8102E` | FFD brand red used for the title bar and divider |
| `outerPad` multiplier | `0.022` | Controls padding around all content edges — find in `buildFirefighterPage` |

---

## Secrets

| Secret | Where set | Description |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | GitHub repo secrets | Cloudflare API token — Workers edit permissions |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub repo secrets | Cloudflare account ID |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Cloudflare Workers dashboard | Service account email (shared with daily-message-display) |
| `GOOGLE_PRIVATE_KEY` | Cloudflare Workers dashboard | RSA private key from Google Cloud JSON key file |
| `GOOGLE_SHEET_ID` | Cloudflare Workers dashboard | ID from the Google Sheet URL |
| `GOOGLE_DRIVE_FOLDER_ID` | Cloudflare Workers dashboard | ID from the Drive folder URL |

Google secrets must be set separately in the Cloudflare Workers dashboard for both the staging and production Workers. They are not passed through GitHub Actions.

---

## Deployment

| Branch | Deploys To | Purpose |
|---|---|---|
| `staging` | `probationary-firefighter-display-staging.bwehner.workers.dev` | Testing |
| `main` | `probationary-firefighter-display.bwehner.workers.dev` | Production |

Push to either branch — GitHub Actions deploys automatically (~30–45 sec).  
**Always stage and test before merging to main.**  
To roll back: use the Cloudflare dashboard **Deployments** tab, then revert the commit on `main`.
