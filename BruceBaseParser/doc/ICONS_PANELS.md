# ICONS_PANELS.md — Clickable Icons, Panels, and Venue Tabs

## Overview

After `processOneYearEvent` fetches the DETAIL page, `wireIconHandlers(eventLink, doc, onstageResult)`
makes icon images on the YEAR page interactive and appends event-tab and venue-tab
button rows to the event section. `onstageResult` (from `fetchOnstageCompanionTags`,
see [TAGS.md](TAGS.md)) is threaded through to `addTagsButton` so its panel
also shows any tags found on the event's "onstage:" companion page.

---

## Constants

| Constant | Purpose |
|---|---|
| `ICON_TITLE_MAP` | Maps every `img.title` variant to a canonical key (`"Photos"` → `"Photo"`, `"Eye"` → `"Eyewitness"`, `"Audio / Video Bootleg"` → `"Bootleg"`, `"Retail"` → `"Retail"`, etc.) |
| `CANONICAL_TAB_LABEL` | Maps canonical key to the DETAIL page YUI tab label that holds its content |
| `ICON_COVERED_TABS` | Set of tab labels handled by icons; excluded from event-tab button row. Includes: `Gallery`, `Setlist`, `News/Memorabilia`, `News`, `Media`, `Storyteller`, `Eyewitness`, `Recording` |
| `SKIP_TABS` | Tab labels to never show as buttons (empty set; kept for future use) |

---

## `wireIconHandlers(eventLink, doc, onstageResult = null)`

1. Builds `tabMap = buildTabMap(doc)`.
2. For each `img.image` in the event's `.bb-section-processed`:
   - Unwraps any real-navigation `<a>` parent (e.g. `/stats:…` links) so clicks
     reach the handler.
   - Strips any ` — click to expand` suffix from `img.title` (added on a
     previous run; stripped before retry so `ICON_TITLE_MAP` lookup works).
   - Maps `rawTitle` → `canonical` via `ICON_TITLE_MAP`. Skips unknown titles.
   - **Retail** (`canonical === 'Retail'`): calls `wireRetailIcon(…)` and skips
     the synchronous `extractIconContent` path.
   - Calls `extractIconContent(doc, canonical, tabMap)`.
   - If `null`: checks if the corresponding DETAIL tab says "Sorry, no X available"
     → inserts `<span class="bb-glyph bb-icon-sorry">⚠️</span>` after the icon
     and dims it to 0.45 opacity.
   - If content is returned:
     - `canonical === 'Photo'` → `openLightbox(content, rawTitle)` on click.
     - All others → `toggleIconPanel(icon, content, section)` on click.
3. `addEventTabButtons(doc, tabMap, section)`.
4. `addTagsButton(doc, tabMap, section, eventLink, onstageResult)` — merges
   any onstage-companion tags into the panel (see [TAGS.md](TAGS.md)).

---

## Content extractors

| Canonical | Tab | Content shape |
|---|---|---|
| `Photo` | Gallery | `{ type:'gallery', items:[{thumbUrl, mediumUrl}] }` |
| `Setlist` | News/Memorabilia | `{ type:'images', caption:'Setlist', items }` — images with "setlist" in src, excl. "ticket" |
| `Ticket` | News/Memorabilia | `{ type:'images', caption:'Tickets', items }` — images with "ticket" in src |
| `News` | News/Memorabilia | `{ type:'links', caption:'News', items:[{url, text, source}] }` — external `http` links; `source` from trailing `<sup><em>` |
| `Memorabilia` | News/Memorabilia | `{ type:'images', caption:'Memorabilia', items }` — images with `/news:` in src |
| `Video` | Media | `{ type:'html', caption:'Media', html }` — only when `<iframe>`/`<object>`/`<embed>`/`<video>` is present |
| `Storyteller` | Storyteller | `{ type:'html', caption:'Storyteller', html }` |
| `Eyewitness` | Eyewitness | `{ type:'html', caption:'Eyewitness', html }` |
| `Bootleg` | Recording | `{ type:'html', caption:'Recording', html }` |
| `LiveDL` | Recording | `{ type:'html', caption:'Official Live Download', html }` |

All extractors return `null` when the tab is absent or its text starts with
`SORRY_RE = /^Sorry,? no /i`.

`getTabEl(doc, tabMap, label)` always looks up the index by label (never
hardcoded) because tab positions vary across event types.

---

## Recording tab split (`extractRecordingContent` / `isLiveDLSplit`)

Split is only applied when `isLiveDLSplit(tab)` is true — i.e. the tab
contains a `.image-container`, a `nugs.net` link, or text matching
`/official\s+concert\s+recording/i`.

