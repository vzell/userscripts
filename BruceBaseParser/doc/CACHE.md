# CACHE.md — Save / Load Cache System

## Purpose

Allows saving fully-processed page state to a JSON file and restoring it later,
avoiding the need to re-fetch all DETAIL pages. Useful for slow connections or
offline review.

---

## Cache schema (version 1)

```json
{
  "schemaVersion": 1,
  "pageType": "year" | "list" | "home" | "detail",
  "url": "https://brucebase.wikidot.com/…",
  "pageTitle": "string",
  "timestamp": "ISO 8601 string",
  "processedHtml": "string (innerHTML of contentEl after processing)",
  "originalHtml": "string (snapshot taken before processing)"
}
```

---

## Save flow (`savePageCache`)

Uses a `Blob` + temporary `<a download>` — no additional `@grant` needed.

- Filename: `bb-<PAGETYPE>-<sanitized-pageTitle>.json`
- Saves when `💾 Save` button is clicked; button is only enabled after
  processing completes (or after a successful Load).

---

## Load flow (`triggerLoadCache` / `loadPageCache`)

1. `triggerLoadCache(onLoaded)` — creates an `<input type="file" accept=".json">`,
   triggers a click, reads the selected file with `FileReader`, parses JSON,
   validates `schemaVersion === 1`, calls `onLoaded(data)`.
2. `loadPageCache(pageType, contentEl, progressEl, data)`:
   - `contentEl.innerHTML = data.processedHtml` — injects saved HTML.
   - `rewireLoadedPage(contentEl, pageType)` — re-wires all recoverable listeners:
     - `.bb-song-year-only`, `.bb-song-detail-only`, `.bb-song-char-diff` → `showSongTooltip`.
     - `[data-msg]` elements → `showErrorTooltip`.
     - `.bb-section-controls` buttons → `rewireSectionControls`.
     - All `.bb-section-processed` → `addCacheRetryBtn`.
   - Re-wires Global toggle (via `setupGlobalToggle` for year/list,
     `rewireDetailToggle` for detail).
   - Re-wires Mismatch filter (via `setupMismatchFilter` for year,
     `setupListMismatchFilter` for list; skipped for home and detail).
   - Enables Save button.
   - Updates progress bar text with cache timestamp.

---

## Cache retry button (`addCacheRetryBtn`)

After a cache load, icon images and event-tab buttons cannot be wired (they
require the DETAIL page document, which is not stored in the cache). A
`⟳` button is added to each `.bb-section-processed` section:

- Icons are dimmed to 0.45 opacity; event-tab buttons are dimmed and
  `pointer-events: none` until refetch.
- Clicking `⟳` fetches the DETAIL page, restores icon opacity, removes stale
  tab-row, and calls `wireIconHandlers(eventLink, doc)`.
- On failure: button text returns to `⟳`, title shows the error; click to retry.
- On success: `⟳` button is removed from the DOM.

---

## `rewireSectionControls(container)`

Reconstructs `showView` closures for per-section ⇄ Original and ☰ List buttons
by scanning `.bb-section-controls` and their siblings in the saved DOM.
Clone-replaces buttons to strip stale listeners from the previous run.

---

## Page-type-specific details

| Page type | `contentEl` | `getOriginalHtml()` |
|---|---|---|
| `year` | `#page-content` | `_savedOriginalHtml` (snapshot before processing) |
| `list` | `#page-content` | `originalHtml` (local snapshot before processing) |
| `home` | `#bb-home-results` | `''` (home page results are generated, not derived from original) |
| `detail` | `getSetlistContainer(document)` | `_detailOriginalHtml` (snapshotted just before `renderDetailSetlist`) |
