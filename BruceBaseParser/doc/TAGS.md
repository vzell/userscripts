# TAGS.md — Tag Consistency Checks

Tag consistency checks run in four contexts:

- **YEAR page**: `addTagsButton` opens a panel showing all DETAIL page tags.
- **DETAIL page**: `annotateDetailPageTags` directly annotates the `.page-tags` block.
- **VENUE page**: `annotateVenuePageTags` annotates `.page-tags` inline on the live page.
- **RETAIL page**: `annotateRetailPageTags` annotates `.page-tags` inline on the live page.
- **SONG page**: `annotateSongPageTags` annotates `.page-tags` inline on the live page.
- **RELATION page**: `annotateRelationPageTags` annotates `.page-tags` inline on the live page.

---

## Constants

| Constant | Value / purpose |
|---|---|
| `SORRY_RE` | `/^Sorry,? no /i` — matches empty-tab placeholder text |
| `MONTH_NAMES` | `['january', …, 'december']` — indexed 0–11 |
| `DAY_NAMES` | `['sunday', …, 'saturday']` — indexed 0–6 |
| `MANAGED_CONTENT_TAGS` | `Set` of content tags whose presence can be verified |
| `SPURIOUS_TAG_REASONS` | `{tag: 'human-readable reason'}` for content tags |

`MANAGED_CONTENT_TAGS` covers: event types (`gig`, `interview`, `nogig`,
`offstage`, `onstage`, `recording`, `rehearsal`, `soundcheck`) plus `bootleg`,
`livedl`, `news`, `memorabilia`, `ticket`, `setlist`, `handwritten`, `printed`,
`storyteller`.

---

## Expected tag rules (`computeExpectedTags`)

| Expected tag | Condition |
|---|---|
| `YYYY` (year) | From event date |
| Month name | From event date (0-indexed into `MONTH_NAMES`) |
| Day number | Zero-padded two-digit string from event date (e.g. `"07"`); `isTagPresent` also accepts the unpadded form `"7"` |
| Weekday name | `new Date(yr, mo-1, dd).getDay()`; skipped when day = 0 (unknown) |
| Event type | `eventType.toLowerCase()` |
| `bootleg` | Recording tab has non-Sorry content AND is not purely a LiveDL (i.e. `!isLiveDLSplit(recTab)` OR `recTab.querySelector('hr')` exists) |
| `livedl` | `isLiveDLSplit(recTab)` is true |
| `news` | News/Memorabilia tab has non-Sorry content |
| `memorabilia` | Tab label is exactly `"News/Memorabilia"` (not just `"News"`) AND non-Sorry |
| `ticket` | News/Memorabilia tab has `<img>` with `"ticket"` in `src` |
| `setlist` | News/Memorabilia tab has `<img>` with `"setlist"` in `src`, excl. `"ticket"` |
| `handwritten` | Setlist images with `"handwritten"` in `src` |
| `printed` | Setlist images with `"printed"` in `src` |
| `soundcheck` | `<p><strong>Soundcheck</strong></p>` header found in the setlist container, OR `#page-content` text matches `/\bsoundcheck\s*:/i` |
| `storyteller` | Storyteller tab has non-Sorry content |

`getNewsMemTab(doc, tabMap)` tries both `"News/Memorabilia"` and `"News"` tab
labels so that events with only a `"News"` tab are still checked.

---

## Bidirectional checking

**Missing** (expected but absent):
- YEAR page Tags panel: bold red `<li>⚠️ tag</li>`.
- DETAIL page annotation: bold red `<span class="bb-tag-missing">⚠️tag</span>`
  appended inside `.page-tags`.

**Spurious** (present but condition NOT met):
- Only checked for `isManagedTag(tag)` tags — unmanaged tags (venue names, song
  abbreviations, tour codes, etc.) are never flagged.
- YEAR page Tags panel: `<li>…link… <span style="color:darkorange">⚠️</span></li>`
  with `title` set to `spuriousTagMsg`.
- DETAIL page annotation: `<span class="bb-tag-spurious">⚠️</span>` appended
  after the tag link; hover shows `showErrorTooltip`.

`isManagedTag(tag)` returns true for: `MANAGED_CONTENT_TAGS` members, month
names, weekday names, 4-digit years, and 1–2 digit day numbers (1–31).

---

## `isTagPresent(tag, actualTags)`

Like `actualTags.has(tag)` but also accepts numeric day aliases:
`"7"` and `"07"` are treated as equivalent.

---

## YEAR page Tags button (`addTagsButton`)

Called from `wireIconHandlers` (after `addEventTabButtons`). It:
1. Reads `.page-tags a[href]` from the fetched DETAIL `doc`.
2. Computes expected tags and compares against actual.
3. Merges existing links (with spurious ⚠️) + missing placeholders into one
   sorted list; renders in the `buildIconPanel` infrastructure.
4. Button label: `"Tags"` when clean; `"Tags ⚠️ (N missing, M spurious)"` with
   colour red (if any missing) or dark-orange (if only spurious).
5. Appended as the last button in `.bb-event-tab-row` (created if absent).

---

## DETAIL page annotation (`annotateDetailPageTags`)

Called from `runDetailPage` right after `addDetailTitleAnnotation`. It:
1. Builds `detailTabMap = buildTabMap(document)` from the current page.
2. Computes expected and actual tags.
3. If any issues found, wraps `.page-tags` parent in a gold warning box
   (`<div class="bb-tags-warn-box">`).
4. Appends `<span class="bb-tag-spurious">⚠️</span>` after spurious tag links.
5. Appends `<span class="bb-tag-missing">⚠️tag</span>` spans for missing tags.

---

## SONG page annotation (`annotateSongPageTags`)

Called from `runSongPage`. Rules:

| Expected tag | Condition |
|---|---|
| `song` | Always — every `/song:…` page must carry this tag |

`isManagedSongTag(tag)` returns true only for `"song"`.

---

## RELATION page annotation (`annotateRelationPageTags`)

Called from `runRelationPage`. Detects the expected tag by reading tab labels
from the live page's `.yui-nav em` elements:

| Tab present | Expected tag |
|---|---|
| `Bands` | `person` — this entry is a person who belongs to bands |
| `Members` | `band` — this entry is a band that has members |
| Neither | No annotation (type cannot be determined) |

`isManagedRelationTag(tag)` returns true for `"person"` and `"band"`.

`computeExpectedRelationTags()` returns an empty set when neither `Bands` nor
`Members` tab is found, causing `annotateRelationPageTags` to exit early.

---

## CSS classes (tag feature)

| CSS class | Purpose |
|---|---|
| `.bb-tag-missing` | Bold red span for expected-but-absent tags |
| `.bb-tag-spurious` | Orange ⚠️ for present-but-unexpected managed tags |
| `.bb-tags-warn-box` | Gold border, #fffbe6 background wrapper around `.page-tags` when issues found |
