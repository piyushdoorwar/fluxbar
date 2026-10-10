// Helpers shared by extension.js (gnome-shell process) and prefs.js (preferences
// process). Keep this module free of Shell- and GTK-specific imports so both can load it.

import GLib from 'gi://GLib';

export const USAGE_DAYS_TO_KEEP = 30;

export function getUsageFilePath() {
    return GLib.build_filenamev([GLib.get_user_data_dir(), 'fluxbar', 'usage.json']);
}

export function formatBytes(bytes) {
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

// Sums the most recent `days` entries of a usage map ({ "YYYY-MM-DD": {rxBytes, txBytes} }).
export function sumUsage(usage, days = USAGE_DAYS_TO_KEEP) {
    let rxBytes = 0;
    let txBytes = 0;

    for (const date of Object.keys(usage).sort().slice(-days)) {
        rxBytes += Number(usage[date]?.rxBytes) || 0;
        txBytes += Number(usage[date]?.txBytes) || 0;
    }

    return {rxBytes, txBytes};
}
