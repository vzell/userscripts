# TAGS.md — Tag Consistency Checks

Tag consistency checks run in these contexts:

- **YEAR page**: `addTagsButton` opens a panel showing all DETAIL page tags for
  the event; `addVenueTagsButton` / `addSongTagsButton` do the same nested
  inside the venue/song tab rows for the venue and song pages linked from the
  event.
- **DETAIL page**: `annotateDetailPageTags` directly annotates the `.page-tags` block.
- **VENUE page**: `annotateVenuePageTags` annotates `.page-tags` inline on the live page.
- **RETAIL page**: `annotateRetailPageTags` annotates `.page-tags` inline on the live page.
- **SONG page**: `annotateSongPageTags` annotates `.page-tags` inline on the live page.
- **RELATION page**: `annotateRelationPageTags` annotates `.page-tags` inline on the live page.

Every managed tag falls into exactly one of three states: **missing** (red),
**spurious** (orange ⚠️), or **passing** (green — see below). Unmanaged tags
(tour codes, etc.) are never colored — **except** song-name tags on DETAIL
pages / the YEAR page's nested Tags button (see "Setlist song tag check"),
and venue-name/city/state/country tags on DETAIL and VENUE pages / their
nested Tags buttons (see "Event-name / venue-name location tag check"),
which each get their own separate check independent of
`isManagedTag`/`MANAGED_CONTENT_TAGS`/`isManagedVenueTag`.

---

## Constants

| Constant | Value / purpose |
|---|---|
| `SORRY_RE` | `/^Sorry,? no /i` — matches empty-tab placeholder text |
| `MONTH_NAMES` | `['january', …, 'december']` — indexed 0–11 |
| `DAY_NAMES` | `['sunday', …, 'saturday']` — indexed 0–6 |
| `MANAGED_CONTENT_TAGS` | `Set` of content tags whose presence can be verified |
| `SPURIOUS_TAG_REASONS` | `{tag: 'human-readable reason'}` for content tags |
| `SONG_TAG_ALIAS_OVERRIDES` | `{songTitleLowercase: 'expectedTag'}` — user-editable manual overrides for the setlist song tag check (empty by default) |
| `US_STATE_NAMES` | `{abbr: 'Full State Name'}` — all 50 US states + DC, for the location tag check |
| `CA_PROVINCE_NAMES` | `{abbr: 'Full Province Name'}` — all 13 Canadian provinces/territories, for the location tag check |
| `COUNTRY_EXTRA_TAGS` | `{countryName: ['extraTag', …]}` — extra continent/region tags expected alongside a bare country's own slug (e.g. `England` → `unitedkingdom`, `europe`); not exhaustive, user-extendable |
| `VENUE_TAG_ALIAS_OVERRIDES` | `{venueOrDetailNameLowercase: 'expectedTag' \| null}` — user-editable manual overrides for the location tag check; `null` means "no tag expected for this name at all" (empty by default) |

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

**Passing** (present AND condition met):
- Every context also marks these tags to make correct data visible without
  clicking. See "Passing (green) tags" below.

---

## `isTagPresent(tag, actualTags)`

Like `actualTags.has(tag)` but also accepts numeric day aliases:
`"7"` and `"07"` are treated as equivalent.

---

## Passing (green) tags

Any managed tag that is both present and matches its expected condition is
rendered green, in addition to the existing red (missing) / orange (spurious)
handling. This lets the user see that a consistency check was performed and
passed, without needing to open a panel or hunt for a ⚠️.

- **Live pages** (DETAIL/VENUE/RETAIL/SONG/RELATION): `markPassingTagLinks(links, msgFn)`
  adds the `.bb-tag-ok` class, sets inline `color:#2a2; font-weight:bold`, and
  wires a `mouseenter`/`mouseleave` pair that shows the rich floating tooltip
  (`showOkTooltip`, styled with `.bb-ok`) via `msgFn(tag)`.
- **YEAR page panels** (`addTagsButton` / `addVenueTagsButton` / `addSongTagsButton`):
  the tag `<a>` element (from the fetched `Document`) gets the same inline
  style plus a native `title` attribute — no custom tooltip wiring, since the
  panel content is inserted as a static HTML string.
