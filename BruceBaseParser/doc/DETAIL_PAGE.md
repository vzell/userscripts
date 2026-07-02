# DETAIL_PAGE.md — DETAIL Page Mode (`runDetailPage`)

Pages like `/gig:2003-09-14-kenan-memorial-stadium-chapel-hill-nc`.

---

## Processing pipeline

`runDetailPage` runs `runDetailProcessing()` automatically on page load (no
Start button — processing begins immediately).

### 1. Early setup (before `runDetailProcessing`)

- `parseDetailSetlist(document)` — parse the current page's setlist.
- `extractDetailEventName(document, location.pathname)` and
  `normalizeDetailName(rawDetailName)` — snapshot names before any DOM changes.
- Build `#bb-btn-container` (Save, Load) and insert it after `#page-title`.
  Created early so Load works before processing starts.

### 2. `runDetailProcessing()`

a. **Derive YEAR page slug**: `detailPathToYearAndAnchor(path)` → `{ year }`.
   `yearPageSlug(year)` maps years 1949–1964 to `'1949-64'`.

b. **Fetch YEAR page**.

c. **Find event link** on YEAR page: locates the `<a href>` whose
   `href === '/' + path`. This is a direct href match, robust against anchor
   suffix mismatches (e.g. anchor `150571a` vs URL without suffix).

d. **Event name check** — compare `yearNameUpper` with `normalizedDetailName`.
   Same early/late variant logic as on YEAR pages.
   `addDetailTitleAnnotation(eventType, yearNameUpper, normalizedDetailName, rawDetailName, nameMatch, isEarlyLate)`:
   - Appends a `bb-event-type-detail` span (`(eventType)` in small grey italic)
     to `#page-title h1`.
   - Appends a ✅/⚠️/❌ glyph; hover shows `showYearTooltip` with all four
     name variants (YEAR, raw DETAIL, normalized DETAIL, diff).

e. **Onstage companion page fetch** — `fetchOnstageCompanionTags(path, eventType, tabMap)`:
   for "gig"/"rehearsal" pages with an "On Stage" tab, fetches the companion
   `onstage:…/noredirect/true` page (BruceBase caps tags-per-page, so some
   tags for these events only exist there) and returns its `.page-tags` as a
   `Set`. Returns `null` when not applicable or the fetch fails.

f. **Tag annotation** — `annotateDetailPageTags(tabMap, eventDate, eventType,
   detailSections, rawDetailName, onstageResult, hasHelp)`. Merges any
   onstage-only tags into its internal tag set before running all
   consistency checks (see [TAGS.md](TAGS.md)), and returns
   `{ additionalTags, onstageUrl }`. When `additionalTags.length > 0`,
   `addOnstageTagsGlyph(additionalTags, onstageUrl)` appends a 🏷️ glyph to
   `#page-title h1` with a rich tooltip listing the extra tags and linking
   to the companion page. Always finishes by reorganizing `.page-tags` into
   per-first-letter lines (`groupTagsIntoLines` — see TAGS.md), regardless
   of whether any consistency issues were found.

g. **Anchor consistency check** — find `<a href="/YEAR#FRAGMENT">Info & Setlist</a>`
   on the current page via `findInfoSetlistLink(document)`. Compare `FRAGMENT`
   with `yearAnchorName`. See [ANCHORS.md](ANCHORS.md).

h. **Venue name check** — `findVenueLink(document)` → fetch venue page →
   compare venue name with detail venue part.
   `addVenueGlyphDetail(venueLink, venueName, venueMatch, detailVenuePart)`:
   - ✅ (`bb-anchor-match`) or ⚠️ (`bb-venue-warn`) appended after venue link.
   - Comparison is case-sensitive; `(The)` article rewrite NOT applied.

