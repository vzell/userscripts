# SETLIST.md — Setlist Parsing, Diff, and Rendering

## Data types

```
Section = {
  label:           string,        // 'show' | 'recording' | 'Soundcheck' | custom
  songs:           string[],      // cleaned song names (compareKeys)
  rawSongs:        string[],      // original text before cleanSongName
  sourceEl:        Element,       // <p> or <blockquote> on YEAR page
  songUrls?:       (string|null)[], // /song:… href per song (detail only)
  paragraphBased?: boolean,       // true when songs came from bare <p> (old pages)
  hasExplicitLabel?: boolean,     // true when label set by <p><strong>…</strong></p>
  detailLabel?:    string | null | false  // sentinel for label mismatch rendering
}

DiffItem = {
  type:         'match' | 'year-only' | 'detail-only' | 'char-diff',
  yearSong?:    string,   // cleaned YEAR song name
  detailSong?:  string,   // cleaned DETAIL song name
  rawYearSong?: string,   // original YEAR page text (before cleanSongName)
  paragraphBased?: boolean,
  detailSongUrl?:  string | null  // /song:… href from DETAIL page
}
```

---

## `parseYearSetlist(setlistEls)` — YEAR page setlist

Iterates `setlistEls` (`<p>` and `<blockquote>` elements):

- `<blockquote>` → `label = 'recording'`; reads inner `<p>` text.
- `<p>` starting with `Label:` → `label = m[1].trim()` (original case preserved);
  label must not end with a digit (to avoid `"3:07"` being parsed as a label).
- Plain `<p>` → `label = 'show'`.
- `<sup><em>` footnote nodes are excluded via `textWithoutSup`.
- Songs are split on ` / `, then filtered through `songCompareKey`:
  - `cleanSongName(raw)` strips any `(…)` with a lowercase letter.
  - If the clean result still has lowercase (e.g. `, and/or`), the alternative
    form `"SONG A, SONG B, and/or SONG C"` is normalised to `"SONG A - SONG B - SONG C"`.
  - Entries whose compareKey contains a run of 2+ lowercase chars are rejected
    (prose lines) — isolated `"c"` in names like `"McGRATH"` is acceptable.

---

## `parseDetailSetlist(doc)` — DETAIL page setlist

Reads `getSetlistContainer(doc)` (three-level fallback: `#wiki-tab-0-1 td` →
`#wiki-tab-0-1` → `#page-content`).

**Three layouts handled:**

**(a) Standard** — `<p><strong>Label</strong></p>` sets section label;
`<ol>`/`<ul>` produce songs from `<a href="/song:…">` text. Medleys (multiple
links in one `<li>`) are joined with ` - ` and get `url = null`.

**(b) Extended label** — `<p>` with `<strong>` and additional `<span>` children
(e.g. `"Pre-show (solo acoustic)"`) — full text used as label.

**(c) Paragraph-based** (old pages, e.g. 1974) — songs in bare
`<p><a href="/song:…">NAME</a></p>` elements, accumulated via `flushPending()`.
Sections carry `paragraphBased: true`.

**(d) Nested fallback** — if no songs from direct children, widens to
`td.querySelectorAll('ol, ul')`.

Each section carries `hasExplicitLabel: boolean` (reset to `false` after each
push so a header does not propagate to the next list) and
`songUrls: (string|null)[]`.

---

## `cleanSongName(text)`

Strips any `(…)` parenthetical whose content contains at least one lowercase
letter:
- `(with James Maddock)`, `(x3)`, `(parts)`, `(acoustic)` → stripped
- `(41 SHOTS)`, `(COME OUT TONIGHT)`, `(BADLANDS)` → preserved (all-caps)

Qualifiers stripped by `cleanSongName` are not lost: `rawSongs` in each
`Section` carries the original text. When rendering a `match`, the portion
after the clean name (e.g. ` (parts)`, ` (with Willie Nile)`) is appended
as plain unstyled text outside the coloured span.

---

## `lcsDiff(yearSongs, detailSongs)`

Standard O(mn) LCS producing `match` / `year-only` / `detail-only` items.

## `mergeCharDiffs(items)`

Adjacent `year-only` + `detail-only` pairs are merged into `char-diff` when
the Levenshtein distance is small relative to length (roughly ≤ 30% edit
distance). Uses `editDistance(a, b)` (standard O(mn) Levenshtein).

---

## Section label sentinel values (`detailLabel`)

Set on each `yearSection` before rendering:

| Value | Meaning |
|---|---|
| `string` | Positionally-matched DETAIL section label (original case) |
| `null` | YEAR section has no counterpart in the DETAIL sections array |
| `false` | DETAIL exists but ALL sections have `hasExplicitLabel: false` AND YEAR has at least one non-show/non-recording section |

---

## Setlist colour coding

### On the YEAR page (`renderYearSetlist` / `renderSetlistElement`)

