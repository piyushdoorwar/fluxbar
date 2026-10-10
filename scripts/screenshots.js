// Renders the preferences window to PNGs for the README and extensions.gnome.org.
//
//   make screenshots        (writes docs/screenshots/prefs-{settings,history}-{light,dark}.png)
//
// Runs prefs.js outside GNOME Shell with an in-memory GSettings backend and sample
// usage data, so your own settings and history never end up in the images.

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

const SCHEMA_ID = 'org.gnome.shell.extensions.fluxbar';
const WINDOW_WIDTH = 680;
const SHOTS = [
    {page: 0, name: 'settings', height: 900},
    {page: 1, name: 'history', height: 720},
];
const SCHEMES = ['light', 'dark'];

const [repoDir, outDir] = ARGV;
const workDir = GLib.dir_make_tmp('fluxbar-shots-XXXXXX');

function writeFile(path, text) {
    GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o755);
    GLib.file_set_contents(path, text);
}

function readFile(path) {
    return new TextDecoder().decode(GLib.file_get_contents(path)[1]);
}

// prefs.js imports ExtensionPreferences from a resource that only exists inside the
// Shell's preferences process; swap in a stub that hands out our settings object.
function stageExtension() {
    const prefs = readFile(`${repoDir}/prefs.js`).replace(
        /^import \{ExtensionPreferences\} from .*$/m,
        'class ExtensionPreferences { getSettings() { return globalThis.fluxbarSettings; } }'
    );
    writeFile(`${workDir}/ext/prefs.js`, prefs);
    writeFile(`${workDir}/ext/utils.js`, readFile(`${repoDir}/utils.js`));

    const [ok] = GLib.spawn_command_line_sync(`glib-compile-schemas --targetdir=${workDir}/ext ${repoDir}/schemas`);
    if (!ok)
        throw new Error('glib-compile-schemas failed');
}

// Twelve days of plausible usage ending today.
function writeSampleUsage() {
    const usage = {};
    const gib = 1024 ** 3;

    for (let i = 0; i < 12; i++) {
        const key = GLib.DateTime.new_now_local().add_days(-i).format('%F');
        usage[key] = {
            rxBytes: Math.round((1.2 + ((i * 37) % 70) / 10) * gib),
            txBytes: Math.round((0.2 + ((i * 13) % 14) / 10) * gib),
        };
    }

    writeFile(`${workDir}/data/fluxbar/usage.json`, JSON.stringify(usage));
}

function renderWindow(win, path) {
    const snapshot = new Gtk.Snapshot();
    new Gtk.WidgetPaintable({widget: win}).snapshot(snapshot, win.get_width(), win.get_height());
    const texture = win.get_renderer().render_texture(snapshot.to_node(), null);
    texture.save_to_png(path);
    print(`wrote ${path}`);
}

stageExtension();
writeSampleUsage();
GLib.setenv('XDG_DATA_HOME', `${workDir}/data`, true);

const source = Gio.SettingsSchemaSource.new_from_directory(
    `${workDir}/ext`, Gio.SettingsSchemaSource.get_default(), false);
globalThis.fluxbarSettings = new Gio.Settings({settings_schema: source.lookup(SCHEMA_ID, false)});

const {default: Preferences} = await import(`file://${workDir}/ext/prefs.js`);

const app = new Adw.Application({
    application_id: 'io.github.piyushdoorwar.FluxBar.Screenshots',
    flags: Gio.ApplicationFlags.NON_UNIQUE,
});

app.connect('activate', () => {
    const jobs = SCHEMES.flatMap(scheme => SHOTS.map(shot => ({...shot, scheme})));
    GLib.mkdir_with_parents(outDir, 0o755);

    const next = () => {
        const job = jobs.shift();
        if (!job) {
            app.quit();
            return;
        }

        Adw.StyleManager.get_default().color_scheme = job.scheme === 'dark'
            ? Adw.ColorScheme.FORCE_DARK
            : Adw.ColorScheme.FORCE_LIGHT;

        const win = new Adw.PreferencesWindow({
            application: app,
            title: 'FluxBar',
            default_width: WINDOW_WIDTH,
            default_height: job.height,
        });

        const pages = [];
        const addPage = win.add.bind(win);
        win.add = page => {
            pages.push(page);
            addPage(page);
        };
        new Preferences().fillPreferencesWindow(win);
        win.visible_page = pages[job.page];
        win.present();

        // Give GTK a moment to lay out and draw before capturing.
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 800, () => {
            renderWindow(win, `${outDir}/prefs-${job.name}-${job.scheme}.png`);
            win.destroy();
            next();
            return GLib.SOURCE_REMOVE;
        });
    };

    next();
});

app.run([]);
GLib.spawn_command_line_sync(`rm -rf ${workDir}`);
