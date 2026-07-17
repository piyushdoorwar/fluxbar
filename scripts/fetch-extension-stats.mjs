// Fetch the public GNOME Extensions download count used by the static website.
// The generated snapshot changes only when the download count changes.

import {readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outputFile = join(root, 'site/data/extension-stats.json');
const extensionUuid = 'fluxbar@piyushdoorwar.github.io';
const endpoint = `https://extensions.gnome.org/api/v1/extensions/${encodeURIComponent(extensionUuid)}/`;

async function loadPrevious() {
    try {
        return JSON.parse(await readFile(outputFile, 'utf8'));
    } catch {
        return {};
    }
}

async function main() {
    const response = await fetch(endpoint, {
        headers: {Accept: 'application/json', 'User-Agent': 'fluxbar-site-stats'},
    });
    if (!response.ok)
        throw new Error(`GNOME Extensions API returned HTTP ${response.status}`);

    const extension = await response.json();
    if (!Number.isInteger(extension.downloads) || extension.downloads < 0)
        throw new Error('GNOME Extensions API returned an invalid download count');

    const previous = await loadPrevious();
    if (previous.downloads === extension.downloads) {
        console.log(`Download count is unchanged at ${extension.downloads}.`);
        return;
    }

    const snapshot = {
        generatedAt: new Date().toISOString(),
        downloads: extension.downloads,
    };
    await writeFile(outputFile, `${JSON.stringify(snapshot, null, 2)}\n`);
    console.log(`Updated GNOME download count to ${extension.downloads}.`);
}

main().catch((error) => {
    console.error(`Failed to refresh GNOME download count: ${error.message}`);
    process.exitCode = 1;
});
