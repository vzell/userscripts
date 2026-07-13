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

All five live-page annotators (DETAIL/VENUE/RETAIL/SONG/RELATION) share the
same wrap-and-regroup finish: `.page-tags` always ends up wrapped in a
`<div>` — gold `.bb-tags-warn-box` if any issues were found, green
`.bb-tags-box` otherwise — with `tagsContainer.style.clear = 'none'`
cancelling BruceBase's own `.page-tags{clear:both}` so the box sits flush
against the preceding footer instead of leaving a gap sized to the floated
`#side-bar`; then `groupTagsIntoLines(tagsContainer)` reflows the tags into
per-first-letter lines (see "Tag line-grouping" below) regardless of which
box was used.

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
| `SONG_COMBINATION_TAG_OVERRIDES` | `{fullCombinationStringLowercase: 'expectedTag'}` — user-editable, end-user-extensible overrides for a medley/tribute *combination* (e.g. `'land of hope and dreams - people get ready'` → `'lohad.pgr'`) tagged as one fixed value instead of one tag per song — checked before `checkSetlistSongTags` splits on `" - "` |
| `US_STATE_NAMES` | `{abbr: 'Full State Name'}` — all 50 US states + DC, for the location tag check |
| `CA_PROVINCE_NAMES` | `{abbr: 'Full Province Name'}` — all 13 Canadian provinces/territories, for the location tag check |
| `COUNTRY_EXTRA_TAGS` | `{countryName: ['extraTag', …]}` — extra continent/region tags expected alongside a bare country's own slug (e.g. `England` → `unitedkingdom`, `europe`); not exhaustive, user-extendable |
| `VENUE_TAG_ALIAS_OVERRIDES` | `{venueOrDetailNameLowercase: 'expectedTag' \| null}` — user-editable manual overrides for the location tag check; `null` means "no tag expected for this name at all" (empty by default) |
| `RELATION_TAG_ALIAS_OVERRIDES` | `{relationNameLowercase: 'expectedTag'}` — user-editable manual overrides for the "On Stage"/"In Studio" tab relation tag check, for the rare case where none of the exact/"The "-stripped/suffix-stripped/nickname-stripped derivations match BruceBase's real tag (e.g. a typo like `jake.clemons`) |
| `RELATION_TAB_CONFIGS` | `{'On Stage': {fixedTag: 'onstage'}, 'In Studio': {fixedTag: 'studio'}, 'On Audio': {fixedTag: null}, 'On Set': {fixedTag: null}}` — which relation-listing tab (gig/rehearsal, recording audio session, nogig, recording video session) maps to which always-expected fixed tag (`null` = no fixed tag, only the per-relation-name checks apply), for `checkOnStageRelationTags` |
| `relationMethodLabel(method, tabLabel)` | Function (not a lookup constant) returning the human-readable reason for the relation tag check's tooltips, parameterized by which tab (`"On Stage"`/`"In Studio"`/`"On Audio"`/`"On Set"`) produced the match |
| `FUZZY_SUBSTRING_TAGS` | `{award: ['award'], grammy: ['grammy'], private: ['private', 'closed'], benefit: ['benefit'], anniversary: ['anniversary'], interview: ['interview'], funeral: ['funeral']}` — generic, event-type-independent tags verified against the event alias and/or page notes text (see "Fuzzy substring tag check" below) rather than any per-event-type rule; each tag maps to one or more substrings that verify it (not necessarily equal to the tag itself) |
| `TOUR_PREMIERE_TAG_VALUES` | `Set` of allowed tour-premiere-count tag values: `'1'`..`'9'`, `'9+'` — see "Tour-premiere-count tag check" below |
| `TOUR_DEFINITIONS` | `[{name, tag, ranges: [[start,end], …]}, …]` — user-editable, end-user-extensible table of Springsteen tour date ranges (dates `"YYYY-MM-DD"`) → tags, for the DETAIL-page tour-association tag check — see "Tour association tag check" below |
| `TOUR_TAG_SET` | `Set` of every tag in `TOUR_DEFINITIONS`, derived automatically — kept in sync as that table is edited |
| `TOUR_NO_TAG` | The literal string `'tour_no'` — the special tag for an event confirmed NOT part of a tour that otherwise covers its date |
| `TOUR_NO_OVERRIDES` | `{eventPath: true \| false}` — user-editable manual overrides for the `tour_no` heuristic, keyed by the event's URL path with no leading slash (empty by default) |

`MANAGED_CONTENT_TAGS` covers: event types (`gig`, `interview`, `nobruce`,
`nogig`, `offstage`, `onstage`, `recording`, `rehearsal`, `soundcheck`) plus
`bootleg`, `livedl`, `news`, `memorabilia`, `ticket`, `setlist`, `handwritten`,
`printed`, `storyteller`, `eyewitness`, `help`, `underconstruction`, `featured`,
`prem`, `rescheduled`.

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
| `memorabilia` | Tab label is exactly `"News/Memorabilia"` (not just `"News"`) AND non-Sorry AND has at least one `<img>` — a tab with only a text "Links" section (news article links, no images) is news-only, not memorabilia |
| `ticket` | News/Memorabilia tab has `<img>` with `"ticket"` in `src` |
| `setlist` | News/Memorabilia tab has `<img>` with `"setlist"` in `src`, excl. `"ticket"` |
| `handwritten` | Setlist images with `"handwritten"` in `src` |
| `printed` | Setlist images with `"printed"` in `src` |
| `soundcheck` | `<p><strong>Soundcheck</strong></p>` header found in the setlist container, OR `#page-content` text matches `/\bsoundcheck\s*:/i` |
| `rescheduled` | The free-text notes preamble (`extractPageNotesText(doc)`) matches `/rescheduled\s+from/i` |
| `storyteller` | Storyteller tab has non-Sorry content |
| `help` | The YEAR page shows a "Help Us" call-to-action icon for this event (see "Help-icon tag check" below) — passed in as `computeExpectedTags`'s optional `hasHelp` argument, since the icon lives on the YEAR page, not (as far as observed) the DETAIL page itself |
| Tour-premiere count | `computeTourPremiereTagValue(countTourPremiereSongs(doc))` — see "Tour-premiere-count tag check" below. Omitted entirely (no tag expected) when the count is 0 |
| `prem` | Expected alongside the count tag whenever `countTourPremiereSongs(doc) > 0` — i.e. whenever at least one tour-premiere song is present. A member of `MANAGED_CONTENT_TAGS` (unlike the bare count tag, which is managed via the day-number-shape rule — see "Tour-premiere-count tag check" below), so it's checked/colored the same way as `bootleg`/`storyteller`/etc. |
| Tour association tag(s) | `computeExpectedTags`'s optional `tourExpectedTags` argument — precomputed by the caller via `checkEventTourTags(eventDate, eventPath, alias)` (same "caller precomputes, passes it in" pattern as `hasHelp`/`hasFeatured`), since that check needs the event's URL path and alias, which `computeExpectedTags` doesn't otherwise have. See "Tour association tag check" below |

