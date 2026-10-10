# Contributing to FluxBar

Thanks for helping out. Bug reports, ideas and pull requests are all welcome.

## Reporting bugs and ideas

Use the [issue templates](https://github.com/piyushdoorwar/fluxbar/issues/new/choose). For bugs, your GNOME Shell version, session type (Wayland or X11) and logs make the biggest difference.

## Development setup

FluxBar is plain GJS (ES modules) with no build step. You need GNOME Shell 45 or newer, `make`, `rsync`, `glib-compile-schemas`, and Node.js for linting only.

```sh
git clone https://github.com/piyushdoorwar/fluxbar.git
cd fluxbar
npm install      # once, for ESLint
make install     # copy into ~/.local/share/gnome-shell/extensions and compile the schema
```

If you have FluxBar installed from extensions.gnome.org, `make install` replaces it with your local copy.

### The edit / reload loop

| Command | What it does |
| --- | --- |
| `make reload` | Reinstall, then disable and enable the extension |
| `make logs` | Follow GNOME Shell logs (`extension.js` output) |
| `make lint` | Run ESLint |
| `make pack` | Build the zip that gets uploaded to extensions.gnome.org |

Things that trip people up:

- **Wayland caches `extension.js`.** After changing it, log out and back in. On X11, `Alt`+`F2`, `r`, `Enter` restarts the shell.
- **Preferences run in their own process.** Close and reopen the preferences window to pick up `prefs.js` changes.
- **Schema changes** need `make install` (which recompiles the schema), and usually a fresh login.
- **Preferences logs** go to `journalctl --user -f`, not the GNOME Shell log.

## Code guidelines

- Follow the existing style; `make lint` must pass.
- Everything created in `enable()` must be undone in `disable()`: timers, signal connections, actors, cancellables. GNOME's review rejects extensions that leave anything behind.
- Don't create objects or connect signals in the extension's constructor or at module load time; do it in `enable()`.
- Log with `console.error('FluxBar: ...')`.
- Keep file I/O in `extension.js` asynchronous; the shell must never block.
- A new setting touches three places: the schema XML, a validated getter in `extension.js`, and a widget in `prefs.js`.
- Stick to APIs available across the GNOME Shell versions listed in `metadata.json`.

See the [GNOME extension review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html) for the full list.

## Pull requests

Keep each pull request focused on one change, fill in the template, and say which GNOME Shell version and session type you tested on.

## Releases (maintainers)

1. Push a tag `v<number>`, e.g. `v3`. The number becomes the `version` in `metadata.json`.
2. The *Package extension* workflow builds the zip and attaches it to a GitHub release.
3. Upload that zip at [extensions.gnome.org/upload](https://extensions.gnome.org/upload/). Review usually takes a few days.
