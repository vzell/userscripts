# CLAUDE.md — BruceBase Event Checker

## Purpose

Tampermonkey userscript that enriches `http://brucebase.wikidot.com/` pages by cross-checking data between different
page types and surfacing discrepancies with inline glyphs and hover tooltips.

---

## Page types and URL patterns

| Page type        | URL pattern                          | `@include` regex |
|------------------|--------------------------------------|------------------|
| HOME page        | `/` or `/start`                      | `(start)?$` (group optional) |
| YEAR page        | `/YYYY`                              | `\d{4}$` |
| YEAR LIST page   | `/YYYY-list`                         | `\d{4}-list$` |
| DETAIL page      | `/type:YYYY-MM-DD-slug`              | `(gig\|nogig\|recording\|…):` |

Known event types (anything else gets a ❓ glyph):
`gig`, `interview`, `nogig`, `offstage`, `onstage`, `recording`, `rehearsal`, `soundcheck`

---

## Boot flow

```
location.pathname
  → ''  / 'start' → runHomePage()
  → /YYYY          → runYearPage()
  → /YYYY-list     → runListPage(year)
  → /type:…        → runDetailPage()
```

`addStyles()` and `createTooltipElement()` always run first.

---

## YEAR page mode (`runYearPage`)

### Confirmed DOM structure (brucebase wikidot)

```
body#html-body > div#skrollr-body > div#container-wrap-wrap
  > div#container-wrap > div#container
    div#header                     ← sticky top:0 z:100
    div#content-wrap
      div#side-bar                 ← sticky top:--bb-header-h (float:left in wikidot CSS)
      div#main-content
        div#action-area-top
        div#bb-sticky-bar          ← inserted by setupStickyBar(); sticky top:--bb-header-h z:90
          div#bb-controls          ← flex row (display:flex); #page-title is hidden (year already in #bb-pre-events)
            div#bb-btn-container   ← ⇄ / ⚡ / Show table buttons
            p#bb-year-progress     ← timer + progress text
          div#bb-pre-events        ← icon legend, year heading, hidden jump-to-recent box
        div#page-content
          hr  ← first event separator (pre-HR nodes moved to sticky bar)
          div.bb-section-processed × N
```

`#page-title` and `#page-content` are siblings inside `#main-content`.
`#side-bar` and `#main-content` are siblings inside `#content-wrap`.

### Processing pipeline

1. **`hideJumpToRecentBox(content)`** — hides the wikidot-injected "Jump to most
   recent show/event" `.list-pages-box` at top of `#page-content`.
2. **Snapshot** `#page-content.innerHTML` (pre-processing, for global toggle).
3. **`wrapYearSections(content)`** — wraps content between each consecutive pair
   of `<hr>` direct children into a `<div class="bb-section-processed">`.
   Serialises the original HTML as a plain string *before* moving nodes (not as
   a DOM clone) so that the snapshot cannot be found by `querySelectorAll` and
   accidentally re-processed.
4. **`extractYearPageEvents(content)`** — scans all `<a href>` in `content`,
   matches `EVENT_URL_RE = /\/([a-z]+):\d{4}-\d{2}-\d{2}/`, and for each hit:
   - finds the last preceding `<a name="…">` anchor (DDMMYY format, may carry a
     letter suffix e.g. `150571a` for the first of two events on the same day)
   - finds the next following anchor (end boundary)
   - calls `collectSetlistElements(eventLink, nextAnchor, content)` to collect
     `<p>` and `<blockquote>` elements between the two anchors
5. **Create buttons + progress element** — `#bb-btn-container` with
   `#bb-global-toggle` and `#bb-mismatch-toggle` (both `disabled`);
   `#bb-year-progress` with `#bb-year-timer` span.
6. **`setupStickyBar(content, pageTitle, btnContainer, progressEl)`** — inserts
   `#bb-sticky-bar` where `#page-title` was, moves `#page-title`, buttons,
   progress, and all `#page-content` children before the first `<hr>` (icon
   legend, year heading, hidden jump-to-recent box) into it; strips `<br>`
   from the pre-HR area; measures `#header` height and sets `--bb-header-h`.
7. **`processYearEvents(events, onProgress)`** — batches 3 events at a time with
   500 ms between batches; `onProgress(idx, name, total)` updates progress text
   to `MM:SS ... Processing event "NNN / TT: title"`.
8. After all events: **`setupGlobalToggle(btn, content, originalHtml)`** and
   **`setupMismatchFilter(btn)`** wire up click handlers and enable the buttons;
   **`insertSectionToggle`** for each wrapped section.

### `collectSetlistElements` filter rules

Elements are collected between `eventLinkEl` and `nextAnchorEl` using
`compareDocumentPosition`, then filtered by these guards **in order** — the
first matching guard `continue`s (or `break`s) the loop:

1. **Inline date header** — `break` if `<p>` text starts with
   `/^\d{4}-\d{2}-\d{2}\s+-\s+/` (unnamed inline events that share a section).
2. **Nested `<p>` inside `<blockquote>`** — `continue`; the `<blockquote>` is
   collected as a unit and its inner `<p>` read by `parseYearSetlist`.
3. **Inside a `<table>`** — `continue`; release/news announcement boxes
   (e.g. `/retail:` links) use `<table>` containers, and their all-caps
   headings would otherwise pass the prose filter.
4. **Event URL first link** — `continue` if the element's first `<a href>`
   matches `EVENT_URL_RE` (event-name header paragraphs).
5. **Empty after stripping `<sup>`** — `continue` via `textWithoutSup(el)`.
6. **Prose filter** (for `<p>` only) — examine the text before the first ` / `
   (whole text for single-song entries), strip any `Label:` prefix and
   parentheticals with lowercase, `continue` if lowercase letters remain.
   `<sup><em>` footnote text is excluded via `textWithoutSup` so notes like
   "Setlist incomplete." don't cause genuine song entries to be rejected.

### Per-event processing (`processOneYearEvent`)

Fetches the DETAIL page with `GM_xmlhttpRequest`, then:

**Event name check:**
- Extracts name from `#page-title` (fallback: `h1.page-title`, `h1`, `<title>`)
- `normalizeDetailName()`: moves `(The)` or `(Le)` before a comma to the front
  (`VENUE (The), CITY` → `The VENUE, CITY`), inserts ` - ` after the date,
  uppercases everything
