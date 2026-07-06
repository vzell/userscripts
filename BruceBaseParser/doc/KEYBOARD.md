# KEYBOARD.md — Keyboard Shortcuts Engine

## Origin

Ported from `ShowAllEntityData`'s Emacs-style `ctrlMFunctionMap` prefix-key
system (`musicbrainz-userscripts/ShowAllEntityData`), with `sa_` settings
renamed to `bbp_`. See the "KEYBOARD SHORTCUTS SECTION" banner comment in
`BruceBaseParser.user.js` (just after `logErr()`) for the full implementation.

Dropped from the original as not applicable here: the numbered action-button
selection (1-9/a-z) in prefix mode (BruceBase has no "Show all"-style button
group), the unused `isSpecialDialogOpen()` guard (dead code in the source
too), and `createInfoDialog`/quick-filter (the help dialog is a plain custom
overlay instead — not worth porting for a single shortcut).

## Config keys

| Key | Type | Default | Purpose |
|---|---|---|---|
| `bbp_enable_keyboard_shortcuts` | checkbox | `true` | Master toggle — gates `initKeyboardShortcuts()` and the `⌨️ Shortcuts` button |
| `bbp_enable_keyboard_shortcut_tooltip` | checkbox | `true` | Floating hint listing function shortcuts while prefix mode is active |
| `bbp_keyboard_shortcut_prefix` | keyboard_shortcut | `Ctrl+M` | Prefix key; expects a second keypress to complete |
| `bbp_enable_direct_ctrl_char_shortcuts` | checkbox | `false` | When off (default), all direct `Ctrl+<a-z>` combos are suppressed everywhere to avoid clashing with browser/OS shortcuts — use the prefix instead |
| `bbp_shortcut_toggle_sticky_bar` | keyboard_shortcut | `Ctrl+B` | Direct shortcut for the sticky-bar toggle |

## Dispatch paths

Two ways to trigger a function in `ctrlMFunctionMap`:

1. **Prefix mode**: press `bbp_keyboard_shortcut_prefix` (default `Ctrl+M`) to
   enter prefix mode (shows the tooltip if enabled, auto-exits after 5s or on
   Escape), then press the mapped character. Always available regardless of
   `bbp_enable_direct_ctrl_char_shortcuts`.
2. **Direct shortcut**: press the combo configured for that action's own
   setting (e.g. `bbp_shortcut_toggle_sticky_bar`, default `Ctrl+B`) directly.
   Only fires when `bbp_enable_direct_ctrl_char_shortcuts` is on, *or* the
   configured combo isn't a bare `Ctrl+<a-z>` (never suppressed either way).

Core functions: `parsePrefixShortcut`, `getPrefixDisplay`, `isPrefixKeyEvent`,
`isShortcutEvent`, `getShortcutDisplay`, `buildShortcutHint` (all read live
from `Lib.settings`, never cached). `showCtrlMTooltip`/`hideCtrlMTooltip`
render/remove the prefix-mode hint. `initKeyboardShortcuts()` registers both
listeners once per page load (guarded by
`document._bbKeyboardShortcutsInitialized`) — called from the top-level boot
flow, gated on `bbp_enable_keyboard_shortcuts`.

## Wired-up actions

| Action | Prefix | Direct | Pages | Function |
|---|---|---|---|---|
| Toggle sticky bar | `Ctrl+M, then B` | `bbp_shortcut_toggle_sticky_bar` (`Ctrl+B`) | Any page with `#bb-sticky-bar` (HOME, YEAR, LIST, RECENT CHANGES today) | `toggleStickyBar()` |

`toggleStickyBar()` hides/shows `#bb-sticky-bar` and keeps the
`--bb-sticky-bar-h` CSS variable in sync (other sticky elements use it for
their `top` offset). It is deliberately page-agnostic — it just looks up
`#bb-sticky-bar` by id and warns if none is found — rather than checking a
page-type allowlist, so it keeps working automatically for any future page
mode that renders one (v2.97 originally restricted it to HOME/YEAR only;
v2.98 dropped that restriction).

## Help UI

- `showShortcutsHelp()` — a plain custom overlay (not SAED's
  `createInfoDialog`) listing the prefix key, the sticky-bar shortcut, and
  `?`/`/`. Bound to `?` and `/` (only when not typing in an input/textarea)
  and to the `⌨️ Shortcuts` button. Acts as a toggle — calling it while open
  closes it.
- `addShortcutsHelpButton(container)` — appends the `⌨️ Shortcuts` button
  (class `bb-toggle-btn`, so it inherits existing button styling) to the given
  `#bb-btn-container`. Called from `runHomePage()`, `runYearPage()`,
  `runListPage()`, and `runRecentChangesPage()`, right after each builds its
  own buttons — i.e. every page that pairs a `#bb-btn-container` with a
  `#bb-sticky-bar`. Not called from `runDetailPage()`/`runVenuePage()`/etc.
  since those pages have no sticky bar to toggle.

## Adding a new shortcut

1. Add a `bbp_shortcut_<name>` entry (type `keyboard_shortcut`) under the
   "Configurable direct shortcuts" comment in `configSchema`.
2. Add `ctrlMFunctionMap['<key>'] = { fn: () => ..., description: '...' };`
   near `toggleStickyBar`'s registration.
3. Add a matching `isShortcutEvent(e, 'bbp_shortcut_<name>', '<default>')`
   block in the direct-shortcut listener inside `initKeyboardShortcuts()`.
4. Add a line to `showShortcutsHelp()`'s box content and to the table above.
