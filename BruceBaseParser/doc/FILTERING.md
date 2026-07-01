# FILTERING.md — Event Text Filter Bar

## Overview

A filter bar is rendered as a second row inside `#bb-sticky-bar`, directly after `#bb-controls`,
on YEAR, LIST, and HOME pages. It allows the user to search events by name (or full content) with
composable case, regex, and exclude modes. The text filter is composable with the existing mismatch
toggle — both can be active simultaneously and are applied in a single DOM pass per event.

---

## Layout

```
[count]  [input field                ×]  [Cc] [Rx] [Ex]  |  [Ev]
```

| Element | ID / Class | Description |
|---|---|---|
| Count | `#bb-filter-count` | Live "N / M events" counter |
| Input wrapper | `#bb-filter-input-wrap` | Flex container for input + × button |
| Text input | `#bb-filter-input` | Filter query; monospace font |
| Clear button | `#bb-filter-clear` | `×`; visible only when input is non-empty |
| Case-sensitive | `#bb-filter-cc` label | `Cc` checkbox |
| Regex mode | `#bb-filter-rx` label | `Rx` checkbox |
| Exclude mode | `#bb-filter-ex` label | `Ex` checkbox |
| Separator | `.bb-filter-sep` | Visual `|` divider; no tooltip |
| Full-text mode | `#bb-filter-ev` label | `Ev` checkbox |

Filter bar is inserted **before** `#bb-pre-events` on YEAR (so it stays above the year heading),
and **appended** to `#bb-sticky-bar` on HOME and LIST (which have no `#bb-pre-events`).

---

## Checkbox Semantics

### Cc — Case-sensitive matching
Off by default. When off, matching is case-insensitive (for both literal and regex modes).

### Rx — Regular expression mode
The input is compiled as a `RegExp`. Invalid regexes fail silently — matcher returns `false` for
all events (shows 0 results, no crash). Applies `i` flag when `Cc` is off.

### Ex — Exclude mode
Inverts the match: shows events that do NOT match the query. Highlighting is disabled in this mode
(non-matching visible events have no highlight to add). Compose with `Rx` and `Cc` freely.

### Ev — Full-text mode
Widens the search scope to the entire rendered section:
- **YEAR page**: matches against `processedDiv.textContent` (event name, type/alias spans, setlist, button labels, all inline text).
- **LIST page**: matches against `rawName` (full link-line text) plus the `<em>` suffix (e.g. `(Rehearsal)`).
- **HOME page (year mode)**: matches against `sec.textContent` (entire rendered section).
- **HOME page (list mode)**: matches against the list row's full text content.

When `Ev` is active, **all occurrences** across the full section are highlighted via
`highlightSectionContent` (text-node walking). When `Ev` is off, see Non-Ev scope below.

### Non-Ev matching scope (Ev unchecked)

The search is narrowed to the event's identifying text row:

- **YEAR page / HOME (year mode)**: event name link text + `.bb-event-type` sibling span text + `.bb-event-alias` sibling span text. Searching `rehearsal` or an alias name works without enabling `Ev`.
- **LIST page / HOME (list mode)**: stripped event name link text + `<em>` sibling text (event-type suffix such as `(Rehearsal)`).

All elements that contribute to the non-Ev match are also individually highlighted when matched
(see Highlighting section).

---

## Escape Key Behaviour

While the filter input has focus:
- **First Escape** (input non-empty): clears the filter field and fires `onChange` with an empty
  query, restoring all events. The cursor stays in the input.
- **Second Escape** (input already empty): blurs the input (removes focus).

`preventDefault()` + `stopPropagation()` are called in both cases to avoid browser shortcut
conflicts.

---

## `buildFilterMatcher(query, options)` Contract

```js
buildFilterMatcher(query, options) → function(text: string): boolean | null
```

- Returns `null` when `query.trim()` is empty → no text filter active.
- Returns `() => false` when `Rx` is checked and the regex is invalid.
- Returns a predicate that already accounts for `Cc` and `Ex`.
- The returned function is stateless and can be called multiple times.

`buildHighlightRegex(query, options)` is a companion that returns a global `RegExp` (for exec
loops in highlighting). It returns `null` for empty query or invalid regex.

---

## Composability with the Issues Filter

Each page maintains a plain `filterState` object shared between the issues toggle and the text
filter bar:

```js
const filterState = {
    mismatchActive: false,  // controlled by issues button (⚡ Issues)
    textMatcher:    null,   // compiled by buildFilterMatcher(); null = inactive
    filterQuery:    '',     // raw string used by highlightEventName / highlightSectionContent
    filterOptions:  { caseSensitive, useRegex, exclude, fullText },
};
```

Both the issues button and the filter bar's `onChange` update `filterState` and then call the
same `applyFn` closure, which performs a **single DOM pass** checking all conditions per event:

```
Issues button click     →  filterState.mismatchActive = …  →  applyFn()
Filter bar onChange    →  filterState.textMatcher = …     →  applyFn()
```

A section is hidden when it fails **any** active filter condition.

---

## Per-Page Integration

### YEAR page

- `createFilterBar('year')` called at page load (synchronously after `setupStickyBar`).
- `setupStickyBar` now returns the `stickyBar` element (previously returned nothing).
- Filter bar inserted before `#bb-pre-events` inside `#bb-sticky-bar`.
- `yearFilterState` declared before `yearStartBtn.addEventListener`.
- `yearApplyFn` and `setupYearTextFilter` called inside the `yearStartBtn` handler after processing
  completes. Rebinding happens each run so `yearApplyFn` always closes over the fresh `currentEvents`.