i. **Setlist comparison** — when `hasSetlist` is true:
   - `collectSetlistElements(eventLink, nextAnchor, yearContent)` — gathers
     YEAR page setlist elements.
   - `parseYearSetlist(setlistEls)` — parses into `Section[]`.
   - `lcsDiff` + `mergeCharDiffs` → `diffItems[]`.
   - Annotate each `diffItem` with `rawYearSong` and `paragraphBased`.
   - Snapshot `td.innerHTML` as `_detailOriginalHtml`.
   - `renderDetailSetlist(diffItems)` — annotates the live DETAIL setlist.
   - `flagDetailSectionHeaders(yearSections, detailSections, diffItems)` — see below.
   - `insertDetailToggle(_detailOriginalHtml)` — wraps setlist in
     `.bb-detail-processed` / `.bb-detail-original` and adds ⇄ Original button.
   - `annotateSetlistTab(nameMatch, true)` — annotates the "Setlist" tab in the
     YUI navigation (green + bold on full match, ⚠️ on any mismatch).
   - Enables Save button.

---

## Setlist rendering on DETAIL page (`renderDetailSetlist`)

- Detects `isParagraphBased` by checking for any `<li>` in the container.
  If none, collects `<p>` elements with `/song:` links as the song list.
- Iterates `diffItems`:
  - `match` → `styleDetailLi` adds `.bb-song-match` to `<a href="/song:">` links
    (or to the `<li>` itself if no link).
  - `detail-only` → adds `.bb-song-detail-only` to the existing element.
  - `char-diff` → adds `.bb-song-char-diff`; replaces `<a>` innerHTML with
    `buildCharDiffHtml(yearSong, detailSong)`.
  - `year-only` → inserts a new `<li>` or `<p>` with `.bb-song-year-only`.
  - After each element on paragraph-based pages: `addParaStructureWarning(el)`.
- After all items are inserted (list-based pages only): iterates every `<ol>`
  in the container and assigns explicit `value` attributes to each
  non-year-only `<li>`, counting only those items. This prevents year-only
  inserted rows (styled as `list-style-type: disc`) from consuming counter
  slots, so subsequent songs display correct numbers regardless of browser
  CSS counter behaviour.

---

## `flagDetailSectionHeaders`

**Case A — DETAIL already has `<p><strong>…</strong></p>` headers:**
Each header is compared (by position) with the corresponding YEAR section label.
Mismatches and extra DETAIL headers append a `bb-para-warn ⚠️` span.

**Case B — DETAIL has no section headers, YEAR has non-show/non-recording sections:**
The rendered `<ol>` is split into per-section sub-lists. Boundaries are computed
from `diffItems` via `posMap` (year-song index → year section index),
counting how many rendered `<li>` items belong to each section. The original
`<ol>` is removed and replaced with interleaved
`<p><strong>Label ⚠️</strong></p>` + `<ol>` fragments.

---

## `annotateSetlistTab`

Finds the `<em>` whose text is exactly `"Setlist"` in the YUI navigation
(works whether the tab is active or not). On mismatch: appends
`<span class="bb-setlist-tab-ann"> ⚠️</span>` with `dataset.msg` set to a
human-readable description (`"Event name mismatch between YEAR and DETAIL page"`
and/or `"Setlist has differences between YEAR and DETAIL page"`). The
`dataset.msg` is required so `collectPageWarnings()` can include the setlist
issue in the `#page-title` warning annotation. On full match: adds
`.bb-setlist-tab-match` to the `<em>` (green + bold via CSS class).

---

## Page title warning annotation

After `runDetailProcessing()` completes, `annotatePageTitleWithWarnings()` is
called. It collects all warning messages from the live DOM via
`collectPageWarnings()`:
- `.bb-tag-missing`, `.bb-tag-spurious`, `.bb-anchor-warn`, `.bb-venue-warn`,
  `.bb-para-warn` → `dataset.msg || title`
- `.yui-nav em span[data-msg]` → `dataset.msg` (covers `bb-setlist-tab-ann`)

When any messages exist, appends `<span class="bb-page-title-warn"> ⚠️</span>`
to `#page-title`. Hovering shows a numbered rich tooltip listing every issue in
document order.

---

## DETAIL page controls

| Button | When enabled | Action |
|---|---|---|
| 💾 Save | After setlist comparison completes | Downloads JSON cache |
| 📂 Load | Always | Opens file picker to restore cache |
| ⇄ Original Page | After setlist comparison | Toggles `.bb-detail-processed` / `.bb-detail-original` |

The Save/Load buttons are placed in `#bb-btn-container` inserted after
`#page-title`. ⇄ Original Page is prepended to `#bb-btn-container` by
`insertDetailToggle` after processing.
