import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {USAGE_DAYS_TO_KEEP, formatBytes, getUsageFilePath, sumUsage} from './utils.js';

const DEFAULT_UPDATE_INTERVAL_MS = 1000;
const PROC_NET_DEV = '/proc/net/dev';
const USAGE_FLUSH_INTERVAL_MS = 30000;
const VALID_UPDATE_INTERVALS_MS = [1000, 2000, 3000, 5000];
const VALID_NETWORK_SOURCES = ['automatic', 'wifi', 'ethernet', 'all'];
const VALID_SPEED_FORMATS = ['standard', 'compact-slash', 'compact-arrows'];
const VALID_TEXT_WEIGHTS = ['normal', 'bold'];
const VALID_IDLE_THRESHOLDS = [0, 1024, 10240, 102400];
const VALID_PANEL_POSITIONS = ['left', 'center', 'right'];
const DEFAULT_IDLE_THRESHOLD = 1024;
// How long traffic must stay at or below the idle threshold before the label hides,
// so a brief lull between bursts doesn't make the top bar jump.
const IDLE_HIDE_DELAY_US = 3 * GLib.USEC_PER_SEC;
// Tabular digits keep every digit the same width, so the label doesn't wobble as values change.
const BASE_LABEL_STYLE = 'margin-top: 2px; font-feature-settings: "tnum";';
const BYTE_UNITS = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
const BIT_UNITS = ['b/s', 'Kb/s', 'Mb/s', 'Gb/s'];
const COMPACT_BYTE_UNITS = ['B', 'K', 'M', 'G'];
const COMPACT_BIT_UNITS = ['b', 'Kb', 'Mb', 'Gb'];
const TOOLTIP_OFFSET = 6;
const TOOLTIP_ANIMATION_TIME = 150;

function getTodayKey() {
    return GLib.DateTime.new_now_local().format('%F');
}

// JSON.parse and other plain JS errors have no matches(); only GLib errors do.
function isCancelled(error) {
    return error instanceof GLib.Error && error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
}

function pruneUsage(usage) {
    const keepDates = Object.keys(usage).sort().slice(-USAGE_DAYS_TO_KEEP);
    const prunedUsage = {};

    for (const date of keepDates)
        prunedUsage[date] = usage[date];

    return prunedUsage;
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

    if (name.startsWith('ww') || name.startsWith('usb'))
        return 'mobile';

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

    return type === 'wifi' || type === 'ethernet' || type === 'mobile';
}

function getRateUnits(useBits, compact) {
    if (useBits)
        return compact ? COMPACT_BIT_UNITS : BIT_UNITS;

    return compact ? COMPACT_BYTE_UNITS : BYTE_UNITS;
}

// Scales to at most three significant digits so the label width stays bounded:
// 999 KB/s rolls over to 1.0 MB/s rather than showing 1000 KB/s.
function formatRate(bytesPerSecond, useBits, compact) {
    const units = getRateUnits(useBits, compact);
    const base = useBits ? 1000 : 1024;
    let value = useBits ? bytesPerSecond * 8 : bytesPerSecond;
    let unitIndex = 0;

    while (value >= 999.5 && unitIndex < units.length - 1) {
        value /= base;
        unitIndex++;
    }

    const number = unitIndex === 0 || value >= 9.95 ? Math.round(value).toString() : value.toFixed(1);
    return `${number}${compact ? '' : ' '}${units[unitIndex]}`;
}

// The widest text formatRate() can produce for these units. It sizes an invisible
// placeholder behind the label so the label never changes width.
function widestRate(useBits, compact) {
    return `888${compact ? '' : ' '}${getRateUnits(useBits, compact)[2]}`;
}