`getNewsMemTab(doc, tabMap)` tries both `"News/Memorabilia"` and `"News"` tab
labels so that events with only a `"News"` tab are still checked.

---

## Tour-premiere-count tag check (`countTourPremiereSongs`, `computeTourPremiereTagValue`)

BruceBase renders a Setlist tab song in bold (`<strong>`) to mark it as a
tour debut ("tour premiere"). `countTourPremiereSongs(doc)` counts these by
querying `getSetlistContainer(doc)` for `strong a[href^="/song:"]` — scoped to
the setlist container so unrelated bold text elsewhere on the page (e.g. a
Storyteller quote) is never counted. `computeTourPremiereTagValue(count)`
then converts that count into BruceBase's tag-value convention (bare, never
zero-padded): `"1"`.."9"` for 1-9 premieres, `"9+"` for more than 9, or
`null` (no tag expected at all) when the count is 0.

`computeExpectedTags` adds this value (when non-null) to the expected-tag
set, so it's checked the same way as any other tag by both
`annotateDetailPageTags` and the YEAR page's `addTagsButton`.

The tricky part is telling this bare-digit tag apart from the also-numeric,
also-1–2-digit day-of-month tag (see the table above) — both `"6"` and
`"03"` match a naive `/^\d{1,2}$/`. The two conventions never actually
collide because BruceBase always zero-pads the day-of-month tag to exactly
2 digits (`"03"`, `"31"`, `"00"`) but never zero-pads a premiere-count tag —
so `isManagedTag`, `spuriousTagMsg`, and `passingTagMsg` all check the
premiere-shaped form (`/^[1-9]$/` or exactly `"9+"`) before falling back to
the day-of-month interpretation (which is now itself tightened to
`/^\d{2}$/` when locating the expected day value in `expectedTags`, so it no
longer accidentally picks up a bare premiere-count entry). `passingTagMsg`
additionally requires the tag to be the literal expected premiere value
(`expectedTags.has(tag)`), not just premiere-shaped, so a legacy bare-digit
day tag that only passes via `isTagPresent`'s zero-pad fallback still gets
the correct "Day tag" message rather than being misattributed to the
premiere-count check.

---

## Tour association tag check (`checkEventTourTags`, `findMatchingTours`, `pickMostSpecificTour`)

Not to be confused with the tour-*premiere* check above (a song's live debut) —
this checks which Springsteen **concert tour** (e.g. "Land Of Hope And Dreams")
an event's date falls within, per the user-editable `TOUR_DEFINITIONS` table,
and expects the matching tag(s) to be present. `findMatchingTours(eventDate)`
returns every `TOUR_DEFINITIONS` entry whose `ranges` cover `eventDate` (plain
string comparison — dates are always `"YYYY-MM-DD"`, so lexical order matches
chronological order).

**The `tour_no` exception**: real tour events normally have no event alias, so
before checking the deduced tag(s), `checkEventTourTags(eventDate, eventPath,
alias)` first decides whether this event is actually an *exception* — a
one-off show (charity gig, award ceremony, etc.) slotted into a tour's date
range but not really part of it, e.g.
[gig:2026-04-18-pollak-theatre-west-long-branch-nj](http://brucebase.wikidot.com/gig:2026-04-18-pollak-theatre-west-long-branch-nj)
inside the "Land Of Hope And Dreams" range. The heuristic: an event alias
(`extractEventAlias(doc)` — the same `<p><strong>ALIAS</strong></p>` +
`<hr>` first-tab pattern the `FUZZY_SUBSTRING_TAGS` check already uses, e.g.
`American Music Honors`) present ⇒ `tour_no`; absent ⇒ the deduced tour
tag(s). `TOUR_NO_OVERRIDES[eventPath]` (`true`/`false`) overrides this default
in either direction for a specific event, when the heuristic gets it wrong.

- When `tour_no` applies: `expectedTags = {TOUR_NO_TAG}` — the deduced tour
  tag(s) are *not* expected (and are spurious if present).
- Otherwise: `expectedTags` is the full set of every matching tour's tag —
  more than one when tours overlap (e.g. both `tour_lohad` and `tour_lohadnk`
  for a date inside the "No Kings" leg, since it's nested inside the larger
  "Land Of Hope And Dreams" tour).
- When `eventDate` falls outside every known tour's range, `checkEventTourTags`
  returns `null` and nothing is checked at all (silent no-op — the vast
  majority of DETAIL pages).

**Routed entirely through the existing generic tag machinery** rather than a
bespoke check (unlike the song/location/relation checks, which need their own
missing/matched arrays): the tour tag(s) are folded directly into
`computeExpectedTags`'s returned `Set` via its `tourExpectedTags` parameter, so
the existing missing/spurious/passing `Set`-diffing in both
`annotateDetailPageTags` and `addTagsButton` handles rendering (including
multiple simultaneously-expected tour tags) with no new rendering code —
`isManagedTag` just needed to recognize `TOUR_NO_TAG`/`TOUR_TAG_SET` members,
and `spuriousTagMsg`/`passingTagMsg` each gained one optional `tourCheck`
parameter (the full `checkEventTourTags(...)` result) plus a branch: `tour_no`'s
message names the tour(s) it falls within (or, if `tourCheck` is `null` because
the current tag being checked was a leftover/wrong tour tag on a date outside
every known tour, says so); a `tour_xxx` tag's message names its own tour via
`TOUR_DEFINITIONS`, and — when `tourCheck.isTourNo` — mentions the alias (or
"`TOUR_NO_OVERRIDES`") that excluded it instead. Because tour tags render via
the same `.bb-tag-missing`/`.bb-tag-spurious` classes as every other managed
tag, `collectPageWarnings()` picks up any tour-tag issue for the `#page-title`
"N issues found" tooltip automatically.