- Compares with the uppercased YEAR page name
- Appends ✅ or ❌ glyph; hover shows a tooltip with both names and a
  token-level diff (`buildDiffHtml`)

**Timing blocks** (always):
- `extractTimingBlocks(doc)` returns all non-empty texts from `div.code pre code`
  elements on the DETAIL page (covers `"Scheduled: …"`, `"Local Start Time …"`,
  and any future patterns).
- For each text, `addScheduledBlock(afterEl, text)` inserts a `<div class="bb-scheduled">`
  in monospace below the event-title `<p>` on the YEAR page and returns the inserted
  div so that multiple blocks are chained in document order.
- `lastScheduledDiv` tracks the final inserted div for venue appending below.

**Venue info** (always, when DETAIL page has a `/venue:` link):
- `findVenueLink(doc)` scans `doc.querySelectorAll('a[href]')` for the first link whose
  `href` starts with `/venue:`.
- Fetches the venue page with `fetchPage`; reads `venueName` from `#page-title`.
- Extracts the raw venue part from `rawDetailName` with
  `/^\d{4}-\d{2}-\d{2}\s*(?:-\s*)?(.*)/s` (preserves Title Case; no normalization).
- Compares with `venueName` directly (trimmed, case-sensitive).
- `renderVenueInfo(lastScheduledDiv || eventP, venueHref, venueName, match, detailVenuePart)`:
  - If `afterEl` is a `.bb-scheduled` div, appends inline so the line reads
    `Scheduled: … at <strong><em><a>Venue Name</a></em></strong> ✅/⚠️`.
  - Otherwise creates a new `.bb-scheduled` div and inserts it after `afterEl`.
  - The `<strong>` wrapping the venue name carries `font-size: 1.1em` so it stands out
    slightly against the surrounding timing text.
  - A ✅ or ⚠️ glyph with `showErrorTooltip` is appended after the venue link.

**Clickable icon handlers** (always):
- `wireIconHandlers(eventLink, doc)` — see the "Clickable YEAR-page icons" section below.
  Called after timing blocks are inserted.

**Anchor consistency check** (always, when `anchorEl` and `anchorName` are set):
- Calls `checkYearAnchorConsistency(detailDoc, anchorName, anchorEl)`
- `findInfoSetlistLink(detailDoc)` locates the `<a href="/YEAR#ANCHOR">Info & Setlist</a>` back-link by matching `INFO_SETLIST_HREF_RE` (`/^\/[\d][\w-]*#([a-zA-Z0-9]+)$/`) and `/info/i` in the link text
- Extracts the fragment from the href and compares with the YEAR page `anchorName`
- On mismatch: `addAnchorWarnYear(anchorEl, …)` inserts a `<span class="bb-anchor-warn">⚠️</span>` immediately after the `<a name>` element, with a hover tooltip describing both values

**Setlist check** (when setlist elements were found):
- `parseYearSetlist(setlistEls)` → `Section[]` where
  `Section = { label: string, songs: string[], rawSongs: string[], sourceEl: Element }`
  - `<blockquote>` → `label = 'recording'`
  - `<p>` starting with `Label:` → `label` preserves the original case from the
    page (e.g. `'With Garland Jeffreys'`); comparisons against `'soundcheck'` /
    `'show'` / `'recording'` are case-insensitive
  - plain `<p>` → `label = 'show'`
  - `songs` — cleaned names (via `cleanSongName`); `rawSongs` — original text
    before cleaning, used to re-append qualifiers like `(parts)` or
    `(with Willie Nile)` as plain (non-green) text in the rendered output
  - `<sup><em>` footnote text excluded via `textWithoutSup()` before splitting
- `parseDetailSetlist(doc)` → reads `getSetlistContainer(doc)` children.
  Handles three layouts:
  - **(a) Standard**: `<p><strong>Label</strong></p>` sets section label;
    `<ol>`/`<ul>` produce a section with song names from `<a href="/song:…">` text
    (medleys joined with ` - `; plain-text fallback for songs with no link).
  - **(b) Paragraph-based** (old pages, e.g. 1974): songs in bare
    `<p><a href="/song:…">NAME</a></p>` elements are accumulated via
    `flushPending()` and emitted as a section with `paragraphBased: true`.
  - **(c) Nested fallback**: if no songs found from direct children, widens
    to `td.querySelectorAll('ol, ul')` to find lists nested inside `<div>`.
  Sections from layout (b) carry `paragraphBased: true`.
  Each section carries `hasExplicitLabel: boolean` — `true` only when a
  `<p><strong>…</strong></p>` header immediately preceded the `<ol>`/`<ul>`.
  This flag is reset to `false` after each section push so a header does not
  accidentally propagate to the next list.
  Each section also carries `songUrls: (string|null)[]` — one entry per song,
  the `href` attribute from the single `<a href="/song:…">` link for that song,
  or `null` for medley entries (multiple links) and plain-text entries with no link.
- `yearFlat` / `yearRawFlat` — flattened cleaned / raw song arrays from
  `yearSections`; `detailParaFlat` — flat bool array (one entry per detail song)
  indicating whether that song came from a paragraph-based section;
  `detailUrlFlat` — flat `(string|null)[]` of song URLs from `detailSections`.
  Each `diffItem` is annotated with `rawYearSong` (year-side raw text),
  `paragraphBased` (whether the detail-side song was in `<p>` format), and
  `detailSongUrl` (the `/song:…` href from the DETAIL page, or `null`).
- **Section label annotation**: `sec.detailLabel` is assigned by position index
  before rendering. Three sentinel values:
  - `string` — the matching DETAIL section's label (explicit `<strong>` header text)
  - `null` — year section has no counterpart in the detail sections array at all
  - `false` — DETAIL exists but ALL its sections have `hasExplicitLabel: false`
    AND the year has at least one non-show/non-recording section (e.g. Soundcheck).
    This means the DETAIL page is missing the `<p><strong>…</strong></p>` header
    for this section.
