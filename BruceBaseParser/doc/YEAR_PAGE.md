# YEAR_PAGE.md — YEAR Page Processing Pipeline

## Entry point: `runYearPage()`

1. Snapshot `#page-content.innerHTML` as `_savedOriginalHtml` and the local
   `originalHtml` variable (both used later for the global toggle and Save).
2. If `SmartTable` and `BrucebaseAdapter` are available, call
   `BrucebaseAdapter.extract()` **before** wrapping sections, because the
   adapter's `_splitOnHr()` iterates `content.children` looking for `<hr>`
   direct children that `wrapYearSections` will later move.
3. `hideJumpToRecentBox(content)` — hides the wikidot-injected
   `.list-pages-box` containing "most recent" text.
4. `wrapYearSections(content)` — wraps each inter-`<hr>` block in a
   `<div class="bb-section-processed">`, returns a `sections[]` snapshot array.
5. `extractYearPageEvents(content)` — scans for event links.
6. Build `#bb-btn-container` with buttons (Start, Save, Load, Global toggle,
   Mismatch filter) and optionally move the SmartTable trigger button into it.
7. `setupStickyBar(content, pageTitle, controlsEl)` — inserts `#bb-sticky-bar`.
8. `yearStartBtn` click handler:
   - Resets DOM to clean state (removes prior-run artifacts, clone-replaces
     toggle buttons to strip stale listeners, restores each section's original HTML).
   - Re-runs `extractYearPageEvents`.
   - Calls `processYearEvents(events, sections, onProgress, shouldStop)` —
     processes events in batches of 3 with 500 ms between batches, using
     `Promise.allSettled` so one failure doesn't abort the batch.
   - After each event in the batch, calls `insertSectionToggle` for that event's
     section (so ⇄ Original and ☰ List buttons appear as each event completes).
   - After all events: enables Global toggle, Mismatch filter, Save button.
   - The Start button toggles to ⏹ Stop while running; `_yearStopRequested`
     flag halts the batch loop after the current batch finishes.

---

## `wrapYearSections(content)`

Iterates all `<hr>` elements that are **direct children** of `content`.
For each gap between consecutive `<hr>` elements, serialises the sibling nodes
to `sectionOriginalHtml` *before* moving them (to avoid clones being found by
later `querySelectorAll` calls), wraps them in a `div.bb-section-processed`,
and pushes `{ hr, processedDiv, sectionOriginalHtml }` to the result array.

The `bb-section-original` div (pre-processing snapshot shown by ⇄ Original) is
created **later** by `insertSectionToggle`, after `processYearEvents` completes,
so that `extractYearPageEvents` never encounters duplicate `<a>` links.

---

## `extractYearPageEvents(content)`

Scans all `a[href]` in `content`, matches `EVENT_URL_RE = /\/([a-z]+):\d{4}-\d{2}-\d{2}/`.

For each hit:
- Rejects links whose text does not start with `YYYY-MM-DD` (prose links to
  other events, e.g. "1993 speech", are skipped).
- Finds the last preceding `<a name="…">` anchor using `compareDocumentPosition`
  — this is the YEAR page anchor (`anchorEl`, `anchorName`).
- Finds the first following named anchor (`nextAnchor`, end boundary for setlist).
- For known event types, calls `collectSetlistElements(eventLink, nextAnchor, content)`.
- Returns `{ element, yearName, url, eventType, isKnown, anchorEl, anchorName, setlistEls }[]`.

---

## `processOneYearEvent(event)`

Fetches the DETAIL page with `fetchPage(url)`, then runs in sequence:

### 1. Event name check

- `extractDetailEventName(doc, url)` — reads `#page-title`, falls back to
  `h1.page-title`, `h1`, `<title>`.
- `normalizeDetailName(rawDetailName)` — moves `(The)` / `(Le)` / `(De)`
  before a comma, inserts ` - ` after the date, uppercases everything.
- Compares with `yearName.trim().toUpperCase()`.
- Detects early/late variants: if the normalized detail name equals the YEAR
  name + one of `(EARLY)`, `(LATE)`, `(AFTERNOON)`, `(EVENING)`, flags ⚠️
  instead of ❌.
- `extractEventAlias(doc)` — reads the alias/alternate name from the DETAIL
  page (if any) and passes it to `addYearGlyph` for display.
- `addYearGlyph(element, nameMatch, isEarlyLate, …)` — appends ✅/⚠️/❌ glyph
  after the event link; hover shows a tooltip via `showYearTooltip`.
  Also appends a `bb-event-type` span showing the event type in grey italics.

### 2. Timing blocks

- `extractTimingBlocks(doc)` — returns all non-empty text strings from
  `div.code pre code` elements (covers "Scheduled: …", "Local Start Time …",
  and any future patterns).
- Each text → `addScheduledBlock(afterEl, text)` — inserts a
  `<div class="bb-scheduled">` after `afterEl`; returns the inserted div
  so that multiple blocks chain in document order. `lastScheduledDiv` tracks
  the final inserted div for venue-info appending.

### 3. Venue info

- `findVenueLink(doc)` — first `<a href="/venue:…">` in `doc`.
- Fetches the venue page; reads `#page-title` for `venueName`.
- Extracts the raw venue part from `rawDetailName` with
  `/^\d{4}-\d{2}-\d{2}\s*(?:-\s*)?(.*)/s` (Title Case, no normalization).
- Compares `venueName === detailVenuePart` (case-sensitive, no article rewrite).
- `renderVenueInfo(lastScheduledDiv || anchorEl, venueHref, venueName, match, detailVenuePart, venuePrefix)`:
  - If `afterEl` is a `.bb-scheduled` div, appends inline:
    `Scheduled: … at <strong><em><a>Venue</a></em></strong> ✅/⚠️`.
  - Otherwise creates a new `.bb-scheduled` div after `afterEl`.
  - A `venuePrefix` (`"Recording session"` / `"No gig"`) is prepended for
    non-gig event types.
  - The `<strong>` around the venue name is at `font-size: 1.1em`.
- The fetched `venueDoc` is saved and passed to `addVenueTabButtons` (no
  extra network request).

### 4. Clickable icons

`wireIconHandlers(eventLink, doc)` — see [ICONS_PANELS.md](ICONS_PANELS.md).

### 5. Venue tab buttons

`addVenueTabButtons(venueDoc, venueHref, venueName, section)` — see
[ICONS_PANELS.md](ICONS_PANELS.md).

### 6. Setlist check

When `setlistEls.length > 0` — see [SETLIST.md](SETLIST.md).

### 7. Anchor consistency check

`checkYearAnchorConsistency(doc, anchorName, anchorEl, eventDate)` — see
[ANCHORS.md](ANCHORS.md).

---

## Collapsible event heading lines

Each processed event heading `<p>` receives:

- Class `bb-event-heading` (light grey background, `#f0f0f0`) applied to the `<p>`.
- Class `bb-event-heading-p` (used as a selector by `setAllEventsCollapsed`).
- A `<span class="bb-event-collapse-toggle">▾/▸</span>` appended inside the
  innermost container of the event link (e.g. a `<strong>` wrapper), placed after
  the glyph and optional alias span.

**`addCollapseToggle(innerEl)`** — called from `addYearGlyph` and
`addUnknownGlyph` immediately after the glyph/alias spans are inserted.
Uses `innerEl.closest('p')` to resolve the outer `<p>` (necessary because
BruceBase wraps event links in `<strong>` so `element.parentElement` is not
always the `<p>`).

**`getOrWrapEventContent(headingP)`** — lazily wraps all DOM siblings after
`headingP` (up to the next `.bb-event-heading-p` or section end) in a
`<div class="bb-event-content">`. Idempotent; returns the existing wrapper on
subsequent calls. Returns `null` when there are no siblings to wrap.

**`setEventCollapsed(headingP, force)`** — collapses (`force=true`), expands
(`force=false`), or toggles (`force=null`) one event.

- Before hiding, sweeps up any siblings appended to the section *after* the
  wrapper was first created (lazy panels and tab rows use `section.appendChild`
  and land outside the wrapper). This ensures open panels are also hidden.
- Uses `style.display = 'none'` / `''` directly — avoids CSS specificity issues.
- Updates the toggle indicator (`▾` expanded / `▸` collapsed) and its `title`.

**`setAllEventsCollapsed(collapse)`** — queries all `.bb-event-heading-p`
elements and calls `setEventCollapsed` on each.

**Click behaviour:**
- Single click on toggle → collapse/expand that one event.
- Ctrl+Click → collapse all if the clicked event was expanded; expand all if it
  was collapsed (determined from the pre-click state of the wrapper).

---

## Per-section controls (`insertSectionToggle`)

Inserts `<div class="bb-section-controls">` with two buttons immediately after
the `<hr>`:

- **⇄ Original / ⇄ Processed** — toggles between `bb-section-original` and
  `bb-section-processed` divs.
- **☰ List / ☰ Flat** — builds a numbered `<ol>` view lazily on first click.
  Only the flat-view setlist `<p>` / `<blockquote>` elements are hidden in-place;
  the event title, scheduled block, icons, and descriptive text remain visible.
  `buildListDiv(setlistEls, section)` constructs the list:
  - Each source element contributes a label paragraph and an `<ol>`.
  - Song numbers are rendered as clickable `<a class="bb-song-num">` links when
    a `/song:` URL is known; clicking fetches the song page and toggles a
    `bb-song-tab-row` via `fetchAndToggleSongTabRow`.
  - Plain `<span class="bb-song-num-plain">` for songs with no song page.

Three mutually exclusive `viewState` values: `'flat'` (default), `'original'`,
`'list'`.

---

## Global controls (`#bb-sticky-bar`)

- **▶ Start / ⏹ Stop** — starts or aborts processing.
- **💾 Save** — enabled after processing; downloads a JSON cache file via
  `savePageCache`. See [CACHE.md](CACHE.md).
- **📂 Load** — opens a file picker; restores from a previously saved JSON file
  via `loadPageCache`. See [CACHE.md](CACHE.md).
- **⇄ Original Page** — `setupGlobalToggle`; alternates `#page-content` /
  `#bb-page-original`. The original div is created after processing so no event
  listeners on the processed content are lost.
- **⚡ Mismatches (N)** — `setupMismatchFilter`; calls `applyMismatchFilter`.
  Button label shows count. Toggling between "⚡ Mismatches (N)" and
  "⚡ All Events (N)". A section is a mismatch when it contains a `.bb-glyph`
  with ❌/⚠️/❓, or a `.bb-song-year-only`, `.bb-song-detail-only`,
  `.bb-song-char-diff`, `.bb-para-warn`, or `.bb-anchor-warn` element.
- **SmartTable trigger** (optional) — moved from the SmartTable host into
  `#bb-btn-container` when SmartTable is available.

---

## `collectSetlistElements` filter rules

Elements are collected between `eventLinkEl` and `nextAnchorEl` using
`compareDocumentPosition`. Guards applied **in order** (first match continues):

1. **Inline date header** — `break` if `<p>` text matches `^\d{4}-\d{2}-\d{2}\s+-\s+`.
2. **Nested `<p>` inside `<blockquote>`** — `continue`; the blockquote is the unit.
3. **Inside `<table>`** — `continue`; retail/news boxes use tables.
4. **Event URL first link** — `continue` if first `<a href>` matches `EVENT_URL_RE`.
5. **Empty after stripping `<sup>`** — `continue` via `textWithoutSup(el)`.
6. **Prose filter** (`<p>` only) — strip `Label:` prefix and lowercase
   parentheticals, `continue` if lowercase letters remain in the core.

---

## `normalizeDetailName` rules

1. Match `YYYY-MM-DD` date prefix.
2. If rest matches `VENUE (The), SUFFIX` or `VENUE (Le), SUFFIX` or
   `VENUE (De), SUFFIX` → rewrite as `The VENUE, SUFFIX` / `Le VENUE, SUFFIX` /
   `De VENUE, SUFFIX`.
3. Insert ` - ` between date and venue.
4. Uppercase the whole string.

Result must equal the YEAR page name (already uppercase) exactly, with the
exception that a ` (EARLY)` / ` (LATE)` / ` (AFTERNOON)` / ` (EVENING)` suffix
on the detail side yields ⚠️ rather than ❌.