**Page-title tour name and event alias**: when the event is confirmed a
genuine tour event (not `tour_no`) and matches more than one
`TOUR_DEFINITIONS` entry, `pickMostSpecificTour(tours)` picks the one with
the smallest total day-span across its own ranges (e.g. "Land Of Hope And
Dreams - No Kings", a single ~2-month leg, over the umbrella "Land Of Hope
And Dreams", ~4 months combined across two legs) — a heuristic, not a
guarantee; ties break toward whichever entry appears first in
`TOUR_DEFINITIONS`.

- **DETAIL page** (always on): `runDetailProcessing` calls, in order,
  `addOnstageTagsGlyph` (🏷️, when applicable), `addEventAliasSpan(eventAlias)`
  (when `annotateDetailPageTags`'s returned `eventAlias` is non-null —
  independent of `tourCheck`/`tour_no`, since an event can have an alias
  regardless of whether its date falls within any known tour at all), then
  `addTourNameSpan(tourCheck.mostSpecificTour.name)` (only when
  `!tourCheck.isTourNo`). `addEventAliasSpan` reuses `makeAliasSpan` — the
  exact same `.bb-event-alias` element the YEAR page already shows — but
  DETAIL's `#page-title` `<h1>` renders at a much larger font than the YEAR
  page's event-heading line, so it would otherwise look oversized; a scoped
  `#page-title .bb-event-alias { font-size: 0.6em; }` override (matching
  `.bb-event-type-detail`'s existing proportions) fixes this without
  touching the YEAR page's own (already correctly-sized) usage.
  `.bb-tour-name` carries the same `font-size: 0.6em` directly, plus its own
  distinct color (configurable via `bbp_tour_name_color`, default `#0066cc`)
  so the two are visually distinguishable.
- **YEAR page** (opt-in, `bbp_show_tour_name_on_year_page`, default `false`):
  see [YEAR_PAGE.md](YEAR_PAGE.md)'s "1b. Tour name annotation" for the
  `titleTailAnchor`-chained insertion mechanics. Styled via
  `.bb-year-tour-name` — same italic/bold shape as `.bb-event-alias`, but
  colored to match the DETAIL page's `.bb-tour-name` (via the shared
  `bbp_tour_name_color` setting) instead of the alias's gray
  (`bbp_event_alias_color`), so a tour name reads consistently as a tour name on
  either page. No font-size override, unlike DETAIL's `.bb-tour-name`/
  `#page-title .bb-event-alias` — the YEAR page's event-heading line was
  never oversized to begin with.

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
included, BruceBase's unknown-day-of-month convention), single lowercase
letters (the day-suffix a/b/c/… distinguishing multiple same-day events —
mirrors `isManagedRetailTag`'s identical rule for retail pages), `"9+"`
(the tour-premiere-count tag's one non-numeric value — bare single digits
`1`-`9` are already covered by the day-number rule; see "Tour-premiere-count
tag check" below for how the two are told apart), and `TOUR_NO_TAG`/
`TOUR_TAG_SET` members (see "Tour association tag check" below).

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

- **Live pages** (DETAIL/VENUE/RETAIL/SONG/RELATION): `markPassingTagLinks(links, msgFn, sourceEl)`
  adds the `.bb-tag-ok` class, sets inline `color:#2a2; font-weight:bold`, and
  wires a `mouseenter`/`mouseleave` pair that shows the rich floating tooltip
  (`showOkTooltip`, styled with `.bb-ok`) via `msgFn(tag)`. The optional third
  parameter, `sourceEl`, wires the "tag source highlight" hover feature below.
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

## Tag source highlight (`bbp_enable_tag_source_highlight`, default `false`)

Opt-in (checkbox, "🔍 TAG SOURCE HIGHLIGHT" configSchema section). Started
DETAIL-only (after a broader first attempt covering all five tag-box pages
plus event-name/alias/notes sources broke other DETAIL-page annotations —
see the CHANGELOG's 3.26 entry), was then extended to VENUE/RETAIL/SONG/
RELATION once the DETAIL-only version was confirmed solid (3.28 entry), and
finally upgraded (3.29 entry) so the highlighted source is the *precise
substring* a tag was deduced from wherever one exists, rather than a whole
title/element. When on, hovering a verified (`.bb-tag-ok`) tag whose source
is currently identifiable also draws a green outline box
(`.bb-tag-hover-highlight`) around the tag itself and the same box
(`.bb-tag-source-highlight`) around that source. Deliberately does **not**
switch tabs to reveal a hidden source (e.g. DETAIL's "Setlist" tab, or the
"On Stage"/"In Studio"/"On Audio"/"On Set" first tab) — an earlier version
did this via a click-simulated tab switch, but hovering between tags
belonging to different tabs made the page constantly jump tabs, losing
scroll position/focus; the box on a hidden source now just sits inert in
the DOM until the user switches tabs themselves.

**Precise substring wrapping** (`wrapTextSubstring(parent, substring)`):
finds the first occurrence of `substring` among `parent`'s own *direct*
text-node children (never recursing into child elements) and wraps it in a
new `<span class="bb-tag-source-part">`, via `Text.splitText`. Operating
only on direct text-node children is what makes repeated calls against the
same `parent` safe — once a substring is wrapped, its text is no longer a
text-node child of `parent`, so a later call can't match inside it or
re-wrap it, and a pre-existing sibling element (e.g. `.bb-event-type-detail`,
`.bb-tour-name`) can never be searched into by accident. Multiple substrings
of the same larger text are wrapped **hierarchically**: the containing span
is wrapped first (e.g. the whole `YYYY-MM-DD` date, or a RETAIL release
date's whole `raw` match), then sub-parts are wrapped *within* that
already-created span (year/month/day within the date span; month/day/year
within a specific release date's span) — this both scopes the sub-search
correctly (no risk of e.g. a month number "10" accidentally matching a
street-number-style substring elsewhere in a venue name) and gives the
containing span itself a usable fallback artefact for tags with no more
specific substring (see `usa`/`canada` below).

**Source resolution, per page** (each `annotate*PageTags` builds its own
lookup(s)/wraps only when the setting is on, wrapped in try/catch so a
resolution failure can't break the rest of the tag annotation — including
`computeExpectedRelationNameTags`, whose *result* is load-bearing for the
RELATION page's own tag computation, not just this feature):
- **DETAIL/VENUE — venue/city/state/country location tags**:
  `resolveLocationSourceEl(r, loc, scope, fallbackEl)` maps a
  `checkParsedLocationTags` result's `label` prefix (`"Venue"`, `"Venue
  detail:"`, `"City:"`, `"State:"`, `"Country: ..."`) back to the literal
  substring in `loc` (`parseVenuePageLocation`/`parseEventNameLocation`'s
  return value, re-derived at the call site) and wraps just that — e.g.
  `universityofmichigan` → "University Of Michigan", `annarbor` → "Ann
  Arbor", `michigan(mi)` → "MI". Falls back to `fallbackEl` (the whole
  title on VENUE; the whole venue-string portion of the title on DETAIL,
  see below) for `usa`/`canada` and any `COUNTRY_EXTRA_TAGS` (`"Region:
  ..."`) result — these have no literal substring in the title at all. The
  "At The" venue-name split (`checkVenueNameTag`'s regex) is re-run here to
  wrap each half separately.
- **VENUE/SONG/RETAIL — first-letter tag**: just the title's first
  character, wrapped via `wrapTextSubstring`. On VENUE, nested inside the
  venue-name span when one was created (wrapping the venue name *after* the
  first character was already wrapped separately would fail to find it — no
  longer a contiguous run of plain text), falling back to the whole title
  when the venue tag itself didn't match.
- **DETAIL — the venue portion of the title**: isolated first via
  `venueStringSpan = wrapTextSubstring(h1, textAfterTheDatePrefix)`, then
  the location-tag substrings above are wrapped *within* it (not `h1`
  directly) — this scoping is also what makes `venueStringSpan` itself the
  correct `usa`/`canada`/`"Region: ..."` fallback (the venue portion only,
  not the date).
- **DETAIL — event-type tag** (e.g. `gig`): the existing
  `.bb-event-type-detail` span (`addDetailTitleAnnotation` already appends
  it to `#page-title` *before* `annotateDetailPageTags` runs) — no wrapping
  needed, just a direct element reference.
- **DETAIL — year/month/day/weekday tags**: `eventDate` (`YYYY-MM-DD`) is
  wrapped as a whole first (`dateSpan`), then year/month/day are wrapped
  within it (`dateTagMap`, keyed by tag value — the month *tag* is a name
  like `"october"` but its substring is the numeric `"10"`). A weekday tag
  (e.g. `friday`, checked via `DAY_NAMES.includes(tag)`) highlights the
  whole `dateSpan`, since no weekday name is literally written in the title.
- **DETAIL — `guest`**: the `(Guest)` marker element itself
  (`extractRelations` now also captures `extraEl`/`mExtraEl` alongside the
  existing text-only `extra` field), resolved via `guestElByName` — built
  alongside `relationElByName`, and selected instead of it specifically for
  results where `r.method === 'guest'`.
- **DETAIL — "On Stage"/"In Studio"/"On Audio"/"On Set" relation tags**
  (non-`guest` methods): the matching relation name link(s) in
  `extractRelations(document)` (`relationElByName`), resolved via each
  result's `names: string[]` field (added to
  `checkSingleRelationName`/`checkRelationNameTags`/`checkOnStageRelationTags`
  specifically for this feature) — empty for the tab-wide `'fixed'` method
  (no single relation to point at), one name for a plain match, two for
  `'ampersand-combined'`/multi-name `'guest'`.
- **DETAIL — setlist song tags**: the song's own `<a href="/song:…">` in the
  live Setlist tab, looked up by name (`songAnchorByName`).
- **DETAIL — a tour tag** (e.g. `tour_rvr`): the existing `.bb-tour-name`
  span — but that span doesn't exist yet when `annotateDetailPageTags` runs
  (`addTourNameSpan` is called by the caller, `runDetailProcessing`, *after*
  this function returns, using its `tourCheck` result). So
  `annotateDetailPageTags` instead computes and returns `tourTagAnchors`
  (the `<a>` link(s) for whichever `TOUR_TAG_SET` tag(s) matched), and the
  caller wires `wireTagSourceHighlight` post-hoc, right after
  `addTourNameSpan(...)` runs.
- **DETAIL — `FUZZY_SUBSTRING_TAGS` matches** (alias/notes, e.g. `grammy`,
  `benefit`): `checkAliasSubstringTags`/`checkNotesSubstringTags` now also
  return the specific lowercase `matched` substring (previously computed
  internally but discarded). `wrapFuzzyMatchSubstring(el, matched)`
  re-finds it case-insensitively in `el`'s live text (to recover the
  original casing) and wraps just that word — for alias matches, `el` is
  `findEventAliasElement(document)` (the first tab's `<strong>` header, not
  the `.bb-event-alias` span shown next to the page title, which is just a
  display copy); for notes matches, whichever `findPageNotesSourceElements`
  element actually contains the match.
- **RETAIL — month/day/year tags**: each `parseRetailReleaseDates` entry's
  whole `raw` match (e.g. `"April 18, 2026 (Vinyl)"`) is wrapped first, then
  its `monthRaw`/`dayRaw`/`year` are wrapped *within* that span — `monthRaw`/
  `dayRaw` (added to `parseRetailReleaseDates`'s return alongside the
  existing fields) are the literal, un-normalized regex-group text, since
  the existing `month`/`day` fields are normalized (lowercase name,
  zero-padded) for tag comparison and don't always match the raw text
  verbatim (e.g. day `"08"` vs. raw `"8"`). This correctly distinguishes
  between multiple release dates listed on the same line.
- **RELATION — Bands/Members name tags**: `computeExpectedRelationNameTags()`'s
  `info.links` (the real name link(s) for that specific tag) — heterogeneous
  per tag, so layered on top via a direct `wireTagSourceHighlight` loop
  after the batch `markPassingTagLinks` call, reusing the same `links` the
  adjacent unconditional green-coloring loop already uses.
- **RELATION — the page's own-title letter tag**: (the `letterTag` entries
  inside `computeExpectedRelationNameTags`, for the "Bands" tab's
  surname-first-letter case or the "Members" tab's band-name-first-letter
  case — previously always passed `link: null`) now wraps the title's first
  character via `safeWrapFirstChar`, gated on `doc === document` (this
  function is also called with a detached fetched `Document` for the YEAR
  page's nested Relation Tags button, where wrapping would be pointless).
  Stored in a **separate `highlightSpan` field**, not `links` — an earlier
  version stored it in `links` directly, but that field is also read by
  `annotateRelationPageTags`'s pre-existing unconditional "colorize every
  name link green" loop (`for (const nameLink of info.links)
  nameLink.classList.add('bb-relation-name-ok')`, run whenever the tag is
  simply present — not hover-gated), so the letter span ended up
  permanently green/bold instead of only highlighting on hover. The
  hover-highlight wiring in `annotateRelationPageTags` reads both `links`
  and `highlightSpan`; the colorization loop only ever reads `links`.
- Every other passing-tag call site (generic managed tags with no single
  source on any page; RETAIL's `retail`/letter/`underconstruction`) still
  simply omits `sourceEl`.

**No cache-reload persistence yet**: unlike other listener types in this
file, the `mouseenter`/`mouseleave` pair wired here is not currently restored
after a 📂 Load — a known limitation rather than an oversight.

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
7. Always wraps `.page-tags` in a box, cancelling BruceBase's own
   `.page-tags{clear:both}` (`tagsContainer.style.clear = 'none'`) so the box
   sits flush against the preceding footer instead of leaving a gap sized to
   the floated `#side-bar`: a gold `<div class="bb-tags-warn-box">` if any
   issues were found (missing/spurious tags, unmatched setlist songs,
   unmatched location parts, OR unmatched relations), otherwise a green
   `<div class="bb-tags-box">`.
8. Appends `<span class="bb-tag-spurious">⚠️</span>` after spurious tag links.
9. Appends `<span class="bb-tag-missing">⚠️tag</span>` spans for missing tags,
   one per unmatched setlist song (showing the derived-alias candidate), one
   per unmatched location part, and one per unmatched relation/`"onstage"`
   (each showing the expected slug/candidate tag).
10. Renders any onstage-companion `additionalTags` directly into `.page-tags`
    itself as real-looking `<a href="/system:page-tags/tag/…">` links (class
    `bb-tag-onstage`), then re-sorts the combined tag list alphabetically —
    see "Onstage companion page tags" below.
11. Regroups `.page-tags` into per-first-letter lines (`groupTagsIntoLines` —
    see "Tag line-grouping" below), on **both** the clean-page early-return
    path (step 7's "no issues" case) and the warn-box path — unlike steps
    7-10, this always runs.
12. Returns `{ additionalTags, onstageUrl }` — tags found only on the onstage
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
insert) a `🏷️` `.bb-glyph` span wired via `mouseenter` → `showOnstageTagsTooltip`
(the "genuinely rich" bucket per the native-title-vs-rich-tooltip convention
in [UTILITIES.md](UTILITIES.md)), not a native `title`. `showOnstageTagsTooltip`
groups `additionalTags` by lowercase first character (digit/symbol-led tags
under `"#"`, same convention as `groupTagsIntoLines`) and renders each group
with the same `.bb-tag-group-label` styling used in `.page-tags` itself —
matching how the tags actually look once merged into the page, rather than a
plain comma-joined list. All text renders in the tooltip's normal near-white
color (no `.bb-fail` red wrapper). Two call sites insert it differently:

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

`checkSetlistSongTags(detailSections, actualTags)` first takes the unique
set of raw (unsplit) song strings from `detailSections.flatMap(s =>
s.songs)`. Each raw string is checked against
`SONG_COMBINATION_TAG_OVERRIDES` *before* any splitting — a small,
user-editable, end-user-extensible lookup table (same shape/placement
convention as `SONG_TAG_ALIAS_OVERRIDES`, keyed by the lowercase, trimmed
**full** combination string) for the case where BruceBase tags a whole
medley/tribute combination with one fixed value rather than one tag per
song, e.g. `"LAND OF HOPE AND DREAMS - PEOPLE GET READY"` → `"lohad.pgr"`
(checked as a single unit against that one tag, method `'combination'` —
neither song's own individual tag is expected or checked for this entry).

A raw string with no combination-override entry is split on `" - "` (the
medley/tribute separator also used by `songCompareKey`, e.g. `"LIGHT OF DAY
- HAPPY BIRTHDAY TO YOU"` → two independent songs, each checked and
expected to have its *own* tag: `lightofday` and `happybirthdaytoyou`) —
individual song names are deduplicated across the whole setlist (a song
appearing standalone elsewhere and also as half of an ordinary, non-override
medley is only checked once) — and for each, via `checkOneSongTag(song,
actualTags)`, tries three lookups in order — the first one that matches an
actual tag wins:

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

Result shape: `{ song, matchedTag, method: 'exact'|'alias'|'override'|'combination'|null }[]`.
A matched song's tag is colored green via `markPassingTagLinks`/inline
title-setting (same convention as other passing tags) with a tooltip naming
the song and the method (`songMethodLabel` maps each method to its
human-readable phrase, e.g. `combination` → `"song combination override"`).
An unmatched song is rendered like a missing tag: for a `'combination'`
result, `r.song` is the full unsplit combination string and the shown
candidate/tooltip reference `SONG_COMBINATION_TAG_OVERRIDES` directly (looked
up again by that same string) rather than the derived-alias/exact-match
candidate any other unmatched song shows.

Sibling override tables for other page types (`RELATION_TAG_ALIAS_OVERRIDES`,
`RETAIL_TAG_ALIAS_OVERRIDES`) are not implemented yet. `VENUE_TAG_ALIAS_OVERRIDES`
*is* implemented, but for the location tag check below, not for song tags.

**Opt-in song-name glyph** (`bbp_enable_setlist_tag_warnings`, default off):

| Setting | Type | Default | Effect |
|---|---|---|---|
| `bbp_enable_setlist_tag_warnings` | checkbox | `false` | Shows a ⚠️ warning icon/tooltip (`makeSetlistSongTagWarningGlyph`) directly next to an unmatched setlist song's own name, in addition to the `.bb-tag-missing` entry already appended to `.page-tags` |

Independent of the `.page-tags`-side annotation above, this setting places
the same ⚠️/tooltip right on the song name itself:
- **DETAIL page** (`annotateDetailPageTags`): builds a one-time
  `textContent → <a href="/song:...">` lookup over
  `getSetlistContainer(document)` (only when the setting is on), then for
  each `unmatchedSongs` entry looks up its anchor and appends the glyph via
  `.after(...)`. Runs against the live Setlist tab regardless of which YUI
  tab is currently selected (hidden tabs stay in the DOM).
- **YEAR page** (`processOneYearEvent` → `renderYearSetlist` →
  `renderSetlistElement`): needs no such lookup — `renderSetlistElement`
  already tags every relevant per-song element with a `data-detail-song`
  attribute (`.bb-song-match` as `<a>` or `<span>`, `.bb-song-detail-only`,
  `.bb-song-char-diff`; `.bb-song-year-only` has no `data-detail-song` and is
  correctly skipped, since it has no corresponding DETAIL-page song to
  check). `processOneYearEvent` computes `unmatchedSongNames` (a
  `Set<string>` of lowercased unmatched song names, via
  `checkSetlistSongTags(detailSections, actualTags)` against the same
  fetched `doc` already used for everything else on the event) only when the
  setting is on, and threads it through `renderYearSetlist`/
  `renderSetlistElement`, which does one `querySelectorAll('[data-detail-song]')`
  pass per section right after rebuilding its `innerHTML`.

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

**Venue-detail suppression** (`findVenueDetailExtra`, see also VENUE.md-style
notes in the source near `renderVenueInfo`): when a DETAIL page's venue
string differs from the actual VENUE page title *only* by an extra
descriptive venue-detail segment (e.g. `"Crisler Arena, University Of
Michigan, Ann Arbor, MI"` vs. the venue page's own `"Crisler Arena, Ann
Arbor, MI"`), the resulting `"Venue detail: …"` entry from
`checkEventNameLocationTags` is filtered out of `unmatchedLocations` in both
`annotateDetailPageTags` and `addTagsButton` (via a `venueDetailExtra`
parameter threaded from the venue-name check) — no missing-tag report for a
tag that was never expected to exist. This does *not* apply to
`checkVenuePageLocationTags` — venue detail never appears in a VENUE page's
own title (see `parseVenuePageLocation` below), so there's nothing to
suppress there. See YEAR_PAGE.md / DETAIL_PAGE.md for the matching
`bb-venue-info` (green, informational) glyph this same detection feeds.

`findVenueDetailExtra` also detects a second, unrelated case that feeds the
same glyph but needs *no* tag-report suppression: a trailing show-variant
suffix (`"(Early)"`/`"(Late)"`/`"(Afternoon)"`/`"(Evening)"`) on the DETAIL
page's venue string that the VENUE page naturally never has (e.g.
`"D'Scene, South Amboy, NJ (Late)"` vs. `"D'Scene, South Amboy, NJ"`).
Because `parseEventNameLocation` already strips this exact suffix (see
below) before ever calling `parseLocationParts`, no spurious tag is derived
from it in the first place — `venueDetailExtra` is non-null here purely for
the glyph, and the `r.label === \`Venue detail: ${venueDetailExtra}\`` filter
above never matches it (no `"Venue detail: (Late)"` entry can exist).

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

## "On Stage"/"In Studio"/"On Audio"/"On Set" tab relation tag check (`checkOnStageRelationTags`)

Every relation name listed under a DETAIL page's "On Stage" tab (gig/
rehearsal), "In Studio" tab (recording, audio session), "On Audio" tab
(nogig), or "On Set" tab (recording, video session) should have a
corresponding tag, checked on both `annotateDetailPageTags` (live DETAIL
page) and `addTagsButton` (YEAR page's nested "Tags" button, using the
fetched `doc`). `checkOnStageRelationTags(doc, tabMap, actualTags)` looks up
which of `RELATION_TAB_CONFIGS`'s tab labels (`"On Stage"` → fixed tag
`"onstage"`, `"In Studio"` → fixed tag `"studio"`, `"On Audio"`/`"On Set"` →
no fixed tag) is present in `tabMap` (from `buildTabMap`) and returns `[]`
immediately when none is; otherwise (a page has at most one of these tabs —
it's always tab index 0, see `extractRelations`):

1. **Fixed tag** (optional): when the matched tab's configured `fixedTag` is
   set (`"onstage"` or `"studio"` — `"On Audio"`/`"On Set"` have none), it's
   always expected, independent of any relation — first item in the result,
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
mirroring the setlist-song/location checks (`tabLabel` — `"On Stage"`,
`"In Studio"`, `"On Audio"`, or `"On Set"` — carries which tab produced the
match, for the tooltip text).
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

---

## Fuzzy substring tag check (`checkAliasSubstringTags`, `checkNotesSubstringTags`)

Unlike every other check in this file, this one is **not** tied to any
specific event type or tab — it applies wherever a page has an event alias
and/or a free-text notes preamble at all, checked against **two**
independent sources:

- **Event alias** (see `extractEventAlias`: the `<p><strong>…</strong></p>`
  header immediately followed by `<hr>` as the first two children of
  `#wiki-tab-0-0`, e.g. `"68th Annual Grammy Awards Ceremony"` on a `nogig`
  page's "On Audio" tab, `"Streets Of Minneapolis Recording Session"` on a
  `recording` page's "In Studio" tab, or `"Democracy Now! 30th Anniversary
  Celebration"` on a `gig` page's "On Stage" tab, immediately followed by the
  relation `<ul>`s of who performed).
- **Page notes** (see `extractPageNotesText`, a plain-text wrapper around
  `extractPageNotes` — the free-text preamble inside `#page-content` before
  the first `.yui-navset`, e.g. a notes paragraph mentioning "...the
  twenty-sixth annual Light Of Day Benefit.").

`FUZZY_SUBSTRING_TAGS` (currently `{award: ['award'], grammy: ['grammy'],
private: ['private', 'closed'], benefit: ['benefit'], anniversary:
['anniversary'], interview: ['interview'], funeral: ['funeral']}`) maps
generic tags to the substring(s) that verify them — a substring list need
not equal the tag itself, e.g. "private" is verified by either "private" *or*
"closed" (both imply a non-public event). `checkAliasSubstringTags(alias,
actualTags)` and `checkNotesSubstringTags(notesText, actualTags)` share the
same structure, just sourced differently:

1. Return `[]` immediately when there's no source text (`extractEventAlias`
   returned `null`, or `extractPageNotesText` returned `''`).
2. Otherwise, for each `tag -> substrings` entry in `FUZZY_SUBSTRING_TAGS`,
   check whether the tag is **present** (`isTagPresent(tag, actualTags)`)
   **and** at least one of its `substrings` occurs case-insensitively in the
   source text — e.g. tag `"grammy"` matches alias `"68th Annual Grammy
   Awards Ceremony"`, tag `"award"` matches too (it's a substring of
   `"Awards"`), tag `"private"` matches alias `"Closed Rehearsal"` on a
   `rehearsal` page's "On Stage" tab (via its `"closed"` substring, not the
   tag's own name), and tag `"benefit"` matches a notes paragraph mentioning
   "...Light Of Day Benefit.".
3. Only matching tags are returned, as `{ tag, label, matched }` (`label`
   names *which* source and substring matched for display; `matched` is the
   same substring, lowercase — added for the tag-source-highlight feature's
   `wrapFuzzyMatchSubstring`, see "Tag source highlight" above, so the
   caller doesn't need to re-derive which of a tag's several candidate
   substrings actually hit); there is no "missing" counterpart —
   a tag not in this map, or present but not matching any of its substrings
   in either source, is simply left to whatever other check (or none) already
   governs it. Neither function ever *requires* a tag to exist — both only
   ever *upgrade* an already-present tag to "verified" (green).

Wired into `annotateDetailPageTags`, `annotateVenuePageTags`,
`annotateSongPageTags`, and `annotateRelationPageTags` (via
`extractEventAlias(document)`/`extractPageNotesText(document)` on the live
page) — **not** `annotateRetailPageTags`. Also wired into `addTagsButton`
(YEAR page's nested "Tags" button, alias-check only, via
`extractEventAlias(doc)` — `doc` is the fetched per-event DETAIL page, the
same one `processOneYearEvent` already calls `extractEventAlias` on for the
`.bb-event-alias` span rendered next to the event name). A matched tag is
colored green via `markPassingTagLinks`/inline title-setting with tooltip
*`Tag "private" verified: matches event alias "Closed Rehearsal" (contains
"closed", case-insensitive)`* or *`Tag "benefit" verified: matches page notes
(contains "benefit", case-insensitive)`*. Because neither check ever
contributes a "missing" entry, they also never affect any annotator's
warn-box early-return check or `addTagsButton`'s "N missing" count — they
only participate in the `passing`/green-coloring branch of the existing-tag
loop in each place.

In practice, `extractEventAlias`'s strict shape requirement (a lone
`<p><strong>…</strong></p>` immediately followed by `<hr>` as the first two
children of `#wiki-tab-0-0`) has so far only ever matched on DETAIL pages —
VENUE/SONG/RELATION `#wiki-tab-0-0` content follows different shapes (e.g. a
rehearsal caption or an "Appeared N times..." summary), so the alias-check is
wired into all four for correctness/future-proofing but is a no-op there
today; the notes-check has no such shape restriction and applies equally.

---

## Help-icon tag check (`hasHelpIcon`, `eventHasHelpIcon`)

BruceBase shows a boilerplate call-to-action for missing/incomplete
information: `<img title="Help Us" class="image" src=".../00Help-32.png">`
followed by descriptive text, usually wrapped in `<a href="/Info%20Request">`.
It appears in **two different places**, both of which must be checked:

1. **YEAR page**, in each event's own block of HTML, with generic text
   (*"If you have any information (eg. setlist, memories, ticket stub or
   other images, as applicable) regarding this date please get in
   touch."*) — for events lacking full documentation overall.
2. **DETAIL page**, directly inside a specific tab's own content, with
   text scoped to what that tab is missing (e.g. *"Complete lineup of
   performers is not known. If you have any information or further
   details regarding the musicians onstage for this date please get in
   touch."* inside the "On Stage" tab). Originally assumed to be
   YEAR-page-only (based on a handful of DETAIL pages that happened not to
   have it) until a counter-example turned up — a page whose *only*
   instance of the icon was this DETAIL-page/tab-scoped one, which the
   YEAR-only check couldn't see, producing an incorrectly-spurious
   `"help"` tag with a misleading "...on the YEAR page" tooltip.

When present in *either* place, the `"help"` tag is expected on that
event's DETAIL page. Two helpers detect it, matched to what container is
available at each call site — **both are always checked, ORed together**:

- **`hasHelpIcon(container)`** — `!!container.querySelector('img.image[title="Help Us"]')`.
  For an already-per-event-scoped container, or any single-event document.
  Used with:
  - `section` in `addTagsButton` (the YEAR page's own `.bb-section-processed`
    div for this event, which — per "Each `.bb-section-processed` div wraps
    exactly one event" — never needs boundary logic: any match inside it
    belongs to this event), **and** `doc` (the fetched DETAIL page) in the
    same call, ORed together.
  - `document` (the live DETAIL page) in `annotateDetailPageTags`, ORed with
    its `hasHelp` parameter (see below).
  The icon survives userscript processing unmodified wherever it appears
  (unlike `Photo`/`News`/`Video`/etc. icons, `"Help Us"` isn't in
  `ICON_TITLE_MAP`, so `wireIconHandlers` skips it entirely — no click
  handler, no styling — it's only ever unwrapped from its
  `<a href="/Info%20Request">` parent by the same generic "unwrap real
  navigation `<a>` parents" step every icon gets).
- **`eventHasHelpIcon(eventLinkEl, nextAnchorEl, content)`** — scans a
  multi-event container (`content`) for a match positioned after
  `eventLinkEl` and before `nextAnchorEl` (or to the end of `content` when
  `nextAnchorEl` is `null`), via the same `compareDocumentPosition` boundary
  technique as `collectSetlistElements`. Used in `annotateDetailPageTags`'s
  caller (`runDetailProcessing`) against the fetched YEAR page's full
  `#page-content` (`yearContent`) — the DETAIL-page-side check
  (`hasHelpIcon(document)`) happens separately, inside
  `annotateDetailPageTags` itself. `nextAnchor` (previously computed after
  the `annotateDetailPageTags` call) was moved earlier so it's available in
  time for this check.

`"help"` was added to `MANAGED_CONTENT_TAGS` (so `isManagedTag`/the generic
spurious-orange and passing-green branches apply to it like any other
managed tag) with matching `SPURIOUS_TAG_REASONS`/`PASSING_TAG_REASONS`
entries (mentioning both possible locations). `computeExpectedTags` takes a
new optional `hasHelp` boolean argument; when true, `expected.add('help')`.

---

## Tag line-grouping (`groupTagsIntoLines`)

BruceBase's raw `.page-tags` markup, plus everything every check above adds
to it, renders as one long unbroken line — hard to scan on events with many
tags. `groupTagsIntoLines(tagsContainer)` is a final DOM-reorganization pass,
called (in both the match and mismatch branches) by all five live-page
annotators — `annotateDetailPageTags`, `annotateVenuePageTags`,
`annotateRetailPageTags`, `annotateSongPageTags`, and
`annotateRelationPageTags` — that reflows `.page-tags`' `<span>` into
multiple lines, one per group of tags sharing the same lowercase first
character (the YEAR page's nested "Tags" button already renders one `<li>`
per tag, see "YEAR page Tags button" above, so it doesn't need this):

1. Reads `[...span.children]` (element children only — skips the
   whitespace text nodes already present in BruceBase's markup).
2. Walks them building "items": a plain `<a>` or `.bb-tag-onstage` `<a>`
   starts a new item; an immediately-following `.bb-tag-spurious` `<span>`
   (BruceBase's ⚠️ icon, always inserted via `a.after(warnSpan)` — see step
   8 above — so it's guaranteed adjacent) is absorbed into that same item so
   the icon stays next to its tag. A standalone `.bb-tag-missing` `<span>`
   (text `" ⚠️tagname"`, no `<a>` — nothing exists to link to) is its own
   item.
3. Each item's group key is its tag text's lowercase first character —
   stripping the `"⚠️"` prefix first for `.bb-tag-missing` items — or `"#"`
   for anything not `a`-`z` (i.e. the digit-led tags like `"17"`/`"2026"`).
4. Stable-sorts items by key (`"#"` sorts before letters, matching
   BruceBase's own convention of digit tags first). Ties keep their
   original DOM order — since real `<a>` tags were already alphabetically
   sorted going in, but `.bb-tag-missing` items were appended at the very
   end regardless of alphabetical position (steps 9 above), this sort has a
   useful side effect: a missing tag now lands in its correct letter group
   instead of trailing after every real tag (e.g. a missing `"memorabilia"`
   now sits right after the real `"memorbilia"` tag in the `M` group,
   instead of stranded at the very end of the list).
5. Clears `span` and rebuilds it: one `<div class="bb-tag-group-line">` per
   distinct key, each starting with a `<span class="bb-tag-group-label">`
   showing the uppercased key, followed by that group's items in order.

**"⇄ Original Page" compatibility**: unlike every other tag decoration in
this file (which are pure CSS/attribute annotations left in place, just
hidden via `.bb-original-view`), this pass restructures the DOM itself —
wrapping tags in per-letter `<div>`s can't be un-wrapped by a `display:none`
without also hiding the tags inside. Instead, `.bb-original-view
.bb-tag-group-line { display: contents; }` makes the wrapper divs invisible
*to layout only* (their children keep flowing inline as before) while
`.bb-original-view .bb-tag-group-label { display: none; }` hides the
letter labels — together reproducing BruceBase's original single-line flow
without needing to reverse the DOM restructuring.

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
| `.bb-tags-warn-box` | Gold border, #fffbe6 background wrapper around `.page-tags` when issues found; reset to invisible in `.bb-original-view` |
| `.bb-tags-box` | Green (`#2a2`) border, #fffbe6 background wrapper around `.page-tags` when no issues found; reset to invisible in `.bb-original-view` |
| `.bb-tag-group-line` | Block-level wrapper for one first-letter group of tags (see "Tag line-grouping"); `display: contents` in `.bb-original-view` |
| `.bb-tag-group-label` | Small bold gray letter label prefixing each `.bb-tag-group-line`; hidden in `.bb-original-view` |
