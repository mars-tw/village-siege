(function () {
  "use strict";

  var script = document.currentScript;
  var panel = document.getElementById("startup-status");
  var title = document.getElementById("startup-title");
  var message = document.getElementById("startup-message");
  var detail = document.getElementById("startup-detail");
  var controls = document.getElementById("startup-controls");
  var retry = document.getElementById("startup-retry");
  var repair = document.getElementById("startup-repair");
  var note = document.getElementById("startup-repair-note");
  if (!panel || !title || !message || !detail || !controls || !retry || !repair || !note) return;

  var ready = false;
  var failed = false;
  var repairing = false;
  var base = null;
  var playUrl = null;
  var timer = null;

  function revealActions() {
    controls.hidden = false;
    note.hidden = false;
    repair.disabled = !base || !playUrl || typeof Promise === "undefined";
  }

  function reportFailure(browserMessage) {
    if (ready) return;
    failed = true;
    window.clearTimeout(timer);
    title.textContent = "遊戲沒有完成啟動";
    message.textContent = "瀏覽器無法完成載入。請重新載入；若仍打不開，可修復這個遊戲的舊版下載資料。";
    detail.textContent = browserMessage || "瀏覽器沒有提供錯誤訊息。";
    detail.hidden = false;
    revealActions();
  }

  function errorMessage(value) {
    var text = typeof value === "string" ? value : value && typeof value.message === "string" ? value.message : "未知的啟動錯誤";
    return text.replace(/[\r\n\t]+/g, " ").slice(0, 240);
  }

  function isOwnRegistration(registration) {
    try {
      var scope = new URL(registration.scope);
      return scope.origin === base.origin && scope.pathname === base.pathname && !scope.search && !scope.hash;
    } catch (_error) {
      return false;
    }
  }

  function withTimeout(work, milliseconds) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timeout = window.setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error("瀏覽器修復逾時，請再試一次。"));
      }, milliseconds);
      work.then(function (result) {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        resolve(result);
      }, function (error) {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        reject(error);
      });
    });
  }

  function repairThisGame() {
    if (repairing || !base || !playUrl || typeof Promise === "undefined") return;
    repairing = true;
    retry.disabled = true;
    repair.disabled = true;
    window.clearTimeout(timer);
    title.textContent = "正在修復這個遊戲";
    message.textContent = "正在移除這款遊戲的舊版下載資料，完成後會開啟新版。";
    detail.hidden = true;
    var cachePrefix = "village-siege:" + encodeURIComponent(base.href) + ":";
    var unregister = navigator.serviceWorker && typeof navigator.serviceWorker.getRegistrations === "function"
      ? Promise.resolve().then(function () { return navigator.serviceWorker.getRegistrations(); }).then(function (registrations) {
        return Promise.all(registrations.filter(isOwnRegistration).map(function (registration) { return registration.unregister(); }));
      })
      : Promise.resolve([]);
    var removeCaches = window.caches && typeof window.caches.keys === "function"
      ? Promise.resolve().then(function () { return window.caches.keys(); }).then(function (names) {
        return Promise.all(names.filter(function (name) { return name.indexOf(cachePrefix) === 0; }).map(function (name) { return window.caches.delete(name); }));
      })
      : Promise.resolve([]);
    withTimeout(Promise.all([unregister, removeCaches]), 12000).then(function () {
      window.location.replace(playUrl.href);
    }, function (error) {
      repairing = false;
      retry.disabled = false;
      repair.disabled = false;
      title.textContent = "修復沒有完成";
      message.textContent = "瀏覽器沒有完成移除舊版下載資料。可再試一次，或先重新載入。";
      detail.textContent = errorMessage(error);
      detail.hidden = false;
      revealActions();
    });
  }

  try {
    var rawBase = script ? script.getAttribute("data-base") : "./";
    base = new URL(rawBase || "./", window.location.href);
    if (base.origin !== window.location.origin || (base.protocol !== "https:" && base.protocol !== "http:")) throw new Error("遊戲入口網址不正確，請從原本的遊戲網址重新開啟。");
    if (base.pathname.charAt(base.pathname.length - 1) !== "/") base.pathname += "/";
    base.search = "";
    base.hash = "";
    playUrl = new URL("play.html", base.href);
  } catch (error) {
    base = null;
    playUrl = null;
    reportFailure(errorMessage(error));
  }

  retry.addEventListener("click", function () {
    if (!repairing) window.location.reload();
  });
  repair.addEventListener("click", repairThisGame);
  window.addEventListener("village-siege-ready", function () {
    ready = true;
    window.clearTimeout(timer);
    panel.hidden = true;
  });
  window.addEventListener("error", function (event) {
    if (ready) return;
    if (typeof event.message === "string" && event.message) {
      reportFailure(errorMessage(event.message));
      return;
    }
    var target = event.target;
    if (target && target.tagName === "SCRIPT") reportFailure("遊戲程式下載失敗，請確認網路連線後重試。");
  }, true);
  window.addEventListener("unhandledrejection", function (event) {
    reportFailure(errorMessage(event.reason));
  });
  if (!failed) timer = window.setTimeout(function () {
    if (ready || repairing) return;
    title.textContent = "遊戲仍在載入";
    message.textContent = "第一次開啟或網路較慢時需要較久。可繼續等候，或重新載入。";
    revealActions();
  }, 15000);
}());
