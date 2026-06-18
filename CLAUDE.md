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
```

The raw equivalents (what the targets wrap):

```sh
rsync -a --delete --exclude='.git' ./ ~/.local/share/gnome-shell/extensions/fluxbar@piyushdoorwar.github.io/
glib-compile-schemas ~/.local/share/gnome-shell/extensions/fluxbar@piyushdoorwar.github.io/schemas
gnome-extensions disable fluxbar@piyushdoorwar.github.io
gnome-extensions enable fluxbar@piyushdoorwar.github.io
```

ESLint is dev-only tooling (flat config in `eslint.config.mjs`, GJS runtime globals declared there); the extension itself has no Node/npm runtime dependency.

A simple `disable`/`enable` only reloads `extension.js`. The preferences UI (`prefs.js`) runs in a separate process — close and reopen the prefs window to pick up changes there. Changing the schema XML requires re-running `glib-compile-schemas` (and usually a full GNOME Shell restart) before the new keys are visible.

Logs:

```sh
journalctl /usr/bin/gnome-shell -f   # extension.js (runs in gnome-shell process)
journalctl --user -f                 # prefs.js and some sessions
```

`console.error('FluxBar: ...')` is the logging convention used throughout.

## Architecture

Two processes, two files. They share state **only** through GSettings and the on-disk usage file — they never call each other directly.

### `extension.js` — runs inside gnome-shell

- `FluxBarExtension` (the `Extension` subclass) owns the lifecycle. `enable()` is `async`: it promisifies the Gio file APIs, reads a baseline network snapshot, builds the indicator, and starts a `GLib.timeout_add` poll loop. `disable()` must tear everything down (cancel the `Gio.Cancellable`, remove the timer, destroy the indicator, disconnect settings) — GNOME requires extensions to leave no residue when disabled.
- The core loop is `_update()`: read `/proc/net/dev`, diff **per-interface** byte counters against `_previousStats` to get per-interval deltas (interfaces that only appear in the current sample are skipped, so hotplugging an interface doesn't record a phantom spike from its cumulative counter), then update label text, tooltip, visibility, color, and accumulate the deltas into in-memory usage. It is guarded by an `_updating` flag (reentrancy) and re-checks `this._indicator` after every `await` because the extension can be disabled mid-async.
- Usage is kept in memory (`this._usage`, marked `_usageDirty` on change) and flushed to disk by a separate ~30s timer (`_flushUsage`, async) rather than rewriting the file every tick. `disable()` does a final **synchronous** flush (`_flushUsageSync` via `GLib.file_set_contents`) because the async path would be cut short by the cancelled `Gio.Cancellable`.
- `FluxBarIndicator` (a `PanelMenu.Button`) is pure presentation: a panel `St.Label` plus a manually-positioned `St.Label` tooltip (added to `Main.uiGroup`, not a child of the button) shown on hover. It holds no settings or timer logic.
- Interface selection lives in two free functions: `getInterfaceType()` classifies an interface name (loopback / virtual / wifi / ethernet / vpn / unknown by name prefix), and `shouldIncludeInterface()` applies the `network-source` setting. Loopback and virtual (docker/veth/br-/virbr/vmnet/zt/tailscale) are always excluded.
- Speed formatting branches on three settings: `unit-mode` (bytes uses base 1024, bits uses base 1000 × 8), `speed-format` (standard vs. compact), and `display-mode` (separate vs. total). `_buildSpeedText()` is the dispatcher.

### `prefs.js` — runs in a separate Adwaita process

- Builds two `Adw.PreferencesPage`s: a Settings page wiring widgets to GSettings via `Gio.SimpleActionGroup` + `settings.create_action(...)` (so most controls need no manual change handlers), and a read-only History page that reads the usage file synchronously and renders the last 30 days.
- The label-color row is the exception — it manually two-way-syncs a `Gtk.Entry` and `Gtk.ColorButton`, guarded by a `syncingColor` flag to avoid feedback loops. Only `#rrggbb` (validated by `HEX_COLOR_PATTERN`) is persisted.

### Shared state

- **GSettings** schema `org.gnome.shell.extensions.fluxbar` (`schemas/...gschema.xml`). When adding a setting you must touch all of: the schema XML, the validated getter + `VALID_*` constant in `extension.js`, and a widget in `prefs.js`. `extension.js` reacts to changes via the `settings.connect('changed', ...)` handler in `enable()`, which special-cases `update-interval-ms` (restart timer), `network-source` (re-baseline stats), and `show-hover-details`.
- **Usage file** `~/.local/share/fluxbar/usage.json`: a `{ "YYYY-MM-DD": { rxBytes, txBytes } }` map, pruned to the last 30 days on each write. `extension.js` owns it in memory and flushes periodically + on disable; `prefs.js` reads it (sync GLib). Zero-delta intervals are not recorded.

## Conventions & constraints

- GJS ES modules with `gi://` and `resource:///org/gnome/shell/...` imports — this is not Node; there is no npm and `Date.now()`/timers come from `GLib`.
- Target shell versions are declared in `metadata.json` (`shell-version`: 45–50). Avoid APIs outside that range.
- All file I/O in `extension.js` goes through the shared `Gio.Cancellable` and swallows `Gio.IOErrorEnum.CANCELLED` errors silently (expected during disable).

## Packaging

```sh
zip -r fluxbar@piyushdoorwar.github.io.zip metadata.json extension.js prefs.js schemas/org.gnome.shell.extensions.fluxbar.gschema.xml README.md LICENSE
```

## The `site/` directory

Static marketing site (`index.html` + `styles.css` + `script.js` + `assets/`), unrelated to the extension code. `.github/workflows/static.yml` deploys `./site` to GitHub Pages on every push to `main`.