- `lcsDiff(yearFlat, detailFlat)` + `mergeCharDiffs()` → `diffItems[]`
- `renderYearSetlist(yearSections, diffItems)` assigns diff items back to their
  source `<p>`/`<blockquote>` elements, then calls
  `renderSetlistElement(el, label, items, detailLabel)` which:
  - re-captures `<sup>` footnote HTML before overwriting `innerHTML`
  - replaces `el.innerHTML` with colour-coded spans
  - for `match` items with `detailSongUrl`: renders `<a href="/song:…" class="bb-song-match">NAME</a>`;
    without a URL (medley, no song page): renders `<span class="bb-song-match">NAME</span>`.
    Any raw qualifier suffix (e.g. ` (parts)`, ` (with Willie Nile)`) is
    appended outside the element as plain text.
  - re-appends footnote HTML after `<br>` so "Setlist incomplete." notes remain
  - for items with `paragraphBased: true`, appends a
    `<span class="bb-para-warn">⚠️</span>` with hover tooltip after the song span;
    listeners registered in a second `querySelectorAll('.bb-para-warn')` pass
  - `detailLabel === null` → ⚠️ "Section X exists on YEAR page but DETAIL page has no corresponding section"
  - `detailLabel === false && labelLc !== 'show'` → ⚠️ "Section label 'X', missing from DETAIL page"
  - `detailLabel === false && labelLc === 'show'` → ⚠️ "Section 'show' exists on YEAR page but DETAIL page has no corresponding section label"
  - `detailLabel` is string, label ≠ detailLabel (non-both-show) → ⚠️ "Section label mismatch: YEAR page has 'X', DETAIL page has 'Y'"

### Setlist colour coding (YEAR page)

| CSS class              | Meaning                     | Visual          |
|------------------------|-----------------------------|-----------------|
| `.bb-song-match`       | same in both pages — on `<a>` if DETAIL has a `/song:` URL, else `<span>` | green text; link underlines on hover |
| `.bb-song-year-only`   | in year, not detail         | light-blue bg   |
| `.bb-song-detail-only` | in detail, not year (inserted) | yellow bg    |
| `.bb-song-char-diff`   | similar but slightly different | char-level red/green |
| `.bb-char-match`       | matching char within diff   | green           |
| `.bb-char-diff`        | differing char              | red bold        |
| `.bb-para-warn`        | song in `<p>` format (old page) | ⚠️ cursor:help |
| `.bb-anchor-warn`      | anchor/date/year mismatch on YEAR or DETAIL page | ⚠️ cursor:help; hover shows issues array |
| `.bb-anchor-match`     | "Info & Setlist" link on DETAIL page passed all anchor checks | ✅ cursor:help; hover shows passed checks |
| `.bb-tag-missing`      | expected tag not present in `.page-tags` (DETAIL page inline span) | bold red |
| `.bb-tag-spurious`     | managed tag present but condition not met (DETAIL page inline span) | orange ⚠️ cursor:help |
| `.bb-tags-warn-box`    | wraps `.page-tags` container on DETAIL page when any tag issue found | gold border, #fffbe6 bg |

Hover over any non-match span shows `showSongTooltip()` with year/detail names
and a word-level diff. Hover over `.bb-para-warn` shows `showErrorTooltip()`.

### Toggle controls (YEAR page only)

Buttons live inside `#bb-sticky-bar` (pinned below `#header` while scrolling).
Both global buttons start `disabled` and are enabled after `processYearEvents` completes.

**Button container** (`#bb-btn-container`):
- Flex div inside `#bb-sticky-bar`, holds both global buttons side by side.

**Global toggle** (`#bb-global-toggle`):
- `setupGlobalToggle(btn, content, originalHtml)` — button already exists in the
  container; this function creates `<div id="bb-page-original">` with the
  pre-processing HTML as a sibling of `#page-content`, then wires the click handler.
- Toggle alternates `display: block / none` on the two divs.
- `#page-content` is never replaced, so all event listeners survive.

**Mismatch filter** (`#bb-mismatch-toggle`):
- `setupMismatchFilter(btn)` — wires the click handler onto the pre-existing button.
- On click calls `applyMismatchFilter(active)`.
- Each `.bb-section-processed` div wraps exactly one event (one `<hr>` per
  event on YEAR pages; `<a name>` anchors are inside `<p>` children, not direct
  children of the section div).
- A block is a **mismatch** when it contains a `.bb-glyph` with ❌/⚠️/❓,
  or a `.bb-song-year-only`, `.bb-song-detail-only`, `.bb-song-char-diff`,
  or `.bb-para-warn` element.
- When filtering, hides the `processedDiv` and walks backward to also hide the
  preceding `.bb-section-toggle` button and `<hr>` (skipping `.bb-section-original`
  which has its own independent display state).

**Per-section toggle** (button after each `<hr>`):
- `insertSectionToggle(hr, processedDiv, sectionOriginalHtml)` creates
  `<div class="bb-section-original">` with the serialised pre-processing HTML
  and inserts it immediately before `processedDiv`.
- IMPORTANT: this div is created *after* `processYearEvents` completes, so
  `querySelectorAll` during event extraction never finds the cloned `<a>` links
  inside it (which would cause duplicate processing and destroy the diff).
- Toggle alternates `display: block / none` between the two sibling divs.

---

## Clickable YEAR-page icons

Each event section on a YEAR page may end with small `<img class="image" title="X">` icon
images (and on some older pages they are wrapped in `<a href="javascript:;">`). After
`processOneYearEvent` fetches the DETAIL page, `wireIconHandlers` makes them interactive.

### Constants

| Constant | Purpose |
|---|---|
| `ICON_TITLE_MAP` | Maps every title variant (`"Photos"`, `"Eye"`, `"Audio / Video Bootleg"`, …) to a canonical key (`"Photo"`, `"Eyewitness"`, `"Bootleg"`, …) |
| `ICON_COVERED_TABS` | Set of YUI tab labels already handled by icon images; these labels are excluded from the extra-tab button row. Includes: `Gallery`, `Setlist`, `News/Memorabilia`, `Media`, `Storyteller`, `Eyewitness`, `Recording` |
| `SKIP_TABS` | Set of tab labels to never show as buttons (currently empty; kept for future use) |

### Tab lookup helpers

`buildTabMap(doc)` iterates `doc.querySelectorAll('.yui-nav em')` in order and returns
a `Map<label, index>`. `getTabEl(doc, tabMap, label)` returns
`doc.getElementById('wiki-tab-0-N')` or `null`. The index is always looked up by label,
never hardcoded, because tab positions vary across event types.

### Content extractors

