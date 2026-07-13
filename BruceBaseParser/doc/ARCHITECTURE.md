# ARCHITECTURE.md — Page Types, URL Patterns, and DOM Structure

## Page types and URL patterns

| Page type | URL pattern | `@include` match |
|---|---|---|
| HOME | `/` or `/start` | `(start)?$` |
| YEAR | `/YYYY` or `/1949-64` | `\d{4}$` or `1949-64` |
| YEAR LIST | `/YYYY-list` or `/1949-64-list` | `\d{4}-list$` |
| DETAIL | `/type:YYYY-MM-DD-slug` | `(gig\|nogig\|…):` prefix |
| VENUE | `/venue:…` | `venue:` prefix |
| RETAIL | `/retail:…` | `retail:` prefix |
| SONG | `/song:…` | `song:` prefix |
| RELATION | `/relation:…` | `relation:` prefix |
| RECENT CHANGES | `/system:recent-changes` | exact match |

Known event types: `gig`, `interview`, `nobruce`, `nogig`, `offstage`,
`onstage`, `recording`, `rehearsal`, `soundcheck`. Any URL type outside this
set receives a ❓ glyph (via `addUnknownGlyph`) and is not fetched.

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

## Top-level `const`/`let` placement — must come before the boot dispatch

The whole file is one big IIFE. Near its top (~line 1255) the boot dispatch does
`const path = location.pathname...` then `await runHomePage()`/`await runYearPage()`/
`await runDetailPage()`/etc. — a **top-level `await`**. Because of that, this file's
own remaining top-level statements (everything textually *after* the dispatch,
which given the dispatch's early position is effectively the entire rest of the
file) do not get a chance to run until the awaited `run*Page()` call fully settles.

`function` declarations are unaffected — they're fully hoisted (name *and* body)
and callable from anywhere in the enclosing scope regardless of their source
position, so the hundreds of helper functions defined after the dispatch work
fine. But a **new top-level `const`/`let`** placed after the dispatch is not
initialized until its own declaration line executes — and since `run*Page()`'s
internal (fully-hoisted) function calls can reach code that reads it *while the
outer `await run*Page()` is still suspended*, i.e. long before control flow would
ever fall through to that later position, referencing it throws `ReferenceError:
Cannot access '<name>' before initialization`. This bit a real fix once — see the
`NON_DECOMPOSABLE_LETTERS` entry in `BruceBaseParser_CHANGELOG.json` (v3.33) and
its declaration site (right after `FUZZY_SUBSTRING_TAGS`, ~line 418).

**Every existing top-level `const` lookup table (`MANAGED_CONTENT_TAGS`,
`FUZZY_SUBSTRING_TAGS`, `TOUR_DEFINITIONS`, `NON_DECOMPOSABLE_LETTERS`, etc.) is
declared before the boot dispatch for exactly this reason.** Any new top-level
data constant must go there too — near the top of the file, alongside the others
— never interspersed among the helper functions further down.

---

## RECENT CHANGES page (`system:recent-changes`)

The page uses Wikidot's `SiteChangesModule` for JavaScript-driven pagination.
Content lives in `<div class="changes-list" id="site-changes-list">`, which
Wikidot replaces wholesale on every page/perpage change — making it the
natural `MutationObserver` target.

Each change entry is a `div.changes-list-item` containing a one-row `<table>`:

| TD class | Content |
|---|---|
| `td.title` | `<a href="/slug">Page Name</a>` |
| `td.flags` | One or more `<span class="spantip" title="change type">` |
| `td.mod-date` | `<span class="odate time_EPOCH">Human date</span>` |
| `td.revision-no` | `(rev. N)` or `(new)` |
| `td.mod-by` | `<span class="printuser"><a>username</a></span>` |

Optional `<div class="comments">` sibling holds the revision comment.

`runRecentChangesPage()` inserts `#bb-sticky-bar` with a "⊞ Table View" button.
Clicking it calls `collectRecentChanges()`, which:
1. Parses all `div.changes-list-item` entries with `parseCurrentPage()`.
2. Finds the "next »" pager link (`.pager .target a` matching `/next/i`) and clicks it.
3. Waits for `#site-changes-list` to mutate (AJAX reload) via MutationObserver.
4. Repeats steps 1–3 for 10 pages total (200 changes at the default 20 per page).
5. Renders collected rows in a SmartTable (columns: Page / Type / Date / Rev / By / Comment / Link).

---

## Network / security

- All cross-origin requests use `GM_xmlhttpRequest`.
- `@connect brucebase.wikidot.com` is declared in the userscript header.
- The script is limited to the one domain and never sends data offsite.
