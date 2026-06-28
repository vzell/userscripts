# HOME_PAGE.md — HOME Page Mode (`runHomePage`)

Runs on `http://brucebase.wikidot.com/` and `/start`.

---

## UI structure

The HOME page inserts the same `#bb-sticky-bar` / `#bb-controls` layout as YEAR
pages, but with a different button set:

| Button | ID | Behaviour |
|---|---|---|
| ▶ Fetch All Year Pages | `#bb-fetch-all-btn` | Fetches each `/YYYY` page (full YEAR mode) |
| ▶ Fetch All Year-List Pages | `#bb-fetch-overview-btn` | Fetches each `/YYYY-list` page (LIST mode) |
| ⚡ Mismatches | `#bb-mismatch-toggle` | Filters to show only mismatched events/years |
| 💾 Save | `#bb-save-btn` | Downloads processed results as a JSON cache |
| 📂 Load | `#bb-load-btn` | Restores from a previously saved JSON cache |
| SmartTable trigger | moved from `stHostEl` | Optional; appears when SmartTable is available |

Both fetch buttons show a ⏹ Stop variant while fetching. They are mutually
exclusive: clicking one disables the other for the duration of the fetch.

---

## `extractGigPageSlugs()`

Scans all `a[href]` in `#page-content` for the pattern
`/^\/(?:\d{4}-\d{2}|\d{4})-list$/`. Returns deduplicated slugs in document order
(e.g. `['1949-64', '1965', …, '2026']`).

---

## Fetch loop (`runFetch`)

For each slug in order:

1. Calls `setMsg(…)` to update the progress line.
2. Calls `fetchAndProcessYear(fetchSlug, resultsEl, setMsg)`.
3. Breaks if `stopRequested` is true.

On completion:
- Builds and renders a `SmartTable` from `extractHomeSmartTableRows(resultsEl)`
  using `HOME_SMARTTABLE_COLUMNS` (columns: `year`, `date`, `status`, `event`, `url`).
- Moves the SmartTable trigger button into `#bb-btn-container`.
- Wires the mismatch filter (see below).
- Enables Save button.

---

## `fetchAndProcessYear(slug, resultsEl, onProgress)`

1. Fetches `/${slug}`.
2. Creates `<h3 class="bb-year-header">` with a collapse/expand glyph (`▼`/`▶`)
   and a link to the live year page. `setupYearHeaderToggle` wires:
   - Single click on h3 (outside the link): toggle that year's wrapper.
   - Ctrl+click: collapse all if any open, expand all if all closed.
3. Creates `<div class="bb-year-wrapper" data-year="${slug}">` and injects the
   fetched year content's `innerHTML` into it.
4. `stripYearWrapperNoise(wrapper, isListPage)` removes:
   - For list pages: `.list-pages-box`, `<h1>`, `<hr>` elements.
   - For year pages: all direct children before the first `<hr>`.
   - Both: nav paragraphs matching `/Previous|Earlier/` and the social-media icon div.
5. Routes to the appropriate pipeline:
   - List slug → `fetchAndProcessListPage(year, wrapper, onProgress)`.
   - Year slug → `wrapYearSections` + `extractYearPageEvents` + `processYearEvents`.

---

## Mismatch filter (HOME page)

After a successful fetch the filter is wired differently depending on mode:

**Full year mode** (`fetchBtn`):
- Counts `.bb-section-processed` divs containing ❌/⚠️/❓ glyphs or diff spans.
- `applyMismatchFilter(active)` hides clean sections; also hides `bb-year-header`
  and `bb-year-wrapper` for entirely clean years.

**List overview mode** (`overviewBtn`):
- Counts list-link `<a>` elements whose next sibling glyph is not ✅.
- Filter hides individual ✅ rows within visible year sections, and hides
  the year header + wrapper entirely when all its rows are clean.

---

## SmartTable rows (`extractHomeSmartTableRows`)

Iterates all `.bb-year-wrapper` divs. For each event link found:

| Column | Source |
|---|---|
| `year` | `wrapper.dataset.year` (numeric) |
| `date` | From href (year wrappers) or leading `YYYY-MM-DD` in link text (list wrappers) |
| `status` | Text of the next `.bb-glyph` sibling (or `''` if absent) |
| `event` | Link text with the `YYYY-MM-DD - ` prefix stripped |
| `url` | `a.href` |

Handles both `EVENT_URL_RE` links (full year wrappers) and `LIST_LINK_RE` links
(list wrappers) by checking `wrapper.dataset.year.endsWith('-list')`.
