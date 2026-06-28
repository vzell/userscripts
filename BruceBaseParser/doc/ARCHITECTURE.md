# ARCHITECTURE.md — Page Types, URL Patterns, and DOM Structure

## Page types and URL patterns

| Page type | URL pattern | `@include` match |
|---|---|---|
| HOME | `/` or `/start` | `(start)?$` |
| YEAR | `/YYYY` or `/1949-64` | `\d{4}$` or `1949-64` |
| YEAR LIST | `/YYYY-list` or `/1949-64-list` | `\d{4}-list$` |
| DETAIL | `/type:YYYY-MM-DD-slug` | `(gig\|nogig\|…):` prefix |

Known event types: `gig`, `interview`, `nogig`, `offstage`, `onstage`,
`recording`, `rehearsal`, `soundcheck`. Any URL type outside this set receives
a ❓ glyph (via `addUnknownGlyph`) and is not fetched.

The special slug `1949-64` covers all events from 1949 to 1964 on a single page.
`yearPageSlug(year)` maps any year in 1949–1964 to `'1949-64'`; all other years
map to their own `/YYYY` page.

---

## Confirmed DOM structure (brucebase.wikidot)

```
body#html-body
  div#skrollr-body
    div#container-wrap-wrap
      div#container-wrap
        div#container
          div#header                    ← sticky; height measured into --bb-header-h
          div#content-wrap
            div#side-bar                ← float:left; position:sticky
            div#main-content
              div#action-area-top
              div#bb-sticky-bar         ← inserted by setupStickyBar()
                div#bb-controls         ← flex row
                  div#bb-btn-container  ← buttons
                  p#bb-year-progress    ← timer + progress text
                div#bb-pre-events       ← icon legend, year heading, jump-to-recent
              div#page-content          ← event sections on YEAR pages
                hr  ← first event separator
                div.bb-section-processed × N
```

`#page-title` (hidden on YEAR pages — year is shown inside `#bb-pre-events`) and
`#page-content` are siblings inside `#main-content`.

---

## CSS custom properties

| Property | Set by | Default |
|---|---|---|
| `--bb-header-h` | `setupStickyBar` (measures `#header.getBoundingClientRect().height`) | `0px` via `:root` |
| `--bb-sticky-bar-h` | `setupStickyBar` (measures `#bb-sticky-bar.offsetHeight`) | `0px` via `:root` |

The SmartTable `stickyOffset` option is passed
`'calc(var(--bb-header-h) + var(--bb-sticky-bar-h))'` so both the SmartTable
header and the table-trigger button stick below the script's own UI bar.

**Do not** add `overflow-y` / `max-height` to `#side-bar` — the scrollbar
takes ~17px and causes year-link lines to wrap. `position: sticky` alone is
sufficient. `scrollbar-gutter: stable` has the same problem; avoid it.

---

## Shared initialization

Both `addStyles()` and `createTooltipElement()` always run before any page
dispatcher. `addStyles()` injects all CSS via `GM_addStyle`; `createTooltipElement()`
appends `#bb-tooltip` to `document.body`.

---

## Network / security

- All cross-origin requests use `GM_xmlhttpRequest`.
- `@connect brucebase.wikidot.com` is declared in the userscript header.
- The script is limited to the one domain and never sends data offsite.
