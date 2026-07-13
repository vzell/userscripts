# UTILITIES.md — Shared Utilities, CSS Notes, and Diff Helpers

## Core utilities

| Function | Purpose |
|---|---|
| `fetchPage(url)` | `GM_xmlhttpRequest` wrapper; parses response as HTML via `DOMParser`; rejects on non-2xx or network error |
| `fmtElapsed(ms)` | Returns fixed-width `MM:SS` string (zero-padded minutes and seconds) |
| `delay(ms)` | `Promise`-based sleep via `setTimeout` |
| `esc(str)` | HTML-escapes `& < > "` |
| `log/logWarn/logErr(...a)` | Delegate to `Lib.debug/warn/error` (VZ_MBLibrary); `log()` is gated on the `bbp_enable_debug_logging` setting, `logWarn`/`logErr` are always visible; args are joined via `fmtArgs`/`fmtLogArg` |

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
| `findVenueDetailExtra(venueName, detailVenuePart)` | Returns the extra text found when that's the *only* difference from an exact match, else `null`. Checks two cases: (1) a trailing "(Early)"/"(Late)"/"(Afternoon)"/"(Evening)" show-variant suffix, e.g. `"(Late)"`; (2) a descriptive venue-detail segment, e.g. `"University Of Michigan"` (reuses `parseLocationParts`, TAGS.md) |
| `renderVenueInfo(afterEl, venueHref, venueName, match, detailVenuePart, venuePrefix, extra)` | Appends venue info to a `.bb-scheduled` div or creates a new one; `extra` (from `findVenueDetailExtra`) selects the green informational glyph instead of the orange mismatch one |
| `addVenueGlyphDetail(linkEl, venueName, match, detailVenuePart, extra)` | Appends ✅ / informational `⚠︎` / ⚠️ after venue link on DETAIL page |
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
| `showSongTooltip(evt, el)` | Song diff (year-only / detail-only / char-diff / match) |
| `showErrorTooltip(evt, msg)` | Generic error/warning message (red text) |
| `hideTooltip()` | Hides `#bb-tooltip` |
| `positionTooltip(tip, evt)` | Positions tooltip near cursor, clamped to viewport |

### Native title vs. rich `#bb-tooltip` — when to use which

A hover message is **either** a native `title` attribute **or** a custom
`mouseenter`/`mouseleave` pair calling one of the functions above — never
both on the same element, since both firing at once produces a duplicate
(browser tooltip + floating `#bb-tooltip` box) for no benefit.

- **One-line plain-text message** (a single sentence/phrase, no color-coding
  or table needed): set `.title = msg` only. No JS listener. This covers
  every `spuriousTagMsg`/`passingTagMsg` result, `.bb-tag-spurious` /
  `.bb-tag-ok` / `.bb-para-warn` / `.bb-setlist-tab-ann` / `.bb-setlist-tab-match`
  / `.bb-first-tab-ann` / `.bb-first-tab-match` / empty-tab warnings, etc.
  Native tooltips render fine without any JS, so
  these need **no cache-reload rewiring either** — `title` is a plain HTML
  attribute and survives the `innerHTML` save/load round-trip on its own.
- **Genuinely rich content** (a `<table>`, per-character diff, or a message
  that is unavoidably multi-line/multi-item and benefits from color-coding):
  wire `mouseenter`/`showErrorTooltip(evt, msg)` (or a dedicated
  `.bb-tip-table`-based function — `showYearTooltip`/`showListTooltip`/
  `showSongTooltip`/`showVenueTooltip`/`showAnchorCheckTooltip`/
  `showLabelMismatchTooltip`) and do **not** set `.title` on the same
  element. A `<table class="bb-tip-table">` (one `<tr><th>label:</th>
  <td>value</td></tr>` row per fact, plus a `Result:` row) is preferred over
  a plain multi-line string wherever there's a natural "label: value" shape —
  it aligns every row's values in one column via the `<th>` column width,
  and values render in the tooltip's default near-white without needing
  quote marks, whereas plain-text messages piped through `showErrorTooltip`
  render entirely in `.bb-fail` red (or whichever wrapper class) with no
  per-value distinction and no reliable way to align across lines (`#bb-tooltip`
  is `white-space: nowrap`, which collapses manual space-padding). Examples:
  `addVenueGlyphDetail`/`renderVenueInfo` → `showVenueTooltip` ("VENUE page:"/
  "DETAIL event:"/"Result:" rows), `addAnchorMatchDetail`/`addAnchorWarnDetail`
  → `showAnchorCheckTooltip` (one row per anchor/date/href check, 0–3 rows,
  failed values in `.bb-fail` red), `showSongTooltip`'s year-only/
  detail-only/char-diff/match cases (colored table).
- `rewireLoadedPage`'s generic re-wiring selector is `[data-msg]:not([title])`
  — elements that keep `dataset.msg` *only* for aggregation
  (`collectPageWarnings`/`collectSectionWarnings`) but are otherwise
  native-title-only (e.g. `annotateEmptyRelationTabs`'s span) correctly fall
  outside this selector once they also carry `.title`, so the generic handler
  never re-attaches a listener that shouldn't exist. Only elements with
  `dataset.msg` and no `.title` (the genuinely rich ones above) get re-wired.

---

## UI helpers

| Function | Purpose |
|---|---|
| `makeGlyphSpan(char)` | Creates `<span class="bb-glyph"> char</span>` |
| `makeVariantInfoGlyphSpan()` | Creates `<span class="bb-variant-info"> ⚠︎</span>` (text-presentation, colorable green) for the isEarlyLate case — not `.bb-glyph`, so mismatch scans skip it |
| `makeEventTypeSpan(type)` | Creates `<span class="bb-event-type"> (type)</span>` — grey italic suffix on YEAR page event links |
| `addYearGlyph(element, nameMatch, isEarlyLate, yearName, normalizedDetailName, rawDetailName, eventType, eventAlias, anchorName)` | Appends event-type span + glyph (✅ / green `⚠︎` for isEarlyLate / ❌) after event link on YEAR page |
| `addDetailTitleAnnotation(…)` | Appends `bb-event-type-detail` + glyph (✅ / green `⚠︎` for isEarlyLate / ❌) to `#page-title h1` on DETAIL page |
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
| `.bb-event-alias` | Italic bold event alias shown in YEAR glyph tooltip and DETAIL page title; color configurable via `bbp_event_alias_color` |
| `.bb-tour-name` | Small italic bold tour name in DETAIL page `#page-title`; color configurable via `bbp_tour_name_color` |
| `.bb-year-tour-name` | Italic bold tour name on YEAR page (opt-in); shares `bbp_tour_name_color` with `.bb-tour-name` |
| `.bb-tag-hover-highlight` | Hover-only outline box around a verified tag `<a>` (opt-in, `bbp_enable_tag_source_highlight`, DETAIL/VENUE/RETAIL/SONG/RELATION) |
| `.bb-tag-source-highlight` | Hover-only outline box around a verified tag's on-page source element(s) (same setting) — see TAGS.md's "Tag source highlight" |
| `.bb-tag-source-part` | Marker class on a `<span>` created by `wrapTextSubstring` to isolate one substring of a larger text (e.g. a venue name inside a page title) for the tag-source-highlight feature — no visual style of its own, just a wrapper `.bb-tag-source-highlight` can be toggled on |
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
