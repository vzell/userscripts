# UTILITIES.md — Shared Utilities, CSS Notes, and Diff Helpers

## Core utilities

| Function | Purpose |
|---|---|
| `fetchPage(url)` | `GM_xmlhttpRequest` wrapper; parses response as HTML via `DOMParser`; rejects on non-2xx or network error |
| `fmtElapsed(ms)` | Returns fixed-width `MM:SS` string (zero-padded minutes and seconds) |
| `delay(ms)` | `Promise`-based sleep via `setTimeout` |
| `esc(str)` | HTML-escapes `& < > "` |
| `log/logWarn/logErr(...a)` | `console.log/warn/error('[BruceBase]', ...a)` |

---

## Name / event utilities

| Function | Purpose |
|---|---|
| `extractDetailEventName(doc, url)` | `#page-title` → `h1.page-title` → `h1` → `<title>` fallback chain |
| `normalizeDetailName(name)` | `(The)`/`(Le)`/`(De)` rewrite + `YYYY-MM-DD - VENUE` uppercase; see [YEAR_PAGE.md](YEAR_PAGE.md) |
| `extractEventAlias(doc)` | Reads the alias/alternate name from the DETAIL page; passed to `addYearGlyph` for display in the tooltip and as `.bb-event-alias` span |
| `detailPathToYearAndAnchor(p)` | `"gig:YYYY-MM-DD-…"` → `{ year: "YYYY" }`; anchor no longer derived from URL |
| `yearPageSlug(year)` | Maps years 1949–1964 to `"1949-64"`, all others return unchanged |
| `yearMatchesHrefSlug(dateYear, hrefSlug)` | Returns true when `hrefSlug === dateYear` OR (`hrefSlug === "1949-64"` AND `1949 ≤ dateYear ≤ 1964`) |

---

## Song name utilities

| Function | Purpose |
|---|---|
| `cleanSongName(text)` | Strips `(…)` with any lowercase letter; preserves all-caps qualifiers |
| `songCompareKey(raw)` | `cleanSongName` for most tokens; normalises `, and/or`/`, and`/`, or` alternatives to ` - ` separators |
| `textWithoutSup(el)` | Clones element, removes all `<sup>` children, returns `.textContent`; used to exclude footnotes from song parsing and prose filtering |

---

## Setlist container

`getSetlistContainer(doc)` — three-level fallback:
1. `doc.querySelector('#wiki-tab-0-1 td')` — standard layout.
2. `doc.querySelector('#wiki-tab-0-1')` — no `<td>` wrapper.
3. `doc.querySelector('#page-content')` — very old pages with no tab widget.

---

## Tab map utilities

`buildTabMap(doc)` iterates `doc.querySelectorAll('.yui-nav em')` in order and
returns `Map<label, index>`. The index is always looked up by label, never
hardcoded, because tab positions vary across event types.

`getTabEl(doc, tabMap, label)` returns `doc.getElementById('wiki-tab-0-N')` or
`null`. `makeTabRowLabel(text)` creates a `<span class="bb-tab-row-label">`.

---

## Venue utilities

| Function | Purpose |
|---|---|
| `findVenueLink(doc)` | Returns first `<a href="/venue:…">` in `doc`, or `null` |
| `renderVenueInfo(afterEl, venueHref, venueName, match, detailVenuePart, venuePrefix)` | Appends venue info to a `.bb-scheduled` div or creates a new one |
| `addVenueGlyphDetail(linkEl, venueName, match, detailVenuePart)` | Appends ✅/⚠️ after venue link on DETAIL page |
| `computeExpectedVenueTags(venueName)` | Returns `Set` containing `"venue"` and first letter of `venueName` (lowercased) |
| `isManagedVenueTag(tag)` | Returns true for `"venue"` and single `[a-z]` tags |

---

## Diff helpers

| Function | Purpose |
|---|---|
| `buildDiffHtml(a, b)` | Token-level diff on whitespace/comma splits (for name mismatch tooltips); mismatching tokens wrapped in `<span class="bb-diff-mismatch">` |
| `buildCharDiffHtml(a, b)` | Char-level LCS diff; year song chars shown with `.bb-char-match` (green) / `.bb-char-diff` (red bold) spans |
| `lcsDiff(yearSongs, detailSongs)` | Standard LCS producing `match`/`year-only`/`detail-only` items |
| `mergeCharDiffs(items)` | Adjacent `year-only` + `detail-only` → `char-diff` when Levenshtein distance is small relative to length |
| `editDistance(a, b)` | Standard O(mn) Levenshtein |

---

## Tooltip functions

| Function | Tooltip type |
|---|---|
| `showYearTooltip(evt, yearName, normalizedDetailName, rawDetailName, eventType, match, isEarlyLate, anchorName)` | Event name comparison table (YEAR / DETAIL page) |
| `showListTooltip(evt, strippedName, rawName, yearName, anchor, match)` | LIST page name comparison table |
| `showSongTooltip(evt, el)` | Song diff (year-only / detail-only / char-diff) |
| `showErrorTooltip(evt, msg)` | Generic error/warning message (red text) |
| `hideTooltip()` | Hides `#bb-tooltip` |
| `positionTooltip(tip, evt)` | Positions tooltip near cursor, clamped to viewport |

