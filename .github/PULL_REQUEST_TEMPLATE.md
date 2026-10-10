## What does this change?

<!-- A short summary, and the issue it closes if there is one (e.g. "Closes #12"). -->

## How was it tested?

<!-- GNOME Shell version and session type (Wayland/X11), and what you checked. -->

## Checklist

- [ ] `make lint` passes
- [ ] Tested with `make reload` (on Wayland: logged out and back in)
- [ ] Disabling the extension leaves nothing behind (no timers, signals or actors left over)
- [ ] New settings are added to the schema, `extension.js` and `prefs.js`
- [ ] README updated if behaviour or settings changed