| Canonical | Tab label | Content shape |
|---|---|---|
| `Photo` | Gallery | `{ type:'gallery', items:[{thumbUrl, mediumUrl}] }` |
| `Setlist` | News/Memorabilia | `{ type:'images', caption:'Setlist', items }` — images with "setlist" in src, not "ticket" |
| `Ticket` | News/Memorabilia | `{ type:'images', caption:'Tickets', items }` — images with "ticket" in src |
| `News` | News/Memorabilia | `{ type:'links', caption:'News', items:[{url, text, source}] }` — external `http` links; source captured from trailing `<sup><em>` sibling |
| `Memorabilia` | News/Memorabilia | `{ type:'images', caption:'Memorabilia', items }` — images with `/news:` in src |
| `Video` | Media | `{ type:'html', caption:'Media', html }` — tab HTML if an `<iframe>`/`<object>`/`<embed>`/`<video>` is present |
| `Storyteller` | Storyteller | `{ type:'html', caption:'Storyteller', html }` |
| `Eyewitness` | Eyewitness | `{ type:'html', caption:'Eyewitness', html }` |
| `Bootleg` | Recording | `{ type:'html', caption:'Recording', html }` — see split logic below |
| `LiveDL` | Recording | `{ type:'html', caption:'Official Live Download', html }` — see split logic below |

All `extractTabHtml` results return `null` when the tab is absent or its text starts with
`"Sorry, no X available"`.

### Recording tab split (`extractRecordingContent` / `isLiveDLSplit`)

When the Recording tab contains an `<hr>`, the split is only applied if
`isLiveDLSplit(tab)` returns true — i.e. the tab contains a `.image-container`,
a `nugs.net` link, or text matching `/official\s+concert\s+recording/i`.

- **LiveDL** → slice before `<hr>` (cover image + official release info).
- **Bootleg** → slice after `<hr>` (circulating recordings).
- When no `<hr>`, or `isLiveDLSplit` is false (structural `<hr>` with no LiveDL content
  before it), both types return the full tab so no content is lost.

### Lightbox (Photo / Gallery)

Two singleton elements appended directly to `document.body` (as independent siblings,
not nested, so `display:none` on one cannot cascade into the other):

- **`_lightbox`** (`#bb-lightbox`) — dark full-screen overlay with a thumbnail grid
  (`#bb-lightbox-grid`). `openLightbox(content, label)` populates it and sets
  `display:flex`. Clicking the backdrop or ✕ calls `closeLightbox()`.
- **`_viewer`** (`#bb-lightbox-viewer`) — separate fixed overlay for the full-size
  image. `showImageViewer(src)` shows it directly without opening the grid lightbox.
  Clicking a thumbnail in the grid also opens `_viewer`. ESC closes both via a shared
  `keydown` listener that calls `closeLightbox()`.

Both are created lazily inside `initLightbox()`.

### Inline panels (all non-photo icons)

`toggleIconPanel(icon, content, section)` lazily builds a panel via `buildIconPanel(content)`
on first click, sets `panel._bbIcon = icon` so the ✕ button can remove the
`.bb-icon-active` highlight from the triggering icon, and appends it to `section`.
Panels are **independent** — multiple panels across different events can be open simultaneously.

`buildIconPanel` renders by content type:

| `content.type` | Rendering |
|---|---|
| `images` | Flex-wrapped `<figure class="bb-thumb-item">` elements; clicking the `<img>` calls `showImageViewer(fullUrl)`. Caption from `filenameCaption(url)` strips the `YYYYMMDD_` prefix and underscores (e.g. `"Article 01"`, `"Setlist 02 Handwritten"`). |
| `links` | `<p class="bb-news-item"><a>Title</a><span class="bb-link-source">(Source)</span></p>` per item. |
| `html` | Raw tab `innerHTML`; relative `/` links rewritten to `http://brucebase.wikidot.com/…`. For `caption === 'Media'`: each `<iframe>`/`<object>`/`<embed>`/`<video>` is extracted from its wikidot wrapper into a clean `<div class="bb-media-item">` flex child to avoid wikidot CSS interfering with the flex layout. |

### Event-tab buttons (`addEventTabButtons`)

After processing icon images, `wireIconHandlers` calls `addEventTabButtons(doc, tabMap, section)`.
This iterates all labels in `tabMap`, skips those in `ICON_COVERED_TABS` or `SKIP_TABS`, and
for each non-empty tab that does not start with `"Sorry, no X available"` creates a
`<button class="bb-event-tab-btn">` with the label as its text. All buttons for one event
are wrapped in `<div class="bb-event-tab-row">` (flex-wrap) appended to the section.

Clicking a button uses the same `buildIconPanel` + `_bbIcon` mechanism as icon handlers.
Because `tabMap` is built in YUI nav insertion order, `"On Stage"` (always tab 0) appears
first in the row, before tabs like `"Performances"`, `"Appearances"`, `"Cancelled"`, etc.

### Venue-tab buttons (`addVenueTabButtons`)

After `wireIconHandlers`, `processOneYearEvent` calls `addVenueTabButtons(venueDoc, venueHref, venueName, section)` when the venue page was successfully fetched (reusing the same `venueDoc` already fetched for the venue name check — no extra network request).

This builds a tab map from the venue page and creates a `<div class="bb-venue-tab-row">` (green-tinted) with one `<button class="bb-venue-tab-btn">` per non-empty tab (e.g. `"Performances"`, `"Cancelled"`, `"Gallery"`). Relative hrefs inside tab HTML are rewritten to absolute `http://brucebase.wikidot.com/…` URLs. At the end, `addVenueTagsButton` appends a `"Tags"` button showing the venue page's `.page-tags` with consistency checks.

**Venue tag consistency** (`computeExpectedVenueTags` / `isManagedVenueTag`):

- `"venue"` — always expected on every venue page.
- First letter of the venue name (lowercased) — e.g. `"b"` for `"Blue Cross Arena…"`.
- `isManagedVenueTag` returns true for `"venue"` and any single `[a-z]` tag.
- Missing managed tags shown in bold red; managed tags present without a matching condition flagged with an orange ⚠️.

### CSS classes (icon feature)

