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
| `RELATION_TAG_ALIAS_OVERRIDES` | `{relationNameLowercase: 'expectedTag'}` — user-editable manual overrides for the "On Stage"/"In Studio" tab relation tag check, for the rare case where none of the exact/"The "-stripped/suffix-stripped/nickname-stripped derivations match BruceBase's real tag (e.g. a typo like `jake.clemons`) |
| `RELATION_TAB_CONFIGS` | `{'On Stage': {fixedTag: 'onstage'}, 'In Studio': {fixedTag: 'studio'}, 'On Audio': {fixedTag: null}}` — which relation-listing tab (gig/rehearsal, recording, nogig) maps to which always-expected fixed tag (`null` = no fixed tag, only the per-relation-name checks apply), for `checkOnStageRelationTags` |
| `relationMethodLabel(method, tabLabel)` | Function (not a lookup constant) returning the human-readable reason for the relation tag check's tooltips, parameterized by which tab (`"On Stage"`/`"In Studio"`/`"On Audio"`) produced the match |
| `ALIAS_SUBSTRING_TAGS` | `{award: ['award'], grammy: ['grammy'], private: ['private', 'closed']}` — generic, event-type-independent tags verified against the event alias (see "Alias-substring tag check" below) rather than any per-event-type rule; each tag maps to one or more alias substrings that verify it (not necessarily equal to the tag itself) |

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
| Day number | Zero-padded two-digit string from event date (e.g. `"07"`), always expected — including `"00"`, BruceBase's convention for an unknown day-of-month; `isTagPresent` also accepts the unpadded form (`"7"`, or `"0"` for `"00"`) |
| Weekday name | `new Date(yr, mo-1, dd).getDay()`; skipped when day = 0 (unknown) |
| Day-suffix letter | The single letter (`a`/`b`/`c`/…) BruceBase appends to the URL slug's day part to distinguish multiple same-day events, e.g. `"b"` in `rehearsal:1976-12-00b-…` — see `extractEventDaySuffix`. Passed in as `computeExpectedTags`'s optional `daySuffix` argument (not derived from `eventDate`, which never carries it); only expected when the URL actually has one |
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
names, weekday names, 4-digit years, 1–2 digit day numbers (0–31 — `0`/`00`
included, BruceBase's unknown-day-of-month convention), and single lowercase
letters (the day-suffix a/b/c/… distinguishing multiple same-day events —
mirrors `isManagedRetailTag`'s identical rule for retail pages).

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

Called from `wireIconHandlers(eventLink, doc, onstageResult)` (after
`addEventTabButtons`), where `onstageResult` is `processOneYearEvent`'s
`fetchOnstageCompanionTags` result (or `null`), threaded through so the
button shows ALL tags for the event, not just the ones on the DETAIL page
itself. It:
1. Reads `.page-tags a[href]` from the fetched DETAIL `doc`.
2. Merges in any onstage-companion tags not already present (same pattern as
   `annotateDetailPageTags` — see "Onstage companion page tags" below), then
   computes expected tags and compares against the merged actual set.
3. Also runs the setlist-song, event-location, and "On Stage" tab relation
   tag checks (same functions `annotateDetailPageTags` uses, against `doc`),
   contributing matched tags to the green/passing set and unmatched ones to
   the missing-tag count.
4. Merges existing links (styled green if passing, with spurious ⚠️ if not) +
   onstage-companion tags (rendered as `bb-tag-onstage`-styled entries, always
   "present", never spurious/missing) + missing placeholders into one sorted
   list; renders in the `buildIconPanel` infrastructure.
5. Button label: `"Tags"` when clean; `"Tags ⚠️ (N missing, M spurious)"` with
   colour red (if any missing), dark-orange (if only spurious), or green
   (`#2a2`, when fully clean) — so status is visible without clicking.
6. Appended as the last button in `.bb-event-tab-row` (created if absent).
7. The panel header caption is the complete raw event name plus `" Tags"`
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
6. Runs the "On Stage" tab relation tag check (see below) and marks matched
   `"onstage"`/relation tags green too.
7. If any issues found (missing/spurious tags, unmatched setlist songs,
   unmatched location parts, OR unmatched relations), wraps `.page-tags`
   parent in a gold warning box (`<div class="bb-tags-warn-box">`).
8. Appends `<span class="bb-tag-spurious">⚠️</span>` after spurious tag links.
9. Appends `<span class="bb-tag-missing">⚠️tag</span>` spans for missing tags,
   one per unmatched setlist song (showing the derived-alias candidate), one
   per unmatched location part, and one per unmatched relation/`"onstage"`
   (each showing the expected slug/candidate tag).
10. Renders any onstage-companion `additionalTags` directly into `.page-tags`
    itself as real-looking `<a href="/system:page-tags/tag/…">` links (class
    `bb-tag-onstage`), then re-sorts the combined tag list alphabetically —
    see "Onstage companion page tags" below.
11. Returns `{ additionalTags, onstageUrl }` — tags found only on the onstage
    companion page, for the caller to pass to `addOnstageTagsGlyph`.

Merging onstage-only tags into the internal `actualTags` Set (step 2) means
they correctly suppress false "missing" warnings and satisfy the setlist-song
/ location checks. Rendering them into the DOM (step 9) additionally makes
them count toward `passingLinks`/`spuriousLinks` like any other tag link from
that point on — `tagLinks` (captured before step 9) still only contains the
*original* anchors, though, so a setlist-song/location match against a
newly-rendered onstage tag still won't get the green "verified" treatment on
this pass (same `if (a) ...` guard as before — no crash, just no highlight).

---

## Onstage companion page tags (`fetchOnstageCompanionTags`, `makeOnstageTagsGlyphSpan`)

BruceBase wiki caps the number of tags per page. For "gig"/"rehearsal" DETAIL
pages, this means some tags spill onto a separate, optional companion page:
same date-slug, type swapped to `onstage`, with `/noredirect/true` appended
(e.g. `/gig:2025-10-26-stone-pony-asbury-park-nj` →
`/onstage:2025-10-26-stone-pony-asbury-park-nj/noredirect/true`). This
companion page only exists when the DETAIL page itself has an "On Stage" tab.

`fetchOnstageCompanionTags(path, eventType, tabMap)`:
- Returns `null` immediately when `eventType` isn't `"gig"` or `"rehearsal"`,
  or when `tabMap` (from `buildTabMap(doc)`) has no `"On Stage"` entry.
- Otherwise builds the companion URL via
  `path.replace(/^(gig|rehearsal):/, 'onstage:') + '/noredirect/true'`,
  fetches it with `fetchPage` (same try/catch/`logWarn`-on-failure convention
  as the existing venue/song/relation page fetches), and returns
  `{ url, tags }` — `tags` being the lowercase `Set` from the companion
  page's own `.page-tags`.

`makeOnstageTagsGlyphSpan(additionalTags, onstageUrl)` builds (but doesn't
insert) a `🏷️` `.bb-glyph` span with a rich tooltip listing the additional
tags — the tooltip content is a variable-length, `\n`-joined list (the
"genuinely rich" bucket per the native-title-vs-rich-tooltip convention in
[UTILITIES.md](UTILITIES.md)), so it's wired via `mouseenter` →
`showErrorTooltip`, not a native `title`. Two call sites insert it
differently:

- **DETAIL page** (`runDetailPage`): calls `fetchOnstageCompanionTags` right
  after `buildTabMap`, before `annotateDetailPageTags` (which needs the
  result to merge/render tags — see above). When `additionalTags.length > 0`,
  `addOnstageTagsGlyph(additionalTags, onstageUrl)` appends the glyph span to
  `#page-title h1`, alongside the existing name-match glyph from
  `addDetailTitleAnnotation`.
- **YEAR page** (`processOneYearEvent`): calls `fetchOnstageCompanionTags`
  right after `addYearGlyph` (which now returns its `.bb-glyph` span so a
  further glyph can be inserted right after it via `glyphSpan.after(...)`),
  reusing the DETAIL `doc` it already fetched for name/venue/setlist checks —
  no extra DETAIL fetch, only the conditional onstage one. `onstageResult` is
  then threaded through `wireIconHandlers` into `addTagsButton` (see the
  "YEAR page Tags button" section above) so the nested Tags panel shows the
  same additional tags. **LIST pages are out of scope**: they never fetch a
  per-event DETAIL document at all (only one shared YEAR page for name
  comparison), so adding this there would mean introducing a whole new eager
  per-event fetch loop — deferred pending a decision on that cost.

---

## Setlist song tag check (`checkSetlistSongTags`, `computeSongTagAlias`)

Every song listed in a DETAIL page's Setlist tab should have a corresponding
tag on that page — this is checked independently of `isManagedTag` (song
tags are never in `MANAGED_CONTENT_TAGS`), on both `annotateDetailPageTags`
(live DETAIL page) and `addTagsButton` (YEAR page's nested "Tags" button,
using the fetched `doc` — it calls `parseDetailSetlist(doc)` itself since it
doesn't have an already-parsed `detailSections` at hand).

`checkSetlistSongTags(detailSections, actualTags)` first flattens
`detailSections.flatMap(s => s.songs)`, then splits every song string on
`" - "` (the medley/tribute separator also used by `songCompareKey`, e.g.
`"LIGHT OF DAY - HAPPY BIRTHDAY TO YOU"` → two independent songs, each
checked and expected to have its *own* tag: `lightofday` and
`happybirthdaytoyou`), takes the unique set of resulting song titles, and
for each, via `checkOneSongTag(song, actualTags)`, tries three lookups in
order — the first one that matches an actual tag wins:

1. **Exact match** (`songTagSlug(song)`): lowercase, with accents/diacritics
   stripped first (`stripDiacritics`, e.g. `"JOLÉ BLON"` → `"JOLE BLON"`)
   and every non-alphanumeric character deleted (not just whitespace), e.g.
   `"WRECKING BALL"` → `wreckingball`, `"LIVIN' IN THE FUTURE"` →
   `livininthefuture`, `"DEVIL'S ARCADE"` → `devilsarcade`, `"JOLÉ BLON"` →
   `joleblon`.
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

## "On Stage"/"In Studio"/"On Audio" tab relation tag check (`checkOnStageRelationTags`)

Every relation name listed under a DETAIL page's "On Stage" tab (gig/
rehearsal), "In Studio" tab (recording), or "On Audio" tab (nogig) should
have a corresponding tag, checked on both `annotateDetailPageTags` (live
DETAIL page) and `addTagsButton` (YEAR page's nested "Tags" button, using
the fetched `doc`). `checkOnStageRelationTags(doc, tabMap, actualTags)`
looks up which of `RELATION_TAB_CONFIGS`'s tab labels (`"On Stage"` → fixed
tag `"onstage"`, `"In Studio"` → fixed tag `"studio"`, `"On Audio"` → no
fixed tag) is present in `tabMap` (from `buildTabMap`) and returns `[]`
immediately when none is; otherwise (a page has at most one of these tabs —
it's always tab index 0, see `extractRelations`):

1. **Fixed tag** (optional): when the matched tab's configured `fixedTag` is
   set (`"onstage"` or `"studio"` — `"On Audio"` has none), it's always
   expected, independent of any relation — first item in the result,
   `method: 'fixed'`. Skipped entirely for tabs with `fixedTag: null`.
2. **Guest tag**: if Bruce Springsteen himself is listed under the tab
   marked `"(Guest)"` (`isRelationMarkedGuest(doc, 'Bruce Springsteen')` —
   scans `extractRelations(doc)`'s top-level items *and* band members for a
   name match plus an `extra` string containing `"Guest"`, e.g.
   `<li><a href="/relation:bruce-springsteen">Bruce Springsteen</a>
   <span style="font-size:80%;"><em>(Guest)</em></span></li>`), `"guest"` is
   also always expected — second item, `method: 'guest'`. Not triggered by
   any *other* relation being marked `"(Guest)"`, only Bruce Springsteen
   specifically.
3. **Exact match**: for every relation name from
   `extractOnStageRelationNames(doc)` (flattens `extractRelations(doc)`'s
   groups — top-level entries *and* their band members — into a unique
   name list; `extractRelations` itself always reads `#wiki-tab-0-0`, the
   established convention already used elsewhere in this file for
   relation-participant rendering), the lowercase, punctuation/whitespace-stripped
   form must match a tag, e.g. `"Steven Van Zandt"` → `stevenvanzandt`.
4. **"The"-stripped fallback**: same slug rule, but with a leading `"The "`
   stripped from the name first, e.g. `"The E Street Band"` → `estreetband`
   (not `theestreetband`).
5. **Suffix-stripped fallback**: same slug rule, but with a trailing
   generational suffix (`Jr.`/`Sr.`/`II`/`III`/`IV`) stripped first, e.g.
   `"Curtis King Jr."` → `curtisking`.
6. **Nickname-stripped fallback**: same slug rule, but with a quoted
   nickname substring removed first, e.g. `Steve "Muddy" Shews` →
   `steveshews` (not `stevemuddyshews`).
7. **Manual override** (`RELATION_TAG_ALIAS_OVERRIDES[name.toLowerCase().trim()]`):
   for the rare case where BruceBase's real tag matches none of the above —
   e.g. `"Jake Clemons"` → `jake.clemons` (a stray period in the real tag).

Rules 3-6 are computed as a candidate list and tried in that order — first
match wins (`checkSingleRelationName`'s inner `seen` Set skips re-checking
a candidate whose slug happens to be identical to an earlier one, e.g. a
name with neither "The " nor a suffix nor a nickname just tries the same
slug once). Add entries to `RELATION_TAG_ALIAS_OVERRIDES` only when all four
fail; no code changes needed elsewhere. This per-name logic lives in
`checkSingleRelationName(name, actualTags)`, extracted out of
`checkOnStageRelationTags` so it can be called twice for a name containing
`" & "` (see below).

8. **`" & "` splitting**: a relation name containing `" & "` (e.g.
   `"Joe Grushecky & The Houserockers"`) is first split into two independent
   names, each checked separately via `checkSingleRelationName` — so
   `"Joe Grushecky"` → `joegrushecky` and `"The Houserockers"` →
   `houserockers` (via the existing "The "-stripped rule, reused
   automatically) become two separate expected tags. Only when *both*
   halves fail to match does `checkOnStageRelationTags` fall back to the
   combined name with `" & "` removed and a leading `"The "` stripped, e.g.
   `"Hall & Oates"` → `halloates` (`method: 'ampersand-combined'`). If
   neither the split nor the combined fallback works, both split-part
   results are pushed as-is (so the user sees both candidates, and both are
   listed as missing).

Result shape: `{ label, candidateTag, matchedTag, method: 'fixed'|'guest'|'exact'|'the-stripped'|'suffix-stripped'|'nickname-stripped'|'override'|'ampersand-combined'|null, tabLabel }[]`,
mirroring the setlist-song/location checks (`tabLabel` — `"On Stage"` or
`"In Studio"` — carries which tab produced the match, for the tooltip text).
A matched tag is colored green via `markPassingTagLinks` with a tooltip
built from `relationMethodLabel(method, tabLabel)` (e.g. *"matches a
relation listed under the 'On Stage' tab (lowercase, whitespace/punctuation
stripped)"*, or the "In Studio"/`"studio"` equivalent). An unmatched
relation (or a missing fixed tag itself) is rendered like a missing tag,
showing `candidateTag` (the *first* candidate's slug, i.e. the plain
exact-match one, since that's the most literal "expected" form to show the
user even though a stripped variant might be closer to BruceBase's actual
convention).

**Important ordering note**: `"onstage"` is also a member of
`MANAGED_CONTENT_TAGS` (it's a real event type for actual `/onstage:` pages),
but `computeExpectedTags` never adds it to `expectedTags` for a gig/rehearsal
page — only this check does. Both `annotateDetailPageTags` and
`addTagsButton` therefore compute `checkOnStageRelationTags`'s results
*before* their `spuriousLinks`/`spurious` computation and exclude any
relation-matched tag from it (`&& !matchedRelationTagSet.has(tag)` /
`&& !relationMatch`) — otherwise the generic spurious check would flag
`"onstage"` (present but "not expected" by its own logic) at the same time
this check marks it green, producing a confusing double-flag. `"studio"` is
*not* a member of `MANAGED_CONTENT_TAGS` (it's not a real event type), so it
never needs this exclusion — the generic spurious check simply never
considers it, and this relation check alone drives its missing/matched state.

**`RELATION_TAB_CONFIGS`/`relationMethodLabel` placement**: both are
declared in the top-of-file constants block (near `VENUE_TAG_ALIAS_OVERRIDES`
and `RELATION_TAG_ALIAS_OVERRIDES`), for locality with each other rather
than near `checkOnStageRelationTags` itself. `relationMethodLabel` is a
`function` declaration (fully hoisted), so — unlike the `const` lookup table
it replaced — its placement isn't load-bearing for the temporal-dead-zone
reason that applies to the other top-block constants (`MANAGED_CONTENT_TAGS`,
`US_STATE_NAMES`, `SONG_TAG_ALIAS_OVERRIDES`, etc., which *do* need to stay
there since the boot dispatch near the top of the file runs before the
script's sequential execution reaches a `const` declared later).

**Onstage-companion tag lookup**: a song/location/relation match against a
tag that only exists via the companion "onstage:" page (i.e. rendered as a
`.bb-tag-onstage` element, not present in the page's own original
`.page-tags`) needs to be found by anchor *after* that rendering happens.
`annotateDetailPageTags` builds a `tagToAnchor` map (tag string → element)
from the original `tagLinks` and keeps adding to it as each onstage tag is
rendered in, then uses `tagToAnchor.get(matchedTag)` (not
`tagLinks.find(...)`, which would only ever see the pre-render snapshot) in
every matched-tag marking loop. `addTagsButton`'s panel doesn't mutate a
live DOM the same way, so its `onstageItems` entries instead check
`matchedSongsByTag`/`matchedLocationsByTag`/`matchedRelationsByTag` directly
and render green (`class="bb-tag-onstage bb-tag-ok"`) with the verification
tooltip when a match exists, instead of unconditionally using the plain
"found on companion page" style. Both branches keep the `bb-tag-onstage`
class even when matched, so a companion-page-sourced tag stays italic
regardless of whether it also turns green (`.bb-tag-onstage`'s
`font-style: italic` is unconditional).

**Color cascade note**: `.bb-tag-ok` and `.bb-tag-onstage` both set `color`
with `!important`, at equal specificity — CSS resolves that tie by source
order, and since `.bb-tag-onstage` is declared *after* `.bb-tag-ok` in the
stylesheet, it would otherwise win, showing a verified companion-page tag as
steelblue instead of green. A `.bb-tag-onstage.bb-tag-ok` combined-selector
rule (higher specificity, `0,0,2,0` vs. `0,0,1,0`) forces green whenever
both classes are present, regardless of declaration order.

`onStageRelationRulesExplanation()` returns a one-line summary of these same
three rules; it's appended to `makeOnstageTagsGlyphSpan`'s tooltip (see
"Onstage companion page tags" above) after the list of additional tags found
on the companion page, since both facts concern the same "On Stage" tab/page
— visible from a single hover on the 🏷️ glyph on both DETAIL and YEAR pages.

---

## Alias-substring tag check (`checkAliasSubstringTags`)

Unlike every other check in this file, this one is **not** tied to any
specific event type or tab — it applies wherever a DETAIL page has an event
alias at all (see `extractEventAlias`: the `<p><strong>…</strong></p>`
header immediately followed by `<hr>` as the first two children of
`#wiki-tab-0-0`, e.g. `"68th Annual Grammy Awards Ceremony"` on a `nogig`
page's "On Audio" tab, or `"Streets Of Minneapolis Recording Session"` on a
`recording` page's "In Studio" tab).

`ALIAS_SUBSTRING_TAGS` (currently `{award: ['award'], grammy: ['grammy'],
private: ['private', 'closed']}`) maps generic tags to the alias
substring(s) that verify them — a substring list need not equal the tag
itself, e.g. "private" is verified by either "private" *or* "closed" (both
imply a non-public event). `checkAliasSubstringTags(alias, actualTags)`:

1. Returns `[]` immediately when there's no alias (`extractEventAlias`
   returned `null`).
2. Otherwise, for each `tag -> substrings` entry in `ALIAS_SUBSTRING_TAGS`,
   checks whether the tag is **present** (`isTagPresent(tag, actualTags)`)
   **and** at least one of its `substrings` occurs case-insensitively in the
   alias (`alias.toLowerCase().includes(substring)`) — e.g. tag `"grammy"`
   matches alias `"68th Annual Grammy Awards Ceremony"`, tag `"award"`
   matches too (it's a substring of `"Awards"`), and tag `"private"` matches
   alias `"Closed Rehearsal"` on a `rehearsal` page's "On Stage" tab (via its
   `"closed"` substring, not the tag's own name).
3. Only matching tags are returned, as `{ tag, label }` (`label` names
   *which* substring matched); there is no "missing" counterpart — a tag not
   in this map, or present but not matching any of its substrings, is simply
   left to whatever other check (or none) already governs it. This check
   only ever *upgrades* an already-present tag to "verified" (green); it
   never requires a tag to exist.

Wired into `annotateDetailPageTags` (DETAIL page, via `extractEventAlias(document)`)
and `addTagsButton` (YEAR page's nested "Tags" button, via `extractEventAlias(doc)`
— `doc` is the fetched per-event DETAIL page, the same one `processOneYearEvent`
already calls `extractEventAlias` on for the `.bb-event-alias` span rendered
next to the event name). A matched tag is colored green via
`markPassingTagLinks`/inline title-setting with tooltip *`Tag "private"
verified: matches event alias "Closed Rehearsal" (contains "closed",
case-insensitive)`*. Because it never contributes a "missing" entry, it also
never affects `annotateDetailPageTags`'s warn-box early-return check or
`addTagsButton`'s "N missing" count — it only participates in the
`passing`/green-coloring branch of the existing-tag loop in both places.

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
| Exact-title slug (`checkSongExactTitleTag`) | `songTagSlug(songName)` (accent-stripped, lowercase, punctuation-stripped) — e.g. `"BORN TO RUN"` → `borntorun` — a hard requirement, flagged missing if absent |

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
