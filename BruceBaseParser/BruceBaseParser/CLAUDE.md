# CLAUDE.md — BruceBase Event Checker

## Purpose

Tampermonkey userscript (`brucebase-eventcheck.user.js`) that enriches
`http://brucebase.wikidot.com/` pages by cross-checking data between different
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
   - finds the last preceding `<a name="…">` anchor (DDMMYY format)
   - finds the next following anchor (end boundary)
   - calls `collectSetlistElements(eventLink, nextAnchor, content)` to collect
     `<p>` and `<blockquote>` elements between the two anchors
   - `<p>` elements without a ` / ` separator are prose descriptions and are
     skipped (only paragraphs that split on ` / ` are setlists)
4. **`processYearEvents(events)`** — batches 3 events at a time with 500 ms
   between batches; each calls `processOneYearEvent(event)`.
5. After all events: **`insertGlobalToggle`** and **`insertSectionToggle`** for
   each wrapped section.

### Per-event processing (`processOneYearEvent`)

Fetches the DETAIL page with `GM_xmlhttpRequest`, then:

**Event name check:**
- Extracts name from `#page-title` (fallback: `h1.page-title`, `h1`, `<title>`)
- `normalizeDetailName()`: moves `(The)` before a comma to the front as `THE `,
  inserts ` - ` after the date, uppercases everything
- Compares with the uppercased YEAR page name
- Appends ✅ or ❌ glyph; hover shows a tooltip with both names and a
  token-level diff (`buildDiffHtml`)

**Setlist check** (when setlist elements were found):
- `parseYearSetlist(setlistEls)` → `Section[]` where
  `Section = { label, songs: string[], sourceEl }`
  - `<blockquote>` → `label = 'recording'`
  - `<p>` starting with `Word:` → `label = 'soundcheck'` (or other label)
  - plain `<p>` → `label = 'show'`
  - each token is cleaned with `cleanSongName()`: strips `(with …)` and `(x3)`
    but preserves `(41 SHOTS)`, `(COME OUT TONIGHT)` etc.
- `parseDetailSetlist(doc)` → reads `#wiki-tab-0-1 td` children:
  - `<p><strong>Soundcheck</strong></p>` etc. set the current section label
  - `<ol>`/`<ul>` produce a section; song names come from `<a href="/song:…">`
    text, medleys (multiple `<a>` in one `<li>`) joined with ` - `
- Flattens both section arrays to `string[]` and runs `lcsDiff(yearFlat, detailFlat)`
- `mergeCharDiffs()` reclassifies adjacent `year-only` + `detail-only` pairs
  as `char-diff` when Levenshtein distance ≤ max(3, 20 % of song length)
- `renderYearSetlist(yearSections, diffItems)` assigns diff items back to their
  source `<p>`/`<blockquote>` elements (tracking a year-song cursor through the
  flat diff), then calls `renderSetlistElement(el, label, items)` which replaces
  each element's `innerHTML` with colour-coded spans

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

1. `parseDetailSetlist(document)` reads the `#wiki-tab-0-1 td` setlist.
2. `detailPathToYearAndAnchor(path)` derives the YEAR page URL and anchor
   (`gig:2003-09-14-…` → `{ year: '2003', anchor: '140903' }`).
3. Fetches the YEAR page, finds the anchor, collects and parses the year-side
   setlist with `collectSetlistElements` + `parseYearSetlist`.
4. Runs `lcsDiff` + `mergeCharDiffs`.
5. `renderDetailSetlist(diffItems)`:
   - `match` → adds `.bb-song-match` class to the `<li>` (green text)
   - `detail-only` → adds `.bb-song-detail-only` (light-blue bg)
   - `char-diff` → adds `.bb-song-char-diff`, replaces `<a>` innerHTML with
     character-level coloured spans
   - `year-only` → inserts a new `<li class="bb-song-year-only">` before the
     current list position (yellow bg, song name from year page)

---

## Shared utilities

| Function | Purpose |
|---|---|
| `fetchPage(url)` | `GM_xmlhttpRequest` wrapper; returns a `DOMParser` document |
| `extractDetailEventName(doc, url)` | `#page-title` → `h1.page-title` → `h1` → `<title>` |
| `normalizeDetailName(name)` | `(The)` rewrite + `YYYY-MM-DD - VENUE` uppercase |
| `cleanSongName(text)` | Strips `(with …)` and `(x\d+)`; preserves `(41 SHOTS)` etc. |
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

`detailPathToYearAndAnchor` derives the anchor from the DETAIL page URL date
segment using `dd + mm + yyyy.slice(2)`.

---

## Name normalisation rules

DETAIL page names are in "Title Case With (The) Before Comma" form.
YEAR page names are in `YYYY-MM-DD - ALL CAPS VENUE, CITY, ST` form.

Normalisation steps applied to the DETAIL name before comparison:
1. Match `YYYY-MM-DD` date prefix
2. If rest matches `VENUE (The), SUFFIX` → rewrite as `The VENUE, SUFFIX`
3. Insert ` - ` between date and venue
4. Uppercase the whole string

Result must equal the YEAR page name (already uppercase) exactly.