- `passingTagMsg(tag, expectedTags)` builds the DETAIL/YEAR event-tag message,
  backed by `PASSING_TAG_REASONS` (mirrors `SPURIOUS_TAG_REASONS`) for content
  tags, with date/weekday/event-type cases handled inline. VENUE, RETAIL,
  SONG, and RELATION pages build their passing message inline in their own
  `annotate*PageTags` / `add*TagsButton` function (no shared helper, since
  each has only 1–4 possible passing tags).
- Marking happens **unconditionally**, before the missing/spurious early-return
  in each `annotate*PageTags` function — so a fully clean `.page-tags` block
  still gets its tags colored green, even though no warning box is drawn.

---

## YEAR page Tags button (`addTagsButton`)

Called from `wireIconHandlers` (after `addEventTabButtons`). It:
1. Reads `.page-tags a[href]` from the fetched DETAIL `doc`.
2. Computes expected tags and compares against actual.
3. Merges existing links (styled green if passing, with spurious ⚠️ if not) +
   missing placeholders into one sorted list; renders in the `buildIconPanel`
   infrastructure.
4. Button label: `"Tags"` when clean; `"Tags ⚠️ (N missing, M spurious)"` with
   colour red (if any missing), dark-orange (if only spurious), or green
   (`#2a2`, when fully clean) — so status is visible without clicking.
5. Appended as the last button in `.bb-event-tab-row` (created if absent).
6. The panel header caption is the complete raw event name plus `" Tags"`
   (e.g. `"2026-04-18 Pollak Theatre, Monmouth University, West Long Branch,
   NJ Tags"`), not just `"Tags"` — set via `content.caption`, rendered as
   plain text (`titleSpan.textContent`) by `buildIconPanel`, so no escaping
   is needed. `addVenueTagsButton`'s panel caption is likewise the complete
   venue-page title plus `" Tags"`, not `"Venue Tags"`.

`addVenueTagsButton` (nested in `.bb-venue-tab-row`, class `bb-venue-tab-btn`),
`addSongTagsButton` (nested in the song tab row, class `bb-song-tab-btn`), and
`addRelationTagsButton` (nested in `.bb-relation-tab-row`, class
`bb-relation-tab-btn`) follow the identical pattern for the VENUE, SONG, and
RELATION pages linked from the event, including the same green/red/dark-orange
button coloring.

`addSongTagsButton` uses `computeExpectedYearSongTags(songDoc, songTabMap, songName)`
and `isManagedYearSongTag(tag)` — distinct names from the live SONG page's
`computeExpectedSongTags()` / `isManagedSongTag(tag)` (see below). These were
previously both named the same; the later, simpler declarations silently won
in the shared module scope, so the YEAR page's Song Tags button never actually
checked the first-letter/lyricsheet tags. Fixed by renaming the YEAR-page
versions.

