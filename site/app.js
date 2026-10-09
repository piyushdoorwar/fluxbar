/*
 * FluxBar site behaviour: mobile menu, copy buttons, scroll reveal, the GNOME
 * download count, and the live top bar preview in the hero and preferences mocks.
 */
(function () {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const SPRITE = "assets/icons.svg";

  // ---- Mobile navigation ------------------------------------------------
  const topbar = document.querySelector(".topbar");
  const toggle = document.querySelector(".nav-toggle");
  if (topbar && toggle) {
    const setOpen = (open) => {
      topbar.classList.toggle("open", open);
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    };
    toggle.addEventListener("click", () => setOpen(!topbar.classList.contains("open")));
    topbar.querySelectorAll(".nav a").forEach((a) => a.addEventListener("click", () => setOpen(false)));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") setOpen(false);
    });
  }

  // ---- GNOME download count ---------------------------------------------
  // .github/workflows/refresh-extension-stats.yml writes data/extension-stats.json
  // daily from the GNOME Extensions API. The number in the HTML is the fallback.
  const extensionDownloads = document.getElementById("extensionDownloads");
  if (extensionDownloads) {
    fetch("data/extension-stats.json", { cache: "no-cache" })
      .then((res) => (res.ok ? res.json() : null))
      .then((stats) => {
        if (!stats || !Number.isInteger(stats.downloads) || stats.downloads < 0) return;
        extensionDownloads.textContent = new Intl.NumberFormat().format(stats.downloads);
        if (stats.generatedAt) {
          const updated = new Date(stats.generatedAt);
          if (!Number.isNaN(updated.getTime())) {
            extensionDownloads.title = `Updated ${updated.toLocaleDateString()}`;
          }
        }
      })
      .catch(() => {});
  }

  // ---- Copy buttons -----------------------------------------------------
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      ta.remove();
      return ok;
    }
  }

  document.addEventListener("click", async (event) => {
    const btn = event.target.closest(".copy-btn");
    if (!btn) return;
    const text = btn.dataset.copy ?? btn.closest(".cmd")?.querySelector("code")?.innerText ?? "";
    const ok = await copyText(text);
    const label = btn.querySelector("span");
    btn.classList.toggle("done", ok);
    if (label) label.textContent = ok ? "Copied" : "Press Ctrl+C";
    clearTimeout(btn._timer);
    btn._timer = setTimeout(() => {
      btn.classList.remove("done");
      if (label) label.textContent = "Copy";
    }, 1800);
  });

  // ---- Scroll reveal ----------------------------------------------------
  const revealEls = document.querySelectorAll("[data-reveal]");
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          // Elements above the viewport (after an anchor jump or reload) are shown as well.
          if (entry.isIntersecting || entry.boundingClientRect.top < 0) {
            entry.target.classList.add("in");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px -40px 0px" }
    );
    revealEls.forEach((el) => observer.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add("in"));
  }

  // ---- Speed readout ----------------------------------------------------
  // Mirrors the extension's formatting: bytes use base 1024, bits use base 1000.
  const readouts = document.querySelectorAll("[data-readout]");
  if (!readouts.length) return;

  const state = { display: "separate", format: "standard", units: "bytes", color: "#f6f7fb", bold: false };
  let downloadBytes = 122880;
  let uploadBytes = 35840;

  function formatSpeed(bytesPerSecond) {
    if (state.units === "bits") {
      const bits = bytesPerSecond * 8;
      if (bits < 1000) return `${bits} b/s`;
      if (bits < 1000000) return `${Math.round(bits / 1000)} Kb/s`;
      return `${(bits / 1000000).toFixed(1)} Mb/s`;
    }
    if (bytesPerSecond < 1024) return `${bytesPerSecond} B/s`;
    if (bytesPerSecond < 1048576) return `${Math.round(bytesPerSecond / 1024)} KB/s`;
    return `${(bytesPerSecond / 1048576).toFixed(1)} MB/s`;
  }

  function formatCompact(bytesPerSecond) {
    const useBits = state.units === "bits";
    const base = useBits ? 1000 : 1024;
    const units = useBits ? ["b", "Kb", "Mb", "Gb"] : ["B", "K", "M", "G"];
    let scaled = useBits ? bytesPerSecond * 8 : bytesPerSecond;
    let unit = 0;
    while (scaled >= base && unit < units.length - 1) {
      scaled /= base;
      unit += 1;
    }
    const shown = scaled < 10 && unit > 0 ? scaled.toFixed(1) : Math.round(scaled).toString();
    return `${shown}${units[unit]}`;
  }

  // Readout parts: strings are text, {icon} entries become sprite icons.
  function readoutParts() {
    const total = downloadBytes + uploadBytes;
    if (state.format !== "standard") {
      if (state.display === "total") return [formatCompact(total)];
      const down = formatCompact(downloadBytes);
      const up = formatCompact(uploadBytes);
      if (state.format === "compact-arrows") return [down, { icon: "arrow-down" }, " " + up, { icon: "arrow-up" }];
      return [`${down} / ${up}`];
    }
    if (state.display === "total") return [{ icon: "arrow-up-down" }, formatSpeed(total)];
    return [{ icon: "arrow-down" }, formatSpeed(downloadBytes) + " ", { icon: "arrow-up" }, formatSpeed(uploadBytes)];
  }

  function icon(name) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("class", "ic");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS(ns, "use");
    use.setAttribute("href", `${SPRITE}#i-${name}`);
    svg.appendChild(use);
    return svg;
  }

  function render() {
    const parts = readoutParts();
    const label = parts.map((p) => (typeof p === "string" ? p : { "arrow-down": "down ", "arrow-up": "up ", "arrow-up-down": "total " }[p.icon])).join("");
    readouts.forEach((el) => {
      el.replaceChildren(...parts.map((p) => (typeof p === "string" ? document.createTextNode(p) : icon(p.icon))));
      el.setAttribute("aria-label", label.trim());
      el.style.color = state.color;
      el.style.fontWeight = state.bold ? "800" : "600";
    });
    const values = {
      down: formatSpeed(downloadBytes),
      up: formatSpeed(uploadBytes),
      total: formatSpeed(downloadBytes + uploadBytes),
    };
    document.querySelectorAll("[data-tip]").forEach((el) => {
      el.textContent = values[el.dataset.tip];
    });
  }

  // Segmented controls in the preferences preview
  document.querySelectorAll(".seg[data-control]").forEach((group) => {
    const buttons = Array.from(group.querySelectorAll("button"));
    const select = (btn) => {
      buttons.forEach((b) => {
        const on = b === btn;
        b.setAttribute("aria-checked", String(on));
        b.tabIndex = on ? 0 : -1;
      });
      state[group.dataset.control] = btn.dataset.value;
      render();
    };
    buttons.forEach((btn, i) => {
      btn.tabIndex = btn.getAttribute("aria-checked") === "true" ? 0 : -1;
      btn.addEventListener("click", () => select(btn));
      btn.addEventListener("keydown", (e) => {
        const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        const next = buttons[(i + step + buttons.length) % buttons.length];
        select(next);
        next.focus();
      });
    });
  });

  const labelColor = document.getElementById("labelColor");
  const labelColorValue = document.getElementById("labelColorValue");
  if (labelColor) {
    labelColor.addEventListener("input", () => {
      state.color = labelColor.value;
      labelColorValue.textContent = labelColor.value;
      render();
    });
  }
  const boldText = document.getElementById("boldText");
  if (boldText) {
    boldText.addEventListener("change", () => {
      state.bold = boldText.checked;
      render();
    });
  }

  // Hero: the readout shows its tooltip on hover, focus or click, like the extension.
  const heroReadout = document.getElementById("heroReadout");
  const heroTip = document.getElementById("heroTip");
  if (heroReadout && heroTip) {
    let pinned = false;
    const show = (on) => {
      heroTip.classList.toggle("is-visible", on || pinned);
      heroReadout.classList.toggle("is-active", on || pinned);
    };
    heroReadout.addEventListener("mouseenter", () => show(true));
    heroReadout.addEventListener("mouseleave", () => show(false));
    heroReadout.addEventListener("focus", () => show(true));
    heroReadout.addEventListener("blur", () => show(false));
    heroReadout.addEventListener("click", () => {
      pinned = !pinned;
      show(pinned);
    });
  }

  // Hero: Settings / History tabs in the preferences window
  const heroTabs = Array.from(document.querySelectorAll("[data-hero-tab]"));
  const selectTab = (tab) => {
    heroTabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
    });
    document.querySelectorAll("[data-hero-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.heroPanel !== tab.dataset.heroTab;
    });
  };
  heroTabs.forEach((tab, i) => {
    tab.addEventListener("click", () => selectTab(tab));
    tab.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const next = heroTabs[(i + (e.key === "ArrowRight" ? 1 : -1) + heroTabs.length) % heroTabs.length];
      selectTab(next);
      next.focus();
    });
  });

  render();

  // Let the speed move a little, like a real network.
  if (!reduceMotion) {
    setInterval(() => {
      downloadBytes = Math.round(36000 + Math.random() * 760000);
      uploadBytes = Math.round(12000 + Math.random() * 190000);
      render();
    }, 1800);
  }
})();
