/*
 * Oasis Pre School — screens that used sample content now show real records:
 * parent portal, attendance calendar and notifications. Also: backup / restore,
 * offline image placeholders.
 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function api(path) { return fetch(path).then(function (r) { return r.json(); }); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function inr(n) { return '₹' + (Number(n) || 0).toLocaleString('en-IN'); }
  function user() { try { return (typeof currentUser !== 'undefined' && currentUser) || {}; } catch (e) { return {}; } } // eslint-disable-line no-undef
  function isParent() { return /parent/i.test(user().role || ''); }

  // ---------- images that can't load offline get a neutral placeholder ----------
  var PLACEHOLDER = 'img/placeholder.svg';
  document.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t.tagName === 'IMG' && !t.dataset.oasisFallback) { t.dataset.oasisFallback = '1'; t.src = PLACEHOLDER; }
  }, true);

  // ---------- which child does this account see? ----------
  function linkedStudent(students) {
    var u = user();
    var mob = String(u.mobile || '').replace(/\D/g, '').slice(-10);
    if (mob) {
      var m = students.find(function (s) { return String(s.m_contact || '').slice(-10) === mob || String(s.f_contact || '').slice(-10) === mob; });
      if (m) return m;
    }
    var email = String(u.email || '').toLowerCase();
    if (email) {
      var e = students.find(function (s) { return String(s.m_email || '').toLowerCase() === email || String(s.f_email || '').toLowerCase() === email; });
      if (e) return e;
    }
    return null;
  }
  function studentOptions(students, selected) {
    return students.map(function (s) {
      return '<option value="' + esc(s.stud_id) + '"' + (s.stud_id === selected ? ' selected' : '') + '>' +
        esc(s.first_name + ' ' + (s.last_name || '') + ' (' + s.stud_id + ' · ' + (s.class_name || '') + ')') + '</option>';
    }).join('');
  }

  // ---------- parent portal ----------
  var portal = document.querySelector('#tab-parent-compose .bg-white.p-5');
  var portalChoice = null;
  function card(color, icon, title, body) {
    return '<div class="p-4 rounded-2xl bg-' + color + '-50 border border-' + color + '-200 flex items-start space-x-3">' +
      '<i class="fa-solid ' + icon + ' text-' + color + '-600 text-2xl mt-0.5"></i><div class="flex-1 min-w-0">' +
      '<h5 class="font-bold text-sm text-' + color + '-900">' + title + '</h5><div class="text-xs text-' + color + '-800 mt-1">' + body + '</div></div></div>';
  }
  function renderPortal() {
    if (!portal) return;
    portal.innerHTML = '<p class="text-xs text-slate-400">Loading…</p>';
    api('/api/students').then(function (students) {
      var child = isParent() ? linkedStudent(students) : (students.find(function (s) { return s.stud_id === portalChoice; }) || students[0]);
      if (!child) {
        portal.innerHTML = '<div class="text-center py-8 text-sm text-slate-500"><i class="fa-solid fa-child-reaching text-3xl text-emerald-500 mb-3 block"></i>' +
          'No child is linked to this account yet.<br>Ask the school office to add your mobile number to your child’s admission record.</div>';
        return;
      }
      var t = today();
      Promise.all([
        api('/api/attendance?date=' + t),
        api('/api/homework'),
        api('/api/student-fee-structure?stud_id=' + encodeURIComponent(child.stud_id)),
        api('/api/holidays'),
        api('/api/van-students')
      ]).then(function (r) {
        var att = r[0].find(function (a) { return a.stud_id === child.stud_id; });
        var hw = r[1].filter(function (h) { return String(h.class_id) === String(child.standard); }).slice(0, 3);
        var fees = r[2].summary || [];
        var due = fees.reduce(function (a, f) { return a + (Number(f.due_amount) || 0); }, 0);
        var total = fees.reduce(function (a, f) { return a + (Number(f.final_amount) || 0); }, 0);
        var hol = r[3].filter(function (h) { return (h.end_date || h.start_date) >= t; }).slice(0, 3);
        var van = r[4].find(function (v) { return v.stud_id === child.stud_id; });

        var html = '';
        if (!isParent()) {
          html += '<label for="portalChildPicker" class="block text-[11px] font-bold text-slate-500">Staff preview: pick a child to see what their parents see</label>' +
            '<select id="portalChildPicker" class="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white">' + studentOptions(students, child.stud_id) + '</select>';
        }
        html += '<div class="border-b pb-3"><p class="text-xs text-slate-400 font-semibold">Welcome!</p>' +
          '<h4 class="text-lg font-bold text-slate-900">Viewing details for <span class="text-emerald-700">' + esc(child.first_name + ' ' + (child.last_name || '')) + '</span></h4>' +
          '<p class="text-[11px] text-slate-500">' + esc((child.class_name || '') + ' · ' + (child.academic_year || '') + ' · ' + child.stud_id) + '</p></div>';
        html += card('emerald', 'fa-clipboard-user', 'Today’s Attendance',
          att && att.id ? esc(att.status) + (att.remarks ? ' — ' + esc(att.remarks) : '') : 'Not marked yet today');
        html += card('amber', 'fa-pen-nib', 'Recent Homework', hw.length ? hw.map(function (h) {
          return esc(h.subject + ': ' + h.title) + (h.due_date ? ' <span class="opacity-70">(due ' + esc(h.due_date) + ')</span>' : '');
        }).join('<br>') : 'No homework posted for ' + esc(child.class_name || 'this class') + '.');
        html += due > 0
          ? card('rose', 'fa-triangle-exclamation', 'Fee Dues', '<span class="font-semibold">Outstanding: ' + inr(due) + ' of ' + inr(total) + '</span>' +
            '<br><button type="button" id="portalPayBtn" class="mt-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-bold"><i class="fa-solid fa-qrcode"></i> Pay now</button>')
          : card('emerald', 'fa-circle-check', 'Fees', fees.length ? 'All fees paid.' : 'No fee package assigned yet.');
        if (van) html += card('sky', 'fa-van-shuttle', 'School Van', esc(van.route_name) + ' · Pickup: ' + esc(van.pickup_point) + '<br>Drop: ' + esc(van.drop_time) +
          (van.driver_name ? ' · Driver: ' + esc(van.driver_name) + ' (' + esc(van.driver_phone) + ')' : ''));
        html += card('indigo', 'fa-calendar-day', 'Upcoming Holidays', hol.length ? hol.map(function (h) {
          return esc(h.start_date + (h.end_date && h.end_date !== h.start_date ? ' → ' + h.end_date : '') + ': ' + h.holiday_name);
        }).join('<br>') : 'No upcoming holidays scheduled.');
        portal.innerHTML = html;
        var pk = $('portalChildPicker');
        if (pk) pk.addEventListener('change', function () { portalChoice = pk.value; renderPortal(); });
        var pay = $('portalPayBtn');
        if (pay) pay.addEventListener('click', function () {
          if (typeof openRecordPaymentModal === 'function') openRecordPaymentModal(child.stud_id, due); // eslint-disable-line no-undef
        });
      });
    });
  }

  // ---------- attendance: real monthly calendar ----------
  var calCard = null;
  Array.prototype.some.call(document.querySelectorAll('#tab-attendance p'), function (p) {
    if (/Monthly attendance summary/i.test(p.textContent)) { calCard = p.parentElement; return true; }
    return false;
  });
  var calChoice = null;
  if (calCard) {
    calCard.innerHTML = '<h3 class="font-bold text-slate-800 text-sm flex items-center space-x-2"><i class="fa-solid fa-calendar-days text-emerald-600"></i><span>Monthly Attendance Calendar</span></h3>' +
      '<label for="calStudentPicker" class="sr-only">Student</label><select id="calStudentPicker" class="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white"></select>' +
      '<div id="calMonthLabel" class="text-xs font-bold text-slate-600"></div>' +
      '<div class="grid grid-cols-7 gap-1.5 text-center text-[10px] font-bold text-slate-400"><div>S</div><div>M</div><div>T</div><div>W</div><div>T</div><div>F</div><div>S</div></div>' +
      '<div id="calGrid" class="grid grid-cols-7 gap-1.5 text-center text-xs"></div>' +
      '<div class="flex flex-wrap gap-3 text-[10px] text-slate-500 pt-1"><span><span class="inline-block w-2.5 h-2.5 rounded bg-emerald-200 align-middle"></span> Present</span>' +
      '<span><span class="inline-block w-2.5 h-2.5 rounded bg-rose-200 align-middle"></span> Absent</span><span><span class="inline-block w-2.5 h-2.5 rounded bg-amber-200 align-middle"></span> Late</span>' +
      '<span><span class="inline-block w-2.5 h-2.5 rounded bg-slate-100 align-middle border"></span> Not marked</span></div>';
    $('calStudentPicker').addEventListener('change', function () { calChoice = this.value; renderCalendar(); });
  }
  function renderCalendar() {
    if (!calCard) return;
    var picker = $('attendanceDatePicker');
    var base = (picker && picker.value) || today();
    var y = +base.slice(0, 4), m = +base.slice(5, 7);
    var days = new Date(y, m, 0).getDate(), first = new Date(y, m - 1, 1).getDay();
    api('/api/students').then(function (students) {
      if (!students.length) { $('calGrid').innerHTML = ''; return; }
      var sel = students.find(function (s) { return s.stud_id === calChoice; }) || students[0];
      calChoice = sel.stud_id;
      $('calStudentPicker').innerHTML = studentOptions(students, sel.stud_id);
      $('calMonthLabel').textContent = new Date(y, m - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
      var reqs = [];
      for (var d = 1; d <= days; d++) reqs.push(api('/api/attendance?date=' + y + '-' + pad(m) + '-' + pad(d)));
      Promise.all(reqs).then(function (res) {
        var cells = '';
        for (var i = 0; i < first; i++) cells += '<div></div>';
        res.forEach(function (list, idx) {
          var a = list.find(function (x) { return x.stud_id === sel.stud_id; });
          var marked = a && a.id;
          var cls = !marked ? 'bg-slate-50 text-slate-400' : a.status === 'Absent' ? 'bg-rose-100 text-rose-800 font-bold' :
            a.status === 'Late' ? 'bg-amber-100 text-amber-800 font-bold' : 'bg-emerald-100 text-emerald-800 font-bold';
          cells += '<div class="p-2 rounded ' + cls + '" title="' + (marked ? esc(a.status) : 'Not marked') + '">' + (idx + 1) + '</div>';
        });
        $('calGrid').innerHTML = cells;
      });
    });
  }

  // ---------- notifications from real records ----------
  function refreshNotifications() {
    if (typeof loadNotificationsList !== 'function') return; // eslint-disable-line no-undef
    var A = window.OasisAccess, admin = /admin/i.test(user().role || '');
    function may(screen, action) { return A && typeof A.can === 'function' ? A.can(screen, action) : admin; }
    function safe(p) { return api(p).catch(function () { return null; }); }
    Promise.all([may('teacher-leaves', 'modify') ? safe('/api/teacher-leaves') : null, may('user-approvals', 'read') ? safe('/api/users/approvals') : null,
      safe('/api/homework'), safe('/api/holidays')]).then(function (r) {
      var list = [], id = 1, t = today();
      (Array.isArray(r[0]) ? r[0] : []).filter(function (l) { return l.status === 'Pending'; }).forEach(function (l) {
        list.push({ id: id++, type: 'leave', tab: 'teacher-leaves', title: 'Leave request pending', desc: (l.staff_name || l.staff_id) + ' · ' + l.leave_type + ' · ' + l.total_days + ' day(s) from ' + l.start_date, time: l.created_at || '', read: false });
      });
      ((r[1] && r[1].pending) || []).forEach(function (u) {
        list.push({ id: id++, type: 'fee', tab: 'user-approvals', title: 'Sign-up waiting for approval', desc: (((u.first_name || '') + ' ' + (u.last_name || '')).trim() || u.username) + ' · ' + u.email + ' · tap to approve or reject', time: u.signed_up || '', read: false });
      });
      (Array.isArray(r[2]) ? r[2] : []).slice(0, 3).forEach(function (h) {
        list.push({ id: id++, type: 'homework', tab: 'homework', title: 'Homework: ' + h.subject, desc: h.title + ' — ' + (h.class_name || '') + (h.due_date ? ', due ' + h.due_date : ''), time: h.created_at || '', read: true });
      });
      (Array.isArray(r[3]) ? r[3] : []).filter(function (h) { return (h.end_date || h.start_date) >= t; }).slice(0, 2).forEach(function (h) {
        list.push({ id: id++, type: 'homework', tab: 'holidays', title: 'Holiday: ' + h.holiday_name, desc: h.start_date + (h.end_date && h.end_date !== h.start_date ? ' → ' + h.end_date : ''), time: '', read: true });
      });
      notificationsList = list; // eslint-disable-line no-undef
      loadNotificationsList(); // eslint-disable-line no-undef
    });
  }
  window.oasisRefreshNotifications = refreshNotifications;

  // ---------- backup / restore (records live in this browser) ----------
  var setup = $('tab-school-setup');
  if (setup && window.OasisDB) {
    var box = document.createElement('div');
    box.className = 'bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-3';
    var onServer = !!window.OasisDB.server;
    box.innerHTML = '<h3 class="font-extrabold text-slate-800 text-base flex items-center gap-2"><i class="fa-solid fa-database text-emerald-600"></i> ' + (onServer ? 'School records on the Oasis server' : 'School records on this device') + '</h3>' +
      (onServer
        ? '<p class="text-xs text-slate-500">All records are saved on the Oasis server and shared by every signed-in device. The server also keeps a copy every day. Only an Administrator can download, restore or reset the records.</p>'
        : '<p class="text-xs text-slate-500">All records are saved inside this browser on this device. Download a backup regularly. To move the records to the Oasis server, download a backup here and restore it there.</p>') +
      '<div class="flex flex-wrap gap-2">' +
      '<button type="button" id="btnBackupDb" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm"><i class="fa-solid fa-download"></i> Download backup</button>' +
      '<label for="inputRestoreDb" class="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer"><i class="fa-solid fa-upload"></i> Restore from backup</label>' +
      '<input type="file" id="inputRestoreDb" accept=".db,.sqlite,application/octet-stream" class="hidden">' +
      '<button type="button" id="btnResetDb" class="px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-xl text-xs font-bold"><i class="fa-solid fa-rotate-left"></i> Start again from clean setup</button>' +
      '</div>';
    setup.appendChild(box);
    window.OasisDB.beforeCleanFile().then(function (bytes) {
      if (!bytes) return;
      var b = document.createElement('button');
      b.type = 'button'; b.id = 'btnBeforeCleanDb';
      b.className = 'px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold';
      b.innerHTML = '<i class="fa-solid fa-clock-rotate-left"></i> Download copy from before sample data was removed';
      b.addEventListener('click', function () {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
        a.download = 'oasis-before-sample-cleanup.db';
        document.body.appendChild(a); a.click(); a.remove();
      });
      $('btnResetDb').parentElement.appendChild(b);
    });
    $('btnBackupDb').addEventListener('click', function () {
      window.OasisDB.exportFile().catch(function (err) { alert('Backup failed: ' + (err && err.message || err)); throw err; }).then(function (bytes) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
        a.download = 'oasis-backup-' + today() + '.db';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
      });
    });
    $('inputRestoreDb').addEventListener('change', function (e) {
      var f = e.target.files[0]; if (!f) return;
      if (!confirm('Replace every record ' + (onServer ? 'on the Oasis server (for everyone)' : 'on this device') + ' with the backup "' + f.name + '"?')) { e.target.value = ''; return; }
      f.arrayBuffer().then(function (buf) { return window.OasisDB.importFile(new Uint8Array(buf)); })
        .then(function () { alert(onServer ? 'Backup restored. Please sign in again.' : 'Backup restored.'); location.reload(); })
        .catch(function (err) {
          alert(onServer && err && err.message && !/not an Oasis backup/i.test(err.message) ? 'Restore failed: ' + err.message
            : 'That file is not an Oasis backup. Choose a file named like oasis-backup-2026-09-26.db.');
          e.target.value = '';
        });
    });
    $('btnResetDb').addEventListener('click', function () {
      if (!confirm('Erase every record ' + (onServer ? 'on the Oasis server (for everyone)' : 'on this device') + ' and go back to a clean start (setup, roles and your accounts only)?')) return;
      window.OasisDB.reset().then(function () { location.reload(); }, function (err) { alert('Reset failed: ' + (err && err.message || err)); });
    });
  }

  // ---------- hooks ----------
  if (typeof window.switchTab === 'function') {
    var origSwitch = window.switchTab;
    window.switchTab = function (tab) {
      origSwitch(tab);
      if (tab === 'parent-compose') renderPortal();
      if (tab === 'attendance') renderCalendar();
      try { window.scrollTo(0, 0); } catch (e) {}
    };
  }
  var attPicker = $('attendanceDatePicker');
  if (attPicker) attPicker.addEventListener('change', renderCalendar);
  if (typeof window.saveAttendance === 'function') {
    var origSave = window.saveAttendance;
    window.saveAttendance = function () { return Promise.resolve(origSave.apply(this, arguments)).then(renderCalendar); };
  }
  if (window.OasisSession && typeof window.OasisSession.loggedIn === 'function') {
    var origLogged = window.OasisSession.loggedIn;
    window.OasisSession.loggedIn = function (d) { origLogged.call(this, d); refreshNotifications(); };
  }
  if (typeof notificationsList !== 'undefined') { notificationsList = []; } // eslint-disable-line no-undef
  document.addEventListener('DOMContentLoaded', function () { if (typeof loadNotificationsList === 'function') loadNotificationsList(); }); // eslint-disable-line no-undef
})();
