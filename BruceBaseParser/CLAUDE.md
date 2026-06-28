# CLAUDE.md — BruceBase Site Checker and Enhancer

## Purpose

Tampermonkey userscript (`BruceBaseParser.user.js`) that enriches
`http://brucebase.wikidot.com/` pages. It cross-checks data between different
page types and surfaces discrepancies with inline glyphs, hover tooltips, and
collapsible panels. It started as a simple event-name mismatch checker and has
grown into a full-featured BruceBase site-checker and usability enhancer.

---

## Quick reference — detailed documentation

The following files are found in the `doc` folder and should be updated after code changes whenever relevant information
should be noted:

| Topic | File |
|---|---|
| Page types, URL patterns, boot flow | [ARCHITECTURE.md](ARCHITECTURE.md) |
| DOM structure and sticky bar | [ARCHITECTURE.md](ARCHITECTURE.md) |
| YEAR page processing pipeline | [YEAR_PAGE.md](YEAR_PAGE.md) |
| HOME page mode | [HOME_PAGE.md](HOME_PAGE.md) |
| YEAR LIST page mode | [LIST_PAGE.md](LIST_PAGE.md) |
| DETAIL page mode | [DETAIL_PAGE.md](DETAIL_PAGE.md) |
| Setlist parsing and diff | [SETLIST.md](SETLIST.md) |
| Clickable icons, panels, lightbox | [ICONS_PANELS.md](ICONS_PANELS.md) |
| Tag consistency checks | [TAGS.md](TAGS.md) |
| Anchor / date consistency checks | [ANCHORS.md](ANCHORS.md) |
| Save / Load cache system | [CACHE.md](CACHE.md) |
| SmartTable integration | [SMARTTABLE.md](SMARTTABLE.md) |
| Shared utilities and CSS | [UTILITIES.md](UTILITIES.md) |

---

## Key constants (top of IIFE)

| Constant | Value |
|---|---|
| `KNOWN_EVENT_TYPES` | `gig`, `interview`, `nogig`, `offstage`, `onstage`, `recording`, `rehearsal`, `soundcheck` |
| `EVENT_URL_RE` | `/\/([a-z]+):\d{4}-\d{2}-\d{2}/` |
| `LIST_LINK_RE` | `/\/((?:\d{4}\|1949-64))#([a-zA-Z0-9]+)$/` |
| `INFO_SETLIST_HREF_RE` | `/^\/[\d][\w-]*#([a-zA-Z0-9]+)$/` |
| `ICON_TITLE_MAP` | Maps every icon title variant to a canonical key |
| `MANAGED_CONTENT_TAGS` | Set of content tags verifiable against DETAIL page data |
| `SPURIOUS_TAG_REASONS` | Human-readable reasons for each spurious managed tag |

---

## Boot flow

```
addStyles() + createTooltipElement()   ← always run first

location.pathname
  → '' / 'start'   → runHomePage()
  → /YYYY          → runYearPage()        (also '1949-64')
  → /YYYY-list     → runListPage(year)    (also '1949-64-list')
  → /type:…        → runDetailPage()
```

---

## External dependencies (`@require`)

- `smarttable.js` — optional; if `typeof SmartTable !== 'undefined'`,
  sortable/filterable tables are rendered on YEAR and LIST pages.
- `brucebase.js` — optional adapter; if `typeof BrucebaseAdapter !== 'undefined'`,
  it extracts column definitions and rows for the YEAR page SmartTable.

Both are loaded via `@require file:///…` in the userscript header and are never
bundled into this file. All SmartTable call-sites guard with `typeof SmartTable !== 'undefined'`.
