/*
 * Oasis Pre School — connection to the Oasis server.
 * Used when the app is opened from the server's web address. The server holds the records and checks
 * every sign-in (a secure cookie), so nothing is stored in this browser except the remembered user id.
 */
(function () {
  'use strict';
  function check(r) {
    if (r.ok) return r;
    return r.json().catch(function () { return {}; }).then(function (d) { throw new Error(d.error || d.message || ('HTTP ' + r.status)); });
  }
  window.OasisDB = {
    server: true,
    ready: Promise.resolve(),
    exportFile: function () {
      return fetch('/api/admin/backup', { credentials: 'same-origin' }).then(check)
        .then(function (r) { return r.arrayBuffer(); }).then(function (b) { return new Uint8Array(b); });
    },
    importFile: function (bytes) {
      return fetch('/api/admin/restore', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes }).then(check);
    },
    reset: function () {
      return fetch('/api/admin/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(check);
    },
    beforeCleanFile: function () { return Promise.resolve(null); }
  };

  // The screens load their records when the page opens, which is before anyone has signed in
  // (the server sends nothing until then). Load them again as soon as a user is signed in.
  var LOADERS = ['loadSummaryData', 'loadAdmissionsData', 'loadVanData', 'loadPaymentsData', 'loadFeeStructure', 'loadReportCards',
    'loadExpensesData', 'loadAttendance', 'loadHomework', 'loadHolidays', 'loadGallery', 'loadSchoolDetails', 'loadFeeTypes',
    'loadNotificationsList', 'loadStaffPayroll', 'loadClasses', 'loadSections'];
  function reloadAll() {
    LOADERS.forEach(function (name) {
      try { if (typeof window[name] === 'function') Promise.resolve(window[name]()).catch(function () {}); } catch (e) {}
    });
  }
  document.addEventListener('DOMContentLoaded', function () {
    var s = window.OasisSession;
    if (!s || typeof s.loggedIn !== 'function') return;
    var base = s.loggedIn;
    s.loggedIn = function (d) { var r = base.apply(this, arguments); reloadAll(); return r; };
  });
})();
