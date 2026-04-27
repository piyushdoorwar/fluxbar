# FluxBar

FluxBar is a minimal GNOME Shell extension that shows live internet speed in the GNOME top bar:

```text
↓ 120 KB/s ↑ 35 KB/s
```

It reads byte counters from `/proc/net/dev`, ignores the loopback interface, aggregates all other interfaces, and updates once per second. This is an MVP: there are no settings, menus, graphs, telemetry, network requests, or external dependencies.

## Local Installation

Clone or copy this project into the GNOME Shell extensions directory:

```sh
mkdir -p ~/.local/share/gnome-shell/extensions
cp -r . ~/.local/share/gnome-shell/extensions/fluxbar@local
```

Restart GNOME Shell after installing:

- On X11, press `Alt` + `F2`, type `r`, then press `Enter`.
- On Wayland, log out and log back in.

## Enable or Disable

Enable FluxBar:

```sh
gnome-extensions enable fluxbar@local
```

Disable FluxBar:

```sh
gnome-extensions disable fluxbar@local
```

You can also manage it with the GNOME Extensions app:

```sh
gnome-extensions-app
```

## Logs

View GNOME Shell logs with:

```sh
journalctl /usr/bin/gnome-shell -f
```

On some Ubuntu sessions, this command may be useful instead:

```sh
journalctl --user -f
```

## Package as Zip Later

From inside the extension directory, create a zip with:

```sh
zip -r fluxbar@local.zip metadata.json extension.js README.md
```

The generated zip can be installed manually or prepared for later review and distribution.