`addRelationTagsButton` similarly uses `computeExpectedYearRelationTags(relDoc)`
— a `relDoc`-based counterpart to the live RELATION page's
`computeExpectedRelationTags()`, which reads tab labels from the live
`document` instead of a fetched document (same live-vs-fetched split as the
song tags, but no naming collision here since the two were already named
differently). Detects `person`/`band` expected tags from `relDoc`'s own
`.yui-nav em` labels (`Bands`/`Members`); a no-op when neither is present
(page type can't be determined) or `.page-tags` is absent.

---

## DETAIL page annotation (`annotateDetailPageTags`)

Called from `runDetailPage` right after `addDetailTitleAnnotation`, passed
the already-parsed `detailSections` (`parseDetailSetlist(document)`, computed
once at the top of `runDetailPage` to avoid a duplicate parse), `rawDetailName`
(the page's raw `#page-title` text, from `extractDetailEventName`), and
`onstageResult` (see "Onstage companion page tags" below). It:
1. Builds `detailTabMap = buildTabMap(document)` from the current page.
2. Computes actual tags, then merges in any tags found only on the onstage
   companion page (`onstageResult`), before computing expected tags.
3. Marks passing tag links green (see "Passing (green) tags").
4. Runs the setlist song tag check (see below) and marks matched song tags
   green too.
5. Runs the event-name location tag check (see below) and marks matched
   venue/city/state/country tags green too.
6. If any issues found (missing/spurious tags, unmatched setlist songs, OR
   unmatched location parts), wraps `.page-tags` parent in a gold warning box
   (`<div class="bb-tags-warn-box">`).
7. Appends `<span class="bb-tag-spurious">⚠️</span>` after spurious tag links.
8. Appends `<span class="bb-tag-missing">⚠️tag</span>` spans for missing tags,
   one per unmatched setlist song (showing the derived-alias candidate), AND
   one per unmatched location part (showing the expected slug/override tag).
9. Returns `{ additionalTags, onstageUrl }` — tags found only on the onstage
   companion page, for the caller to pass to `addOnstageTagsGlyph`.

Merging onstage-only tags into the internal `actualTags` Set (step 2) means
they correctly suppress false "missing" warnings and satisfy the setlist-song
/ location checks, but since they have no real `<a>` element in this page's
own `.page-tags`, they can never be colored green or flagged spurious here —
`markPassingTagLinks`'s callers already guard with `if (a) ...` before
calling it, so this degrades silently (no crash, just no green highlight for
that specific tag on this page).

---

## Onstage companion page tags (`fetchOnstageCompanionTags`, `addOnstageTagsGlyph`)

BruceBase wiki caps the number of tags per page. For "gig"/"rehearsal" DETAIL
pages, this means some tags spill onto a separate, optional companion page:
same date-slug, type swapped to `onstage`, with `/noredirect/true` appended
(e.g. `/gig:2025-10-26-stone-pony-asbury-park-nj` →
`/onstage:2025-10-26-stone-pony-asbury-park-nj/noredirect/true`). This
companion page only exists when the DETAIL page itself has an "On Stage" tab.

`fetchOnstageCompanionTags(path, eventType, tabMap)`:
- Returns `null` immediately when `eventType` isn't `"gig"` or `"rehearsal"`,
  or when `tabMap` (from `buildTabMap(document)`) has no `"On Stage"` entry.
- Otherwise builds the companion URL via
  `path.replace(/^(gig|rehearsal):/, 'onstage:') + '/noredirect/true'`,
  fetches it with `fetchPage` (same try/catch/`logWarn`-on-failure convention
  as the existing venue/song/relation page fetches), and returns
  `{ url, tags }` — `tags` being the lowercase `Set` from the companion
  page's own `.page-tags`.

Called from `runDetailPage` right after `buildTabMap`, before
`annotateDetailPageTags` (which needs the result to merge tags in). When
`annotateDetailPageTags` returns one or more `additionalTags` (present on the
companion page but not on this one), `addOnstageTagsGlyph(additionalTags,
onstageUrl)` appends a new `🏷️` glyph (via `makeGlyphSpan`) to `#page-title
h1`, alongside the existing name-match glyph from `addDetailTitleAnnotation`.
Since the tooltip content is a variable-length, `\n`-joined list of tag names
(the "genuinely rich" bucket per the native-title-vs-rich-tooltip convention
in [UTILITIES.md](UTILITIES.md)), it's wired via `mouseenter` →
`showErrorTooltip`, not a native `title`.

---

## Setlist song tag check (`checkSetlistSongTags`, `computeSongTagAlias`)

Every song listed in a DETAIL page's Setlist tab should have a corresponding
tag on that page — this is checked independently of `isManagedTag` (song
tags are never in `MANAGED_CONTENT_TAGS`), on both `annotateDetailPageTags`
(live DETAIL page) and `addTagsButton` (YEAR page's nested "Tags" button,
using the fetched `doc` — it calls `parseDetailSetlist(doc)` itself since it
doesn't have an already-parsed `detailSections` at hand).

`checkSetlistSongTags(detailSections, actualTags)` takes the unique set of
song titles across all sections (`detailSections.flatMap(s => s.songs)`) and,
for each, tries three lookups in order — the first one that matches an
actual tag wins:

1. **Exact match**: `song.toLowerCase().replace(/[^a-z0-9]/g, '')` — lowercase
   with every non-alphanumeric character deleted (not just whitespace), e.g.
   `"WRECKING BALL"` → `wreckingball`, `"LIVIN' IN THE FUTURE"` →
   `livininthefuture`, `"DEVIL'S ARCADE"` → `devilsarcade`.
2. **Derived alias** (`computeSongTagAlias(title)`): splits the title on
   whitespace and, per word:
   - a dotted initialism (`^([A-Za-z]\.)+$`, e.g. `"U.S.A."`) contributes ALL
     its letters, periods stripped (`"usa"`, not just `"u"`);
   - a purely-numeric word contributes the whole number (`"41"` stays `"41"`,
     not `"4"`);
   - every other word contributes only its first letter.

   Parens `()`, apostrophes `'`, hyphens `-`, ampersands `&`, and periods (on
   non-initialism words) are deleted outright (not replaced with a space) —
   so letters on either side merge into one word when there's no space
   (`"DOESN'T"` → `"DOESNT"` → one word), but stay separate when a space
   already exists on both sides (`"(41 SHOTS)"` → `"41"`, `"SHOTS"` — two
   words, since the space between them is untouched by paren-stripping).

   Examples: `"AMERICAN SKIN (41 SHOTS)"` → `as41s`, `"BORN IN THE U.S.A."`
   → `bitusa`, `"BECAUSE THE NIGHT"` → `btn`, `"DARKNESS ON THE EDGE OF TOWN"`
   → `doteot`.
3. **Manual override** (`SONG_TAG_ALIAS_OVERRIDES[song.toLowerCase().trim()]`):
   a small, user-editable lookup table (see "Constants" above) for the rare
   case where BruceBase's real tag matches neither of the above — e.g.
   `"ROSALITA (COME OUT TONIGHT)"` → `rosalita` (real tag is just the first
   word, not the full-title slug `rosalitacomeouttonight` nor an acronym
   alias), and `"TENTH AVENUE FREEZE-OUT"` → `10th`. Add entries here as
   exceptions are discovered; no code changes needed elsewhere.

Result shape: `{ song, matchedTag, method: 'exact'|'alias'|'override'|null }[]`.
A matched song's tag is colored green via `markPassingTagLinks`/inline
title-setting (same convention as other passing tags) with a tooltip naming
the song and the method. An unmatched song is rendered like a missing tag,
showing the derived-alias candidate (or the exact-match candidate as
fallback) so it's clear what to add.

Sibling override tables for other page types (`RELATION_TAG_ALIAS_OVERRIDES`,
`RETAIL_TAG_ALIAS_OVERRIDES`) are not implemented yet. `VENUE_TAG_ALIAS_OVERRIDES`
*is* implemented, but for the location tag check below, not for song tags.

---

## Event-name / venue-name location tag check

Every location component in a page's own title — venue name, venue detail
(DETAIL pages only), city, state/province, country/region — should have a
corresponding tag. Checked independently of `isManagedTag`/`isManagedVenueTag`
(location tags are never added to those managed-tag sets — see "Passing
(green) tags" note below), on:
- `annotateDetailPageTags` (live DETAIL page) / `addTagsButton` (YEAR page's
  nested "Tags" button) via `checkEventNameLocationTags(pageTitle, actualTags)`.
- `annotateVenuePageTags` (live VENUE page) / `addVenueTagsButton` (nested
  "Tags" button) via `checkVenuePageLocationTags(venueTitle, actualTags)`.

Both delegate to the shared `checkParsedLocationTags(loc, actualTags)`, fed
by one of two title parsers:
- `parseEventNameLocation(pageTitle)` — DETAIL-page title, e.g. `"2026-04-18
  Pollak Theatre, Monmouth University, West Long Branch, NJ"`. Strips the
  leading `YYYY-MM-DD `, then splits the remainder on commas: 4 parts means
  `venueName, venueDetail, city, state/country`; 3 parts means
  `venueName, city, state/country` (no detail).
- `parseVenuePageLocation(venueTitle)` — VENUE-page's own title, e.g.
  `"Pollak Theatre, West Long Branch, NJ"`. No date prefix and no venue
  detail ever appears here — always exactly `venueName, city, state/country`.

Both feed the shared `parseLocationParts(parts)`, which decides US-state vs.
Canadian-province vs. bare-country from the last comma part (checked against
`US_STATE_NAMES`/`CA_PROVINCE_NAMES` — a bare 2-letter code that isn't a
known abbreviation, e.g. a country initialism, falls through to the
bare-country branch).

Tag derivation, per component:
- **Venue name / venue detail / city**: `toLocationTagSlug(str)` — drop a
  leading/trailing `"The"`/`"Le"`/`"De"` article (including the `"(The)"`
  parenthetical form), lowercase, delete every non-alphanumeric character —
  no acronym, unlike `computeSongTagAlias`. E.g. `"West Long Branch"` →
  `westlongbranch`, `"Co-op Live"` → `cooplive`, `"Adelphi (The)"` → `adelphi`.
- **US state**: tag is `` `${toLocationTagSlug(fullName)}(${abbr.toLowerCase()})` ``,
  e.g. `NJ` → `newjersey(nj)`, plus a separate `usa` tag.
- **Canadian province**: same shape, e.g. `ON` → `ontario(on)`, plus `canada`.
- **Bare country**: its own slug (`England` → `england`) plus zero or more
  extra tags from `COUNTRY_EXTRA_TAGS` (`England` → also `unitedkingdom`,
  `europe`; `Finland` → also `europe`, `scandinavia`).

The venue name is checked by `checkVenueNameTag(name, cityHint, actualTags)`,
called from `checkParsedLocationTags` instead of a single
`checkLocationNameTag` call. It first looks for a descriptive `" At The "`
middle part (case-insensitive, e.g. `"Blue Cross Arena At The War
Memorial"`); if found, it splits into two independently-checked names —
`"Blue Cross Arena"` and `"War Memorial"`, each expecting its own tag
(`bluecrossarena` and `warmemorial`) — instead of a single combined-name
tag (`bluecrossarenaatthewarmemorial`, which BruceBase never uses). If no
`" At The "` is found, it falls back to a single `checkLocationNameTag`
call for the whole name. Each split half is passed a distinct `label`
(`` `Venue part before "At The" in "${name}"` `` / `` `Venue part after "At
The" in "${name}"` ``) instead of the generic `"Venue"` label, so the
resulting tooltip on the matched (or missing) tag explicitly names the "At
The" splitting rule rather than just saying "Venue".

`checkLocationNameTag` itself first looks up `VENUE_TAG_ALIAS_OVERRIDES`
(keyed by the lowercase, trimmed name), then tries the plain full-name slug,
then — only if a `cityHint` was supplied and the name begins with it — the
slug of just the remainder after the city prefix. This handles two
real-world cases:
- Set an override value to `null` to mean "no tag is expected for this name
  at all" (e.g. a generic building name like `"Spotify HQ"` that BruceBase
  never tags, favoring the more specific venue detail — `"Adelphi (The)"` →
  `adelphi` — instead; on VENUE pages this exception doesn't need an
  override at all, since the venue's own title is already the entity that
  has a wiki page).
- The **city-prefix rule**: when a venue name repeats its city as a prefix
  (e.g. venue `"Ocean Grove Youth Temple"` in city `"Ocean Grove"`),
  BruceBase sometimes only tags the venue-specific remainder (`youthtemple`)
  since the city itself is already tagged separately (`oceangrove`).
  `checkParsedLocationTags` passes `loc.city` as the `cityHint` for the
  venue-name check only (not venue detail or city itself). This applies on
  both DETAIL pages (when the venue is named as part of the event name) and
  VENUE pages (the venue's own title).

Result shape: `{ label, candidateTag, matchedTag, method: 'exact'|'override'|null }[]`.
A matched part's tag is colored green via `markPassingTagLinks`/inline
title-setting with a tooltip naming the location field and method. An
unmatched part is rendered like a missing tag, showing `candidateTag` (the
slug/override/remainder-slug that was expected).

---

## VENUE page annotation (`annotateVenuePageTags`)

Called from `runVenuePage`. `computeExpectedVenueTags(venueName)` returns a
fixed set: `venue`, plus the first letter of the venue name (lowercase,
alphabetical-index tag — e.g. `"Pollak Theatre…"` → `p`).
`isManagedVenueTag(tag)` returns true for exactly those two kinds of tag.
(`files`/`info` were considered as always-present fixed tags but are *not*
reliably present on every VENUE page, so they are intentionally left
unmanaged/unchecked.)

Location tags (venue-name/city/state/country slugs) are checked separately
by the location tag check above — deliberately *not* added to
`computeExpectedVenueTags`'s Set or to `isManagedVenueTag`, since they're
page-specific freeform strings rather than a small fixed vocabulary; a wrong
venue/city tag will still show up as a red missing entry for the *correct*
tag, it just isn't flagged "spurious" (same trade-off as song tags).

`addVenueTagsButton` (YEAR page's nested "Tags" button, `.bb-venue-tab-row`)
mirrors this exactly, merging the same location-check results into its
`<ol>` panel.

---

## SONG page annotation (`annotateSongPageTags`)

Called from `runSongPage`, passed `songName` (`#page-title` text) and
`buildTabMap(document)`. `computeExpectedSongTags(songName, tabMap)` and
`isManagedSongTag(tag)` delegate to `computeExpectedYearSongTags`/
`isManagedYearSongTag` (used by the YEAR page's nested "Song Tags" button —
see above) since the rules are identical, just against the live `document`
instead of a fetched one:

| Expected tag | Condition |
|---|---|
| `song` | Always — every `/song:…` page must carry this tag |
| First letter of `songName` | Lowercase, e.g. `"BORN TO RUN"` → `b` |
| `lyricsheet` | Gallery tab has an `<img>` whose `src` contains `"lyricsheet"` |
| Exact-title slug (`checkSongExactTitleTag`) | `songName.toLowerCase().replace(/[^a-z0-9]/g, '')` — e.g. `"BORN TO RUN"` → `borntorun` — a hard requirement, flagged missing if absent |

In addition, `checkSongAliasTagRecognition(songName, actualTags, exactTag)`
checks one more tag convention — but as *recognition only*, never as a
requirement (real SONG pages sometimes carry only the exact-title tag, or
neither, relying on the first-letter tag alone), so it never appears in the
missing-tag list: the **derived alias** (`computeSongTagAlias`, same
algorithm as the setlist song tag check) — e.g. `"BORN TO RUN"` → `btr`.
Returns `null` when the alias would equal the exact-title tag, to avoid
double-reporting the same tag under two labels.

The exact-title tag, when present, is marked green via `markPassingTagLinks`
with a "verified" tooltip (same wording as the required checks above); the
alias tag, when present, gets a "recognized" tooltip instead, to distinguish
an optional match from a required one. `addSongTagsButton` (YEAR page's
nested "Song Tags" button) mirrors both checks, merging the exact-title
check into its missing-tag list (contributing to the "N missing" button
count) and the alias check into its existing-tag pass/tooltip logic only.

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
`Members` tab is found, causing `annotateRelationPageTags` to exit early
(before any passing-tag marking, too — the page type can't be determined).

---

## CSS classes (tag feature)

| CSS class | Purpose |
|---|---|
| `.bb-tag-missing` | Bold red span for expected-but-absent tags |
| `.bb-tag-spurious` | Orange ⚠️ for present-but-unexpected managed tags |
| `.bb-tag-ok` | Bold green (`#2a2`) for present-and-expected ("passing") managed tags; reset to `inherit` in `.bb-original-view` |
| `.bb-tags-warn-box` | Gold border, #fffbe6 background wrapper around `.page-tags` when issues found |