- When split applies: LiveDL = slice before `<hr>`, Bootleg = slice after.
- When no `<hr>` or `isLiveDLSplit` is false: both types return the full tab.

---

## Retail icon (`wireRetailIcon`)

Scans the Recording tab for `<p>` elements containing `/retail:` links.
- None found → inserts `bb-icon-sorry ⚠️` and dims icon.
- Found → icon becomes clickable; first click lazily calls
  `buildRetailContent(retailParas, hrefs)`:
  - Fetches each `/retail:…` page.
  - Strips scripts, footer (disclaimer link + preceding `<hr>`), and top-level
    `.list-pages-box` elements (redundant release icon nav).
  - Reads `#page-title` from the retail page and renders it as
    `<div class="bb-retail-page-title">` above the content.
  - Flattens each YUI navset into `<p><strong class="bb-retail-tab-label">LABEL</strong></p>`
    + `<div>content</div>` pairs using a `DocumentFragment` (no wrapper div).
  - Returns `{ type:'html', caption:'Retail', html }`.
- After the panel is appended to the DOM, `wirePanelCollapsibles(panel)` wires
  each `.bb-retail-tab-label` as a collapse toggle for the `<div>` immediately
  following its `<p>` parent. All sections start collapsed.
- Subsequent clicks toggle the panel open/closed.

---

## Lightbox (Photo / Gallery)

Two singleton elements appended directly to `document.body` (as independent
siblings, not nested, so `display:none` on one cannot cascade into the other):

- **`_lightbox`** (`#bb-lightbox`) — dark full-screen overlay with thumbnail
  grid (`#bb-lightbox-grid`). `openLightbox(content, label)` populates it and
  sets `display:flex`. Clicking the backdrop or ✕ calls `closeLightbox()`.
- **`_viewer`** (`#bb-lightbox-viewer`) — separate fixed overlay for the
  full-size image. `showImageViewer(src)` shows it without opening the grid.
  Clicking a thumbnail in the grid also opens `_viewer`. ESC closes both.

Both created lazily inside `initLightbox()`.

`filenameCaption(url)` strips the `YYYYMMDD_` prefix and replaces `_` with
spaces for a human-readable caption (e.g. `"Article 01"`, `"Setlist 02 Handwritten"`).

---

## Inline panels (all non-photo icons)

`toggleIconPanel(icon, content, section)` builds a panel lazily on first click
via `buildIconPanel(content)`, sets `panel._bbIcon = icon` (so the ✕ button can
remove `.bb-icon-active` from the triggering element), and appends it to
`section`. Multiple panels across different events can be open simultaneously.

`buildIconPanel` renders by content type:

| `content.type` | Rendering |
|---|---|
| `images` | Flex-wrapped `<figure class="bb-thumb-item">` elements; clicking calls `showImageViewer(fullUrl)` |
| `links` | `<p class="bb-news-item"><a>Title</a><span class="bb-link-source">(Source)</span></p>` per item |
| `html` | Raw tab `innerHTML`; relative `/` links rewritten to `http://brucebase.wikidot.com/…`. For `caption === 'Media'`: each `<iframe>`/`<object>`/`<embed>`/`<video>` extracted into a `<div class="bb-media-item">` flex child |

---

## Event-tab buttons (`addEventTabButtons`)

Iterates all labels in `tabMap`, skips `ICON_COVERED_TABS` and `SKIP_TABS`,
and for each non-empty tab that does not start with `SORRY_RE` creates a
`<button class="bb-event-tab-btn">`. All buttons are wrapped in
`<div class="bb-event-tab-row">` prefixed with a `<span class="bb-tab-row-label">Event:</span>`.

Clicking uses the same `buildIconPanel` + `_bbIcon` mechanism as icon handlers.

---

## Notes button (`buildNotesButton`)

For VENUE, SONG, and RELATION pages, a **Notes** button is appended to the
first tab button row when the page has introductory free text before the first
`.yui-navset`.

`extractPageNotes(doc)` collects all children of `#page-content` that precede
the first `.yui-navset`, strips `<script>` elements, and rewrites relative hrefs
to absolute URLs. Returns `null` when only whitespace is found.

`buildNotesButton(doc, caption, btnClass, section)` builds a toggle button that
lazily constructs a `buildIconPanel({ type:'html', … })` panel on first click.
Subsequent clicks toggle the panel open/closed.

---

## Page title / event title warnings

### `annotatePageTitleWithWarnings()`

Called at the end of `runDetailPage`, `runVenuePage`, `runSongPage`, and
`runRelationPage`. Collects messages from the live DOM via `collectPageWarnings()`
(`.bb-tag-missing`, `.bb-tag-spurious`, `.bb-anchor-warn`, `.bb-venue-warn`,
`.bb-para-warn`, `.yui-nav em span[data-msg]`). When any exist, appends
`<span class="bb-page-title-warn"> ⚠️</span>` to `#page-title` with a rich
numbered tooltip listing all issues.