| CSS class | Meaning | Visual |
|---|---|---|
| `.bb-song-match` | Same in both — on `<a>` if DETAIL has `/song:` URL, else `<span>` | Green text; link underline on hover |
| `.bb-song-year-only` | In YEAR, not DETAIL | Light-blue background |
| `.bb-song-detail-only` | In DETAIL, not YEAR (inserted) | Yellow background |
| `.bb-song-char-diff` | Similar but slightly different | Char-level red/green |
| `.bb-char-match` | Matching char within char-diff | Green |
| `.bb-char-diff` | Differing char | Red bold |
| `.bb-para-warn` | Song in `<p>` format (old page) or section label issue | ⚠️ cursor:help |
| `.bb-section-label` | Non-show, non-recording section label prefix | Spans inserted by `renderSetlistElement` |
| `.bb-section-label-warn` | Section label with mismatch warning | Combined with `.bb-para-warn` |
| `.bb-anchor-warn` | Anchor/date/year mismatch | ⚠️ cursor:help |
| `.bb-sep` | Song separator rendered as ` / ` | `.bb-sep` class; used by list-view builder to split songs |

### On the DETAIL page

Same colour classes applied to `<li>` / `<p>` / `<a>` elements:
- `match` → `.bb-song-match` on each `<a href="/song:">` (or the `<li>` itself).
- `detail-only` → `.bb-song-detail-only` on the existing element.
- `char-diff` → `.bb-song-char-diff` + `buildCharDiffHtml` replaces `<a>` innerHTML.
- `year-only` → new `<li>` or `<p>` inserted with `.bb-song-year-only`.

After all items are inserted, `renderDetailSetlist` sets explicit `value`
attributes on every non-year-only `<li>` inside each `<ol>`. This prevents
year-only items (which use `list-style-type: disc`) from consuming a counter
slot in the ordered list, so subsequent songs are numbered correctly regardless
of browser CSS counter behaviour.

---

## Song number rendering (flat view)

`renderSetlistElement` prepends a number or bullet before each song.
`songNum` is incremented only for non-`detail-only` items (detail-only songs do
not exist on the YEAR page and must not consume a counter slot).

- `detail-only` → `<a href="/song:…" class="bb-song-num" data-sn="…">•</a>`
  (bullet, still hyperlinked with the same click handler).
- All other types with a known song URL → `<a … class="bb-song-num">N.</a>`.
- No URL available → `<span class="bb-song-num-plain">N.</span>`.

Clicking a `bb-song-num` link calls
`fetchAndToggleSongTabRow(songHref, songName, section, numLink)`:
- Fetches the `/song:…` page.
- Builds a `<div class="bb-song-tab-row">` with buttons for each non-empty tab
  on the song page (using the same `buildIconPanel` infrastructure).
- Toggles the row open/closed on repeated clicks; the `numLink` gains/loses
  `.bb-icon-active`.

The same rule applies in `buildListDiv` (list view): `detail-only` groups are
detected before stripping `bb-song-num` elements (to preserve the song href),
receive a `•` prefix, and do not increment `itemNum`.

---

## Relation participant elements

Injected by `injectEventRelations` (called from `processOneYearEvent`) into
`processedDiv` immediately before each eligible setlist `<p>` element.
`injectEventRelations` excludes `'setlist'` preview sections (case d) and
`'soundcheck'` sections, falling back to soundcheck-inclusive if no show
sections exist.

| CSS class | Role |
|---|---|
| `.bb-relations-flat` | Flat one-liner `<p>` visible in flat/original views |
| `.bb-relations-list` | Nested `<div>` with "Relations:" label + `<ul>`; visible only in list view |
| `ul.bb-relations-list-ul` | Nested `<ul>` inside the list-view div; top-level and member lists |
| `.bb-rel-bullet.bb-rel-main` | `•` `<span>` for top-level artists/bands — click opens Relation: tab row |
| `.bb-rel-bullet.bb-rel-member` | `◦` `<span>` for band members — click opens Relation: tab row |
| `.bb-rel-name` | `<a href>` link on the name text — navigates to the relation page |
| `.bb-rel-extra` | Extra annotation inline after name, e.g. `(Guest)` |
| `.bb-rel-loading` | Added to bullet while the relation page is being fetched |
| `.bb-relation-tab-row` | Container row appended to `section` by `addRelationTabButtons` |
| `.bb-relation-tab-btn` | Button per relation-page tab in the tab row |

Bullet click handling is wired in `injectEventRelations` immediately after
injection. Clicks call `fetchAndToggleRelationTabRow(relHref, relName, section,
bullet)` which fetches the relation page on first click and builds
`.bb-relation-tab-row` (via `addRelationTabButtons`), caching the row on
`section._bbRelRows` (keyed by `relHref`) for subsequent toggle clicks.

The `showView()` closure in both `insertSectionToggle` and
`rewireSectionControls` queries `.bb-relations-flat` and `.bb-relations-list`
at toggle-click time (lazy, via `processedDiv.querySelectorAll`) to switch
between the two representations alongside the setlist toggle.
`.bb-relations-flat` elements are excluded from `setlistEls` detection so that
`buildListDiv` does not process them as song sections.

---

## Footnote preservation

`<sup>` nodes (e.g. "Setlist incomplete.") are cloned out before any
`innerHTML` replacement, then re-appended after a `<br>` at the end of the
rendered element.