---

## UI helpers

| Function | Purpose |
|---|---|
| `makeGlyphSpan(char)` | Creates `<span class="bb-glyph"> char</span>` |
| `makeEventTypeSpan(type)` | Creates `<span class="bb-event-type"> (type)</span>` — grey italic suffix on YEAR page event links |
| `addYearGlyph(element, nameMatch, isEarlyLate, yearName, normalizedDetailName, rawDetailName, eventType, eventAlias, anchorName)` | Appends event-type span + ✅/⚠️/❌ glyph after event link on YEAR page |
| `addDetailTitleAnnotation(…)` | Appends `bb-event-type-detail` + glyph to `#page-title h1` on DETAIL page |
| `addWarningGlyph(element, msg, eventType?)` | Appends ⚠️ glyph (fetch error or unknown type fallback) |
| `addUnknownGlyph(element, eventType, url)` | Appends ❓ glyph for unrecognised event type URLs |
| `addListGlyph(element, match, strippedName, rawName, yearName, anchor)` | Appends ✅/❌ glyph on LIST pages |
| `hideJumpToRecentBox(content)` | Hides `.list-pages-box` containing "most recent" text |
| `setupStickyBar(content, pageTitle, controlsEl)` | Builds sticky header band; sets CSS vars |
| `setupGlobalToggle(btn, content, originalHtml)` | Wires ⇄ Original Page button |
| `setupMismatchFilter(btn, eventCount)` | Wires ⚡ Mismatches button for YEAR pages |
| `setupListMismatchFilter(btn, listEvents)` | Wires ⚡ Mismatches button for LIST pages |
| `applyMismatchFilter(active)` | Shows/hides `.bb-section-processed` divs; also hides/restores `<hr>` and `.bb-section-controls` |

---

## CSS layout notes

- **Do not** add `overflow-y` / `max-height` to `#side-bar` — these shrink the
  sidebar (scrollbar takes ~17px), causing year-link lines to wrap.
  `position: sticky` alone is sufficient for sidebar visibility.
- `scrollbar-gutter: stable` makes content permanently narrower even with no
  scrollbar — avoid it on the sidebar.
- `--bb-header-h` defaults to `0px` on non-YEAR pages via `:root`.
- `--bb-sticky-bar-h` is set after measuring `#bb-sticky-bar.offsetHeight`.

## Key CSS classes (visual identity)

| Class | Description |
|---|---|
| `.bb-toggle-btn` | Style for all script buttons (Start, Save, Load, toggle, filter, …) |
| `.bb-glyph` | Inline glyph spans (✅ ❌ ⚠️ ❓) appended after event links |
| `.bb-event-type` | Grey italic `(type)` suffix on YEAR page event links |
| `.bb-event-type-detail` | Small grey italic `(type)` in DETAIL page `#page-title` |
| `.bb-event-alias` | Italic bold event alias shown in YEAR glyph tooltip |
| `.bb-section-processed` | Wrapper div for each event section on YEAR pages |
| `.bb-section-original` | Hidden div holding pre-processing snapshot |
| `.bb-section-controls` | Flex div holding ⇄ Original and ☰ List buttons per section |
| `.bb-section-list` | Ordered-list view built by `buildListDiv` |
| `.bb-list-view` | `<ol>` inside `.bb-section-list` |
| `.bb-list-label` | Section label paragraph inside `.bb-section-list` |
| `.bb-song-num` | Clickable song number link in flat / list view |
| `.bb-song-num-plain` | Non-clickable song number span |
| `.bb-year-header` | `<h3>` collapse/expand header for a year block (HOME page) |
| `.bb-year-wrapper` | Container div for injected year content (HOME page) |
| `.bb-year-toggle-glyph` | ▼/▶ glyph inside year header |
| `#bb-sticky-bar` | Sticky control bar below `#header` |
| `#bb-controls` | Flex row containing buttons and progress inside sticky bar |
| `#bb-btn-container` | Flex container for all control buttons |
| `#bb-year-progress` | Timer + progress text paragraph |
| `#bb-year-timer` | Fixed-width `MM:SS` span inside progress |
| `#bb-page-original` | Hidden div with pre-processing page HTML (global toggle) |
| `.bb-detail-processed` | Wrapper for processed DETAIL setlist content |
| `.bb-detail-original` | Hidden wrapper for original DETAIL setlist content |
| `#bb-tooltip` | Fixed-position hover tooltip (`z-index: 9999`) |
| `#bb-home-results` | Results container on HOME page |
| `#bb-home-smarttable-host` | SmartTable host div on HOME page |
| `#bb-smarttable-host` | SmartTable host div on YEAR page |
