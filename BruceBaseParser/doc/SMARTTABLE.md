# SMARTTABLE.md — SmartTable Integration

## Overview

SmartTable is an optional external dependency loaded via `@require`. When both
`SmartTable` and `BrucebaseAdapter` are available at runtime, sortable and
filterable data tables are rendered alongside the standard annotated view.

All SmartTable call-sites guard with `typeof SmartTable !== 'undefined'` before
proceeding.

---

## YEAR page SmartTable

`BrucebaseAdapter.extract()` is called **before** `wrapYearSections()` because
the adapter's internal `_splitOnHr()` iterates `content.children` looking for
`<hr>` direct children that `wrapYearSections` will later move.

```javascript
const HAS_ST = typeof SmartTable !== 'undefined' && typeof BrucebaseAdapter !== 'undefined';
const stRows = HAS_ST ? BrucebaseAdapter.extract() : null;
```

After extracting rows, a `<div id="bb-smarttable-host">` is inserted before
`#page-content`, and `SmartTable.render(…)` is called with:
- `columns: BrucebaseAdapter.columnDefs`
- `rows: stRows`
- `options: { stickyOffset: 'calc(var(--bb-header-h) + var(--bb-sticky-bar-h))' }`

The SmartTable trigger button (`.st-btn-trigger`) is moved from `stHost` into
`#bb-btn-container` so it appears in the script's sticky bar.

---

## LIST page SmartTable

Built after `processOneListEvent` runs for all events (glyphs already in DOM).

Columns defined in `LIST_SMARTTABLE_COLUMNS`:

| Key | Label | Type | Width | Notes |
|---|---|---|---|---|
| `date` | Date | date | 105px | |
| `status` | Status | string | 60px | Not sortable |
| `event` | Event | string | flexible | |
| `url` | Link | string | — | Not sortable, not filterable; renders as `<a target="_blank">` |

Rows built by `extractListSmartTableRows(listEvents)`:
- `date`: leading `YYYY-MM-DD` from link text.
- `event`: link text with date prefix stripped.
- `status`: text of next `.bb-glyph` sibling, or `''`.
- `url`: `element.href`.

---

## HOME page SmartTable

Built after each fetch completes (`runFetch`). Uses `HOME_SMARTTABLE_COLUMNS`:

| Key | Label | Type | Width | Notes |
|---|---|---|---|---|
| `year` | Year | number | 58px | |
| `date` | Date | date | 105px | |
| `status` | Status | string | 60px | Not sortable |
| `event` | Event | string | flexible | |
| `url` | Link | string | — | Not sortable, not filterable |

Rows built by `extractHomeSmartTableRows(resultsEl)`. Handles both full year
wrappers (`EVENT_URL_RE` links) and list wrappers (`LIST_LINK_RE` links).

`stHostEl` and `stBtnEl` are torn down and rebuilt at the start of each new
`runFetch` call so stale SmartTable state from the previous run is cleared.

---

## Sticky positioning

The `stickyOffset` option passed to SmartTable ensures that both the
SmartTable global bar (`st-global-bar`) and the `thead` row stick below the
script's sticky bar rather than at the top of the viewport:

```javascript
options: {
  stickyOffset: 'calc(var(--bb-header-h) + var(--bb-sticky-bar-h))'
}
```

`--bb-header-h` and `--bb-sticky-bar-h` are set by `setupStickyBar` (YEAR
page) or by the equivalent HOME page setup code.
