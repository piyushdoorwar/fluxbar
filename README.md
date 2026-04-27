# FluxBar

Live network speed in your GNOME top bar.

FluxBar keeps your current upload and download speed visible without opening a system monitor. It is small, local, and designed to feel like it belongs in the panel.

```text
↓ 120 KB/s ↑ 35 KB/s
```

## Highlights

- See live download and upload speed in the GNOME top bar
- Switch between total speed and separate download/upload values
- Display speeds in bytes or bits
- Choose an update interval: 0.5, 1, 2, 3, or 5 seconds
- Apply an optional custom text color
- Review daily network usage for the last 30 days
- Runs locally with no telemetry, network requests, or external services

## Screenshots

Screenshots coming soon.

Suggested images:

- Top bar speed indicator
- FluxBar preferences window
- 30-day usage table

## How It Works

FluxBar reads network counters from `/proc/net/dev`, ignores the loopback interface, and combines the remaining interfaces into one live speed value. Usage history is stored locally on your machine.

```text
~/.local/share/fluxbar/usage.json
```

## Install Locally

Clone or copy this project into the GNOME Shell extensions directory:

```sh
mkdir -p ~/.local/share/gnome-shell/extensions
rsync -a --delete --exclude='.git' ./ ~/.local/share/gnome-shell/extensions/fluxbar@local/
glib-compile-schemas ~/.local/share/gnome-shell/extensions/fluxbar@local/schemas
```

Restart GNOME Shell after installing:

- On X11, press `Alt` + `F2`, type `r`, then press `Enter`.
- On Wayland, log out and log back in.

Enable FluxBar:

```sh
gnome-extensions enable fluxbar@local
```

Open the GNOME Extensions app to enable, disable, or configure FluxBar:

```sh
gnome-extensions-app
```

## Development

After changing source files, sync the extension and reload it:

```sh
rsync -a --delete --exclude='.git' ./ ~/.local/share/gnome-shell/extensions/fluxbar@local/
glib-compile-schemas ~/.local/share/gnome-shell/extensions/fluxbar@local/schemas
gnome-extensions disable fluxbar@local
gnome-extensions enable fluxbar@local
```

View GNOME Shell logs:

```sh
journalctl /usr/bin/gnome-shell -f
```

On some Ubuntu sessions, this command may be more useful:

```sh
journalctl --user -f
```

## Package

From inside the extension directory, create a zip:

```sh
zip -r fluxbar@local.zip metadata.json extension.js prefs.js schemas/org.gnome.shell.extensions.fluxbar.gschema.xml README.md LICENSE
```

The generated zip can be installed manually or prepared for review and distribution.