- **Re-run behaviour**: `clearAllHighlights(content)` and `yearFilterState.mismatchActive = false`
  are called at the start of each restart. The text query/options are preserved — the user's filter
  stays active across re-runs.

### LIST page

- `createFilterBar('list')` called at page load, appended to `#bb-sticky-bar` before DOM insertion
  so the height measurement at the end of the list page setup includes the filter bar.
- `listFilterState` and `listApplyFn` created after processing completes.
- `setupListMismatchFilter` and `setupListTextFilter` are called with the shared state.
- `listApplyFn()` is called once immediately after wiring to sync the initial state.

### HOME page

- `createFilterBar('home')` called synchronously at page load; `requestAnimationFrame` defers
  height measurement until after all sync code, so the filter bar height is captured.
- `homeFilterState` declared once; persists across fetches (text query/options survive re-fetch).
- `homeFilterState.mismatchActive = false` and `homeFilterState.applyFn = null` are reset at the
  start of each `runFetch` call.
- `homeFilterState.applyFn` is rebuilt after each fetch (bound to the current `resultsEl` content).
- `homeFilterBar.setCount(0)` and `setTotal(0)` are also called during teardown.

---

## Highlighting

### Default mode (Ev off) — `highlightEventName`

`highlightEventName(el, query, options)` is called once per highlighted element:

- Stores `el.innerHTML` in `data-bb-filter-original` (only on first call; never overwritten while active).
- Reads `textContent` for match positions, builds replacement HTML using `esc()` for safety,
  inserts `<mark class="bb-filter-match">` around each match.
- Restored via `clearEventNameHighlight(el)`: reads the attribute, restores `innerHTML`, deletes the attribute.
- No-op when the query is empty or in exclude mode.

Which elements are highlighted per page:

| Page | Elements highlighted |
|---|---|
| YEAR | `<a>` event name link, `.bb-event-type` span, `.bb-event-alias` span |
| LIST | `<a>` event name link, `<em>` suffix element |
| HOME (year mode) | `highlightSectionContent` used — entire section (see Ev mode) |
| HOME (list mode) | `<a>` event name link, `<em>` suffix element |

All potentially highlighted elements are explicitly cleared (`clearEventNameHighlight`) at the
start of each filter pass before re-evaluation, preventing stacked `<mark>` elements.

### Ev mode — `highlightSectionContent`

- Uses `document.createTreeWalker(container, NodeFilter.SHOW_TEXT, ...)` to collect all text
  nodes, skipping `SCRIPT`, `STYLE`, and `MARK` parents.
- For each matching text node: builds a `DocumentFragment` of plain text and `<mark>` nodes,
  then replaces the original text node with `replaceChild(frag, textNode)`.
- No `innerHTML` manipulation — event listeners on sibling or parent elements are fully preserved.
- Cleared via `clearSectionHighlights(container)`: replaces all `<mark class="bb-filter-match">`
  elements with their `textContent`, then calls `container.normalize()` to merge adjacent text nodes.

### Restore invariant

Every call to `applyYearFilters` / `applyListFilters` / `applyHomeFilters` unconditionally clears
all highlights on each event before re-evaluating visibility. This prevents stacked or duplicated
`<mark>` elements across repeated filter changes.

---

## Interaction with the ⇄ Original Page Toggle

On YEAR page restart (user clicks ▶ Start again), the `yearStartBtn` handler calls
`clearAllHighlights(content)` before the section HTML reset. The per-section restore
(`sec.processedDiv.innerHTML = sec.sectionOriginalHtml`) then replaces all section content anyway,
which would wipe any remaining `<mark>` elements or `data-bb-filter-original` attributes inside
sections. The explicit `clearAllHighlights` call handles edge cases outside sections.

`applyYearFilters` is re-called after processing completes, applying any active text filter to
the new `currentEvents` array.

---

## SmartTable Interaction

The filter bar operates on `.bb-section-processed` divs and list-link `<a>` elements — not on
SmartTable rows. The SmartTable has its own column filters which are independent. SmartTable
does not re-render in response to the filter bar.

**Known limitation**: highlights added to event name links or section text nodes are not reflected
in SmartTable cell content (which was extracted from the DOM before the filter ran).

---

## `loadPageCache` Compatibility

`setupMismatchFilter` and `setupListMismatchFilter` accept optional `state` and `applyFn` params
(defaulting to `null`). When called by `loadPageCache` without these params, they fall back to
the original `applyMismatchFilter` behaviour.

The filter bar is present in the DOM on cache-loaded pages (it was rendered at page load), but it
is **not wired** to event data after a cache load — the filter input does nothing until the user
clicks ▶ Start. This limitation is acceptable for the cache-load path.

---

## Key CSS Classes and IDs

| Selector | Purpose |
|---|---|
| `#bb-filter-bar` | Outer flex row; second row in `#bb-sticky-bar` |
| `#bb-filter-count` | Live "N / M events" span; bold, 1.05em monospace; tooltip: "Visible events / total events on this page" |
| `#bb-filter-input-wrap` | Input + clear button flex wrapper |
| `#bb-filter-input` | Text input |
| `#bb-filter-clear` | `×` clear button; `.visible` class shows it |
| `.bb-filter-cb-label` | Label wrapping each checkbox |
| `.bb-filter-sep` | `|` separator span |
| `mark.bb-filter-match` | Yellow highlight mark; `background: #ffe066` |
