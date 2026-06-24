# CLAUDE.md — BruceBase Event Checker

## Purpose

Tampermonkey userscript that enriches `http://brucebase.wikidot.com/` pages by cross-checking data between different
page types and surfacing discrepancies with inline glyphs and hover tooltips.

---

## Page types and URL patterns

| Page type        | URL pattern                          | `@include` regex |
|------------------|--------------------------------------|------------------|
| YEAR page        | `/YYYY`                              | `\d{4}$` |
| YEAR LIST page   | `/YYYY-list`                         | `\d{4}-list$` |
| DETAIL page      | `/type:YYYY-MM-DD-slug`              | `(gig\|nogig\|recording\|…):` |

Known event types (anything else gets a ❓ glyph):
`gig`, `interview`, `nogig`, `offstage`, `onstage`, `recording`, `rehearsal`, `soundcheck`

---

## Boot flow

```
location.pathname
  → /YYYY        → runYearPage()
  → /YYYY-list   → runListPage(year)
  → /type:…      → runDetailPage()
```

`addStyles()` and `createTooltipElement()` always run first.

---

## YEAR page mode (`runYearPage`)

### Processing pipeline

1. **Snapshot** `#page-content.innerHTML` (pre-processing, for global toggle).
2. **`wrapYearSections(content)`** — wraps content between each consecutive pair
   of `<hr>` direct children into a `<div class="bb-section-processed">`.
   Serialises the original HTML as a plain string *before* moving nodes (not as
   a DOM clone) so that the snapshot cannot be found by `querySelectorAll` and
   accidentally re-processed.
3. **`extractYearPageEvents()`** — scans all `<a href>` in `#page-content`,
   matches `EVENT_URL_RE = /\/([a-z]+):\d{4}-\d{2}-\d{2}/`, and for each hit:
   - finds the last preceding `<a name="…">` anchor (DDMMYY format, may carry a
     letter suffix e.g. `150571a` for the first of two events on the same day)
   - finds the next following anchor (end boundary)
   - calls `collectSetlistElements(eventLink, nextAnchor, content)` to collect
     `<p>` and `<blockquote>` elements between the two anchors
4. **`processYearEvents(events)`** — batches 3 events at a time with 500 ms
   between batches; each calls `processOneYearEvent(event)`.
5. After all events: **`insertGlobalToggle`** and **`insertSectionToggle`** for
   each wrapped section.

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
- `parseDetailSetlist(doc)` → reads `getSetlistContainer(doc)` children
  (falls back from `#wiki-tab-0-1 td` to `#wiki-tab-0-1` for tableless pages):
  - `<p><strong>Soundcheck</strong></p>` etc. set the current section label
  - `<ol>`/`<ul>` produce a section; song names from `<a href="/song:…">` text,
    medleys joined with ` - `; plain-text fallback for songs with no `/song:` link
- `yearFlat` / `yearRawFlat` — flattened cleaned / raw song arrays from
  `yearSections`; each `diffItem` is annotated with `rawYearSong` (the raw text
  at its flat index) before rendering
- `lcsDiff(yearFlat, detailFlat)` + `mergeCharDiffs()` → `diffItems[]`
- `renderYearSetlist(yearSections, diffItems)` assigns diff items back to their
  source `<p>`/`<blockquote>` elements, then calls
  `renderSetlistElement(el, label, items)` which:
  - re-captures `<sup>` footnote HTML before overwriting `innerHTML`
  - replaces `el.innerHTML` with colour-coded spans
  - for `match` items: wraps only the clean song name in the green span;
    any raw qualifier suffix (e.g. ` (parts)`, ` (with Willie Nile)`) is
    appended outside the span as plain text
  - re-appends footnote HTML after `<br>` so "Setlist incomplete." notes remain

### Setlist colour coding (YEAR page)

| CSS class              | Meaning                     | Visual          |
|------------------------|-----------------------------|-----------------|
| `.bb-song-match`       | same in both pages          | green text      |
| `.bb-song-year-only`   | in year, not detail         | light-blue bg   |
| `.bb-song-detail-only` | in detail, not year (inserted) | yellow bg    |
| `.bb-song-char-diff`   | similar but slightly different | char-level red/green |
| `.bb-char-match`       | matching char within diff   | green           |
| `.bb-char-diff`        | differing char              | red bold        |

