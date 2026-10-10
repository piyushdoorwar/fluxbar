# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

FluxBar is a GNOME Shell extension (UUID `fluxbar@piyushdoorwar.github.io`) that shows live upload/download speed in the top bar. It is plain ES-module GJS code — no build step, no package manager, no test framework. The `site/` directory is a separate, unrelated marketing site deployed to GitHub Pages.

## Develop / install / reload

There is nothing to compile except the GSettings schema. The dev loop is wrapped by the `Makefile` — prefer these over the raw commands:

```sh
make install   # rsync sources into the extensions dir + glib-compile-schemas
make reload    # install, then disable+enable
make logs      # follow gnome-shell logs
make pack      # build the distributable zip
make lint      # run ESLint (run `npm install` once first)
make screenshots  # render prefs to docs/screenshots with sample data
```

The raw equivalents (what the targets wrap):

```sh
rsync -a --delete --exclude='.git' ./ ~/.local/share/gnome-shell/extensions/fluxbar@piyushdoorwar.github.io/
glib-compile-schemas ~/.local/share/gnome-shell/extensions/fluxbar@piyushdoorwar.github.io/schemas
gnome-extensions disable fluxbar@piyushdoorwar.github.io
gnome-extensions enable fluxbar@piyushdoorwar.github.io
```

`.github/workflows/ci.yml` runs on pushes/PRs (ignoring `site/`): ESLint, a `metadata.json` field check, `glib-compile-schemas --strict --dry-run`, and `make pack`. Contributor-facing docs live in `CONTRIBUTING.md`, `SECURITY.md` and `.github/ISSUE_TEMPLATE/`; keep their dev-loop instructions in sync with the Makefile.

ESLint is dev-only tooling (flat config in `eslint.config.mjs`, GJS runtime globals declared there); the extension itself has no Node/npm runtime dependency.

A simple `disable`/`enable` only reloads `extension.js`. The preferences UI (`prefs.js`) runs in a separate process — close and reopen the prefs window to pick up changes there. Changing the schema XML requires re-running `glib-compile-schemas` (and usually a full GNOME Shell restart) before the new keys are visible.

Logs:

```sh
journalctl /usr/bin/gnome-shell -f   # extension.js (runs in gnome-shell process)
journalctl --user -f                 # prefs.js and some sessions
```

`console.error('FluxBar: ...')` is the logging convention used throughout.

## Architecture

Two processes, two entry files, plus `utils.js` (pure helpers both import: usage-file path, `formatBytes`, `sumUsage`; keep it free of Shell/GTK imports). The processes share state **only** through GSettings and the on-disk usage file — they never call each other directly. The one "message" is `history-cleared-at`: prefs bumps it when the user clears history, and the extension drops its in-memory usage so the next flush doesn't write it back.

### `extension.js` — runs inside gnome-shell

