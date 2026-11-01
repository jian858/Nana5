(() => {
  const style = document.createElement("style");
  style.textContent = `
    #murmur-pwa-status{position:fixed;z-index:2000;top:calc(12px + env(safe-area-inset-top));left:50%;transform:translate(-50%,-12px);width:min( calc(100% - 28px), 430px);padding:13px 16px;border-radius:14px;background:#182333;color:#fff;box-shadow:0 8px 28px #0003;font:600 14px/1.4 system-ui,sans-serif;text-align:center;opacity:0;pointer-events:none;transition:opacity .22s ease,transform .22s ease}
    #murmur-pwa-status.show{opacity:1;transform:translate(-50%,0)}
    #murmur-install-button{position:fixed;z-index:1200;right:16px;bottom:calc(18px + env(safe-area-inset-bottom));display:none;align-items:center;gap:8px;border:0;border-radius:999px;padding:13px 18px;background:#14c8a0;color:#073c32;font:700 14px system-ui,sans-serif;box-shadow:0 5px 20px #0003}
    #murmur-install-button.show{display:flex}
    @media(prefers-reduced-motion:reduce){#murmur-pwa-status{transition:none}}
  `;
  document.head.appendChild(style);

  const status = document.createElement("div");
  status.id = "murmur-pwa-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  document.body.appendChild(status);

  let statusTimer;
  function notify(message) {
    status.textContent = message;
    status.classList.add("show");
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => status.classList.remove("show"), 4200);
  }

  function connectionState() {
    if (navigator.onLine) {
      notify("You're online again. Murmur is connected.");
    } else {
      notify("You're offline. Some Murmur features need an internet connection.");
    }
  }

  window.addEventListener("offline", () => notify("You're offline. Some Murmur features need an internet connection."));
  window.addEventListener("online", () => notify("You're online again. Murmur is connected."));

  if (!navigator.onLine) {
    setTimeout(() => notify("You're offline. Some Murmur features need an internet connection."), 500);
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
    notify("Murmur has been installed.");
  });

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/service-worker.js")
        .then(registration => registration.update().catch(() => {}))
        .catch(error => console.warn("Murmur offline support could not start:", error));
    }, { once: true });
  }
})();
