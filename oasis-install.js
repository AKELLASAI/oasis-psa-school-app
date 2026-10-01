/*
 * Oasis Pre School — "Install app" button (right side of the header; a floating button on phones).
 * Android phones: download the Oasis Android app.  Computers (Chrome / Edge): install this website as an app.
 * iPhone / iPad: shows the "Add to Home Screen" steps.  Hidden inside the apps themselves.
 */
(function () {
  'use strict';
  var ua = navigator.userAgent || '';
  var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  if (window.OASIS_ANDROID_APP || /OasisAndroid/.test(ua) || standalone) return;

  var isAndroid = /Android/i.test(ua);
  var isIOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  var hasApk = !!window.OASIS_SERVER_MODE;          // the server offers the Android app at /Oasis.apk
  var deferredPrompt = null;                         // Chrome / Edge "install this site" prompt

  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferredPrompt = e; });
  window.addEventListener('appinstalled', function () { deferredPrompt = null; hideButtons(); close(); });

  // ---------- styles (self-contained, so the button looks the same everywhere)
  var css = document.createElement('style');
  css.textContent =
    '.oi-btn{display:inline-flex;align-items:center;gap:6px;background:#059669;color:#fff;border:0;border-radius:12px;padding:8px 14px;' +
    'font-family:inherit;font-weight:700;font-size:12px;line-height:1;cursor:pointer;text-decoration:none;box-shadow:0 1px 2px rgba(0,0,0,.08);white-space:nowrap}' +
    '.oi-btn:hover{background:#047857}.oi-btn:focus-visible{outline:3px solid #6ee7b7;outline-offset:2px}' +
    '.oi-head{margin-right:4px}@media (max-width:639px){.oi-head{display:none}}' +
    '.oi-fab{position:fixed;right:16px;bottom:20px;z-index:40;border-radius:999px;padding:12px 16px;box-shadow:0 8px 24px rgba(4,120,87,.35)}' +
    '@media (min-width:640px){.oi-fab{display:none}}' +
    '.oi-fab .oi-x{margin-left:4px;opacity:.8;font-size:14px;line-height:1;padding:0 2px}' +
    '.oi-back{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:60;display:flex;align-items:flex-end;justify-content:center;padding:16px}' +
    '@media (min-width:640px){.oi-back{align-items:center}}' +
    '.oi-card{background:#fff;border-radius:20px;max-width:440px;width:100%;padding:22px;box-shadow:0 20px 50px rgba(0,0,0,.25);color:#1e293b;font-size:14px;line-height:1.5}' +
    '.oi-card h3{margin:0 0 4px;font-size:18px;font-weight:800;color:#0f172a}.oi-card p{margin:6px 0;color:#475569}' +
    '.oi-opt{border:1px solid #e2e8f0;border-radius:14px;padding:14px;margin-top:12px}' +
    '.oi-opt b{display:block;color:#0f172a;margin-bottom:2px}.oi-opt small{display:block;color:#64748b;font-size:12px;margin:2px 0 10px}' +
    '.oi-opt ol{margin:6px 0 0 18px;padding:0;color:#334155}.oi-opt li{margin:3px 0}' +
    '.oi-close{margin-top:14px;width:100%;background:#f1f5f9;color:#334155;border:0;border-radius:12px;padding:10px;font-weight:700;cursor:pointer}' +
    '.oi-close:hover{background:#e2e8f0}';
  document.head.appendChild(css);

  // ---------- the buttons
  var head = document.createElement('button');
  head.type = 'button';
  head.className = 'oi-btn oi-head';
  head.innerHTML = '<i class="fa-solid fa-download" aria-hidden="true"></i><span>Install app</span>';
  head.addEventListener('click', open);
  var right = document.getElementById('btnNotificationBell');
  right = right && right.closest('.flex.items-center.space-x-3');   // the header's right-hand group
  if (right) right.insertBefore(head, right.firstChild);

  var DISMISS = 'oasis_install_fab_hidden';
  var fab = null;
  var dismissed = false;
  try { dismissed = localStorage.getItem(DISMISS) === '1'; } catch (e) {}
  if (!dismissed) {
    fab = document.createElement('button');
    fab.type = 'button';
    fab.className = 'oi-btn oi-fab';
    fab.setAttribute('aria-label', 'Install the Oasis app');
    fab.innerHTML = '<i class="fa-solid fa-download" aria-hidden="true"></i><span>Install app</span><span class="oi-x" title="Hide" aria-label="Hide">&times;</span>';
    fab.addEventListener('click', function (e) {
      if (e.target.classList.contains('oi-x')) {
        fab.remove(); fab = null;
        try { localStorage.setItem(DISMISS, '1'); } catch (err) {}
        return;
      }
      open();
    });
    document.body.appendChild(fab);
  }
  function hideButtons() { head.remove(); if (fab) fab.remove(); }

  // ---------- the install choices
  var back = null;
  function open() {
    close();
    var parts = [];
    // The website app (same records as everyone else) comes first; the Android app keeps its own separate records.
    if (deferredPrompt) {
      parts.push('<div class="oi-opt"><b>Install this website as an app</b><small>Recommended for parents and teachers. Opens like an app, with the same records as this website.</small>' +
        '<button type="button" class="oi-btn" id="oiPrompt"><i class="fa-solid fa-display" aria-hidden="true"></i><span>Install on this ' + (isAndroid ? 'phone' : 'computer') + '</span></button></div>');
    } else if (isIOS) {
      parts.push('<div class="oi-opt"><b>Add to your Home Screen</b><small>The same records as this website, one tap away.</small>' +
        '<ol><li>Open this page in <b style="display:inline">Safari</b>.</li><li>Tap the Share button <i class="fa-solid fa-arrow-up-from-bracket" aria-hidden="true"></i>.</li>' +
        '<li>Choose <b style="display:inline">Add to Home Screen</b>, then Add.</li></ol></div>');
    } else if (isAndroid) {
      parts.push('<div class="oi-opt"><b>Add to your Home screen</b><small>Recommended for parents and teachers. The same records as this website.</small>' +
        '<ol><li>Open this page in <b style="display:inline">Chrome</b>.</li><li>Tap the menu (&#8942;), then <b style="display:inline">Add to Home screen</b> or <b style="display:inline">Install app</b>.</li></ol></div>');
    } else {
      parts.push('<div class="oi-opt"><b>Put Oasis on this computer</b><small>Opens in its own window, with the same records as this website.</small>' +
        '<ol><li><b style="display:inline">Chrome / Edge:</b> open the browser menu (&#8942; or &hellip;) and choose <b style="display:inline">Install Oasis</b> ' +
        '(or <b style="display:inline">Cast, save and share &gt; Install page as app / Create shortcut</b>).</li>' +
        '<li><b style="display:inline">Safari on Mac:</b> File &gt; <b style="display:inline">Add to Dock</b>.</li></ol></div>');
    }
    if (hasApk && (isAndroid || !isIOS)) {
      parts.push('<div class="oi-opt"><b>Android app that works without internet</b><small>For a school office phone only. It keeps its own separate records on that phone and does not show the records on this website.</small>' +
        '<a class="oi-btn" href="Oasis.apk" download="Oasis.apk" style="background:#475569"><i class="fa-brands fa-android" aria-hidden="true"></i><span>Download Android app (.apk)</span></a></div>');
    }
    back = document.createElement('div');
    back.className = 'oi-back';
    back.innerHTML = '<div class="oi-card" role="dialog" aria-modal="true" aria-labelledby="oiTitle">' +
      '<h3 id="oiTitle">Install the Oasis app</h3><p>Choose how you would like to use Oasis on this device.</p>' + parts.join('') +
      '<button type="button" class="oi-close">Close</button></div>';
    back.addEventListener('click', function (e) { if (e.target === back || e.target.classList.contains('oi-close')) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(back);
    var p = document.getElementById('oiPrompt');
    if (p) p.addEventListener('click', function () {
      var ev = deferredPrompt; deferredPrompt = null;
      ev.prompt();
      (ev.userChoice || Promise.resolve()).then(function () { close(); });
    });
    var first = back.querySelector('a.oi-btn, button.oi-btn, .oi-close');
    if (first) first.focus();
  }
  function onKey(e) { if (e.key === 'Escape') close(); }
  function close() {
    if (back) { back.remove(); back = null; }
    document.removeEventListener('keydown', onKey);
  }
})();
