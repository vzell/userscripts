# ICONS_PANELS.md — Clickable Icons, Panels, and Venue Tabs

## Overview

After `processOneYearEvent` fetches the DETAIL page, `wireIconHandlers(eventLink, doc)`
makes icon images on the YEAR page interactive and appends event-tab and venue-tab
button rows to the event section.

---

## Constants

| Constant | Purpose |
|---|---|
| `ICON_TITLE_MAP` | Maps every `img.title` variant to a canonical key (`"Photos"` → `"Photo"`, `"Eye"` → `"Eyewitness"`, `"Audio / Video Bootleg"` → `"Bootleg"`, `"Retail"` → `"Retail"`, etc.) |
| `CANONICAL_TAB_LABEL` | Maps canonical key to the DETAIL page YUI tab label that holds its content |
| `ICON_COVERED_TABS` | Set of tab labels handled by icons; excluded from event-tab button row. Includes: `Gallery`, `Setlist`, `News/Memorabilia`, `News`, `Media`, `Storyteller`, `Eyewitness`, `Recording` |
| `SKIP_TABS` | Tab labels to never show as buttons (empty set; kept for future use) |

---

## `wireIconHandlers(eventLink, doc)`

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
4. `addTagsButton(doc, tabMap, section, eventLink)`.

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
  - Strips scripts, footer (disclaimer link + preceding `<hr>`).
  - Flattens YUI navsets into labeled tab panels (all visible, no JS needed).
  - Returns `{ type:'html', caption:'Retail', html }`.
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
| `.bb-retail-tabs` | Wrapper for flattened YUI navset in Retail panel |
| `.bb-retail-tab-label` | Label for each flattened retail tab |
| `.bb-cache-retry` | ⟳ button added to sections after a cache load |