| CSS class | Purpose |
|---|---|
| `.bb-scheduled` | Monospace timing block below event title (0.9em, #555) — covers "Scheduled: …", "Local Start Time …", and appended venue info |
| `.bb-venue-warn` | Orange ⚠️ glyph when venue page name ≠ DETAIL event name venue part (YEAR and DETAIL pages) |
| `img.bb-icon-active` | Blue outline on a clicked icon image |
| `.bb-icon-panel` | Inline collapsible panel container |
| `.bb-icon-panel-header` | Panel title + ✕ button row |
| `.bb-icon-panel-body` | Panel content area |
| `.bb-icon-thumbnails` | Flex-wrap thumbnail grid inside a panel |
| `.bb-thumb-item` | `<figure>` wrapper for one thumbnail + caption |
| `.bb-news-item` | `<p>` wrapper for one news link + source |
| `.bb-link-source` | Italic grey source label after a news link |
| `.bb-media-item` | Flex child wrapping one extracted video embed |
| `.bb-event-tab-row` | Flex-wrap row of event (DETAIL page) tab buttons |
| `.bb-event-tab-btn` | Individual event-tab button; `.bb-icon-active` applied when open |
| `.bb-venue-tab-row` | Flex-wrap row of venue page tab buttons (green-tinted) |
| `.bb-venue-tab-btn` | Individual venue-tab button; `.bb-icon-active` applied when open |
| `#bb-lightbox` | Full-screen thumbnail grid overlay |
| `#bb-lightbox-viewer` | Full-screen single-image viewer overlay (separate body child) |

---

## HOME page mode (`runHomePage`)

Runs on `http://brucebase.wikidot.com/` and `/start`.

1. **`extractGigPageSlugs()`** — scans all `a[href]` in `#page-content` for the
   pattern `/YYYY-list` (or `/YYYY-MM-list`), strips the `-list` suffix, deduplicates,
   and returns the ordered slug list (e.g. `['1949-64', '1965', …, '2026']`).
2. Inserts "Fetch All Gig Pages" button and disabled "⚡ Mismatches Only" filter
   button after `#page-title`, plus a progress line and timer element below.
3. On button click: iterates slugs in order, calls **`fetchAndProcessYear(slug, resultsEl, onProgress)`**
   for each — fetches the YEAR page, injects content into a `div.bb-year-wrapper`
   appended to `#bb-home-results`, runs `wrapYearSections` + `extractYearPageEvents`
   + `processYearEvents` on the injected wrapper, inserts per-section toggles.
4. On completion: enables the filter button; `applyMismatchFilter` works across all
   injected `.bb-section-processed` divs in the document.

Note: injecting into the live DOM before calling the processing pipeline is required
because `document.createElement`, `element.after()`, etc. need the target nodes to be
in the current document.

---

## YEAR LIST page mode (`runListPage`)

Pages like `/2024-list` contain links of the form `/2024#DDMMYY` pointing to
anchors on the YEAR page.

1. Fetches the YEAR page once.
2. `buildAnchorToNameMap(yearDoc)` pairs each `<a name="…">` anchor with the
   first following event link using `compareDocumentPosition`.
3. For each list link, extracts the raw name via `getLinkLineText()` (captures
   sibling text nodes after `<a>` for suffixes like "(Golden Globe Awards)"),
   strips the optional trailing `(…)` suffix with `stripListSuffix()`, compares
   uppercased with the YEAR page anchor map entry.
4. Appends ✅/❌ glyph; hover shows a tooltip with both names.

---

## DETAIL page mode (`runDetailPage`)

Pages like `/gig:2003-09-14-kenan-memorial-stadium-chapel-hill-nc`.

1. `parseDetailSetlist(document)` reads `getSetlistContainer(document)`.
2. `detailPathToYearAndAnchor(path)` extracts just the year
   (`gig:2003-09-14-…` → `{ year: '2003' }`). The anchor is **not** derived
   from the URL because YEAR page anchors may carry a letter suffix (e.g.
   `150571a`) that is absent from the DETAIL URL.
3. Fetches the YEAR page.
4. Finds the event link on the YEAR page whose `href === '/' + path` — direct
   match is robust against anchor suffix mismatches.
5. Finds all `<a[name]>` anchors on the YEAR page in `allYearNamedAnchors`.
6. The last one preceding the event link is `yearAnchorName` (the true YEAR page anchor).
   The first one following the event link is `nextAnchor` (end boundary for setlist).
7. **Anchor consistency check**: finds `<a href="/YEAR#FRAGMENT">Info & Setlist</a>` on
   the current page via `findInfoSetlistLink(document)`. Compares `FRAGMENT` with
   `yearAnchorName`. On mismatch: `addAnchorWarnDetail(infoLink, …)` appends a
   `<span class="bb-anchor-warn">⚠️</span>` after the link, with a hover tooltip.
8. **Venue name check**: `findVenueLink(document)` locates `<a href="/venue:…">Venue</a>`.
   Fetches the venue page; reads `#page-title` for the canonical venue name. Extracts the
   raw venue part from `rawDetailName` (after the date, no normalization, Title Case).
   Calls `addVenueGlyphDetail(venueLink, venueName, match, detailVenuePart)` to append
   ✅ or ⚠️ after the Venue link. Comparison is case-sensitive; the `(The)` article
   rewrite is NOT applied so any formatting difference is flagged.
9. Collects and parses the year-side setlist with `collectSetlistElements` +
   `parseYearSetlist`.
10. Runs `lcsDiff` + `mergeCharDiffs`; annotates each `diffItem` with
   `rawYearSong`.
11. `renderDetailSetlist(diffItems)` via `styleDetailLi`:
   - Detects `isParagraphBased` by checking whether the container has any `<li>`.
     If not, collects `<p>` elements with `/song:` links as the song element list.
   - `match` → adds `.bb-song-match` to each `a[href^="/song:"]` inside the
     element (so only the link text turns green); falls back to adding the class
     to the element itself for plain-text entries with no song link.
   - `detail-only` → adds `.bb-song-detail-only` (light-blue bg).
   - `char-diff` → adds `.bb-song-char-diff`, replaces `<a>` innerHTML with
     character-level coloured spans.
   - `year-only` → inserts a new `<li>` (or `<p>` on paragraph-based pages)
     with `.bb-song-year-only` before the current position.
   - After each element on paragraph-based pages, `addParaStructureWarning(el)`
     appends a ⚠️ span with tooltip.
12. `flagDetailSectionHeaders(yearSections, detailSections, diffItems)` runs after rendering:
   - **Case A** — DETAIL already has `<p><strong>…</strong></p>` headers: flags
     each with ⚠️ when its label mismatches the positionally-corresponding YEAR
     section label (or when the DETAIL has headers with no YEAR counterpart).
   - **Case B** — DETAIL has NO section headers AND year has a non-show/non-recording
     section (e.g. Soundcheck): synthesizes missing headers by splitting the rendered
     `<ol>` into per-section sub-lists. Computes section boundaries from `diffItems`
     via a `posMap` (year-song index → year section index), counting how many
     rendered `<li>` items belong to each section. The original `<ol>` is removed
     and replaced with interleaved `<p><strong>Label ⚠️</strong></p>` + `<ol>`
     fragments, each with a warning tooltip explaining the label is missing from
     the original DETAIL page.
13. `insertDetailToggle(originalTdHtml)` wraps the setlist tab content in
   processed/original show-hide divs and inserts a toggle button after
   `#page-title`.

---

## Shared utilities

| Function | Purpose |
|---|---|
| `fetchPage(url)` | `GM_xmlhttpRequest` wrapper; returns a `DOMParser` document |
| `fmtElapsed(ms)` | Returns fixed-width `MM:SS` string (zero-padded minutes and seconds) |
| `extractDetailEventName(doc, url)` | `#page-title` → `h1.page-title` → `h1` → `<title>` |
| `normalizeDetailName(name)` | `(The)`/`(Le)`/`(De)` rewrite + `YYYY-MM-DD - VENUE` uppercase |
| `cleanSongName(text)` | Strips any parenthetical containing a lowercase letter: `(with …)`, `(x3)`, `(parts)`, `(acoustic)` etc.; preserves all-caps qualifiers like `(41 SHOTS)` |
| `textWithoutSup(el)` | Clones el, removes all `<sup>` children, returns `.textContent`; used to exclude footnote text from prose filtering and song-name parsing |
| `getSetlistContainer(doc)` | Returns `#wiki-tab-0-1 td` → `#wiki-tab-0-1` → `#page-content` (three-level fallback for pages without a tab widget) |
| `hideJumpToRecentBox(content)` | Hides the wikidot-injected `.list-pages-box` containing "most recent" text at top of YEAR pages |
| `setupStickyBar(content, pageTitle, controlsEl)` | Creates `#bb-sticky-bar` in place of `#page-title` (hides it — year already in `#bb-pre-events`), appends `#bb-controls` + pre-HR content, sets `--bb-header-h` CSS var |
| `setupGlobalToggle(btn, content, originalHtml)` | Wires click handler on pre-existing `#bb-global-toggle`; creates hidden `#bb-page-original` div |
| `setupMismatchFilter(btn)` | Wires click handler on pre-existing `#bb-mismatch-toggle` |
| `addParaStructureWarning(el)` | Appends a `<span class="bb-para-warn">⚠️</span>` with tooltip to a `<p>`-based song element on DETAIL pages |
| `flagDetailSectionHeaders(yearSections, detailSections, diffItems)` | Case A: flags existing DETAIL `<p><strong>…</strong></p>` headers when their label mismatches the positional YEAR section. Case B: when DETAIL has no headers but YEAR has non-show sections, splits the rendered `<ol>` into per-section sub-lists and inserts synthetic `<p><strong>Label ⚠️</strong></p>` headers at the correct positions (computed via `diffItems` + `posMap`). |
| `findInfoSetlistLink(doc)` | Returns the first `<a href>` whose href matches `INFO_SETLIST_HREF_RE` and text contains "info" — the "Info & Setlist" back-link on detail pages |
| `dateToAnchor(dateStr)` | `"YYYY-MM-DD"` → `"DDMMYY"` (Brucebase anchor format); returns `null` for invalid input |
| `checkYearAnchorConsistency(detailDoc, yearAnchorName, anchorEl, eventDate?)` | Runs anchor-fragment match, `dateToAnchor` match, and href-year-vs-date-year checks; collects all issues into an array and calls `addAnchorWarnYear` (or logs match ✅) |
| `addAnchorWarnYear(anchorEl, yearAnchorName, detailAnchorRef, detailHref, issues[])` | Inserts `<span class="bb-anchor-warn">⚠️</span>` after `<a name>` on YEAR page; `issues[]` is the message array from the consistency check |
| `addAnchorWarnDetail(linkEl, yearAnchorName, detailAnchorRef, issues[])` | Appends `<span class="bb-anchor-warn"> ⚠️</span>` after the "Info & Setlist" link on the DETAIL page; `issues[]` is the message array |
| `addAnchorMatchDetail(linkEl, msg)` | Appends `<span class="bb-anchor-match"> ✅</span>` after the "Info & Setlist" link when ALL anchor checks pass; `msg` describes what was verified |
| `extractTimingBlocks(doc)` | Returns all non-empty texts from `div.code pre code` elements — covers `"Scheduled:"`, `"Local Start Time …"`, and any future patterns |
| `addScheduledBlock(afterEl, text)` | Inserts `<div class="bb-scheduled">` after `afterEl` on the YEAR page; returns the inserted div for chaining multiple blocks |
| `findVenueLink(doc)` | Returns the first `<a href="/venue:…">` element found in `doc`, or `null` |
| `renderVenueInfo(afterEl, venueHref, venueName, match, detailVenuePart)` | Appends ` at <strong><em><a>venueName</a></em></strong> ✅/⚠️` to `afterEl` (if it is a `bb-scheduled` div) or creates a new `bb-scheduled` div after it; venue `<strong>` is at `font-size: 1.1em`; comparison is raw Title Case (no uppercasing) |
| `addVenueGlyphDetail(linkEl, venueName, match, detailVenuePart)` | Appends a ✅ (`bb-anchor-match`) or ⚠️ (`bb-venue-warn`) span after the `<a href="/venue:…">Venue</a>` link on DETAIL pages |
| `buildTabMap(doc)` | Builds `Map<label,index>` from `.yui-nav em` elements on a DETAIL page |
| `getTabEl(doc, tabMap, label)` | Returns `#wiki-tab-0-N` for the given label, or `null` |
| `extractIconContent(doc, canonical, tabMap)` | Dispatcher; calls the appropriate per-type extractor |
| `extractRecordingContent(doc, tabMap, canonical)` | Extracts Bootleg/LiveDL slice from the Recording tab; splits at `<hr>` only when `isLiveDLSplit(tab)` is true |
| `isLiveDLSplit(tab)` | Returns true when the Recording tab contains a LiveDL entry (cover image, nugs.net link, or "Official concert recording" text) |
| `initLightbox()` | Lazily creates `_lightbox` and `_viewer` as independent `body` children |
| `openLightbox(content, label)` | Populates and shows the thumbnail grid lightbox |
| `closeLightbox()` | Hides both `_lightbox` and `_viewer` |
| `showImageViewer(src)` | Shows a single full-size image in `_viewer` without opening the grid |
| `filenameCaption(url)` | Derives a human-readable caption from a dated filename (strips `YYYYMMDD_` prefix, replaces `_` with spaces) |
| `toggleIconPanel(icon, content, section)` | Lazily builds and toggles an inline panel for a YEAR-page icon; panels are independent (multiple can be open) |
| `buildIconPanel(content)` | Creates a detached panel div for a content object; handles `images`, `links`, and `html` types |
| `addEventTabButtons(doc, tabMap, section)` | Appends a `.bb-event-tab-row` with buttons for DETAIL tabs not in `ICON_COVERED_TABS` or `SKIP_TABS` |
| `addTagsButton(doc, tabMap, section, eventLink)` | Appends a "Tags" button (last in `.bb-event-tab-row`) that opens a panel showing all DETAIL page tags as hyperlinks; missing expected tags shown in bold red, spurious managed tags shown with an orange ⚠️ tooltip; button label turns red/orange and shows counts |
| `wireIconHandlers(eventLink, doc)` | Makes icon images interactive, calls `addEventTabButtons`, then `addTagsButton`; called from `processOneYearEvent` |
| `addVenueTabButtons(venueDoc, venueHref, venueName, section)` | Appends a `.bb-venue-tab-row` (green-tinted) with buttons for each non-empty venue page tab, then calls `addVenueTagsButton`; reuses already-fetched `venueDoc` |
| `addVenueTagsButton(venueDoc, venueName, section, row)` | Appends a "Tags" button to the venue tab row showing the venue page's `.page-tags` with consistency checks (`"venue"` and first-letter tag) |
| `computeExpectedVenueTags(venueName)` | Returns `Set<string>` of tags expected on a venue page: `"venue"` always, plus the first letter of `venueName` lowercased |
| `isManagedVenueTag(tag)` | Returns `true` for `"venue"` and single `[a-z]` tags (first-letter index tags) |
| `computeExpectedTags(doc, tabMap, eventDate, eventType)` | Returns `Set<string>` of lowercase tags expected for an event — date-derived (year, month name, day, weekday), event-type, and content-based (bootleg, livedl, news, memorabilia, ticket, setlist, handwritten, printed, soundcheck, storyteller); see "Tag consistency checks" section below |
| `isManagedTag(tag)` | Returns `true` for tags whose presence can be verified: content tags in `MANAGED_CONTENT_TAGS`, month names, weekday names, 4-digit years, 1–2 digit day numbers ≤ 31 |
| `spuriousTagMsg(tag, expectedTags)` | Returns a human-readable tooltip string for a tag that is present but whose condition is not met; uses `SPURIOUS_TAG_REASONS` dict for content tags and derives contextual messages for date tags |
| `isTagPresent(tag, actualTags)` | Like `actualTags.has(tag)` but also accepts numeric day aliases: `"7"` and `"07"` are equivalent |
| `annotateDetailPageTags(tabMap, eventDate, eventType)` | On DETAIL pages: runs `computeExpectedTags`, wraps `.page-tags` in a gold warning box when issues found, adds orange ⚠️ after spurious tag links and red bold spans for missing tags |
| `buildDiffHtml(a, b)` | Token-level diff on whitespace/comma splits (for name tooltips) |
| `buildCharDiffHtml(a, b)` | Char-level LCS diff; shows year song chars with red/green spans |
| `lcsDiff(yearSongs, detailSongs)` | Standard LCS producing `match`/`year-only`/`detail-only` items |
| `mergeCharDiffs(items)` | Adjacent `year-only`+`detail-only` → `char-diff` when close enough |
| `editDistance(a, b)` | Standard O(mn) Levenshtein |
| `esc(str)` | HTML-escapes `& < > "` |
| `delay(ms)` | `Promise`-based sleep |

### CSS layout notes

- **Do not** add `overflow-y`/`max-height` to `#side-bar` — these shrink the sidebar
  content area (the scrollbar takes ~17px), causing year-link lines to break.
  `position: sticky` alone is sufficient for sidebar visibility.
- `scrollbar-gutter: stable` makes content permanently narrower even with no scrollbar —
  avoid it on the sidebar.
- `--bb-header-h` CSS custom property is set by `setupStickyBar` on YEAR pages; defaults
  to `0px` on other page types via `:root { --bb-header-h: 0px; }`.
- `--bb-sticky-bar-h` is set by `setupStickyBar` after measuring `#bb-sticky-bar.offsetHeight`.
  The SmartTable `stickyOffset` option is passed `'calc(var(--bb-header-h) + var(--bb-sticky-bar-h))'`
  so both `st-global-bar` and `thead` stick below the sticky bar rather than below the viewport top.

---

## Anchor format

Named anchors on YEAR pages use `DDMMYY` order:
- `<a name="140903">` = September 14, 2003
- `<a name="070124">` = January 7, 2024

Multi-event days (or events with unknown day numbers) carry a letter suffix:
- `<a name="150571a">` = first event on May 15, 1971
- `<a name="000568a">` = first event in May 1968 (day unknown)

The DETAIL page URL may **not** carry the letter suffix (e.g.
`/gig:1971-05-15-newark-state-college-union-nj` for anchor `150571a`), which
is why `runDetailPage` locates the event link by `href` match rather than by
deriving the anchor name from the URL.

---

## Name normalisation rules

DETAIL page names are in "Title Case With Article Before Comma" form.
YEAR page names are in `YYYY-MM-DD - ALL CAPS VENUE, CITY, ST` form.

Normalisation steps applied to the DETAIL name before comparison:
1. Match `YYYY-MM-DD` date prefix
2. If rest matches `VENUE (The), SUFFIX` or `VENUE (Le), SUFFIX` → rewrite as
   `The VENUE, SUFFIX` / `Le VENUE, SUFFIX`
3. Insert ` - ` between date and venue
4. Uppercase the whole string

Result must equal the YEAR page name (already uppercase) exactly.

---

## Song name cleaning rules (`cleanSongName`)

Strips any `(…)` parenthetical whose content contains at least one lowercase
letter. This covers:
- `(with James Maddock)` — guest musician
- `(x3)` — repeat count
- `(parts)`, `(acoustic)`, `(instrumental)` — descriptive qualifiers

Parentheticals that are all-caps are preserved because they form part of the
song title:
- `(41 SHOTS)`, `(COME OUT TONIGHT)`, `(BADLANDS)` — medley/subtitle

Qualifiers stripped by `cleanSongName` are **not** lost for display purposes:
`rawSongs` in each `Section` carries the original text before cleaning, and
`rawYearSong` on each `diffItem` carries the raw text for the year-side song.
When rendering a `match` on the YEAR page, the portion after the clean name
(e.g. ` (parts)`, ` (with Willie Nile)`) is appended as plain unstyled text
outside the green span.

---

## Anchor and date checks

All three checks are run in both `checkYearAnchorConsistency` (called from `processOneYearEvent` on the YEAR page, and also on the DETAIL page anchor section in `runDetailPage`) and in `processOneListEvent` (YEAR LIST pages).

### `dateToAnchor(dateStr)` — DDMMYY derivation

```
"2026-01-17"  →  "170126"   (DD + MM + last-two-of-YYYY)
"1977-02-17"  →  "170277"
```

### Three checks

1. **Anchor fragment match** — `yearAnchorName === detailAnchorRef` (exact string).
2. **DateToAnchor match** — `anchor.startsWith(dateToAnchor(eventDate))`. Uses `startsWith` to allow letter disambiguation suffixes (`"170277a"`).
3. **Href year match** — 4-digit year in the "Info & Setlist" href path (e.g. `/1977#…`) must equal the 4-digit year in the event date.

### Where applied

| Page | Check triggered by | Failure annotation |
|---|---|---|
| YEAR page | `checkYearAnchorConsistency` (after detail fetch) | `addAnchorWarnYear` → `bb-anchor-warn` ⚠️ after `<a name>` |
| DETAIL page | anchor block in `runDetailPage` (after detail fetch) | `addAnchorWarnDetail` → `bb-anchor-warn` ⚠️ after "Info & Setlist" link; `addAnchorMatchDetail` → `bb-anchor-match` ✅ on success |
| LIST page | `processOneListEvent` pre-checks (no fetch required) | `addWarningGlyph` ⚠️ on cross-year hrefs; `bb-anchor-warn` span after ✅/❌ glyph for same-year anchor issues |

### LIST page `hrefYear` check

`extractListPageEvents` no longer filters out cross-year hrefs (`hrefYear !== pageYear`). All matching hrefs are extracted; `hrefYear` is stored in the event record. In `processOneListEvent(event, anchorMap, pageYear)`:

- **Cross-year** (`hrefYear !== pageYear`): immediately flags with `addWarningGlyph`; skips name comparison (anchor map is built for `pageYear`, not `hrefYear`).
- **Same-year**: runs name comparison as before, then appends a `bb-anchor-warn` span if either DateToAnchor or day-year check fails.

---

## Tag consistency checks

### Constants (defined at top of IIFE)

| Constant | Value / purpose |
|---|---|
| `SORRY_RE` | `/^Sorry,? no /i` — matches empty-tab placeholder text |
| `MONTH_NAMES` | `['january', …, 'december']` — indexed 0–11 |
| `DAY_NAMES` | `['sunday', …, 'saturday']` — indexed 0–6 |
| `MANAGED_CONTENT_TAGS` | `Set` of content tags we can verify: event types + `bootleg`, `livedl`, `news`, `memorabilia`, `ticket`, `setlist`, `handwritten`, `printed`, `soundcheck`, `storyteller` |
| `SPURIOUS_TAG_REASONS` | `{tag: 'human-readable reason'}` — used by `spuriousTagMsg` for content tags |

### Expected tag rules (`computeExpectedTags`)

| Expected tag | Condition |
|---|---|
| `YYYY` (year) | from event date |
| month name | from event date |
| day number (stripped) | `parseInt(dd)` — `"07"` → stored as `"7"`; `isTagPresent` accepts both forms |
| weekday name | `new Date(yr, mo-1, dd).getDay()`; skipped when day = 0 (unknown) |
| event type | `eventType.toLowerCase()` (`"gig"`, `"recording"`, etc.) |
| `bootleg` | Recording tab has non-Sorry content AND is NOT purely a LiveDL (i.e. `!isLiveDLSplit(recTab)` OR `recTab.querySelector('hr')` exists) |
| `livedl` | `isLiveDLSplit(recTab)` is true |
| `news` | News/Memorabilia (or News) tab has non-Sorry content |
| `memorabilia` | Combined `News/Memorabilia` tab has non-Sorry content (not just plain `News`) |
| `ticket` | News/Memorabilia tab has images with `ticket` in src |
| `setlist` | News/Memorabilia tab has images with `setlist` in src (excl. `ticket`) |
| `handwritten` | Setlist images with `handwritten` in src |
| `printed` | Setlist images with `printed` in src |
| `soundcheck` | `#page-content` text matches `/\bsoundcheck\s*:/i` |
| `storyteller` | Storyteller tab has non-Sorry content |

### Bidirectional checking

**Missing** (expected but absent): tag rendered in bold red in the Tags panel; `bb-tag-missing` span appended inside `.page-tags` on DETAIL.

**Spurious** (present but condition NOT met): orange ⚠️ appended after the tag link; tooltip from `spuriousTagMsg`. Only checked for `isManagedTag` tags — unmanaged tags (venue names, song abbreviations, tour codes, etc.) are never flagged.

### YEAR page Tags button

`addTagsButton` is called from `wireIconHandlers` (after `addEventTabButtons`). It:
1. Reads `.page-tags a[href]` from the fetched DETAIL `doc`.
2. Computes expected tags and compares against actual (using `isTagPresent`).
3. Merges existing links + missing placeholders into one sorted list; renders in the `buildIconPanel` infrastructure.
4. Button label: `"Tags"` when clean; `"Tags ⚠️ (N missing, M spurious)"` with color red (if any missing) or dark-orange (if only spurious).

### DETAIL page annotation

`annotateDetailPageTags(tabMap, eventDate, eventType)` is called from `runDetailPage` right after `addDetailTitleAnnotation`. It builds `detailTabMap = buildTabMap(document)` from the current page (not the fetched YEAR page).
