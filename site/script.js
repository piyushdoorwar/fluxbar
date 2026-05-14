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
const labelColorValue = document.querySelector('#labelColorValue');
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
  labelColorValue.textContent = labelColor.value;
}

function randomizeSpeeds() {
  downloadBytes = Math.round(36000 + Math.random() * 760000);
  uploadBytes = Math.round(12000 + Math.random() * 190000);
  render();
}

[displayMode, speedFormat, unitMode, labelColor, boldText].forEach((control) => {
  control.addEventListener('input', render);
});

function closeCustomSelects(exceptSelect) {
  document.querySelectorAll('.custom-select.is-open').forEach((customSelect) => {
    if (customSelect === exceptSelect) return;

    customSelect.classList.remove('is-open');
    customSelect.querySelector('.custom-select-button')?.setAttribute('aria-expanded', 'false');
  });
}

function initCustomSelect(customSelect) {
  const select = document.querySelector(`#${customSelect.dataset.select}`);
  const button = document.createElement('button');
  const options = document.createElement('div');

  button.type = 'button';
  button.className = 'custom-select-button';
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  options.className = 'custom-options';
  options.setAttribute('role', 'listbox');

  function syncLabel() {
    const selectedOption = select.options[select.selectedIndex];
    button.textContent = selectedOption.textContent;

    options.querySelectorAll('.custom-option').forEach((optionButton) => {
      const isSelected = optionButton.dataset.value === select.value;
      optionButton.classList.toggle('is-selected', isSelected);
      optionButton.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    });
  }

  Array.from(select.options).forEach((option) => {
    const optionButton = document.createElement('button');
    optionButton.type = 'button';
    optionButton.className = 'custom-option';
    optionButton.dataset.value = option.value;
    optionButton.textContent = option.textContent;
    optionButton.setAttribute('role', 'option');
    optionButton.addEventListener('click', () => {
      select.value = option.value;
      select.dispatchEvent(new Event('input', {bubbles: true}));
      syncLabel();
      customSelect.classList.remove('is-open');
      button.setAttribute('aria-expanded', 'false');
      button.focus();
    });
    options.append(optionButton);
  });

  button.addEventListener('click', () => {
    const shouldOpen = !customSelect.classList.contains('is-open');
    closeCustomSelects(customSelect);
    customSelect.classList.toggle('is-open', shouldOpen);
    button.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
  });

  button.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      customSelect.classList.remove('is-open');
      button.setAttribute('aria-expanded', 'false');
    }
  });

  customSelect.append(button, options);
  syncLabel();
}

document.querySelectorAll('.custom-select').forEach(initCustomSelect);

document.addEventListener('click', (event) => {
  if (!event.target.closest('.custom-select')) closeCustomSelects();
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