const FluxBarIndicator = GObject.registerClass(
class FluxBarIndicator extends PanelMenu.Button {
    _init(openPreferences, onMenuOpened) {
        super._init(0.0, 'FluxBar Indicator');

        this._tooltipEnabled = true;

        // The label sits on top of an invisible placeholder holding the widest
        // possible text; the BinLayout sizes the box to the larger of the two.
        const labelBox = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._sizer = new St.Label({
            opacity: 0,
            y_align: Clutter.ActorAlign.CENTER,
            style: BASE_LABEL_STYLE,
        });

        this._label = new St.Label({
            text: '↓ 0 B/s ↑ 0 B/s',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            style: BASE_LABEL_STYLE,
        });

        labelBox.add_child(this._sizer);
        labelBox.add_child(this._label);
        this.add_child(labelBox);

        this._tooltip = new St.Label({
            style_class: 'dash-label',
            text: 'Download: 0 B/s\nUpload: 0 B/s\nTotal: 0 B/s',
            visible: false,
        });
        Main.uiGroup.add_child(this._tooltip);

        this._todayItem = new PopupMenu.PopupMenuItem('', {reactive: false, can_focus: false});
        this._rangeItem = new PopupMenu.PopupMenuItem('', {reactive: false, can_focus: false});
        this.menu.addMenuItem(this._todayItem);
        this.menu.addMenuItem(this._rangeItem);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const settingsItem = new PopupMenu.PopupMenuItem('Settings');
        settingsItem.connect('activate', () => openPreferences());
        this.menu.addMenuItem(settingsItem);

        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                onMenuOpened();
        });

        this.connect('notify::hover', () => this._syncTooltip());
        this.connect('destroy', () => this._tooltip.destroy());
    }

    setSpeedText(text, widestText) {
        this._label.text = text;

        if (this._sizer.text !== widestText)
            this._sizer.text = widestText;
    }

    setUsageSummary(todayText, rangeText) {
        this._todayItem.label.text = todayText;
        this._rangeItem.label.text = rangeText;
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

    setLabelStyle(style) {
        // Called every tick; restyling triggers a relayout, so skip it when nothing changed.
        if (this._label.style === style)
            return;

        // The placeholder must share the label's font weight or its width would be wrong.
        this._label.style = style;
        this._sizer.style = style;
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
    async enable() {
        this._timeoutId = 0;
        this._usageFlushTimeoutId = 0;
        this._updating = false;
        this._usage = {};
        this._usageDirty = false;
        this._downloadSpeed = 0;
        this._uploadSpeed = 0;
        this._hasSelectedInterface = false;
        this._lastActiveTime = 0;

        Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');
        Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');

        this._cancellable = new Gio.Cancellable();
        this._settings = this.getSettings();
        this._settingsChangedId = this._settings.connect('changed', async (_settings, key) => {
            if (key === 'update-interval-ms') {
                this._restartTimer();
                return;
            } else if (key === 'network-source') {
                this._previousStats = await this._readNetworkStats();
                if (!this._indicator) return;
                this._downloadSpeed = 0;
                this._uploadSpeed = 0;
                this._hasSelectedInterface = this._previousStats?.hasSelectedInterface ?? false;
            } else if (key === 'show-hover-details') {
                this._indicator?.setTooltipEnabled(this._settings.get_boolean('show-hover-details'));
            } else if (key === 'panel-position') {
                if (this._indicator)
                    this._createIndicator();
            } else if (key === 'history-cleared-at') {
                // The preferences window cleared the history file; drop the in-memory
                // copy too, or the next flush would write it straight back.
                this._usage = {};
                this._usageDirty = true;
                await this._flushUsage();
                return;
            }

            this._render();
        });
        this._createIndicator();

        this._usage = await this._readUsage();
        if (!this._indicator) return;
        this._previousStats = await this._readNetworkStats();
        if (!this._indicator) return;
        this._hasSelectedInterface = this._previousStats?.hasSelectedInterface ?? false;
        this._render();
        this._restartTimer();
        this._startUsageFlushTimer();
    }

    disable() {
        if (this._timeoutId) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = 0;
        }

        if (this._usageFlushTimeoutId) {
            GLib.Source.remove(this._usageFlushTimeoutId);
            this._usageFlushTimeoutId = 0;
        }

        this._flushUsageSync();

        this._cancellable?.cancel();
        this._cancellable = null;
        this._updating = false;
        this._usage = null;
        this._usageDirty = false;

        this._indicator?.destroy();
        this._indicator = null;
        this._previousStats = null;
        this._settings?.disconnect(this._settingsChangedId);
        this._settingsChangedId = 0;
        this._settings = null;
    }

    _createIndicator() {
        this._indicator?.destroy();

        this._indicator = new FluxBarIndicator(
            () => this.openPreferences(),
            () => this._refreshUsageSummary()
        );
        this._indicator.setTooltipEnabled(this._settings.get_boolean('show-hover-details'));

        // Index 1 in the right box is GNOME's default slot for status indicators;
        // in the left and center boxes, FluxBar goes after the existing items.
        const position = this._getPanelPosition();
        Main.panel.addToStatusArea(this.uuid, this._indicator, position === 'right' ? 1 : -1, position);
    }

    _refreshUsageSummary() {
        if (!this._indicator)
            return;

        const usage = this._usage ?? {};
        const today = usage[getTodayKey()] ?? {rxBytes: 0, txBytes: 0};
        const range = sumUsage(usage);

        this._indicator.setUsageSummary(
            `Today   ↓ ${formatBytes(today.rxBytes)}   ↑ ${formatBytes(today.txBytes)}`,
            `Last ${USAGE_DAYS_TO_KEEP} days   ↓ ${formatBytes(range.rxBytes)}   ↑ ${formatBytes(range.txBytes)}`
        );
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

    _startUsageFlushTimer() {
        if (this._usageFlushTimeoutId)
            GLib.Source.remove(this._usageFlushTimeoutId);

        this._usageFlushTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            USAGE_FLUSH_INTERVAL_MS,
            () => {
                this._flushUsage();
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

    _getIdleThreshold() {
        const threshold = this._settings?.get_int('idle-threshold') ?? DEFAULT_IDLE_THRESHOLD;

        if (VALID_IDLE_THRESHOLDS.includes(threshold))
            return threshold;

        return DEFAULT_IDLE_THRESHOLD;
    }

    _getPanelPosition() {
        const position = this._settings?.get_string('panel-position') ?? 'right';

        if (VALID_PANEL_POSITIONS.includes(position))
            return position;

        return 'right';
    }

    async _update() {
        if (!this._indicator || this._updating)
            return;

        this._updating = true;

        try {
            const currentStats = await this._readNetworkStats();

            if (!this._indicator) return;

            if (currentStats && this._previousStats) {
                let downloadBytes = 0;
                let uploadBytes = 0;
                const elapsedSeconds = (currentStats.timestamp - this._previousStats.timestamp) / GLib.USEC_PER_SEC;

                for (const name in currentStats.interfaces) {
                    const previous = this._previousStats.interfaces[name];

                    // Skip interfaces that appeared this tick: diffing their full
                    // cumulative counter against nothing would record a phantom spike.
                    if (!previous)
                        continue;

                    const current = currentStats.interfaces[name];
                    downloadBytes += Math.max(0, current.rxBytes - previous.rxBytes);
                    uploadBytes += Math.max(0, current.txBytes - previous.txBytes);
                }

                this._recordUsage(downloadBytes, uploadBytes);

                // The delta covers however long actually passed since the last
                // sample (the interval setting, plus any timer drift), not one second.
                if (elapsedSeconds > 0) {
                    this._downloadSpeed = Math.round(downloadBytes / elapsedSeconds);
                    this._uploadSpeed = Math.round(uploadBytes / elapsedSeconds);
                }
            }

            if (currentStats) {
                this._hasSelectedInterface = currentStats.hasSelectedInterface;
                this._previousStats = currentStats;
                this._render();
            }
        } finally {
            this._updating = false;
        }
    }

    async _readNetworkStats() {
        try {
            const file = Gio.File.new_for_path(PROC_NET_DEV);
            const [contents] = await file.load_contents_async(this._cancellable);
            const timestamp = GLib.get_monotonic_time();
            const decoder = new TextDecoder('utf-8');
            const lines = decoder.decode(contents).split('\n');

            const interfaces = {};
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
                interfaces[name] = {
                    rxBytes: Number.parseInt(fields[0], 10) || 0,
                    txBytes: Number.parseInt(fields[8], 10) || 0,
                };
            }

            return {interfaces, hasSelectedInterface, timestamp};
        } catch (error) {
            if (!isCancelled(error))
                console.error('FluxBar: Failed to read /proc/net/dev', error);
            return null;
        }
    }

    _render() {
        if (!this._indicator)
            return;

        this._indicator.setSpeedText(
            this._buildSpeedText(this._downloadSpeed, this._uploadSpeed),
            this._buildSpeedText(0, 0, true)
        );
        this._indicator.setTooltipText(this._buildTooltipText(this._downloadSpeed, this._uploadSpeed));
        this._updateVisibility(this._hasSelectedInterface, this._downloadSpeed + this._uploadSpeed);
        this._applyColor();
    }

    _updateVisibility(hasSelectedInterface, totalBytes) {
        if (!this._indicator)
            return;

        const hideWhenIdle = this._settings?.get_boolean('hide-when-idle') ?? true;
        const now = GLib.get_monotonic_time();

        if (hasSelectedInterface && totalBytes > this._getIdleThreshold())
            this._lastActiveTime = now;

        const recentlyActive = this._lastActiveTime > 0 && now - this._lastActiveTime < IDLE_HIDE_DELAY_US;
        this._indicator.setIndicatorVisible(!hideWhenIdle || (hasSelectedInterface && recentlyActive));
    }

    _useBits() {
        return this._settings?.get_string('unit-mode') === 'bits';
    }

    // With `widest`, returns the widest text this format can produce instead of
    // the real values (see widestRate()).
    _buildSpeedText(downloadBytes, uploadBytes, widest = false) {
        const speedFormat = this._getSpeedFormat();
        const compact = speedFormat !== 'standard';
        const useBits = this._useBits();
        const format = bytes => (widest ? widestRate(useBits, compact) : formatRate(bytes, useBits, compact));

        if (this._settings?.get_string('display-mode') === 'total') {
            const totalText = format(downloadBytes + uploadBytes);
            return compact ? totalText : `↕ ${totalText}`;
        }

        const downloadSpeed = format(downloadBytes);
        const uploadSpeed = format(uploadBytes);

        if (speedFormat === 'compact-arrows')
            return `${downloadSpeed}↓ ${uploadSpeed}↑`;

        if (speedFormat === 'compact-slash')
            return `${downloadSpeed} / ${uploadSpeed}`;

        return `↓ ${downloadSpeed} ↑ ${uploadSpeed}`;
    }

    _buildTooltipText(downloadBytes, uploadBytes) {
        const useBits = this._useBits();

        return [
            `Download: ${formatRate(downloadBytes, useBits, false)}`,
            `Upload: ${formatRate(uploadBytes, useBits, false)}`,
            `Total: ${formatRate(downloadBytes + uploadBytes, useBits, false)}`,
        ].join('\n');
    }

    _applyColor() {
        if (!this._indicator)
            return;

        const color = this._settings?.get_string('label-color') ?? '';
        const styleParts = [BASE_LABEL_STYLE];

        if (/^#[0-9a-fA-F]{6}$/.test(color))
            styleParts.push(`color: ${color};`);

        if (this._getTextWeight() === 'bold')
            styleParts.push('font-weight: bold;');

        this._indicator.setLabelStyle(styleParts.join(' '));
    }

    _recordUsage(downloadBytes, uploadBytes) {
        if (downloadBytes === 0 && uploadBytes === 0)
            return;

        if (!this._usage)
            return;

        const today = getTodayKey();

        if (!this._usage[today])
            this._usage[today] = {rxBytes: 0, txBytes: 0};
        this._usage[today].rxBytes += downloadBytes;
        this._usage[today].txBytes += uploadBytes;
        this._usageDirty = true;
    }

    async _flushUsage() {
        if (!this._usageDirty || !this._usage)
            return;

        this._usage = pruneUsage(this._usage);
        const payload = JSON.stringify(this._usage, null, 2);
        const filePath = getUsageFilePath();

        try {
            GLib.mkdir_with_parents(GLib.path_get_dirname(filePath), 0o755);
            const file = Gio.File.new_for_path(filePath);
            const bytes = new GLib.Bytes(new TextEncoder().encode(payload));
            await file.replace_contents_bytes_async(
                bytes, null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                this._cancellable
            );
            this._usageDirty = false;
        } catch (error) {
            if (!isCancelled(error))
                console.error('FluxBar: Failed to write usage data', error);
        }
    }

    _flushUsageSync() {
        // Only write when there is something new: if disable() lands before
        // _readUsage() finishes, this._usage is still {} and would wipe the file.
        if (!this._usageDirty || !this._usage)
            return;

        const filePath = getUsageFilePath();

        try {
            GLib.mkdir_with_parents(GLib.path_get_dirname(filePath), 0o755);
            GLib.file_set_contents(filePath, JSON.stringify(pruneUsage(this._usage), null, 2));
            this._usageDirty = false;
        } catch (error) {
            console.error('FluxBar: Failed to write usage data', error);
        }
    }

    async _readUsage() {
        try {
            const file = Gio.File.new_for_path(getUsageFilePath());
            const [contents] = await file.load_contents_async(this._cancellable);
            const decoder = new TextDecoder('utf-8');
            const usage = JSON.parse(decoder.decode(contents));

            if (usage && typeof usage === 'object')
                return usage;
        } catch (error) {
            if (isCancelled(error))
                return {};

            // A corrupt file (invalid JSON) is logged and treated as empty rather
            // than aborting enable().
            if (!(error instanceof GLib.Error && error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)))
                console.error('FluxBar: Failed to read usage data', error);
        }

        return {};
    }
}