Hover over any non-match span shows `showSongTooltip()` with year/detail names
and a word-level diff.

### Toggle controls (YEAR page only)

**Global toggle** (button after `#page-title`):
- `insertGlobalToggle(content, originalHtml)` creates `<div id="bb-page-original">`
  with the pre-processing HTML, inserted as a sibling of `#page-content`.
- Toggle alternates `display: block / none` on the two divs.
- `#page-content` is never replaced, so all event listeners survive.

**Per-section toggle** (button after each `<hr>`):
- `insertSectionToggle(hr, processedDiv, sectionOriginalHtml)` creates
  `<div class="bb-section-original">` with the serialised pre-processing HTML
  and inserts it immediately before `processedDiv`.
- IMPORTANT: this div is created *after* `processYearEvents` completes, so
  `querySelectorAll` during event extraction never finds the cloned `<a>` links
  inside it (which would cause duplicate processing and destroy the diff).
- Toggle alternates `display: block / none` between the two sibling divs.

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
5. Finds the next `<a name>` after that event link as the boundary.
6. Collects and parses the year-side setlist with `collectSetlistElements` +
   `parseYearSetlist`.
7. Runs `lcsDiff` + `mergeCharDiffs`; annotates each `diffItem` with
   `rawYearSong`.
8. `renderDetailSetlist(diffItems)` via `styleDetailLi`:
   - `match` → adds `.bb-song-match` to each `a[href^="/song:"]` inside the
     `<li>` (so only the link text turns green, not descriptive `<span>` nodes
     like `(parts)`); falls back to adding the class to the `<li>` itself for
     plain-text entries with no song link (e.g. REFRIGERATOR BLUES)
   - `detail-only` → adds `.bb-song-detail-only` (light-blue bg)
   - `char-diff` → adds `.bb-song-char-diff`, replaces `<a>` innerHTML with
     character-level coloured spans
   - `year-only` → inserts a new `<li class="bb-song-year-only">` before the
     current list position (yellow bg, clean song name from year page)
9. `insertDetailToggle(originalTdHtml)` wraps the setlist tab content in
   processed/original show-hide divs and inserts a toggle button after
   `#page-title`.

---

## Shared utilities

| Function | Purpose |
|---|---|
| `fetchPage(url)` | `GM_xmlhttpRequest` wrapper; returns a `DOMParser` document |
| `extractDetailEventName(doc, url)` | `#page-title` → `h1.page-title` → `h1` → `<title>` |
| `normalizeDetailName(name)` | `(The)`/`(Le)` rewrite + `YYYY-MM-DD - VENUE` uppercase |
| `cleanSongName(text)` | Strips any parenthetical containing a lowercase letter: `(with …)`, `(x3)`, `(parts)`, `(acoustic)` etc.; preserves all-caps qualifiers like `(41 SHOTS)` |
| `textWithoutSup(el)` | Clones el, removes all `<sup>` children, returns `.textContent`; used to exclude footnote text from prose filtering and song-name parsing |
| `getSetlistContainer(doc)` | Returns `#wiki-tab-0-1 td` if present, else `#wiki-tab-0-1` itself (for older pages with no `<table>` layout) |
| `buildDiffHtml(a, b)` | Token-level diff on whitespace/comma splits (for name tooltips) |
| `buildCharDiffHtml(a, b)` | Char-level LCS diff; shows year song chars with red/green spans |
| `lcsDiff(yearSongs, detailSongs)` | Standard LCS producing `match`/`year-only`/`detail-only` items |
| `mergeCharDiffs(items)` | Adjacent `year-only`+`detail-only` → `char-diff` when close enough |
| `editDistance(a, b)` | Standard O(mn) Levenshtein |
| `esc(str)` | HTML-escapes `& < > "` |
| `delay(ms)` | `Promise`-based sleep |

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
