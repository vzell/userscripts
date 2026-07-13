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
   Same early/late variant logic as on YEAR pages (see YEAR_PAGE.md).
   `addDetailTitleAnnotation(eventType, yearNameUpper, normalizedDetailName, rawDetailName, nameMatch, isEarlyLate)`:
   - Appends a `bb-event-type-detail` span (`(eventType)` in small grey italic)
     to `#page-title h1`.
   - Appends the glyph (`makeGlyphSpan('✅')` / `makeVariantInfoGlyphSpan()`
     for `isEarlyLate` / `makeGlyphSpan('❌')`); hover shows `showYearTooltip`
     with all four name variants (YEAR, raw DETAIL, normalized DETAIL, diff).
     `isEarlyLate` renders green, informational `.bb-variant-info` instead of
     orange `.bb-glyph` ⚠️ — excluded from `collectPageWarnings`'s
     `.bb-page-title-warn` aggregation (never had a `dataset.msg` in the
     first place) and, being a distinct class from `.bb-glyph`, from any
     generic `.bb-glyph`-based mismatch scan.

e. **Onstage companion page fetch** — `fetchOnstageCompanionTags(path, eventType, tabMap)`:
   for "gig"/"rehearsal" pages with an "On Stage" tab, fetches the companion
   `onstage:…/noredirect/true` page (BruceBase caps tags-per-page, so some
   tags for these events only exist there) and returns its `.page-tags` as a
   `Set`. Returns `null` when not applicable or the fetch fails.

f. **Venue name check (computed early)** — `findVenueLink(document)` → fetch
   venue page → compare venue name with detail venue part. Deliberately runs
   here, *before* the tag annotation step below (rather than after the anchor
   check, where the actual glyph is still rendered — see step h), so its
   `venueDetailExtra` result (from `findVenueDetailExtra(venueName,
   detailVenuePart)` — non-null when the only difference from the VENUE page
   title is a trailing show-variant suffix like "(Late)", or an extra
   descriptive venue-detail segment, e.g. "University Of Michigan") can be
   threaded into `annotateDetailPageTags` in time to
   suppress the corresponding "Venue detail" missing-tag entry (see TAGS.md's
   "Event-name / venue-name location tag check").

g. **Tag annotation** — `annotateDetailPageTags(tabMap, eventDate, eventType,
   detailSections, rawDetailName, onstageResult, hasHelp, hasFeatured,
   venueDetailExtra)`. Merges any onstage-only tags into its internal tag set
   before running all consistency checks (see [TAGS.md](TAGS.md)). Right
   after `colorizeOnStageRelationNames` runs (part of the "On Stage"/"In
   Studio"/"On Audio"/"On Set" tab relation tag check), it also calls
   `annotateFirstTab(tabMap)` — see "`annotateFirstTab`" below — and returns
   `{ additionalTags, onstageUrl, tourCheck, eventAlias }`. When
   `additionalTags.length > 0`, `addOnstageTagsGlyph(additionalTags,
   onstageUrl)` appends a 🏷️ glyph to `#page-title h1` with a rich tooltip
   listing the extra tags and linking to the companion page. Then, when
   `eventAlias` is non-null, `addEventAliasSpan(eventAlias)` appends the same
   `.bb-event-alias` span the YEAR page shows (see TAGS.md's "Tour association
   tag check" for the font-size correction this needs on the DETAIL page's
   larger `#page-title`); when `tourCheck` resolves to a genuine tour event
   (not the `tour_no` exception) with a `mostSpecificTour`,
   `addTourNameSpan(tourCheck.mostSpecificTour.name)` appends the tour's
   official name (`.bb-tour-name`) right after that. Always finishes by
   reorganizing `.page-tags` into per-first-letter lines (`groupTagsIntoLines`
   — see TAGS.md), regardless of whether any consistency issues were found.

h. **Anchor consistency check** — find `<a href="/YEAR#FRAGMENT">Info & Setlist</a>`
   on the current page via `findInfoSetlistLink(document)`. Compare `FRAGMENT`
   with `yearAnchorName`. See [ANCHORS.md](ANCHORS.md).

i. **Venue glyph** — reuses the venue check already computed in step f (no
   re-fetch); only renders the glyph, in its original DOM position (after the
   anchor check).
   `addVenueGlyphDetail(venueLink, venueName, venueMatch, detailVenuePart, venueDetailExtra)`:
   - Exact match → ✅ (`bb-anchor-match`).
   - Extra-descriptive-segment-only difference → green, informational
     `.bb-venue-info` (text-presentation `⚠︎`, not the `⚠️` emoji — see
     UTILITIES.md), excluded from mismatch counting.
   - Any other difference → ⚠️ (`bb-venue-warn`), the pre-existing real-mismatch path.
   - Comparison is case-sensitive; `(The)` article rewrite NOT applied.

j. **Setlist comparison** — when `hasSetlist` is true:
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
`.bb-setlist-tab-match` to the `<em>` (green + bold via CSS class). Opt-out via
`bbp_enable_setlist_tab_annotation` (default `true`, "🔖 TAB ANNOTATIONS"
configSchema section) — a no-op when disabled.

---

## `annotateFirstTab`

Mirrors `annotateSetlistTab`, but for the event's *first* tab — whichever of
`RELATION_TAB_CONFIGS`'s labels (`"On Stage"`, `"In Studio"`, `"On Audio"`,
`"On Set"`) is present in `tabMap` (a page has at most one, always tab index
0 — see [TAGS.md](TAGS.md)'s "On Stage"/"In Studio"/"On Audio"/"On Set" tab
relation tag check). No-op when none of those labels is present (e.g. an
interview-only page has no such tab at all). Called from
`annotateDetailPageTags`, right after `colorizeOnStageRelationNames` — it
depends on that call having already run, since it detects a mismatch purely
by checking whether any `.bb-relation-name-warn` span exists anywhere on the
page (the ⚠️ `colorizeOnStageRelationNames` appends after an unmatched
relation name's own link). On mismatch: appends
`<span class="bb-first-tab-ann"> ⚠️</span>` to the tab's `<em>`, with
`dataset.msg` set to `` `"${tabLabel}" tab has one or more relations with no
matching tag` ``. On full match: adds `.bb-first-tab-match` to the `<em>`
(green + bold, same CSS rule `.bb-setlist-tab-match` uses). Opt-out via
`bbp_enable_first_tab_annotation` (default `true`, same "🔖 TAB ANNOTATIONS"
configSchema section) — a no-op when disabled; `colorizeOnStageRelationNames`
itself (the underlying per-relation-name ⚠️/green marking) is unaffected by
this setting, only the tab-label-level summary annotation is.

---

## Page title warning annotation

After `runDetailProcessing()` completes, `annotatePageTitleWithWarnings()` is
called. It collects all warning messages from the live DOM via
`collectPageWarnings()`:
- `.bb-tag-missing`, `.bb-tag-spurious`, `.bb-anchor-warn`, `.bb-venue-warn`,
  `.bb-para-warn` → `dataset.msg || title`
- `.yui-nav em span[data-msg]` → `dataset.msg` (covers `bb-setlist-tab-ann`
  and `bb-first-tab-ann`)
- `.bb-venue-info` is deliberately *not* in this list — it's informational
  (see step i above), not a real issue.

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
