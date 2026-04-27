import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gdk from 'gi://Gdk';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const USAGE_DAYS_TO_SHOW = 30;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

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

function rgbaFromHex(hex) {
    const rgba = new Gdk.RGBA();
    return rgba.parse(hex) ? rgba : null;
}

function componentToHex(component) {
    return Math.round(component * 255).toString(16).padStart(2, '0');
}

function rgbaToHex(rgba) {
    return `#${componentToHex(rgba.red)}${componentToHex(rgba.green)}${componentToHex(rgba.blue)}`;
}

class FluxBarSettingsPage extends Adw.PreferencesPage {
    static {
        GObject.registerClass(this);
    }

    constructor(settings) {
        super({
            title: 'Settings',
            icon_name: 'preferences-system-symbolic',
        });

        this._settings = settings;
        this._actionGroup = new Gio.SimpleActionGroup();
        this.insert_action_group('fluxbar', this._actionGroup);
        this._actionGroup.add_action(this._settings.create_action('display-mode'));
        this._actionGroup.add_action(this._settings.create_action('speed-format'));
        this._actionGroup.add_action(this._settings.create_action('unit-mode'));
        this._actionGroup.add_action(this._settings.create_action('network-source'));
        this._actionGroup.add_action(this._settings.create_action('hide-when-idle'));
        this._actionGroup.add_action(this._settings.create_action('text-weight'));
        this._actionGroup.add_action(this._settings.create_action('update-interval-ms'));

        this._addDisplayGroup();
        this._addUpdateGroup();
        this._addColorGroup();
    }

    _addDisplayGroup() {
        const group = new Adw.PreferencesGroup({
            title: 'Display',
        });
        this.add(group);

        this._addSegmentedChoice(group, 'Speed', 'display-mode', [
            ['separate', 'Download and Upload'],
            ['total', 'Total Speed'],
        ]);

        this._addSegmentedChoice(group, 'Format', 'speed-format', [
            ['standard', '↓ 120 KB/s ↑ 35 KB/s'],
            ['compact-slash', '120K / 35K'],
            ['compact-arrows', '120↓ 35↑'],
        ]);

        this._addSegmentedChoice(group, 'Units', 'unit-mode', [
            ['bytes', 'Bytes'],
            ['bits', 'Bits'],
        ]);

        this._addSegmentedChoice(group, 'Text Weight', 'text-weight', [
            ['normal', 'Normal'],
            ['bold', 'Bold'],
        ]);

        this._addSegmentedChoice(group, 'Network Source', 'network-source', [
            ['automatic', 'Automatic'],
            ['wifi', 'Wi-Fi'],
            ['ethernet', 'Ethernet'],
            ['all', 'All interfaces'],
        ]);

        const hideWhenIdleSwitch = new Gtk.Switch({
            action_name: 'fluxbar.hide-when-idle',
            valign: Gtk.Align.CENTER,
        });
        const hideWhenIdleRow = new Adw.ActionRow({
            title: 'Hide When Idle',
            subtitle: 'Hide the top bar speed when there is no active traffic.',
            activatable_widget: hideWhenIdleSwitch,
        });
        hideWhenIdleRow.add_suffix(hideWhenIdleSwitch);
        group.add(hideWhenIdleRow);
    }

    _addSegmentedChoice(group, title, settingName, options) {
        const row = new Adw.ActionRow({
            title,
        });

        const buttons = new Gtk.Box({
            css_classes: ['linked'],
            halign: Gtk.Align.END,
            valign: Gtk.Align.CENTER,
        });

        for (const [value, label] of options) {
            const variantType = typeof value === 'number' ? 'i' : 's';

            buttons.append(new Gtk.ToggleButton({
                label,
                action_name: `fluxbar.${settingName}`,
                action_target: new GLib.Variant(variantType, value),
            }));
        }

        row.add_suffix(buttons);
        group.add(row);
    }

    _addUpdateGroup() {
        const group = new Adw.PreferencesGroup({
            title: 'Update Frequency',
        });
        this.add(group);

        this._addSegmentedChoice(group, 'Refresh', 'update-interval-ms', [
            [500, '0.5s'],
            [1000, '1s'],
            [2000, '2s'],
            [3000, '3s'],
            [5000, '5s'],
        ]);
    }

    _addColorGroup() {
        const group = new Adw.PreferencesGroup({
            title: 'Color',
        });
        this.add(group);

        const currentColor = this._settings.get_string('label-color');
        const entry = new Gtk.Entry({
            text: currentColor,
            placeholder_text: '#ffffff',
            valign: Gtk.Align.CENTER,
            width_chars: 9,
            max_width_chars: 9,
        });

        const colorButton = new Gtk.ColorButton({
            rgba: rgbaFromHex(currentColor) ?? rgbaFromHex('#ffffff'),
            use_alpha: false,
            valign: Gtk.Align.CENTER,
        });

        let syncingColor = false;

        entry.connect('changed', () => {
            if (syncingColor)
                return;

            const color = entry.text.trim();

            if (color === '') {
                this._settings.set_string('label-color', color);
                return;
            }

            if (HEX_COLOR_PATTERN.test(color)) {
                syncingColor = true;
                colorButton.rgba = rgbaFromHex(color);
                syncingColor = false;
                this._settings.set_string('label-color', color);
            }
        });

        colorButton.connect('notify::rgba', () => {
            if (syncingColor)
                return;

            const color = rgbaToHex(colorButton.rgba);
            syncingColor = true;
            entry.text = color;
            syncingColor = false;
            this._settings.set_string('label-color', color);
        });

        const row = new Adw.ActionRow({
            title: 'Text Color',
            subtitle: 'Pick a color, enter a hex value, or leave empty for the system default.',
            activatable_widget: entry,
        });
        row.add_suffix(colorButton);
        row.add_suffix(entry);
        group.add(row);
    }
}

class FluxBarHistoryPage extends Adw.PreferencesPage {
    static {
        GObject.registerClass(this);
    }

    constructor() {
        super({
            title: 'History',
            icon_name: 'view-list-symbolic',
        });

        this._addUsageGroup();
    }

    _addUsageGroup() {
        const group = new Adw.PreferencesGroup({
            title: 'Data Consumption',
            description: 'Last 30 days of recorded network usage.',
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
        window.add(new FluxBarSettingsPage(this.getSettings()));
        window.add(new FluxBarHistoryPage());
    }
}
