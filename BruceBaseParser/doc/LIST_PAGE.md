# LIST_PAGE.md — YEAR LIST Page Mode (`runListPage`)

Pages like `/2024-list` and `/1949-64-list` contain links of the form
`/2024#DDMMYY` pointing to anchors on the YEAR page.

---

## Processing pipeline

1. Snapshot `#page-content.innerHTML` as `originalHtml` (for Global toggle / Save).
2. `extractListPageEvents(year)` — scans `#page-content a[href]` for links
   matching `LIST_LINK_RE = /\/((?:\d{4}|1949-64))#([a-zA-Z0-9]+)$/`.
   - `hrefYear` (the year in the href path) and `anchor` (the fragment) are
     extracted from each link.
   - Cross-year hrefs (`hrefYear !== pageYear`) are **not** filtered out —
     all matches are returned. `hrefYear` is stored in the event record.
   - `getLinkLineText(a)` captures sibling text nodes after `<a>` so that
     suffixes like `"(Golden Globe Awards)"` are included.
   - `stripListSuffix(rawName)` strips an optional trailing `(…)` from the
     raw name before comparison.
3. Build `#bb-btn-container` with: Global toggle (disabled), Mismatch filter
   (disabled), Save, Load buttons.
4. `setupStickyBar(content, pageTitle, controlsEl)`.
5. Fetch the YEAR page once.
6. `buildAnchorToNameMap(yearDoc)` — pairs each `<a name="…">` on the YEAR
   page with the first following event-link text using `compareDocumentPosition`.
7. For each list event: `processOneListEvent(event, anchorMap, pageYear)`.
8. After all events:
   - Enable Global toggle and wire `setupGlobalToggle`.
   - Enable Mismatch filter and wire `setupListMismatchFilter`.
   - Enable Save button.
   - Render SmartTable if available (using `LIST_SMARTTABLE_COLUMNS`).

---

## `processOneListEvent(event, anchorMap, pageYear)`

### Cross-year events (`hrefYear !== pageYear`)

Immediately calls `addWarningGlyph(element, msg)` and returns. The anchor map
is built for `pageYear`, so no name comparison is possible.

### Same-year events

1. Looks up `anchorMap.get(anchor)` — the YEAR page event name for this anchor.
2. Compares `strippedName.toUpperCase() === yearName.toUpperCase()`.
3. Appends ✅ or ❌ glyph via `addListGlyph`; hover shows `showListTooltip`
   with both names and a token-level diff.
4. Runs anchor/date checks (see [ANCHORS.md](ANCHORS.md)):
   - `dateToAnchor` check: `anchor.startsWith(dateToAnchor(eventDate))`.
   - Href-year check: `hrefYear` matches the date year (via `yearMatchesHrefSlug`).
   - Issues appended as `<span class="bb-anchor-warn">⚠️</span>` after the glyph.

---

## SmartTable (`extractListSmartTableRows`)

| Column | Source |
|---|---|
| `date` | Leading `YYYY-MM-DD` in link text |
| `event` | Link text with date prefix stripped |
| `status` | Text of next `.bb-glyph` sibling |
| `url` | `element.href` |

Columns defined in `LIST_SMARTTABLE_COLUMNS`:
`date` (105px), `status` (60px, not sortable), `event` (flexible), `url` (Link,
renders as `<a target="_blank">`).

---

## Mismatch filter (`setupListMismatchFilter`)

Unlike the YEAR page, list events are plain `<a>` elements rather than
`.bb-section-processed` wrappers. The filter hides/shows the nearest block
ancestor (`li`, `tr`, or `parentNode`) of each event link. Count is computed
once at setup time and embedded in the button label.
