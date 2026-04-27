import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const USAGE_DAYS_TO_SHOW = 30;

function getUsageFilePath() {
    return GLib.build_filenamev([GLib.get_user_data_dir(), 'fluxbar', 'usage.json']);
}

function readUsage() {
    try {
        const [, contents] = GLib.file_get_contents(getUsageFilePath());
        const decoder = new TextDecoder('utf-8');
        const usage = JSON.parse(decoder.decode(contents));

        if (usage && typeof usage === 'object')
            return usage;
    } catch (error) {
        if (!GLib.file_test(getUsageFilePath(), GLib.FileTest.EXISTS))
            return {};

        console.error('FluxBar: Failed to read usage data', error);
    }

    return {};
}

function formatBytes(bytes) {
    if (bytes < 1024)
        return `${bytes} B`;

    const kib = bytes / 1024;

    if (kib < 1024)
        return `${kib.toFixed(1)} KB`;

    const mib = kib / 1024;

    if (mib < 1024)
        return `${mib.toFixed(1)} MB`;

    const gib = mib / 1024;
    return `${gib.toFixed(2)} GB`;
}

class FluxBarPreferencesPage extends Adw.PreferencesPage {
    static {
        GObject.registerClass(this);
    }

    constructor(settings) {
        super({
            title: 'FluxBar',
            icon_name: 'network-transmit-receive-symbolic',
        });

        this._settings = settings;
        this._actionGroup = new Gio.SimpleActionGroup();
        this.insert_action_group('fluxbar', this._actionGroup);
        this._actionGroup.add_action(this._settings.create_action('display-mode'));
        this._actionGroup.add_action(this._settings.create_action('unit-mode'));
        this._actionGroup.add_action(this._settings.create_action('update-interval-ms'));

        this._addDisplayGroup();
        this._addUpdateGroup();
        this._addColorGroup();
        this._addUsageGroup();
    }

    _addDisplayGroup() {
        const group = new Adw.PreferencesGroup({
            title: 'Display',
        });
        this.add(group);

        const displayModes = [
            ['separate', 'Download and Upload'],
            ['total', 'Total Speed'],
        ];

        for (const [mode, title] of displayModes) {
            const check = new Gtk.CheckButton({
                action_name: 'fluxbar.display-mode',
                action_target: new GLib.Variant('s', mode),
            });
            const row = new Adw.ActionRow({
                title,
                activatable_widget: check,
            });
            row.add_prefix(check);
            group.add(row);
        }

        const unitModes = [
            ['bytes', 'Bytes'],
            ['bits', 'Bits'],
        ];

        for (const [mode, title] of unitModes) {
            const check = new Gtk.CheckButton({
                action_name: 'fluxbar.unit-mode',
                action_target: new GLib.Variant('s', mode),
            });
            const row = new Adw.ActionRow({
                title,
                activatable_widget: check,
            });
            row.add_prefix(check);
            group.add(row);
        }
    }

    _addUpdateGroup() {
        const group = new Adw.PreferencesGroup({
            title: 'Update Frequency',
        });
        this.add(group);

        const intervals = [
            [500, '0.5 seconds'],
            [1000, '1 second'],
            [2000, '2 seconds'],
            [3000, '3 seconds'],
            [5000, '5 seconds'],
        ];

        for (const [interval, title] of intervals) {
            const check = new Gtk.CheckButton({
                action_name: 'fluxbar.update-interval-ms',
                action_target: new GLib.Variant('i', interval),
            });
            const row = new Adw.ActionRow({
                title,
                activatable_widget: check,
            });
            row.add_prefix(check);
            group.add(row);
        }
    }

    _addColorGroup() {
        const group = new Adw.PreferencesGroup({
            title: 'Color',
        });
        this.add(group);

        const entry = new Gtk.Entry({
            text: this._settings.get_string('label-color'),
            placeholder_text: '#ffffff',
            valign: Gtk.Align.CENTER,
            width_chars: 9,
            max_width_chars: 9,
        });

        entry.connect('changed', () => {
            const color = entry.text.trim();

            if (color === '' || /^#[0-9a-fA-F]{6}$/.test(color))
                this._settings.set_string('label-color', color);
        });

        const row = new Adw.ActionRow({
            title: 'Text Color',
            subtitle: 'Use a hex color, or leave empty for the system default.',
            activatable_widget: entry,
        });
        row.add_suffix(entry);
        group.add(row);
    }

    _addUsageGroup() {
        const group = new Adw.PreferencesGroup({
            title: 'Last 30 Days',
        });
        this.add(group);

        const usage = readUsage();
        const dates = Object.keys(usage).sort().reverse().slice(0, USAGE_DAYS_TO_SHOW);

        if (dates.length === 0) {
            group.add(new Adw.ActionRow({
                title: 'No data yet',
                subtitle: 'FluxBar will start filling this table while it is enabled.',
            }));
            return;
        }

        for (const date of dates) {
            const rxBytes = Number(usage[date]?.rxBytes) || 0;
            const txBytes = Number(usage[date]?.txBytes) || 0;
            const totalBytes = rxBytes + txBytes;

            group.add(new Adw.ActionRow({
                title: date,
                subtitle: `Download ${formatBytes(rxBytes)}   Upload ${formatBytes(txBytes)}   Total ${formatBytes(totalBytes)}`,
            }));
        }
    }
}

export default class FluxBarPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window.add(new FluxBarPreferencesPage(this.getSettings()));
    }
}
