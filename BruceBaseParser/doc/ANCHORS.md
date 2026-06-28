# ANCHORS.md — Anchor and Date Consistency Checks

## Anchor format

Named anchors on YEAR pages use `DDMMYY` order:
- `<a name="140903">` = September 14, 2003
- `<a name="070124">` = January 7, 2024

Multi-event days (or events with unknown day numbers) carry a letter suffix:
- `<a name="150571a">` = first event on May 15, 1971
- `<a name="000568a">` = first event in May 1968 (day unknown)

The DETAIL page URL may **not** carry the letter suffix
(`/gig:1971-05-15-newark-state-college-union-nj` for anchor `150571a`), which
is why `runDetailPage` locates the event link by `href` match rather than by
deriving the anchor name from the URL.

---

## `dateToAnchor(dateStr)`

Converts `"YYYY-MM-DD"` → `"DDMMYY"` (last two digits of year):

```
"2026-01-17"  →  "170126"
"1977-02-17"  →  "170277"
```

Returns `null` for invalid input. The check uses `startsWith` to allow letter
disambiguation suffixes (`"170277a"`).

---

## Three checks run in both contexts

1. **Anchor fragment match** — `yearAnchorName === detailAnchorRef` (exact string).
2. **DateToAnchor match** — `yearAnchorName.startsWith(dateToAnchor(eventDate))`.
3. **Href year match** — 4-digit year in the "Info & Setlist" href path (e.g.
   `/1977#…`) must equal the 4-digit year in the event date, using
   `yearMatchesHrefSlug(dateYear, hrefYear)` (which handles the `1949-64`
   consolidated slug: years 1949–1964 are accepted for that slug).

---

## Where applied

| Page | Triggered by | Failure annotation |
|---|---|---|
| YEAR page | `checkYearAnchorConsistency(detailDoc, anchorName, anchorEl, eventDate)` after detail fetch | `addAnchorWarnYear(anchorEl, …)` inserts `<span class="bb-anchor-warn">⚠️</span>` immediately after `<a name>` |
| DETAIL page | Anchor block in `runDetailPage` | `addAnchorWarnDetail(infoLink, …)` appends `<span class="bb-anchor-warn"> ⚠️</span>` after "Info & Setlist" link; `addAnchorMatchDetail(infoLink, …)` appends `<span class="bb-anchor-match"> ✅</span>` on success |
| LIST page | `processOneListEvent` — direct check without fetching | `addWarningGlyph` ⚠️ for cross-year hrefs; `bb-anchor-warn` span after ✅/❌ glyph for same-year anchor issues |

---

## `findInfoSetlistLink(doc)`

Returns the first `<a href>` whose `href` matches
`INFO_SETLIST_HREF_RE = /^\/[\d][\w-]*#([a-zA-Z0-9]+)$/` AND whose text
contains `"info"` (case-insensitive). This targets the
`<a href="/1977#ANCHOR">Info & Setlist</a>` back-link on detail pages.

---

## LIST page cross-year handling

`extractListPageEvents` does **not** filter out cross-year hrefs
(`hrefYear !== pageYear`). All matching hrefs are extracted; `hrefYear` is
stored in the event record.

In `processOneListEvent(event, anchorMap, pageYear)`:
- **Cross-year** (`hrefYear !== pageYear`): immediately flags with
  `addWarningGlyph`; skips name comparison.
- **Same-year**: runs name comparison, then appends `bb-anchor-warn` span if
  either DateToAnchor or href-year check fails.

---

## CSS classes (anchor feature)

| CSS class | Purpose |
|---|---|
| `.bb-anchor-warn` | ⚠️ cursor:help; hover shows `issues[]` joined by newlines |
| `.bb-anchor-match` | ✅ cursor:help; hover shows passed checks |