- `FluxBarExtension` (the `Extension` subclass) owns the lifecycle. `enable()` is `async`: it promisifies the Gio file APIs, reads a baseline network snapshot, builds the indicator, and starts a `GLib.timeout_add` poll loop. `disable()` must tear everything down (cancel the `Gio.Cancellable`, remove the timer, destroy the indicator, disconnect settings) — GNOME requires extensions to leave no residue when disabled.
- The core loop is `_update()`: read `/proc/net/dev`, diff **per-interface** byte counters against `_previousStats` to get per-interval deltas, divided by the real elapsed time (monotonic `timestamp` on each snapshot) to get bytes/s (interfaces that only appear in the current sample are skipped, so hotplugging an interface doesn't record a phantom spike from its cumulative counter), accumulate the raw deltas into in-memory usage, and call `_render()`. Settings changes call `_render()` with the last computed speeds rather than re-sampling, so a reading never spans a partial interval. It is guarded by an `_updating` flag (reentrancy) and re-checks `this._indicator` after every `await` because the extension can be disabled mid-async.
- Usage is kept in memory (`this._usage`, marked `_usageDirty` on change) and flushed to disk by a separate ~30s timer (`_flushUsage`, async) rather than rewriting the file every tick. `disable()` does a final **synchronous** flush, only when `_usageDirty` (so a disable before `_readUsage()` finishes can't overwrite the file with `{}`), via `_flushUsageSync` (`GLib.file_set_contents`), because the async path would be cut short by the cancelled `Gio.Cancellable`.
- `FluxBarIndicator` (a `PanelMenu.Button`) is pure presentation: a panel `St.Label` stacked (via `Clutter.BinLayout`) over an invisible "sizer" label holding the widest text the current format can produce (`widestRate()`), so the label never changes width; a manually-positioned `St.Label` tooltip (added to `Main.uiGroup`, not a child of the button) shown on hover; and a menu with today/30-day usage refreshed on open. It holds no settings or timer logic. `_createIndicator()` (re)builds it, which is how `panel-position` changes are applied.
- Interface selection lives in two free functions: `getInterfaceType()` classifies an interface name (loopback / virtual / wifi / ethernet / mobile / vpn / unknown by name prefix; `automatic` includes wifi + ethernet + mobile), and `shouldIncludeInterface()` applies the `network-source` setting. Loopback and virtual (docker/veth/br-/virbr/vmnet/zt/tailscale) are always excluded.
- Speed formatting is the pure `formatRate()` (at most three significant digits, rolling over at 999.5 up to GB/s; bytes base 1024, bits base 1000 × 8), driven by `unit-mode`, `speed-format` (standard vs. compact) and `display-mode` (separate vs. total). `_buildSpeedText()` is the dispatcher.
- Visibility: with `hide-when-idle`, the label hides once combined speed has stayed at or below `idle-threshold` for `IDLE_HIDE_DELAY_US` (3s), so short lulls don't make the top bar jump.

### `prefs.js` — runs in a separate Adwaita process

- Builds two `Adw.PreferencesPage`s: a Settings page wiring widgets to GSettings via `Gio.SimpleActionGroup` + `settings.create_action(...)` (so most controls need no manual change handlers), and a read-only History page that reads the usage file synchronously and renders the last 30 days.
- The label-color row is the exception — it manually two-way-syncs a `Gtk.Entry` and `Gtk.ColorButton`, guarded by a `syncingColor` flag to avoid feedback loops. Only `#rrggbb` (validated by `HEX_COLOR_PATTERN`) is persisted.

### Shared state

- **GSettings** schema `org.gnome.shell.extensions.fluxbar` (`schemas/...gschema.xml`). When adding a setting you must touch all of: the schema XML, the validated getter + `VALID_*` constant in `extension.js`, and a widget in `prefs.js`. `extension.js` reacts to changes via the `settings.connect('changed', ...)` handler in `enable()`, which special-cases `update-interval-ms` (restart timer), `network-source` (re-baseline stats), `show-hover-details`, `panel-position` (rebuild indicator) and `history-cleared-at`; everything else just calls `_render()`.
- **Usage file** `~/.local/share/fluxbar/usage.json`: a `{ "YYYY-MM-DD": { rxBytes, txBytes } }` map, pruned to the last 30 days on each write. `extension.js` owns it in memory and flushes periodically + on disable; `prefs.js` reads it (sync GLib). Zero-delta intervals are not recorded.

## Conventions & constraints

- GJS ES modules with `gi://` and `resource:///org/gnome/shell/...` imports — this is not Node; there is no npm and `Date.now()`/timers come from `GLib`.
- Target shell versions are declared in `metadata.json` (`shell-version`: 45–50). Avoid APIs outside that range.
- All file I/O in `extension.js` goes through the shared `Gio.Cancellable` and swallows `Gio.IOErrorEnum.CANCELLED` errors silently (expected during disable).

## Packaging

New runtime files must be added to `PACK` in the Makefile and the "missing from the package" check in `.github/workflows/package.yml`. Tags set `version-name` (not `version`; extensions.gnome.org assigns that). The optional `publish` job uploads via `gnome-extensions upload` when `EGO_USERNAME`/`EGO_PASSWORD` secrets exist.


```sh
zip -r fluxbar@piyushdoorwar.github.io.zip metadata.json extension.js prefs.js utils.js schemas/org.gnome.shell.extensions.fluxbar.gschema.xml README.md LICENSE
```

## The `site/` directory

Static marketing site (`index.html` + `404.html` + `styles.css` + `app.js` + `assets/icons.svg` sprite + `data/extension-stats.json`), unrelated to the extension code. It follows the house product-site design (DM Sans, light by default with OS-driven dark tokens, pink accent tokens in `styles.css`). `.github/workflows/static.yml` deploys `./site` to GitHub Pages on every push to `main`; `refresh-extension-stats.yml` rewrites `site/data/extension-stats.json`, which `app.js` reads for the download count.
