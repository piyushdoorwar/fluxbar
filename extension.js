import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

const UPDATE_INTERVAL_SECONDS = 1;
const PROC_NET_DEV = '/proc/net/dev';

const FluxBarIndicator = GObject.registerClass(
class FluxBarIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'FluxBar Indicator');

        this._label = new St.Label({
            text: '↓ 0 B/s ↑ 0 B/s',
        });

        this.add_child(this._label);
    }

    setSpeedText(text) {
        this._label.text = text;
    }
});

export default class FluxBarExtension extends Extension {
    enable() {
        this._timeoutId = 0;
        this._indicator = new FluxBarIndicator();
        this._previousStats = this._readNetworkStats();

        Main.panel.addToStatusArea(this.uuid, this._indicator);
        this._update();

        this._timeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            UPDATE_INTERVAL_SECONDS,
            () => {
                this._update();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    disable() {
        if (this._timeoutId) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = 0;
        }

        this._indicator?.destroy();
        this._indicator = null;
        this._previousStats = null;
    }

    _update() {
        if (!this._indicator)
            return;

        const currentStats = this._readNetworkStats();

        if (currentStats && this._previousStats) {
            const downloadBytes = Math.max(0, currentStats.rxBytes - this._previousStats.rxBytes);
            const uploadBytes = Math.max(0, currentStats.txBytes - this._previousStats.txBytes);

            this._indicator.setSpeedText(
                `↓ ${this._formatSpeed(downloadBytes)} ↑ ${this._formatSpeed(uploadBytes)}`
            );
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
        if (bytesPerSecond < 1024)
            return `${bytesPerSecond} B/s`;

        const kibPerSecond = bytesPerSecond / 1024;

        if (kibPerSecond < 1024)
            return `${Math.round(kibPerSecond)} KB/s`;

        const mibPerSecond = kibPerSecond / 1024;
        return `${mibPerSecond.toFixed(1)} MB/s`;
    }
}
