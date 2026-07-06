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
- Detects early/late variants (`isEarlyLate`): if the normalized detail name
  equals the YEAR name + one of `(EARLY)`, `(LATE)`, `(AFTERNOON)`,
  `(EVENING)`, flags it as an informational variant instead of a mismatch.
- `extractEventAlias(doc)` — reads the alias/alternate name from the DETAIL
  page (if any) and passes it to `addYearGlyph` for display.
- `addYearGlyph(element, nameMatch, isEarlyLate, …)` — appends the glyph
  after the event link (`makeGlyphSpan('✅')` / `makeVariantInfoGlyphSpan()`
  for `isEarlyLate` / `makeGlyphSpan('❌')`); hover shows a tooltip via
  `showYearTooltip`. Also appends a `bb-event-type` span showing the event
  type in grey italics. Returns the inserted glyph span (`.bb-glyph` or
  `.bb-variant-info`), so a further glyph (below) can be inserted right after
  it via `glyphSpan.after(...)`.
  `isEarlyLate` renders green `.bb-variant-info` (text-presentation `⚠︎`, see
  UTILITIES.md) instead of orange `.bb-glyph` ⚠️ — deliberately not classed
  `bb-glyph`, so `isYearMismatch`'s generic `.bb-glyph` text scan
  (`#bb-mismatch-toggle`'s count/filter) no longer treats it as a mismatch.
  It was already excluded from the `.bb-event-title-warn` aggregated tooltip
  (`collectSectionWarnings` never queried `.bb-glyph` — this glyph's tooltip
  is wired via `mouseenter`, not `dataset.msg`); `annotateEventTitleWithWarnings`'s
  sibling-walk was extended to recognize `.bb-variant-info` too, so a
  genuinely different, coexisting issue on the same event still inserts its
  aggregated warning glyph after (not before) the variant glyph.

### 1a. Onstage companion page (tags-per-page cap spillover)

- `fetchOnstageCompanionTags(eventPath, eventType, buildTabMap(doc))` — for
  "gig"/"rehearsal" events with an "On Stage" tab, fetches the companion
  `onstage:…/noredirect/true` page (reusing the already-fetched `doc`'s own
  tab map — no extra DETAIL fetch, only this one conditional extra request).
  See [TAGS.md](TAGS.md) for the full rule.
- When it returns additional tags not already on this event's own
  `.page-tags`, appends a `🏷️` `.bb-glyph` (`makeOnstageTagsGlyphSpan`) right
  after the match/mismatch glyph from step 1, with a tooltip listing them.
- The result is also threaded through to `wireIconHandlers` (step 4) so the
  nested "Tags" button panel shows the same additional tags.
- **LIST pages are out of scope**: `processOneListEvent` never fetches a
  per-event DETAIL document, so this feature isn't available there.

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
- When not an exact match, `findVenueDetailExtra(venueName, detailVenuePart)`
  checks two cases, in order: (1) a trailing show-variant suffix —
  `"(Early)"`/`"(Late)"`/`"(Afternoon)"`/`"(Evening)"` — that VENUE page
  titles never carry (e.g. `"D'Scene, South Amboy, NJ (Late)"` vs. the venue
  page's own `"D'Scene, South Amboy, NJ"`); (2) an extra descriptive
  venue-detail segment (e.g. `"University Of Michigan"`) — reuses
  `parseLocationParts`'s existing venue-detail extraction (see TAGS.md's
  "Event-name / venue-name location tag check"), so it's the same value the
  tag check computes. Only case (2) has a matching tag-report suppression
  (see TAGS.md) — case (1)'s suffix is already stripped before
  `parseEventNameLocation` ever runs, so no spurious tag was ever deduced for
  it.
- `renderVenueInfo(lastScheduledDiv || anchorEl, venueHref, venueName, match, detailVenuePart, venuePrefix, extra)`:
  - If `afterEl` is a `.bb-scheduled` div, appends inline:
    `Scheduled: … at <strong><em><a>Venue</a></em></strong> ✅/⚠️/⚠︎`.
  - Otherwise creates a new `.bb-scheduled` div after `afterEl`.
  - A `venuePrefix` (`"Recording session"` / `"No gig"`) is prepended for
    non-gig event types.
  - The `<strong>` around the venue name is at `font-size: 1.1em`.
  - Three glyph states: exact match → `.bb-glyph` ✅; extra-only difference →
    `.bb-venue-info` (green, text-presentation `⚠︎` so it's actually
    colorable — see UTILITIES.md), deliberately excluded from `isYearMismatch`
    / `collectSectionWarnings` / `#bb-mismatch-toggle` counting since it's
    informational, not a real mismatch; anything else → `.bb-glyph
    bb-venue-warn` ⚠️ (the pre-existing real-mismatch path).
- The fetched `venueDoc` is saved and passed to `addVenueTabButtons` (no
  extra network request).
- `venueDetailExtra` is also forwarded to `wireIconHandlers` → `addTagsButton`
  so the YEAR page's nested "Tags" button panel suppresses the same
  now-informational "Venue detail" missing-tag entry (see TAGS.md).

### 4. Clickable icons

`wireIconHandlers(eventLink, doc, onstageResult, venueDetailExtra)` — see
[ICONS_PANELS.md](ICONS_PANELS.md). `onstageResult` (from step 1a) is passed
through to `addTagsButton` so its panel includes the onstage-companion tags.

### 5. Venue tab buttons

`addVenueTabButtons(venueDoc, venueHref, venueName, section)` — see
[ICONS_PANELS.md](ICONS_PANELS.md).

### 6. Setlist check

When `setlistEls.length > 0` — see [SETLIST.md](SETLIST.md).

### 7. Relation participants

Called at the end of the `setlistEls.length > 0` block, after `renderYearSetlist`:

- `extractRelations(doc)` — parses `#wiki-tab-0-0` to extract the artist/band
  participants listed under each event. Returns `RelGroup[]` where each group
  has an optional header (from `<p><strong>…</strong></p>` section dividers) and
  a list of `RelItem` objects `{ href, name, extra, members }`.
  - Skips the alias block (`<p><strong>…</strong></p><hr>`) at the start if
    present.
  - Multiple consecutive `<ul>` blocks without an intervening header are merged
    into one group (handles the "Guest" annotation pattern — case b).
  - Stops at `<hr>` or `<ol>` (setlist area begins).
- `injectEventRelations(processedDiv, relGroups, yearSections)` — inserts one
  `<p class="bb-relations-flat">` + `<div class="bb-relations-list">` pair before
  each matching setlist `<p>` element. Matching is index-based after filtering
  out `label === 'setlist'` preview sections (case d). Top-level entries use `•`
  bullets; band members use `◦` bullets; both hyperlinked to `/relation:` pages.
  Extra info (e.g. `(Guest)`) is rendered inline as `.bb-rel-extra`.

The list view (`showView('list')` in `insertSectionToggle`) toggles `.bb-relations-flat`
hidden and `.bb-relations-list` visible, showing the original nested hierarchy.

### 8. Anchor consistency check

`checkYearAnchorConsistency(doc, anchorName, anchorEl, eventDate)` — see
[ANCHORS.md](ANCHORS.md).

### 9. Event title warning annotation

`annotateEventTitleWithWarnings(element, processedDiv)` — called after all
checks complete. Collects warning messages from within `processedDiv` via
`collectSectionWarnings(processedDiv)`:
- `.bb-anchor-warn`, `.bb-venue-warn`, `.bb-para-warn` → `dataset.msg || title`
- `.bb-glyph.bb-icon-sorry[data-msg]` → `dataset.msg`
- `.bb-song-year-only` present → synthetic "Year page song(s) not found in DETAIL setlist"
- `.bb-song-detail-only` present → synthetic "DETAIL page song(s) not found in YEAR setlist"
- `.bb-song-char-diff` present → synthetic "Song name character differences between YEAR and DETAIL page"

When any messages exist, inserts `<span class="bb-event-title-warn"> ⚠️</span>`
after the last of the `bb-glyph` / `bb-event-type` / `bb-event-alias` siblings
that immediately follow the event link. Hovering shows a rich tooltip listing
all issues.

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

Inserts `<div class="bb-section-controls">` with the following buttons
immediately after the `<hr>`:

- **⇄ Original / ⇄ Processed** — toggles between `bb-section-original` and
  `bb-section-processed` divs.
- **☰ List / ☰ Flat** — builds a numbered `<ol>` view lazily on first click.
  Only the flat-view setlist `<p>` / `<blockquote>` elements are hidden in-place;
  the event title, scheduled block, icons, and descriptive text remain visible.
  `buildListDiv(setlistEls, section)` constructs the list:
  - Each source element contributes a label paragraph and an `<ol>`.
  - `detail-only` groups show `•` (bullet) and do not increment the counter;
    their song href is captured from the flat-view `bb-song-num` anchor before
    it is stripped, keeping the click handler intact.
  - Other songs: clickable `<a class="bb-song-num">N.</a>` when a `/song:` URL
    is known; `<span class="bb-song-num-plain">N.</span>` otherwise.
- **Hide Relations / Show Relations** — (only present when the event has
  relation blocks) toggles `.bb-rel-hidden` on `processedDiv`.
- **Hide Buttons / Show Buttons** — hides or shows all tab button rows
  (`.bb-event-tab-row`, `.bb-venue-tab-row`, `.bb-song-tab-row`,
  `.bb-relation-tab-row`) within the event's `processedDiv`.
- **Fetch Songs** — (only present when `a.bb-song-num` links exist) iterates
  every unloaded song link in the event and calls `fetchAndToggleSongTabRow`
  sequentially, loading all song tab rows in one click.
- **Fetch Relations** — (only present when `.bb-rel-bullet[data-rel-href]`
  elements exist) iterates every unique relation href and calls
  `fetchAndToggleRelationTabRow` sequentially.

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
- **⚡ Issues (N)** — `setupMismatchFilter`; calls `applyMismatchFilter`.
  Button label shows count. Toggles between "⚡ Issues (N)" and
  "⚡ All Events (N)". A section has issues when it contains a `.bb-glyph`
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
