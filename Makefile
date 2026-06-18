UUID    = fluxbar@piyushdoorwar.github.io
EXT_DIR = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
SCHEMA  = schemas/org.gnome.shell.extensions.fluxbar.gschema.xml
PACK    = metadata.json extension.js prefs.js $(SCHEMA) README.md LICENSE

# Files that belong in the repo but not in the installed extension.
EXCLUDES = --exclude='.git' --exclude='site' --exclude='.github' \
           --exclude='Makefile' --exclude='node_modules' \
           --exclude='package.json' --exclude='package-lock.json' \
           --exclude='eslint.config.mjs' --exclude='*.zip' --exclude='CLAUDE.md'

.PHONY: install schemas reload enable disable logs pack lint uninstall

## install: sync sources into the GNOME extensions dir and compile schemas
install:
	mkdir -p $(EXT_DIR)
	rsync -a --delete $(EXCLUDES) ./ $(EXT_DIR)/
	glib-compile-schemas $(EXT_DIR)/schemas

## reload: reinstall, then disable+enable so GNOME Shell picks up the changes
reload: install disable enable
	@echo "Reloaded. On Wayland you must log out/in for extension.js changes to take effect."

## enable / disable: toggle the extension (disable ignores 'not enabled' errors)
enable:
	gnome-extensions enable $(UUID)

disable:
	-gnome-extensions disable $(UUID)

## logs: follow GNOME Shell logs (extension.js output)
logs:
	journalctl /usr/bin/gnome-shell -f

## pack: build the distributable zip
pack:
	rm -f $(UUID).zip
	zip -r $(UUID).zip $(PACK) -x '*gschemas.compiled'

## lint: run ESLint (requires 'npm install' first)
lint:
	npx eslint .

## uninstall: disable and remove the installed extension
uninstall:
	-gnome-extensions disable $(UUID)
	rm -rf $(EXT_DIR)
