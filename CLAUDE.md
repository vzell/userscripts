# Userscripts — Claude Code Guide

## Projects overview

Root directory for Tampermonkey userscripts.

## Commit message conventions

When writing a Git commit message prepend with the name of the project in brackets like e.g. "[BruceBaseParser] <commit message text>

## Shell command conventions

When writing and running Python (or other scripts) to analyze files, always save the code to a `.py` file first and execute it with a plain command like `python3 script.py`. Never use inline `python3 -c "..."`, pipes, command substitution (`$(...)`), or embedded quotes directly in the Bash command — these trigger Claude Code's static-analysis permission check and force a manual approval every time.

## Changelog format

```json
{
  "version": "9.99.XXX",
  "date": "YYYY-MM-DD",
  "sections": [
    {
      "label": "🐛 Fix | ✨ Improve | 🚀 Feature | 🔧 Refactor | 📝 Docs",
      "items": [ "Description of the change." ]
    }
  ]
}
```

Prepend new entries at the top of the JSON array.

## Versioning

Always read the current `// @version` from the userscript header and the latest entry in `<project>_CHANGELOG.json` 
before making any changes. Never assume a version - always derive it from the source files.

**Version bumps and `<project>_CHANGELOG.json` entries belong on `main` only.**
Feature branches must NOT touch `// @version` or `<project>_CHANGELOG.json`.

### Tracking work in a feature branch — `<project>_CHANGELOG.wip.json`

While working in a feature branch, record changes in the
`<project>_CHANGELOG.wip.json` using placeholder versions `"WIP.1"`,
`"WIP.2"`, … (newest first, same JSON schema as the real changelog).
Cross-references between WIP entries use the same `WIP.N` labels.

At merge time (on `main`):
1. Read the WIP file, assign the next real version numbers in order.
2. Update any `WIP.N` cross-references inside the entry text to the real versions.
3. Prepend the entries to `<project>_CHANGELOG.json`.
4. Bump `// @version` to the highest assigned number.
5. Delete `<project>_CHANGELOG.wip.json`.

## Mandatory conventions — apply to every change

- Bump `// @version` in the `==UserScript==` header. Format: `M.NN` (e.g. `1.32`)
- Add a changelog entry to `<project>_CHANGELOG.json` in the same session
- 4-space indentation, no tabs, no trailing whitespace
- All functions must have JSDoc `/** … */` blocks

## BruceBaseParser — architecture notes

### Page types and button container

Four page types: HOME, YEAR, LIST, DETAIL. All have `#bb-btn-container` inserted
immediately after `#page-title`.

| Page | Button order |
|------|-------------|
| HOME | ▶ Fetch All Year Pages \| ▶ Fetch All Year-List Pages \| ⚡ Mismatches \| ⇄ Original Page \| 💾 Save \| 📂 Load \| ⌨️ Shortcuts |
| YEAR | ▶ Start \| 💾 Save \| 📂 Load \| ⇄ Original Page \| ⚡ Mismatches \| Hide Relations \| ⌨️ Shortcuts \| [SmartTable] |
| LIST | ⇄ Original Page \| ⚡ Mismatches \| 💾 Save \| 📂 Load \| ⌨️ Shortcuts |
| DETAIL | 💾 Save \| 📂 Load (⇄ Original Page prepended after processing) |

`⌨️ Shortcuts` (added in v2.97, extended to LIST/RECENT CHANGES in v2.98) is wired
wherever the page renders `#bb-sticky-bar` — see "Keyboard shortcuts engine" below.
RECENT CHANGES isn't in this table (not one of the four main page types) but also
gets the button, since it builds its own `#bb-sticky-bar`/`#bb-btn-container`.

### Save / Load — no new `@grant` needed

- **Save**: `Blob` + `<a download>` — filename `bb-${pageType.toUpperCase()}-${pageTitle}.json`
- **Load**: hidden `<input type="file">` + `FileReader`
- **Cache schema v1**: `{ schemaVersion, pageType, url, pageTitle, timestamp, processedHtml, originalHtml }`

