const speedText = document.querySelector('#speedText');
const fluxPill = document.querySelector('#fluxPill');
const tooltip = document.querySelector('#fluxTooltip');
const tipDown = document.querySelector('#tipDown');
const tipUp = document.querySelector('#tipUp');
const tipTotal = document.querySelector('#tipTotal');
const displayMode = document.querySelector('#displayMode');
const speedFormat = document.querySelector('#speedFormat');
const unitMode = document.querySelector('#unitMode');
const labelColor = document.querySelector('#labelColor');
const boldText = document.querySelector('#boldText');
const copyButton = document.querySelector('.copy-button');

let downloadBytes = 122880;
let uploadBytes = 35840;

function formatSpeed(bytesPerSecond) {
  if (unitMode.value === 'bits') {
    const bitsPerSecond = bytesPerSecond * 8;

    if (bitsPerSecond < 1000) return `${bitsPerSecond} b/s`;
    if (bitsPerSecond < 1000000) return `${Math.round(bitsPerSecond / 1000)} Kb/s`;
    return `${(bitsPerSecond / 1000000).toFixed(1)} Mb/s`;
  }

  if (bytesPerSecond < 1024) return `${bytesPerSecond} B/s`;
  if (bytesPerSecond < 1048576) return `${Math.round(bytesPerSecond / 1024)} KB/s`;
  return `${(bytesPerSecond / 1048576).toFixed(1)} MB/s`;
}

function formatCompact(bytesPerSecond) {
  const useBits = unitMode.value === 'bits';
  const value = useBits ? bytesPerSecond * 8 : bytesPerSecond;
  const base = useBits ? 1000 : 1024;
  const units = useBits ? ['b', 'Kb', 'Mb', 'Gb'] : ['B', 'K', 'M', 'G'];
  let scaled = value;
  let unitIndex = 0;

  while (scaled >= base && unitIndex < units.length - 1) {
    scaled /= base;
    unitIndex += 1;
  }

  const shown = scaled < 10 && unitIndex > 0 ? scaled.toFixed(1) : Math.round(scaled).toString();
  return `${shown}${units[unitIndex]}`;
}

function buildSpeedText() {
  const total = downloadBytes + uploadBytes;

  if (speedFormat.value !== 'standard') {
    if (displayMode.value === 'total') return formatCompact(total);

    const down = formatCompact(downloadBytes);
    const up = formatCompact(uploadBytes);
    return speedFormat.value === 'compact-arrows' ? `${down}↓ ${up}↑` : `${down} / ${up}`;
  }

  if (displayMode.value === 'total') return `↕ ${formatSpeed(total)}`;
  return `↓ ${formatSpeed(downloadBytes)} ↑ ${formatSpeed(uploadBytes)}`;
}

function render() {
  const down = formatSpeed(downloadBytes);
  const up = formatSpeed(uploadBytes);
  const total = formatSpeed(downloadBytes + uploadBytes);

  speedText.textContent = buildSpeedText();
  tipDown.textContent = down;
  tipUp.textContent = up;
  tipTotal.textContent = total;
  fluxPill.style.color = labelColor.value;
  fluxPill.style.fontWeight = boldText.checked ? '800' : '700';
}

function randomizeSpeeds() {
  downloadBytes = Math.round(36000 + Math.random() * 760000);
  uploadBytes = Math.round(12000 + Math.random() * 190000);
  render();
}

[displayMode, speedFormat, unitMode, labelColor, boldText].forEach((control) => {
  control.addEventListener('input', render);
});

fluxPill.addEventListener('click', () => {
  tooltip.classList.toggle('is-visible');
  fluxPill.classList.toggle('is-active');
});

copyButton.addEventListener('click', async () => {
  const target = document.querySelector(`#${copyButton.dataset.copy}`);
  const text = target.textContent.trim();

  try {
    await navigator.clipboard.writeText(text);
    copyButton.textContent = 'Copied';
    window.setTimeout(() => {
      copyButton.textContent = 'Copy';
    }, 1400);
  } catch {
    copyButton.textContent = 'Select text';
  }
});

render();
window.setInterval(randomizeSpeeds, 1800);