### `annotateEventTitleWithWarnings(element, processedDiv)` — YEAR pages

Called at the end of `processOneYearEvent` after all checks complete. Collects
messages from within the event's `bb-section-processed` via
`collectSectionWarnings(processedDiv)`. When any exist, inserts
`<span class="bb-event-title-warn"> ⚠️</span>` after the last
`bb-glyph` / `bb-event-type` / `bb-event-alias` sibling of the event link,
with the same rich tooltip format.

`renderVenueInfo` sets `glyph.dataset.msg` on the venue warning span so it is
visible to both collectors. Its informational sibling class, `.bb-venue-info`
(see YEAR_PAGE.md / DETAIL_PAGE.md / TAGS.md), is deliberately *not* queried
by either collector — it's not a real mismatch, just a note that the DETAIL
page's title has an extra descriptive venue-detail segment the VENUE page
doesn't.

---

## Venue-tab buttons (`addVenueTabButtons`)

Called from `processOneYearEvent` when the venue page was successfully fetched
(reusing `venueDoc` — no extra request). Builds a tab map from the venue page
and creates `<div class="bb-venue-tab-row">` (green-tinted) with
`<button class="bb-venue-tab-btn">` elements. Relative hrefs inside tab HTML
are rewritten to absolute URLs.

At the end, `addVenueTagsButton(venueDoc, venueName, section, row)` appends a
"Tags" button to the venue tab row showing the venue page's `.page-tags` with:
- `computeExpectedVenueTags(venueName)` — always expects `"venue"` plus the
  first letter of the venue name (lowercased, e.g. `"b"` for `"Blue Cross Arena"`).
- `isManagedVenueTag(tag)` — true for `"venue"` and single `[a-z]` tags.
- Missing managed tags shown in bold red; spurious managed tags flagged with ⚠️.

---

## CSS classes (icon / panel feature)

| CSS class | Purpose |
|---|---|
| `.bb-scheduled` | Monospace timing block below event title (0.9em, #555) |
| `.bb-venue-warn` | Orange ⚠️ glyph for venue name mismatches |
| `.bb-venue-info` | Green, informational glyph (text-presentation `⚠︎`) when the only difference from the VENUE page title is an extra descriptive venue-detail segment or show-variant suffix — not counted as a mismatch |
| `.bb-variant-info` | Green, informational glyph (text-presentation `⚠︎`) for the isEarlyLate case (event name differs from the YEAR page only by a trailing show-variant suffix) — not counted as a mismatch |
| `img.bb-icon-active` | Blue outline on a currently-open icon |
| `.bb-icon-panel` | Inline collapsible panel container |
| `.bb-icon-panel-header` | Panel title + ✕ button row |
| `.bb-icon-panel-body` | Panel content area |
| `.bb-icon-thumbnails` | Flex-wrap thumbnail grid |
| `.bb-thumb-item` | `<figure>` wrapper for one thumbnail + caption |
| `.bb-news-item` | `<p>` wrapper for one news link + source |
| `.bb-link-source` | Italic grey source label |
| `.bb-media-item` | Flex child wrapping one video embed |
| `.bb-event-tab-row` | Flex-wrap event-tab button row |
| `.bb-event-tab-btn` | Individual event-tab button |
| `.bb-venue-tab-row` | Flex-wrap venue-tab button row (green-tinted) |
| `.bb-venue-tab-btn` | Individual venue-tab button |
| `.bb-tab-row-label` | Fixed-width label span before button rows ("Event:" / "Venue:") |
| `.bb-icon-sorry` | ⚠️ span for icons with no matching DETAIL content |
| `.bb-song-tab-row` | Row of song-page tab buttons (from song-number click) |
| `#bb-lightbox` | Full-screen thumbnail grid overlay |
| `#bb-lightbox-viewer` | Full-screen single-image viewer overlay |
| `.bb-retail-refs` | Wrapper div for retail reference paragraphs in Retail panel |
| `.bb-retail-page-title` | Bold heading showing the retail page's `#page-title` text |
| `.bb-retail-tab-label` | Collapsible label `<strong>` for each flattened retail tab section |
| `.bb-retail-tab-open` | Added to `.bb-retail-tab-label` when the section is expanded |
| `.bb-page-title-warn` | ⚠️ span appended to `#page-title` on DETAIL/VENUE/SONG/RELATION pages |
| `.bb-event-title-warn` | ⚠️ span appended to event title line on YEAR pages |
| `.bb-cache-retry` | ⟳ button added to sections after a cache load |
