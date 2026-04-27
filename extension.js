import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const DEFAULT_UPDATE_INTERVAL_MS = 1000;
const PROC_NET_DEV = '/proc/net/dev';
const USAGE_DAYS_TO_KEEP = 30;
const VALID_UPDATE_INTERVALS_MS = [500, 1000, 2000, 3000, 5000];

function getTodayKey() {
    return GLib.DateTime.new_now_local().format('%F');
}

function getUsageFilePath() {
    return GLib.build_filenamev([GLib.get_user_data_dir(), 'fluxbar', 'usage.json']);
}

const FluxBarIndicator = GObject.registerClass(
class FluxBarIndicator extends PanelMenu.Button {
    _init(openPreferences) {
        super._init(0.0, 'FluxBar Indicator');

        this._label = new St.Label({
            text: '↓ 0 B/s ↑ 0 B/s',
            y_align: Clutter.ActorAlign.CENTER,
            style: 'margin-top: 2px;',
        });

        this.add_child(this._label);

        const settingsItem = new PopupMenu.PopupMenuItem('Settings');
        settingsItem.connect('activate', () => openPreferences());
        this.menu.addMenuItem(settingsItem);
    }

    setSpeedText(text) {
        this._label.text = text;
    }
});

export default class FluxBarExtension extends Extension {
    enable() {
        this._timeoutId = 0;
        this._settings = this.getSettings();
        this._settingsChangedId = this._settings.connect('changed', (_settings, key) => {
            if (key === 'update-interval-ms')
                this._restartTimer();

            this._update();
        });
        this._indicator = new FluxBarIndicator(() => this.openPreferences());
        this._previousStats = this._readNetworkStats();

        Main.panel.addToStatusArea(this.uuid, this._indicator);
        this._update();
        this._restartTimer();
    }

    disable() {
        if (this._timeoutId) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = 0;
        }

        this._indicator?.destroy();
        this._indicator = null;
        this._previousStats = null;
        this._settings?.disconnect(this._settingsChangedId);
        this._settingsChangedId = 0;
        this._settings = null;
    }

    _restartTimer() {
        if (this._timeoutId) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = 0;
        }

        this._timeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            this._getUpdateIntervalMs(),
            () => {
                this._update();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    _getUpdateIntervalMs() {
        const interval = this._settings?.get_int('update-interval-ms') ?? DEFAULT_UPDATE_INTERVAL_MS;

        if (VALID_UPDATE_INTERVALS_MS.includes(interval))
            return interval;

        return DEFAULT_UPDATE_INTERVAL_MS;
    }

    _update() {
        if (!this._indicator)
            return;

        const currentStats = this._readNetworkStats();

        if (currentStats && this._previousStats) {
            const downloadBytes = Math.max(0, currentStats.rxBytes - this._previousStats.rxBytes);
            const uploadBytes = Math.max(0, currentStats.txBytes - this._previousStats.txBytes);

            this._recordUsage(downloadBytes, uploadBytes);
            this._indicator.setSpeedText(this._buildSpeedText(downloadBytes, uploadBytes));
            this._applyColor();
        }

        if (currentStats)
            this._previousStats = currentStats;
    }

    _readNetworkStats() {
        try {
            const [, contents] = GLib.file_get_contents(PROC_NET_DEV);
            const decoder = new TextDecoder('utf-8');
            const lines = decoder.decode(contents).split('\n');

            let rxBytes = 0;
            let txBytes = 0;

            for (const line of lines) {
                const [interfaceName, values] = line.trim().split(':');

                if (!values)
                    continue;

                const name = interfaceName.trim();

                if (name === 'lo')
                    continue;

                const fields = values.trim().split(/\s+/);

                if (fields.length < 16)
                    continue;

                rxBytes += Number.parseInt(fields[0], 10) || 0;
                txBytes += Number.parseInt(fields[8], 10) || 0;
            }

            return {rxBytes, txBytes};
        } catch (error) {
            console.error('FluxBar: Failed to read /proc/net/dev', error);
            return null;
        }
    }

    _formatSpeed(bytesPerSecond) {
        if (this._settings?.get_string('unit-mode') === 'bits')
            return this._formatBitsSpeed(bytesPerSecond);

        if (bytesPerSecond < 1024)
            return `${bytesPerSecond} B/s`;

        const kibPerSecond = bytesPerSecond / 1024;

        if (kibPerSecond < 1024)
            return `${Math.round(kibPerSecond)} KB/s`;

        const mibPerSecond = kibPerSecond / 1024;
        return `${mibPerSecond.toFixed(1)} MB/s`;
    }

    _formatBitsSpeed(bytesPerSecond) {
        const bitsPerSecond = bytesPerSecond * 8;

        if (bitsPerSecond < 1000)
            return `${bitsPerSecond} b/s`;

        const kibPerSecond = bitsPerSecond / 1000;

        if (kibPerSecond < 1000)
            return `${Math.round(kibPerSecond)} Kb/s`;

        const mibPerSecond = kibPerSecond / 1000;
        return `${mibPerSecond.toFixed(1)} Mb/s`;
    }

    _buildSpeedText(downloadBytes, uploadBytes) {
        if (this._settings?.get_string('display-mode') === 'total') {
            const totalBytes = downloadBytes + uploadBytes;
            return `↕ ${this._formatSpeed(totalBytes)}`;
        }

        return `↓ ${this._formatSpeed(downloadBytes)} ↑ ${this._formatSpeed(uploadBytes)}`;
    }

    _applyColor() {
        if (!this._indicator)
            return;

        const color = this._settings?.get_string('label-color') ?? '';
        const styleParts = ['margin-top: 2px;'];

        if (/^#[0-9a-fA-F]{6}$/.test(color))
            styleParts.push(`color: ${color};`);

        this._indicator._label.style = styleParts.join(' ');
    }

    _recordUsage(downloadBytes, uploadBytes) {
        if (downloadBytes === 0 && uploadBytes === 0)
            return;

        const filePath = getUsageFilePath();
        const dirPath = GLib.path_get_dirname(filePath);
        const usage = this._readUsage();
        const today = getTodayKey();

        if (!usage[today])
            usage[today] = {rxBytes: 0, txBytes: 0};
        usage[today].rxBytes += downloadBytes;
        usage[today].txBytes += uploadBytes;

        const keepDates = Object.keys(usage).sort().slice(-USAGE_DAYS_TO_KEEP);
        const prunedUsage = {};

        for (const date of keepDates)
            prunedUsage[date] = usage[date];

        try {
            GLib.mkdir_with_parents(dirPath, 0o755);
            GLib.file_set_contents(filePath, JSON.stringify(prunedUsage, null, 2));
        } catch (error) {
            console.error('FluxBar: Failed to write usage data', error);
        }
    }

    _readUsage() {
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
}