### YEAR page Start/Stop restart safety

Before each new processing run the click handler:
1. Removes `#bb-page-original`, `.bb-section-controls`, `.bb-section-original`
2. Resets each `sec.processedDiv.innerHTML = sec.sectionOriginalHtml` and `sec.toggleInserted = false`
3. Clone-replaces `globalBtn` and `mismatchBtn` to strip stale listeners
4. Re-runs `extractYearPageEvents(content)` for fresh DOM references

### Range-slug year pages (`1949-64`)

`LIST_LINK_RE` matches both `\d{4}` and `1949-64` slugs. Year comparisons must use
`yearMatchesHrefSlug(dateYear, hrefSlug)` (not `===`) so that e.g. `"1953"` correctly
matches the `"1949-64"` slug (covering 1949–1964). Applied at all three check sites:
YEAR page event anchors, DETAIL page "Info & Setlist" anchor, LIST page event links.

### `@grant` declarations

`GM_xmlhttpRequest`, `GM_addStyle`, `GM_info`, `GM_setValue`, `GM_getValue`, `GM_registerMenuCommand`
(the last four added in v2.96 to wire in `VZ_MBLibrary` for settings/changelog/logging). Do not add
further grants without explicit discussion.

### `@connect` declarations

`brucebase.wikidot.com`, `raw.githubusercontent.com` (the latter added in v2.99 — required for
`GM_xmlhttpRequest` requests to succeed; a missing `@connect` entry makes Tampermonkey silently
refuse the request rather than erroring at the network layer). Any new remote host used via
`GM_xmlhttpRequest`/`Lib.fetchCachedText` needs a matching `@connect` line or the request is refused
outright with "This domain is not a part of the @connect list".

### VZ_MBLibrary wiring

`@require`s `lib/VZ_MBLibrary.user.js` (from `musicbrainz-userscripts`), following the same pattern
as `MB_PageEnhancer`. Instantiated as `Lib` with a `bbp_`-prefixed `configSchema` and a `remoteConfig`
pointing at `BruceBaseParser_CHANGELOG.json` on GitHub raw (auto-registers the "⚙️ Userscript Settings
Manager" and "📜 ChangeLog" Tampermonkey menu commands). `log()/logWarn()/logErr()` delegate to
`Lib.debug/warn/error`; `log()` output is gated on `bbp_enable_debug_logging` (default off), while
`logWarn()`/`logErr()` remain always-visible.

### Keyboard shortcuts engine

Ported from ShowAllEntityData's Emacs-style `ctrlMFunctionMap` prefix-key system (`sa_` settings
renamed to `bbp_`); see the "KEYBOARD SHORTCUTS SECTION" banner comment in `BruceBaseParser.user.js`.
Two dispatch paths share one `ctrlMFunctionMap`: the prefix key (`bbp_keyboard_shortcut_prefix`,
default `Ctrl+M`) followed by a single character always works; the direct `Ctrl+<letter>` combo only
fires when `bbp_enable_direct_ctrl_char_shortcuts` is on (default off, to avoid clashing with
browser/OS shortcuts). `initKeyboardShortcuts()` is called once from the top-level boot flow
(guarded by `document._bbKeyboardShortcutsInitialized`); `addShortcutsHelpButton(container)` is
called per-page wherever the `⌨️ Shortcuts` button should appear — currently `runHomePage()`,
`runYearPage()`, `runListPage()`, and `runRecentChangesPage()`, i.e. every page that builds its own
`#bb-btn-container` next to a `#bb-sticky-bar`.
`showShortcutsHelp()` (bound to `?`/`/` and the button) is a plain custom overlay, not a port of
SAED's `createInfoDialog`/quick-filter (not needed for the single shortcut wired up so far). The
first (and so far only) action, `bbp_shortcut_toggle_sticky_bar` (default `Ctrl+B`), toggles
`#bb-sticky-bar` — `toggleStickyBar()` is deliberately page-agnostic (just checks for the element's
presence), so it works on any current or future page mode that renders one, without needing an
allowlist of page-type flags.

