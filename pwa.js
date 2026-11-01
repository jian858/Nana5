(() => {
  const style = document.createElement("style");
  style.textContent = `
    #murmur-connection-overlay{position:fixed;inset:0;z-index:2147483000;display:none;align-items:center;justify-content:center;padding:24px;background:rgba(8,15,25,.72);backdrop-filter:blur(7px);font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    #murmur-connection-overlay.show{display:flex}
    #murmur-connection-card{width:min(100%,390px);padding:30px 24px;border-radius:22px;background:#fff;color:#17212b;text-align:center;box-shadow:0 18px 70px #0005;animation:murmur-pop-in .22s ease-out}
    #murmur-connection-mark{width:54px;height:54px;margin:0 auto 16px;border-radius:50%;display:grid;place-items:center;background:#eef1f4;color:#354252;font-size:25px;font-weight:800}
    #murmur-connection-title{margin:0 0 9px;font-size:22px;line-height:1.25;font-weight:750}
    #murmur-connection-message{margin:0;color:#5d6875;font-size:14px;line-height:1.55}
    #murmur-connection-overlay.online{background:rgba(8,15,25,.48)}
    #murmur-connection-overlay.online #murmur-connection-mark{background:#e2f8f1;color:#087b5b}
    @keyframes murmur-pop-in{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}
    #murmur-install-button{position:fixed;z-index:1200;right:16px;bottom:calc(18px + env(safe-area-inset-bottom));display:none;align-items:center;gap:8px;border:0;border-radius:999px;padding:13px 18px;background:#14c8a0;color:#073c32;font:700 14px system-ui,sans-serif;box-shadow:0 5px 20px #0003}
    #murmur-install-button.show{display:flex}
    @media(prefers-reduced-motion:reduce){#murmur-connection-card{animation:none}}
  `;
  document.head.appendChild(style);

  const overlay = document.createElement("div");
  overlay.id = "murmur-connection-overlay";
  overlay.setAttribute("role", "alertdialog");
  overlay.setAttribute("aria-live", "assertive");
  overlay.setAttribute("aria-modal", "true");
  overlay.innerHTML = '<div id="murmur-connection-card"><div id="murmur-connection-mark" aria-hidden="true">!</div><h2 id="murmur-connection-title">You are offline</h2><p id="murmur-connection-message">Check your internet connection. Some Murmur features will be unavailable until you reconnect.</p></div>';
  document.body.appendChild(overlay);

  const title = overlay.querySelector("#murmur-connection-title");
  const message = overlay.querySelector("#murmur-connection-message");
  const mark = overlay.querySelector("#murmur-connection-mark");
  let onlineTimer = null;
  let lastOnline = navigator.onLine;

  function showOffline() {
    clearTimeout(onlineTimer);
    overlay.classList.remove("online");
    title.textContent = "You're offline";
    message.textContent = "Your internet connection was lost. Check your connection. Murmur will let you know when you're back online.";
    mark.textContent = "!";
    overlay.classList.add("show");
  }

  function showOnline() {
    clearTimeout(onlineTimer);
    overlay.classList.add("online", "show");
    title.textContent = "You're back online";
    message.textContent = "Your internet connection has been restored. You can continue using Murmur.";
    mark.textContent = "✓";
    onlineTimer = setTimeout(() => {
      overlay.classList.remove("show", "online");
    }, 4000);
  }

  window.addEventListener("offline", () => {
    lastOnline = false;
    showOffline();
  });
  window.addEventListener("online", () => {
    if (!lastOnline) showOnline();
    lastOnline = true;
  });

  if (!navigator.onLine) {
    lastOnline = false;
    showOffline();
  }

  const installButton = document.createElement("button");
  installButton.id = "murmur-install-button";
  installButton.type = "button";
  installButton.textContent = "Install Murmur";
  installButton.setAttribute("aria-label", "Install Murmur app");
  document.body.appendChild(installButton);

  let installPrompt = null;
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    installPrompt = event;
    if (!window.matchMedia("(display-mode: standalone)").matches) installButton.classList.add("show");
  });

  installButton.addEventListener("click", async () => {
    if (!installPrompt) return;
    installButton.disabled = true;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => null);
    installPrompt = null;
    installButton.classList.remove("show");
    installButton.disabled = false;
  });

  window.addEventListener("appinstalled", () => {
    installButton.classList.remove("show");
    title.textContent = "Murmur installed";
    message.textContent = "Murmur has been installed on your device.";
    mark.textContent = "✓";
    overlay.classList.add("online", "show");
    clearTimeout(onlineTimer);
    onlineTimer = setTimeout(() => overlay.classList.remove("show", "online"), 3500);
  });

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/service-worker.js")
        .then(registration => registration.update().catch(() => {}))
        .catch(error => console.warn("Murmur offline support could not start:", error));
    }, { once: true });
  }
})();