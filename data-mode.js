/* Murmur Data Mode
 * Low-data mode reduces optional media downloads. It cannot provide free carrier
 * internet access; live sync still requires a network connection.
 */
(() => {
  "use strict";
  const KEY = "murmur-low-data-mode";
  let lowData = false;
  let manualChoice = false;
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;

  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "on" || saved === "off") {
      lowData = saved === "on";
      manualChoice = true;
    } else {
      lowData = !!(connection && (connection.saveData || /(^|-)2g$/.test(connection.effectiveType || "")));
    }
  } catch {
    lowData = !!(connection && (connection.saveData || /(^|-)2g$/.test(connection.effectiveType || "")));
  }

  const style = document.createElement("style");
  style.textContent = `
    html.murmur-low-data .murmur-data-media-hidden{visibility:hidden!important}
    html.murmur-low-data video{background:#111;object-fit:contain}
    #murmurDataModeRow{display:flex;align-items:center;justify-content:space-between;gap:12px}
    #murmurDataModeToggle{border:0;border-radius:999px;padding:8px 13px;background:#e8edf1;color:#253342;font:700 13px system-ui;white-space:nowrap}
    #murmurDataModeToggle[aria-pressed="true"]{background:#d9f7ee;color:#075b49}
    #murmurDataModeHelp{margin:2px 14px 12px;color:var(--muted,#687386);font-size:12px;line-height:1.45}
  `;
  document.head.appendChild(style);

  function deferImage(img) {
    if (!(img instanceof HTMLImageElement) || img.closest(".avatar")) return;
    if (img.getAttribute("src") && !img.dataset.murmurDeferredSrc) {
      img.dataset.murmurDeferredSrc = img.getAttribute("src");
      img.removeAttribute("src");
      img.classList.add("murmur-data-media-hidden");
    }
    if (img.getAttribute("srcset") && !img.dataset.murmurDeferredSrcset) {
      img.dataset.murmurDeferredSrcset = img.getAttribute("srcset");
      img.removeAttribute("srcset");
    }
  }

  function setMode(enabled) {
    lowData = !!enabled;
    document.documentElement.classList.toggle("murmur-low-data", lowData);
    document.querySelectorAll("#murmurDataModeToggle").forEach(button => {
      button.setAttribute("aria-pressed", String(lowData));
      button.textContent = lowData ? "On" : "Off";
      button.setAttribute("aria-label", "Free Data Mode " + (lowData ? "on" : "off"));
    });
    document.querySelectorAll("img").forEach(img => {
      if (img.closest(".avatar")) return;
      if (lowData) {
        deferImage(img);
      } else {
        if (img.dataset.murmurDeferredSrc) {
          img.setAttribute("src", img.dataset.murmurDeferredSrc);
          delete img.dataset.murmurDeferredSrc;
        }
        if (img.dataset.murmurDeferredSrcset) {
          img.setAttribute("srcset", img.dataset.murmurDeferredSrcset);
          delete img.dataset.murmurDeferredSrcset;
        }
        img.classList.remove("murmur-data-media-hidden");
      }
    });
    document.querySelectorAll("video").forEach(video => {
      if (lowData) {
        video.pause();
        video.preload = "none";
        video.removeAttribute("autoplay");
      } else {
        video.preload = "metadata";
      }
    });
    const status = document.getElementById("murmurDataModeStatus");
    if (status) status.textContent = lowData ? "Text-first browsing. Photos and videos are held back." : "Photos and videos can load normally.";
  }

  function addMenuControl() {
    const settings = document.getElementById("settingsPrivacyContent");
    if (!settings || document.getElementById("murmurDataModeRow")) return;
    const row = document.createElement("div");
    row.className = "menu-row";
    row.id = "murmurDataModeRow";
    row.innerHTML = '<span>Free Data Mode</span><button type="button" id="murmurDataModeToggle" aria-pressed="false">Off</button>';
    settings.prepend(row);
    const help = document.createElement("p");
    help.id = "murmurDataModeHelp";
    help.textContent = "Saves mobile data by holding back photos and videos. Messages and live updates still need an internet connection. This does not make mobile data free.";
    row.insertAdjacentElement("afterend", help);
    document.getElementById("murmurDataModeToggle").addEventListener("click", () => {
      manualChoice = true;
      try { localStorage.setItem(KEY, lowData ? "off" : "on"); } catch {}
      setMode(!lowData);
    });
    setMode(lowData);
  }

  const observer = new MutationObserver(records => {
    if (!lowData) return;
    for (const record of records) {
      if (record.type === "childList") {
        record.addedNodes.forEach(node => {
          if (node.nodeType !== 1) return;
          if (node.matches?.("img")) deferImage(node);
          node.querySelectorAll?.("img").forEach(deferImage);
          node.querySelectorAll?.("video").forEach(video => { video.pause(); video.preload = "none"; });
        });
      } else if (record.type === "attributes" && record.target instanceof HTMLImageElement) {
        deferImage(record.target);
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "srcset"] });

  document.addEventListener("DOMContentLoaded", () => {
    addMenuControl();
    setMode(lowData);
  });
  document.addEventListener("click", event => {
    if (event.target.closest?.("#settingsPrivacyToggle")) setTimeout(addMenuControl, 0);
  });
  if (connection && !manualChoice) {
    connection.addEventListener?.("change", () => {
      setMode(!!(connection.saveData || /(^|-)2g$/.test(connection.effectiveType || "")));
    });
  }
  window.MurmurDataMode = { isEnabled: () => lowData, setEnabled: setMode };
})();
