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
| HOME | ▶ Fetch All Year Pages \| ▶ Fetch All Year-List Pages \| ⚡ Mismatches \| 💾 Save \| 📂 Load |
| YEAR | ▶ Start \| 💾 Save \| 📂 Load \| ⇄ Original Page \| ⚡ Mismatches \| [SmartTable] |
| LIST | ⇄ Original Page \| ⚡ Mismatches \| 💾 Save \| 📂 Load |
| DETAIL | 💾 Save \| 📂 Load (⇄ Original Page prepended after processing) |

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

Only `GM_xmlhttpRequest` and `GM_addStyle`. Do not add new grants without explicit discussion.

