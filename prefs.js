import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gdk from 'gi://Gdk';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {USAGE_DAYS_TO_KEEP, formatBytes, getUsageFilePath, sumUsage} from './utils.js';

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

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

// "2026-10-08" -> "Today", "Yesterday", or "Wed, Oct 8" (in the user's locale).
function formatUsageDate(key) {
    const [year, month, day] = key.split('-').map(Number);
    const date = GLib.DateTime.new_local(year, month, day, 0, 0, 0);

    if (!date)
        return key;

    const today = GLib.DateTime.new_now_local().format('%F');
    const yesterday = GLib.DateTime.new_now_local().add_days(-1).format('%F');

    if (key === today)
        return 'Today';

    if (key === yesterday)
        return 'Yesterday';

    return date.format('%a, %b %-e');
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
        this._actionGroup.add_action(this._settings.create_action('show-hover-details'));
        this._actionGroup.add_action(this._settings.create_action('text-weight'));
        this._actionGroup.add_action(this._settings.create_action('update-interval-ms'));
        this._actionGroup.add_action(this._settings.create_action('idle-threshold'));
        this._actionGroup.add_action(this._settings.create_action('panel-position'));

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

        this._addSegmentedChoice(group, 'Position', 'panel-position', [
            ['left', 'Left'],
            ['center', 'Center'],
            ['right', 'Right'],
        ]);

        const hideWhenIdleSwitch = new Gtk.Switch({
            action_name: 'fluxbar.hide-when-idle',
            valign: Gtk.Align.CENTER,
        });
        const hideWhenIdleRow = new Adw.ActionRow({
            title: 'Hide When Idle',
            subtitle: 'Hide the top bar speed after a few seconds without meaningful traffic.',
            activatable_widget: hideWhenIdleSwitch,
        });
        hideWhenIdleRow.add_suffix(hideWhenIdleSwitch);
        group.add(hideWhenIdleRow);

        const idleThresholdRow = this._addSegmentedChoice(group, 'Idle Below', 'idle-threshold', [
            [0, 'No traffic'],
            [1024, '1 KB/s'],
            [10240, '10 KB/s'],
            [102400, '100 KB/s'],
        ]);
        idleThresholdRow.subtitle = 'Background traffic under this speed counts as idle.';
        this._settings.bind('hide-when-idle', idleThresholdRow, 'sensitive', Gio.SettingsBindFlags.GET);

        const showHoverDetailsSwitch = new Gtk.Switch({
            action_name: 'fluxbar.show-hover-details',
            valign: Gtk.Align.CENTER,
        });
        const showHoverDetailsRow = new Adw.ActionRow({
            title: 'Show Hover Details',
            subtitle: 'Show download, upload, and total speed details when hovering over the top bar label.',
            activatable_widget: showHoverDetailsSwitch,
        });
        showHoverDetailsRow.add_suffix(showHoverDetailsSwitch);
        group.add(showHoverDetailsRow);
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
        return row;
    }

    _addUpdateGroup() {
        const group = new Adw.PreferencesGroup({
            title: 'Update Frequency',
        });
        this.add(group);

        this._addSegmentedChoice(group, 'Refresh', 'update-interval-ms', [
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

    constructor(settings) {
        super({
            title: 'History',
            icon_name: 'view-list-symbolic',
        });

        this._settings = settings;
        this._group = null;
        this._buildUsageGroup();
    }

    _buildUsageGroup() {
        if (this._group)
            this.remove(this._group);

        const clearButton = new Gtk.Button({
            label: 'Clear History',
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
        });
        clearButton.connect('clicked', () => this._confirmClear());

        this._group = new Adw.PreferencesGroup({
            title: 'Data Consumption',
            description: `Last ${USAGE_DAYS_TO_KEEP} days of recorded network usage.`,
            header_suffix: clearButton,
        });
        this.add(this._group);

        const usage = readUsage();
        const dates = Object.keys(usage).sort().reverse().slice(0, USAGE_DAYS_TO_KEEP);
        clearButton.sensitive = dates.length > 0;

        if (dates.length === 0) {
            this._group.add(new Adw.ActionRow({
                title: 'No data yet',
                subtitle: 'FluxBar will start filling this table while it is enabled.',
            }));
            return;
        }

        const total = sumUsage(usage);
        this._group.add(new Adw.ActionRow({
            title: `Total, last ${dates.length} ${dates.length === 1 ? 'day' : 'days'}`,
            subtitle: `Download ${formatBytes(total.rxBytes)}   Upload ${formatBytes(total.txBytes)}   Total ${formatBytes(total.rxBytes + total.txBytes)}`,
            css_classes: ['property'],
        }));

        for (const date of dates) {
            const rxBytes = Number(usage[date]?.rxBytes) || 0;
            const txBytes = Number(usage[date]?.txBytes) || 0;
            const totalBytes = rxBytes + txBytes;

            this._group.add(new Adw.ActionRow({
                title: formatUsageDate(date),
                subtitle: `Download ${formatBytes(rxBytes)}   Upload ${formatBytes(txBytes)}   Total ${formatBytes(totalBytes)}`,
            }));
        }
    }

    _confirmClear() {
        const heading = 'Clear usage history?';
        const body = 'This permanently deletes all recorded daily usage. It cannot be undone.';

        // Adw.AlertDialog arrived in libadwaita 1.5 (GNOME 46); GNOME 45 ships 1.4.
        if (Adw.AlertDialog) {
            const dialog = new Adw.AlertDialog({heading, body});
            dialog.add_response('cancel', 'Cancel');
            dialog.add_response('clear', 'Clear History');
            dialog.set_response_appearance('clear', Adw.ResponseAppearance.DESTRUCTIVE);
            dialog.connect('response', (_dialog, response) => {
                if (response === 'clear')
                    this._clearHistory();
            });
            dialog.present(this);
            return;
        }

        const dialog = new Adw.MessageDialog({
            heading,
            body,
            transient_for: this.get_root(),
            modal: true,
        });
        dialog.add_response('cancel', 'Cancel');
        dialog.add_response('clear', 'Clear History');
        dialog.set_response_appearance('clear', Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.connect('response', (_dialog, response) => {
            if (response === 'clear')
                this._clearHistory();
        });
        dialog.present();
    }

    _clearHistory() {
        // Tell the running extension first so it drops its in-memory copy, then
        // delete the file ourselves in case the extension is disabled.
        this._settings.set_int64('history-cleared-at', GLib.get_real_time());

        try {
            Gio.File.new_for_path(getUsageFilePath()).delete(null);
        } catch (error) {
            if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                console.error('FluxBar: Failed to delete usage data', error);
        }

        this._buildUsageGroup();
    }
}

export default class FluxBarPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.add(new FluxBarSettingsPage(settings));
        window.add(new FluxBarHistoryPage(settings));
    }
}
