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
const VALID_UPDATE_INTERVALS_MS = [1000, 2000, 3000, 5000];
const VALID_NETWORK_SOURCES = ['automatic', 'wifi', 'ethernet', 'all'];
const VALID_SPEED_FORMATS = ['standard', 'compact-slash', 'compact-arrows'];
const VALID_TEXT_WEIGHTS = ['normal', 'bold'];
const TOOLTIP_OFFSET = 6;
const TOOLTIP_ANIMATION_TIME = 150;

function getTodayKey() {
    return GLib.DateTime.new_now_local().format('%F');
}

function getUsageFilePath() {
    return GLib.build_filenamev([GLib.get_user_data_dir(), 'fluxbar', 'usage.json']);
}

function getInterfaceType(name) {
    if (name === 'lo')
        return 'loopback';

    if (
        name.startsWith('docker') ||
        name.startsWith('veth') ||
        name.startsWith('br-') ||
        name.startsWith('virbr') ||
        name.startsWith('vmnet') ||
        name.startsWith('zt') ||
        name.startsWith('tailscale')
    )
        return 'virtual';

    if (name.startsWith('wl') || name.startsWith('wlan') || name.startsWith('wifi'))
        return 'wifi';

    if (name.startsWith('en') || name.startsWith('eth'))
        return 'ethernet';

    if (name.startsWith('tun') || name.startsWith('tap') || name.startsWith('wg') || name.startsWith('ppp'))
        return 'vpn';

    return 'unknown';
}

function shouldIncludeInterface(name, selectedSource) {
    const type = getInterfaceType(name);

    if (type === 'loopback' || type === 'virtual')
        return false;

    if (selectedSource === 'all')
        return type !== 'unknown';

    if (selectedSource === 'wifi')
        return type === 'wifi';

    if (selectedSource === 'ethernet')
        return type === 'ethernet';

    return type === 'wifi' || type === 'ethernet';
}

const FluxBarIndicator = GObject.registerClass(
class FluxBarIndicator extends PanelMenu.Button {
    _init(openPreferences) {
        super._init(0.0, 'FluxBar Indicator');

        this._tooltipEnabled = true;

        this._label = new St.Label({
            text: '↓ 0 B/s ↑ 0 B/s',
            y_align: Clutter.ActorAlign.CENTER,
            style: 'margin-top: 2px;',
        });

        this.add_child(this._label);

        this._tooltip = new St.Label({
            style_class: 'dash-label',
            text: 'Download: 0 B/s\nUpload: 0 B/s\nTotal: 0 B/s',
            visible: false,
        });
        Main.uiGroup.add_child(this._tooltip);

        const settingsItem = new PopupMenu.PopupMenuItem('Settings');
        settingsItem.connect('activate', () => openPreferences());
        this.menu.addMenuItem(settingsItem);

        this.connect('notify::hover', () => this._syncTooltip());
        this.connect('destroy', () => this._tooltip.destroy());
    }

    setSpeedText(text) {
        this._label.text = text;
    }

    setTooltipText(text) {
        this._tooltip.text = text;

        if (this.hover)
            this._syncTooltip();
    }

    setIndicatorVisible(visible) {
        this.visible = visible;

        if (!visible)
            this._syncTooltip();
    }

    setTooltipEnabled(enabled) {
        this._tooltipEnabled = enabled;
        this._syncTooltip();
    }

    _syncTooltip() {
        const shouldShowTooltip = this._tooltipEnabled && this.hover && this.visible;

        if (shouldShowTooltip) {
            this._tooltip.set({
                visible: true,
                opacity: 0,
            });

            const [stageX, stageY] = this.get_transformed_position();
            const [indicatorWidth, indicatorHeight] = this.allocation.get_size();
            const [tooltipWidth, tooltipHeight] = this._tooltip.get_size();
            const monitor = Main.layoutManager.findMonitorForActor(this);
            const x = Math.min(
                Math.max(stageX + Math.floor((indicatorWidth - tooltipWidth) / 2), monitor.x),
                monitor.x + monitor.width - tooltipWidth
            );
            const y = stageY - monitor.y > indicatorHeight + TOOLTIP_OFFSET
                ? stageY - tooltipHeight - TOOLTIP_OFFSET
                : stageY + indicatorHeight + TOOLTIP_OFFSET;

            this._tooltip.set_position(x, y);
        }

        this._tooltip.ease({
            opacity: shouldShowTooltip ? 255 : 0,
            duration: TOOLTIP_ANIMATION_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                this._tooltip.visible = this._tooltipEnabled && this.hover && this.visible;
            },
        });
    }
});

export default class FluxBarExtension extends Extension {
    enable() {
        this._timeoutId = 0;
        this._settings = this.getSettings();
        this._settingsChangedId = this._settings.connect('changed', (_settings, key) => {
            if (key === 'update-interval-ms') {
                this._restartTimer();
            } else if (key === 'network-source') {
                this._previousStats = this._readNetworkStats();
                this._indicator?.setSpeedText(this._buildSpeedText(0, 0));
                this._indicator?.setTooltipText(this._buildTooltipText(0, 0));
                this._updateVisibility(this._previousStats?.hasSelectedInterface ?? false, 0);
                this._applyColor();
                return;
            } else if (key === 'show-hover-details') {
                this._indicator?.setTooltipEnabled(this._settings.get_boolean('show-hover-details'));
            }

            this._update();
        });
        this._indicator = new FluxBarIndicator(() => this.openPreferences());
        this._indicator.setTooltipEnabled(this._settings.get_boolean('show-hover-details'));
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

    _getNetworkSource() {
        const source = this._settings?.get_string('network-source') ?? 'automatic';

        if (VALID_NETWORK_SOURCES.includes(source))
            return source;

        return 'automatic';
    }

    _getSpeedFormat() {
        const format = this._settings?.get_string('speed-format') ?? 'standard';

        if (VALID_SPEED_FORMATS.includes(format))
            return format;

        return 'standard';
    }

    _getTextWeight() {
        const weight = this._settings?.get_string('text-weight') ?? 'normal';

        if (VALID_TEXT_WEIGHTS.includes(weight))
            return weight;

        return 'normal';
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
            this._indicator.setTooltipText(this._buildTooltipText(downloadBytes, uploadBytes));
            this._updateVisibility(currentStats.hasSelectedInterface, downloadBytes + uploadBytes);
            this._applyColor();
        }

        if (currentStats) {
            if (!this._previousStats)
                this._updateVisibility(currentStats.hasSelectedInterface, 0);

            this._previousStats = currentStats;
        }
    }

    _readNetworkStats() {
        try {
            const [, contents] = GLib.file_get_contents(PROC_NET_DEV);
            const decoder = new TextDecoder('utf-8');
            const lines = decoder.decode(contents).split('\n');

            let rxBytes = 0;
            let txBytes = 0;
            let hasSelectedInterface = false;

            for (const line of lines) {
                const [interfaceName, values] = line.trim().split(':');

                if (!values)
                    continue;

                const name = interfaceName.trim();

                if (!shouldIncludeInterface(name, this._getNetworkSource()))
                    continue;

                const fields = values.trim().split(/\s+/);

                if (fields.length < 16)
                    continue;

                hasSelectedInterface = true;
                rxBytes += Number.parseInt(fields[0], 10) || 0;
                txBytes += Number.parseInt(fields[8], 10) || 0;
            }

            return {rxBytes, txBytes, hasSelectedInterface};
        } catch (error) {
            console.error('FluxBar: Failed to read /proc/net/dev', error);
            return null;
        }
    }

    _updateVisibility(hasSelectedInterface, totalBytes) {
        if (!this._indicator)
            return;

        const hideWhenIdle = this._settings?.get_boolean('hide-when-idle') ?? true;
        this._indicator.setIndicatorVisible(!hideWhenIdle || (hasSelectedInterface && totalBytes > 0));
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

    _formatCompactSpeed(bytesPerSecond) {
        const useBits = this._settings?.get_string('unit-mode') === 'bits';
        const value = useBits ? bytesPerSecond * 8 : bytesPerSecond;
        const base = useBits ? 1000 : 1024;
        const units = useBits ? ['b', 'Kb', 'Mb', 'Gb'] : ['B', 'K', 'M', 'G'];

        if (value < base)
            return `${value}${units[0]}`;

        let scaledValue = value;
        let unitIndex = 0;

        while (scaledValue >= base && unitIndex < units.length - 1) {
            scaledValue /= base;
            unitIndex++;
        }

        const formattedValue = scaledValue < 10 ? scaledValue.toFixed(1) : Math.round(scaledValue).toString();
        return `${formattedValue}${units[unitIndex]}`;
    }

    _buildSpeedText(downloadBytes, uploadBytes) {
        const speedFormat = this._getSpeedFormat();

        if (speedFormat !== 'standard') {
            if (this._settings?.get_string('display-mode') === 'total')
                return this._formatCompactSpeed(downloadBytes + uploadBytes);

            const downloadSpeed = this._formatCompactSpeed(downloadBytes);
            const uploadSpeed = this._formatCompactSpeed(uploadBytes);

            if (speedFormat === 'compact-arrows')
                return `${downloadSpeed}↓ ${uploadSpeed}↑`;

            return `${downloadSpeed} / ${uploadSpeed}`;
        }

        if (this._settings?.get_string('display-mode') === 'total') {
            const totalBytes = downloadBytes + uploadBytes;
            return `↕ ${this._formatSpeed(totalBytes)}`;
        }

        return `↓ ${this._formatSpeed(downloadBytes)} ↑ ${this._formatSpeed(uploadBytes)}`;
    }

    _buildTooltipText(downloadBytes, uploadBytes) {
        const totalBytes = downloadBytes + uploadBytes;

        return [
            `Download: ${this._formatSpeed(downloadBytes)}`,
            `Upload: ${this._formatSpeed(uploadBytes)}`,
            `Total: ${this._formatSpeed(totalBytes)}`,
        ].join('\n');
    }

    _applyColor() {
        if (!this._indicator)
            return;

        const color = this._settings?.get_string('label-color') ?? '';
        const styleParts = ['margin-top: 2px;'];

        if (/^#[0-9a-fA-F]{6}$/.test(color))
            styleParts.push(`color: ${color};`);

        if (this._getTextWeight() === 'bold')
            styleParts.push('font-weight: bold;');

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
