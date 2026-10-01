/*
 * Oasis Pre School — Screen Master, Role Master, User Master, role-based access and Email + OTP login.
 */
(function () {
  'use strict';

  // ------------------------------------------------------------ utilities
  function $(id) { return document.getElementById(id); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function req(method, path, body) {
    return fetch(path, method === 'GET' ? undefined : { method: method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().then(function (d) { if (d && typeof d === 'object' && !Array.isArray(d)) d._status = r.status; return d; }); });
  }
  var get = function (p) { return req('GET', p); };
  var post = function (p, b) { return req('POST', p, b || {}); };
  var del = function (p) { return req('DELETE', p); };

  var toastBox = document.createElement('div');
  toastBox.id = 'oasisToast';
  toastBox.setAttribute('role', 'status');
  toastBox.setAttribute('aria-live', 'polite');
  toastBox.className = 'fixed left-1/2 -translate-x-1/2 bottom-6 z-[80] flex flex-col items-center gap-2 pointer-events-none w-[calc(100%-2rem)] max-w-md';
  document.body.appendChild(toastBox);
  function toast(msg, kind) {
    var t = document.createElement('div');
    var color = kind === 'error' ? 'bg-rose-600' : kind === 'info' ? 'bg-slate-800' : 'bg-emerald-600';
    t.className = color + ' text-white text-xs font-semibold px-4 py-3 rounded-xl shadow-lg pointer-events-auto w-full text-center';
    t.textContent = msg;
    toastBox.appendChild(t);
    setTimeout(function () { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(function () { t.remove(); }, 320); }, kind === 'error' ? 5200 : 3200);
  }
  var style = document.createElement('style');
  style.textContent = '.rbac-hide{display:none!important}.oasis-check{width:1.05rem;height:1.05rem;accent-color:#059669;cursor:pointer}.oasis-check:disabled{cursor:not-allowed;opacity:.55}' +
    '.oasis-modal-panel{max-height:calc(100vh - 2rem);overflow-y:auto}';
  document.head.appendChild(style);

  // ------------------------------------------------------------ access state
  var perms = null;          // screen_id -> {r,a,m,d}
  var me = null;             // signed-in user
  var currentTab = 'summary';
  function isAdminRole() { return me && /^administrator$/i.test(me.role || ''); }
  function canDo(screen, action) {
    if (!perms) return true;
    var p = perms[screen];
    if (!p) return false;
    return !!(action === 'read' ? p.can_read : action === 'add' ? p.can_add : action === 'modify' ? p.can_modify : p.can_delete);
  }
  window.OasisAccess = { can: function (screen, action) { return canDo(screen, action); }, me: function () { return me ? Object.assign({}, me) : null; } };
  function setPerms(list) {
    perms = {};
    (list || []).forEach(function (p) { perms[p.screen_id] = p; });
  }

  // ------------------------------------------------------------ menu and sections
  var navUserAuth = $('nav-user-auth');
  var masterGroup = navUserAuth ? navUserAuth.parentElement : null;
  if (navUserAuth) navUserAuth.remove();
  var oldSection = $('tab-user-auth');
  var mainArea = oldSection ? oldSection.parentElement : (document.querySelector('#tab-summary') || {}).parentElement;
  if (oldSection) oldSection.remove();

  var MY_TABS = [
    ['screen-master', 'Screen Master', 'fa-desktop'],
    ['role-master', 'Role Master', 'fa-user-shield'],
    ['user-master', 'User Master', 'fa-users'],
    ['user-approvals', 'User Approvals', 'fa-user-check']
  ];
  if (masterGroup) {
    var group = document.createElement('div');
    group.className = 'space-y-1 border-t border-slate-100 pt-3';
    group.innerHTML = '<p class="px-3 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Security &amp; Access</p>' +
      MY_TABS.map(function (t) {
        return '<button onclick="switchTab(\'' + t[0] + '\')" id="nav-' + t[0] + '" class="w-full flex items-center text-left space-x-3 px-3 py-2 rounded-xl text-sm text-slate-600 hover:bg-slate-100 transition-all">' +
          '<i class="fa-solid ' + t[2] + ' w-5 text-center text-emerald-600"></i><span>' + t[1] + '</span>' +
          (t[0] === 'user-approvals' ? '<span id="navApprovalsBadge" class="hidden px-1.5 text-center rounded-full bg-amber-500 text-white text-[10px] font-extrabold" style="margin-left:auto;min-width:1.25rem"></span>' : '') +
          '</button>';
      }).join('');
    masterGroup.parentElement.insertBefore(group, masterGroup.nextSibling);
  }
  if (mainArea) {
    MY_TABS.forEach(function (t) {
      var s = document.createElement('section');
      s.id = 'tab-' + t[0];
      s.className = 'space-y-6 hidden';
      mainArea.appendChild(s);
    });
  }

  function navButtons() { return Array.prototype.slice.call(document.querySelectorAll('button[id^="nav-"]')); }
  function screenOfNav(btn) { return btn.id.slice(4); }
  function firstAllowedTab() {
    var b = navButtons().find(function (btn) { return canDo(screenOfNav(btn), 'read'); });
    return b ? screenOfNav(b) : null;
  }

  // ------------------------------------------------------------ switchTab guard
  var baseSwitch = window.switchTab;
  window.switchTab = function (tab) {
    if (perms && !canDo(tab, 'read')) {
      toast('Your role does not have access to that screen.', 'error');
      return;
    }
    MY_TABS.forEach(function (t) {
      var s = $('tab-' + t[0]); if (s) s.classList.add('hidden');
      var n = $('nav-' + t[0]); if (n) n.classList.remove('sidebar-item-active');
    });
    currentTab = tab;
    baseSwitch(tab);
    if (tab === 'screen-master') renderScreenMaster();
    else if (tab === 'role-master') renderRoleMaster();
    else if (tab === 'user-master') renderUserMaster();
    else if (tab === 'user-approvals') renderUserApprovals();
    gateSoon();
  };

  // ------------------------------------------------------------ applying access
  // onclick handler -> [screen, action]
  var ACTION_RULES = [
    [/^openNewAdmissionModal/, 'admissions', 'add'],
    [/^openRecordPaymentModal/, 'payments', 'add'],
    [/^openAddExpenseModal/, 'expenses', 'add'],
    [/^openAddHomeworkModal/, 'homework', 'add'],
    [/^openAddHolidayModal/, 'holidays', 'add'], [/^deleteHoliday/, 'holidays', 'delete'],
    [/^openAddPhotoModal/, 'gallery', 'add'],
    [/^openUploadReportCardModal/, 'report-cards', 'add'], [/^deleteReportCard/, 'report-cards', 'delete'],
    [/^saveAttendance/, 'attendance', 'add'],
    [/^openAddStaffModal\(\s*'/, 'staff-payroll', 'modify'], [/^openAddStaffModal/, 'staff-payroll', 'add'],
    [/^deleteStaff/, 'staff-payroll', 'delete'], [/^openPayrollModal/, 'payroll', 'add'],
    [/^deletePayrollRecord/, 'payroll', 'delete'], [/^switchStaffSubTab\(\s*'payroll'/, 'payroll', 'read'], [/^saveStaffAttendance/, 'staff-payroll', 'add'],
    [/^updateLeaveStatus/, 'teacher-leaves', 'modify'], [/^deleteLeaveRecord/, 'teacher-leaves', 'delete'],
    [/^scrollToApplyLeaveForm/, 'teacher-leaves', 'add'],
    [/^openAddClassModal/, 'classes-setup', 'add'], [/^editClass/, 'classes-setup', 'modify'], [/^deleteClass/, 'classes-setup', 'delete'],
    [/^openAddSectionModal/, 'sections-setup', 'add'], [/^editSection/, 'sections-setup', 'modify'], [/^deleteSection/, 'sections-setup', 'delete'],
    [/^openAddFeeTypeModal/, 'fee-types-setup', 'add'], [/^editFeeType/, 'fee-types-setup', 'modify'], [/^deleteFeeType/, 'fee-types-setup', 'delete'],
    [/^approveUser|^rejectUser/, 'user-master', 'modify'], [/^openModal\(\s*'modalCreateAdminUser/, 'user-master', 'add'],
    [/^triggerCleanSampleData/, 'school-setup', 'delete'],
    [/^scrollToAttachFeeForm/, 'student-fee-attachment', 'add']
  ];
  // whole blocks that only make sense with a permission
  var BLOCK_RULES = [
    ['#staffSubPanel-payroll', 'payroll', 'read'],
    ['#sectionAttachFeeForm', 'student-fee-attachment', 'add'],
    ['#sectionApplyLeaveForm', 'teacher-leaves', 'add'],
    ['#formLeaveQuota', 'teacher-leaves', 'modify'],
    ['#formSchoolSetup button[type=submit]', 'school-setup', 'modify'],
    ['#oasisEmailSettings', 'school-setup', 'modify'],
    ['label[for="inputRestoreDb"]', 'school-setup', 'modify'],
    ['#btnResetDb', 'school-setup', 'delete']
  ];
  function gate() {
    if (!perms) return;
    Array.prototype.forEach.call(document.querySelectorAll('#mainAppLayout [onclick], body > div.fixed [onclick]'), function (el) {
      var code = (el.getAttribute('onclick') || '').trim();
      for (var i = 0; i < ACTION_RULES.length; i++) {
        if (ACTION_RULES[i][0].test(code)) { el.classList.toggle('rbac-hide', !canDo(ACTION_RULES[i][1], ACTION_RULES[i][2])); break; }
      }
    });
    BLOCK_RULES.forEach(function (r) {
      Array.prototype.forEach.call(document.querySelectorAll(r[0]), function (el) { el.classList.toggle('rbac-hide', !canDo(r[1], r[2])); });
    });
    // Money and salary cards only for people who may see them (the server also leaves these numbers out).
    [['statFeesPaid', 'payments'], ['statFeesDues', 'payments'], ['statTotalRevenue', 'payments'], ['statTotalExpenses', 'expenses'],
      ['statNetBalance', ['payments', 'expenses']], ['chartFeeStatus', 'payments'], ['chartExpenseCategory', 'expenses'],
      ['statMonthlyPayrollTotal', 'payroll']].forEach(function (c) {
      var el = $(c[0]), card = el && el.closest('.rounded-2xl');
      if (card) card.classList.toggle('rbac-hide', ![].concat(c[1]).every(function (s) { return canDo(s, 'read'); }));
    });
    var sal = $('staffBaseSalaryInput'), salBox = sal && sal.parentElement;
    var salOk = canDo('payroll', 'add') || canDo('payroll', 'modify');
    if (salBox) salBox.classList.toggle('rbac-hide', !salOk);
    if (sal) sal.required = salOk;
    var bank = $('staffBankAccountInput');
    if (bank && bank.parentElement) bank.parentElement.classList.toggle('rbac-hide', !salOk);
    var setupForm = $('formSchoolSetup');
    if (setupForm) Array.prototype.forEach.call(setupForm.querySelectorAll('input,select,textarea'), function (i) { i.disabled = !canDo('school-setup', 'modify'); });
    Array.prototype.forEach.call(document.querySelectorAll('.att-status-select, .att-remarks-input'), function (i) { i.disabled = !canDo('attendance', 'add'); });
  }
  var gateTimer = null;
  function gateSoon() { clearTimeout(gateTimer); gateTimer = setTimeout(gate, 30); }
  new MutationObserver(function () { if (perms) gateSoon(); }).observe(document.body, { childList: true, subtree: true });

  function applyMenu() {
    navButtons().forEach(function (b) { b.classList.toggle('hidden', !canDo(screenOfNav(b), 'read')); });
    // hide a menu group heading when none of its screens are allowed
    Array.prototype.forEach.call(document.querySelectorAll('#mainAppSidebar .space-y-1'), function (g) {
      var btns = g.querySelectorAll('button[id^="nav-"]');
      if (!btns.length) return;
      var any = Array.prototype.some.call(btns, function (b) { return !b.classList.contains('hidden'); });
      g.classList.toggle('hidden', !any);
    });
  }
  function reloadScreens() {
    ['loadSummaryData', 'loadAdmissionsData', 'loadVanData', 'loadPaymentsData', 'loadFeeStructure', 'loadReportCards', 'loadExpensesData',
      'loadAttendance', 'loadHomework', 'loadHolidays', 'loadGallery', 'loadSchoolDetails', 'loadFeeTypes', 'loadStaffPayroll']
      .forEach(function (f) { if (typeof window[f] === 'function') { try { window[f](); } catch (e) {} } });
  }
  function onSignedIn(d) {
    if (!d || !d.user) return;
    me = Object.assign({}, d.user);   // own copy: the page's Admin/Teacher/Parent preview switch rewrites the shared user's role
    setPerms(d.permissions);
    applyMenu();
    reloadScreens();
    var roleBox = $('roleBtnAdmin') ? $('roleBtnAdmin').parentElement : null;
    if (roleBox) roleBox.classList.toggle('hidden', !isAdminRole());
    if (!canDo(currentTab, 'read')) {
      var first = firstAllowedTab();
      if (first) window.switchTab(first);
      else toast('Your role has no screens assigned yet. Please contact the school office.', 'error');
    }
    gateSoon();
    refreshApprovalBadge();
  }
  if (window.OasisSession && typeof window.OasisSession.loggedIn === 'function') {
    var baseLoggedIn = window.OasisSession.loggedIn;
    window.OasisSession.loggedIn = function (d) {
      // Copy the user first: the page's login code (Admin/Teacher/Parent preview) rewrites the shared user's role.
      var mine = d && d.user ? Object.assign({}, d, { user: Object.assign({}, d.user) }) : d;
      baseLoggedIn.call(this, d);
      onSignedIn(mine);
    };
  }
  // A saved login can be restored before this script loads; apply its access now too.
  (function restore() {
    var id = null;
    try { id = localStorage.getItem('oasis_user_id'); } catch (e) {}
    if (!id) return;
    get('/api/auth/me?user_id=' + encodeURIComponent(id)).then(function (d) {
      if (d && d.success && (!me || me.user_id !== d.user.user_id || !perms)) onSignedIn(d);
    });
  })();
  // The header's Admin/Teacher/Parent preview buttons also go through switchTab, so they respect access too.
  // Before anyone signs in they are hidden.
  (function () { var rb = $('roleBtnAdmin'); if (rb) rb.parentElement.classList.add('hidden'); })();
  var authTitle = $('screenAuthTitle'), authSub = $('screenAuthSubtitle');
  if (authTitle) authTitle.textContent = 'Welcome to Oasis';
  if (authSub) authSub.textContent = 'Log in with your email or username and password.';
  // Inside the Android app: say which version this is, and that it needs no server or internet.
  (function () {
    var m = /OasisAndroid\/([\d.]+)/.exec(navigator.userAgent || '');
    if (!window.OASIS_ANDROID_APP || !authSub) return;
    var note = document.createElement('p');
    note.id = 'androidAppNote';
    note.className = 'text-[11px] text-emerald-700 mt-1';
    note.textContent = 'Oasis Android app' + (m ? ' ' + m[1] : '') + ' \u00b7 works without internet \u00b7 records are kept on this phone';
    authSub.parentNode.insertBefore(note, authSub.nextSibling);
  })();

  // ============================================================ LOGIN / SIGN UP (email or username + password)
  (function () {
    var box = $('screenAuthMsg');
    function say(text, good) {
      if (!box) { if (text) alert(text); return; }
      box.textContent = text || '';
      box.className = text ? 'text-xs font-semibold rounded-xl px-3 py-2 border ' + (good ? 'text-emerald-800 bg-emerald-50 border-emerald-200' : 'text-rose-600 bg-rose-50 border-rose-200') : 'hidden';
    }
    function busy(form, on) { var b = form && form.querySelector('button[type=submit]'); if (b) { b.disabled = on; b.style.opacity = on ? '0.6' : ''; } }
    var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/, USERNAME = /^[A-Za-z0-9._-]{3,30}$/;

    window.handleScreenLogin = function (e) {
      if (e && e.preventDefault) e.preventDefault();
      var form = $('screenFormLogin'), ident = ($('screenLoginEmail').value || '').trim(), pw = $('screenLoginPassword').value || '';
      if (!ident) { say('Enter your email or username.'); $('screenLoginEmail').focus(); return; }
      if (!pw) { say('Enter your password.'); $('screenLoginPassword').focus(); return; }
      say(''); busy(form, true);
      post('/api/auth/login', { username: ident, email: ident, password: pw }).then(function (d) {
        busy(form, false);
        if (!d.success) { say(d.message || d.error || 'Login failed.'); $('screenLoginPassword').select(); return; }
        $('screenLoginPassword').value = '';
        if (window.OasisSession) window.OasisSession.loggedIn(d);
        toast('Welcome, ' + ((d.user && (d.user.first_name || d.user.username)) || 'there') + '!');
      }, function () { busy(form, false); say('Could not reach the server. Please try again.'); });
    };

    window.handleScreenSignup = function (e) {
      if (e && e.preventDefault) e.preventDefault();
      var form = $('screenFormSignup');
      var email = ($('screenSignupEmail').value || '').trim(), user = ($('screenSignupUsername').value || '').trim();
      var pw = $('screenSignupPassword').value || '', pw2 = $('screenSignupPassword2').value || '';
      if (!EMAIL.test(email)) { say('Please enter a valid email address.'); $('screenSignupEmail').focus(); return; }
      if (!USERNAME.test(user)) { say('Username must be 3 to 30 characters: letters, numbers, dot, dash or underscore.'); $('screenSignupUsername').focus(); return; }
      if (pw.length < 8) { say('Password must be at least 8 characters.'); $('screenSignupPassword').focus(); return; }
      if (pw !== pw2) { say('The two passwords do not match.'); $('screenSignupPassword2').focus(); return; }
      say(''); busy(form, true);
      post('/api/auth/signup', { email: email, username: user, password: pw, first_name: user, role: 'Parent' }).then(function (d) {
        busy(form, false);
        if (!d.success) { say(d.error || d.message || 'Could not create the account.'); return; }
        form.reset();
        if (d.requires_approval) {
          if (typeof window.switchScreenAuthMode === 'function') window.switchScreenAuthMode('login');
          $('screenLoginEmail').value = user;
          say('Account created. The school office will approve it, then you can log in with your username or email and password.', true);
        } else if (window.OasisSession) {
          window.OasisSession.loggedIn(d);
        }
      }, function () { busy(form, false); say('Could not reach the server. Please try again.'); });
    };

    // ---- Forgot password: send a code, then set a new password with it
    (function () {
      var form = $('screenFormForgot');
      if (!form) return;
      var stepSend = $('forgotStepSend'), stepReset = $('forgotStepReset');
      function showStep(reset) { stepSend.classList.toggle('hidden', reset); stepReset.classList.toggle('hidden', !reset); }
      var link = $('screenForgotLink');
      if (link) link.addEventListener('click', function () {
        showStep(false);
        var id = ($('screenLoginEmail').value || '').trim();
        if (id && !$('forgotIdent').value) $('forgotIdent').value = id;
        setTimeout(function () { $('forgotIdent').focus(); }, 30);
      });
      function sendCode() {
        var ident = ($('forgotIdent').value || '').trim();
        if (!ident) { say('Enter your email, username or mobile number.'); $('forgotIdent').focus(); return; }
        say(''); busy(form, true);
        post('/api/auth/forgot/send', { ident: ident }).then(function (d) {
          busy(form, false);
          if (!d.success) { say(d.error || d.message || 'The code could not be sent.'); return; }
          showStep(true);
          ['forgotCode', 'forgotPw1', 'forgotPw2'].forEach(function (id) { $(id).value = ''; });
          say(d.message, true);
          $('forgotCode').focus();
        }, function () { busy(form, false); say('Could not reach the server. Please try again.'); });
      }
      function setPassword() {
        var ident = ($('forgotIdent').value || '').trim(), code = ($('forgotCode').value || '').replace(/\D/g, '');
        var pw = $('forgotPw1').value || '', pw2 = $('forgotPw2').value || '';
        if (code.length !== 6) { say('Enter the 6-digit code.'); $('forgotCode').focus(); return; }
        if (pw.length < 8) { say('The new password must be at least 8 characters.'); $('forgotPw1').focus(); return; }
        if (pw !== pw2) { say('The two passwords do not match.'); $('forgotPw2').focus(); return; }
        say(''); busy(form, true);
        post('/api/auth/forgot/reset', { ident: ident, code: code, password: pw }).then(function (d) {
          busy(form, false);
          if (!d.success) { say(d.error || d.message || 'The password could not be changed.'); return; }
          ['forgotCode', 'forgotPw1', 'forgotPw2'].forEach(function (id) { $(id).value = ''; });
          showStep(false);
          if (typeof window.switchScreenAuthMode === 'function') window.switchScreenAuthMode('login');
          $('screenLoginEmail').value = ident;
          $('screenLoginPassword').value = '';
          say(d.message || 'Your password has been changed. Please log in.', true);
          $('screenLoginPassword').focus();
        }, function () { busy(form, false); say('Could not reach the server. Please try again.'); });
      }
      form.addEventListener('submit', function (e) { e.preventDefault(); if (stepReset.classList.contains('hidden')) sendCode(); else setPassword(); });
      $('forgotResend').addEventListener('click', function () { showStep(false); sendCode(); });
      $('forgotCode').addEventListener('input', function () { this.value = this.value.replace(/\D/g, '').slice(0, 6); });
    })();

    // "Switch account" inside the app simply logs out and returns to this screen.
    window.openAuthModal = function () {
      try { localStorage.removeItem('oasis_user_id'); } catch (err) {}
      fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(function () {}).then(function () { location.reload(); });
    };
  })();

  // ------------------------------------------------------------ shared modal
  var modal = document.createElement('div');
  modal.id = 'oasisAccessModal';
  modal.className = 'fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center hidden p-4';
  modal.innerHTML = '<div class="oasis-modal-panel bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 relative" role="dialog" aria-modal="true" aria-labelledby="oasisModalTitle">' +
    '<button type="button" id="oasisModalClose" class="absolute top-4 right-4 text-slate-400 hover:text-slate-600" aria-label="Close"><i class="fa-solid fa-xmark text-lg"></i></button>' +
    '<h3 id="oasisModalTitle" class="text-base font-extrabold text-slate-900 pr-8"></h3><p id="oasisModalSub" class="text-xs text-slate-500 -mt-2"></p>' +
    '<form id="oasisModalForm" class="space-y-3" novalidate></form></div>';
  document.body.appendChild(modal);
  function closeModalBox() { modal.classList.add('hidden'); }
  $('oasisModalClose').addEventListener('click', closeModalBox);
  modal.addEventListener('click', function (e) { if (e.target === modal) closeModalBox(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeModalBox(); });
  function openModalBox(title, sub, html, onSubmit) {
    $('oasisModalTitle').textContent = title;
    $('oasisModalSub').textContent = sub || '';
    var f = $('oasisModalForm');
    f.innerHTML = html + '<p id="oasisModalError" class="hidden text-xs font-semibold text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2"></p>' +
      '<div class="flex justify-end gap-2 pt-2 border-t"><button type="button" id="oasisModalCancel" class="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold">Cancel</button>' +
      '<button type="submit" id="oasisModalSave" class="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-md">Save</button></div>';
    $('oasisModalCancel').addEventListener('click', closeModalBox);
    f.onsubmit = function (e) {
      e.preventDefault();
      var btn = $('oasisModalSave'); btn.disabled = true;
      Promise.resolve(onSubmit(f)).then(function (res) {
        btn.disabled = false;
        if (res && res.success === false) { var er = $('oasisModalError'); er.textContent = res.error || res.message || 'Could not save.'; er.classList.remove('hidden'); return; }
        closeModalBox();
      }, function (err) { btn.disabled = false; var er = $('oasisModalError'); er.textContent = String(err); er.classList.remove('hidden'); });
    };
    modal.classList.remove('hidden');
    var firstInput = f.querySelector('input:not([readonly]):not([type=hidden]),select,textarea');
    if (firstInput) setTimeout(function () { firstInput.focus(); }, 30);
  }
  function field(id, label, input) {
    return '<div><label for="' + id + '" class="block text-xs font-bold text-slate-600 mb-1">' + label + '</label>' + input + '</div>';
  }
  var INPUT = 'w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white';

  function header(icon, title, desc, actionsHtml) {
    return '<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">' +
      '<div class="flex items-start gap-3"><div class="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0"><i class="fa-solid ' + icon + ' text-lg"></i></div>' +
      '<div><h2 class="text-xl font-extrabold text-slate-900">' + title + '</h2><p class="text-xs text-slate-500 mt-0.5 max-w-xl">' + desc + '</p></div></div>' +
      '<div class="flex flex-wrap gap-2">' + (actionsHtml || '') + '</div></div>';
  }
  function primaryBtn(id, icon, label) {
    return '<button type="button" id="' + id + '" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs shadow-sm flex items-center gap-2"><i class="fa-solid ' + icon + '"></i><span>' + label + '</span></button>';
  }
  function tile(label, value, sub) {
    return '<div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm"><p class="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">' + label + '</p>' +
      '<p class="text-2xl font-black text-slate-900 mt-1 tabular-nums">' + value + '</p>' + (sub ? '<p class="text-[11px] text-slate-500">' + sub + '</p>' : '') + '</div>';
  }

  // ============================================================ SCREEN MASTER
  var screenState = { list: [], q: '', cat: '' };
  function renderScreenMaster() {
    var sec = $('tab-screen-master'); if (!sec) return;
    sec.innerHTML = header('fa-desktop', 'Screen Master', 'Every screen in the Oasis app. Roles are given access screen by screen in Role Master. Built-in screens come from the app menu; you can also register extra screens.',
      canDo('screen-master', 'add') ? primaryBtn('smAdd', 'fa-plus', 'Add Screen') : '') +
      '<div id="smTiles" class="grid grid-cols-1 sm:grid-cols-3 gap-4"></div>' +
      '<div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">' +
      '<div class="p-4 border-b border-slate-200 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">' +
      '<label for="smSearch" class="sr-only">Search screens</label><div class="relative w-full sm:w-72"><i class="fa-solid fa-magnifying-glass absolute left-3 top-2.5 text-slate-400 text-xs"></i>' +
      '<input id="smSearch" type="search" placeholder="Search screens" class="' + INPUT + ' pl-8"></div>' +
      '<label for="smCat" class="sr-only">Menu group</label><select id="smCat" class="' + INPUT + ' sm:w-56"></select></div>' +
      '<div class="overflow-x-auto"><table class="w-full text-left text-xs"><thead class="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px]"><tr>' +
      '<th class="p-3">Screen</th><th class="p-3">Menu group</th><th class="p-3">What it is for</th><th class="p-3 text-center">Roles with access</th><th class="p-3 text-center">Type</th><th class="p-3 text-right">Actions</th>' +
      '</tr></thead><tbody id="smBody" class="divide-y divide-slate-100"><tr><td colspan="6" class="p-6 text-center text-slate-400">Loading…</td></tr></tbody></table></div></div>';
    if ($('smAdd')) $('smAdd').addEventListener('click', function () { screenForm(null); });
    $('smSearch').value = screenState.q;
    $('smSearch').addEventListener('input', function () { screenState.q = this.value; drawScreens(); });
    $('smCat').addEventListener('change', function () { screenState.cat = this.value; drawScreens(); });
    get('/api/screens').then(function (list) { screenState.list = Array.isArray(list) ? list : []; drawScreens(); });
  }
  function drawScreens() {
    var list = screenState.list;
    var cats = []; list.forEach(function (s) { if (cats.indexOf(s.category) === -1) cats.push(s.category); });
    $('smCat').innerHTML = '<option value="">All menu groups</option>' + cats.map(function (c) { return '<option' + (c === screenState.cat ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
    $('smTiles').innerHTML = tile('Screens', list.length, 'registered in the app') + tile('Menu groups', cats.length) +
      tile('Custom screens', list.filter(function (s) { return !s.builtin; }).length, 'added by you');
    var q = screenState.q.toLowerCase().trim();
    var rows = list.filter(function (s) {
      return (!screenState.cat || s.category === screenState.cat) &&
        (!q || (s.screen_name + ' ' + s.screen_id + ' ' + (s.description || '')).toLowerCase().indexOf(q) !== -1);
    });
    var canEdit = canDo('screen-master', 'modify'), canDel = canDo('screen-master', 'delete');
    $('smBody').innerHTML = rows.length ? rows.map(function (s) {
      return '<tr class="hover:bg-slate-50">' +
        '<td class="p-3"><div class="flex items-center gap-2.5"><span class="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0"><i class="fa-solid ' + esc(s.icon) + '"></i></span>' +
        '<div><div class="font-bold text-slate-900">' + esc(s.screen_name) + '</div><div class="font-mono text-[10px] text-slate-400">' + esc(s.screen_id) + '</div></div></div></td>' +
        '<td class="p-3 text-slate-600">' + esc(s.category) + '</td>' +
        '<td class="p-3 text-slate-500 max-w-xs">' + esc(s.description || '—') + '</td>' +
        '<td class="p-3 text-center tabular-nums font-bold text-slate-700">' + s.roles_with_access + ' of ' + s.total_roles + '</td>' +
        '<td class="p-3 text-center">' + (s.builtin ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600">Built-in</span>' : '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">Custom</span>') + '</td>' +
        '<td class="p-3 text-right whitespace-nowrap">' +
        (canEdit ? '<button type="button" data-edit="' + esc(s.screen_id) + '" class="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-bold">Edit</button> ' : '') +
        (canDel && !s.builtin ? '<button type="button" data-del="' + esc(s.screen_id) + '" class="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg text-[11px] font-bold">Delete</button>' : '') +
        '</td></tr>';
    }).join('') : '<tr><td colspan="6" class="p-6 text-center text-slate-400">No screens match.</td></tr>';
    Array.prototype.forEach.call($('smBody').querySelectorAll('[data-edit]'), function (b) {
      b.addEventListener('click', function () { screenForm(list.find(function (s) { return s.screen_id === b.dataset.edit; })); });
    });
    Array.prototype.forEach.call($('smBody').querySelectorAll('[data-del]'), function (b) {
      b.addEventListener('click', function () {
        if (!confirm('Delete the screen "' + b.dataset.del + '"? Its access settings are removed from every role.')) return;
        del('/api/screens?id=' + encodeURIComponent(b.dataset.del)).then(function (d) {
          if (d.success) { toast('Screen deleted'); renderScreenMaster(); } else toast(d.error || 'Could not delete', 'error');
        });
      });
    });
  }
  function screenForm(s) {
    var cats = []; screenState.list.forEach(function (x) { if (cats.indexOf(x.category) === -1) cats.push(x.category); });
    var builtin = s && s.builtin;
    openModalBox(s ? 'Edit screen' : 'Add screen', builtin ? 'Built-in screens keep the name shown in the menu. You can change the description.' : 'Register a screen so roles can be given access to it.',
      field('smfId', 'Screen ID', '<input id="smfId" ' + (s ? 'readonly' : '') + ' required placeholder="e.g. transport-live" class="' + INPUT + (s ? ' bg-slate-50 text-slate-500' : '') + ' font-mono" value="' + esc(s ? s.screen_id : '') + '">') +
      field('smfName', 'Screen name', '<input id="smfName" ' + (builtin ? 'readonly' : '') + ' required class="' + INPUT + (builtin ? ' bg-slate-50 text-slate-500' : '') + '" value="' + esc(s ? s.screen_name : '') + '">') +
      field('smfCat', 'Menu group', '<input id="smfCat" list="smfCats" ' + (builtin ? 'readonly' : '') + ' class="' + INPUT + (builtin ? ' bg-slate-50 text-slate-500' : '') + '" value="' + esc(s ? s.category : 'General') + '"><datalist id="smfCats">' +
        cats.map(function (c) { return '<option value="' + esc(c) + '">'; }).join('') + '</datalist>') +
      field('smfDesc', 'What it is for', '<textarea id="smfDesc" rows="2" class="' + INPUT + '">' + esc(s ? s.description : '') + '</textarea>'),
      function () {
        return post('/api/screens', { mode: s ? 'edit' : 'add', screen_id: $('smfId').value, screen_name: $('smfName').value, category: $('smfCat').value, description: $('smfDesc').value })
          .then(function (d) { if (d.success) { toast(d.message || 'Saved'); renderScreenMaster(); } return d; });
      });
  }

  // ============================================================ ROLE MASTER
  var roleState = { roles: [], screens: [], active: null, perms: [], dirty: false };
  function renderRoleMaster() {
    var sec = $('tab-role-master'); if (!sec) return;
    sec.innerHTML = header('fa-user-shield', 'Role Master', 'Create roles such as Administrator, Staff, Teacher and Parent, then tick the screens each role can open and what it may do there: Read, Add, Modify or Delete.',
      canDo('role-master', 'add') ? primaryBtn('rmAdd', 'fa-plus', 'New Role') : '') +
      '<div class="grid grid-cols-1 lg:grid-cols-4 gap-6">' +
      '<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3 self-start"><h3 class="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Roles</h3><div id="rmRoles" class="space-y-2"></div></div>' +
      '<div class="lg:col-span-3 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"><div id="rmHead" class="p-4 border-b border-slate-200 bg-slate-50/60"></div>' +
      '<div class="overflow-x-auto"><table class="w-full text-left text-xs"><thead class="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px]"><tr>' +
      '<th class="p-3">Screen</th>' + ['Read', 'Add', 'Modify', 'Delete'].map(function (c) {
        return '<th class="p-3 text-center"><label class="inline-flex flex-col items-center gap-1 cursor-pointer"><span>' + c + '</span><input type="checkbox" class="oasis-check rm-col" data-col="' + c.toLowerCase() + '" aria-label="' + c + ' on every screen"></label></th>';
      }).join('') + '<th class="p-3 text-center">All</th></tr></thead><tbody id="rmBody" class="divide-y divide-slate-100"></tbody></table></div></div></div>';
    if ($('rmAdd')) $('rmAdd').addEventListener('click', function () { roleForm(null); });
    Promise.all([get('/api/roles'), get('/api/screens')]).then(function (r) {
      roleState.roles = Array.isArray(r[0]) ? r[0] : [];
      roleState.screens = Array.isArray(r[1]) ? r[1] : [];
      if (!roleState.active || !roleState.roles.some(function (x) { return x.role_id === roleState.active; })) roleState.active = roleState.roles.length ? roleState.roles[0].role_id : null;
      drawRoles(); loadRolePerms();
    });
  }
  function drawRoles() {
    $('rmRoles').innerHTML = roleState.roles.map(function (r) {
      var on = r.role_id === roleState.active;
      return '<button type="button" data-role="' + esc(r.role_id) + '" class="w-full text-left p-3 rounded-xl border transition-all ' +
        (on ? 'bg-emerald-50 border-emerald-300 shadow-sm' : 'bg-slate-50 hover:bg-slate-100 border-slate-200') + '">' +
        '<div class="flex items-center justify-between gap-2"><span class="text-xs font-bold ' + (on ? 'text-emerald-900' : 'text-slate-800') + '">' + esc(r.role_name) + (r.locked ? ' <i class="fa-solid fa-lock text-[10px] text-slate-400" title="Full access, cannot be changed"></i>' : '') + '</span>' +
        '<span class="text-[10px] text-slate-400 font-mono">' + esc(r.role_id) + '</span></div>' +
        '<p class="text-[11px] text-slate-500 mt-1">' + r.user_count + ' user' + (r.user_count === 1 ? '' : 's') + ' · ' + r.screen_count + ' screen' + (r.screen_count === 1 ? '' : 's') + '</p></button>';
    }).join('');
    Array.prototype.forEach.call($('rmRoles').querySelectorAll('[data-role]'), function (b) {
      b.addEventListener('click', function () {
        if (roleState.dirty && !confirm('You have unsaved access changes for this role. Discard them?')) return;
        roleState.active = b.dataset.role; drawRoles(); loadRolePerms();
      });
    });
  }
  function activeRole() { return roleState.roles.find(function (r) { return r.role_id === roleState.active; }); }
  function loadRolePerms() {
    var r = activeRole();
    if (!r) { $('rmHead').innerHTML = '<p class="text-xs text-slate-500">Create a role to start.</p>'; $('rmBody').innerHTML = ''; return; }
    get('/api/role-permissions?role_id=' + encodeURIComponent(r.role_id)).then(function (list) {
      var byId = {}; (Array.isArray(list) ? list : []).forEach(function (p) { byId[p.screen_id] = p; });
      roleState.perms = roleState.screens.map(function (s) {
        var p = byId[s.screen_id] || {};
        return { screen_id: s.screen_id, screen_name: s.screen_name, category: s.category, icon: s.icon,
          read: !!p.can_read, add: !!p.can_add, modify: !!p.can_modify, 'delete': !!p.can_delete };
      });
      roleState.dirty = false;
      drawRoleHead(); drawMatrix();
    });
  }
  function drawRoleHead() {
    var r = activeRole(), locked = !!r.locked, editable = !locked && canDo('role-master', 'modify');
    $('rmHead').innerHTML = '<div class="flex flex-col md:flex-row md:items-center justify-between gap-3"><div>' +
      '<h3 class="text-sm font-extrabold text-slate-900 flex items-center gap-2"><i class="fa-solid fa-user-shield text-emerald-600"></i>' + esc(r.role_name) + '</h3>' +
      '<p class="text-[11px] text-slate-500 mt-0.5">' + esc(r.description || 'No description') + '</p>' +
      (locked ? '<p class="text-[11px] font-semibold text-slate-600 mt-1"><i class="fa-solid fa-lock"></i> Administrator always has full access so the school can never be locked out.</p>' : '') +
      '</div><div class="flex flex-wrap items-center gap-2"><span id="rmDirty" class="hidden text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg">Unsaved changes</span>' +
      (!locked && canDo('role-master', 'modify') ? '<button type="button" id="rmEdit" class="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold">Edit role</button>' : '') +
      (!locked && canDo('role-master', 'delete') ? '<button type="button" id="rmDel" class="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-xl text-xs font-bold">Delete role</button>' : '') +
      (editable ? '<button type="button" id="rmSave" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow disabled:opacity-50" disabled><i class="fa-solid fa-check"></i> Save access</button>' : '') +
      '</div></div>';
    if ($('rmEdit')) $('rmEdit').addEventListener('click', function () { roleForm(r); });
    if ($('rmDel')) $('rmDel').addEventListener('click', function () {
      if (!confirm('Delete the role "' + r.role_name + '"?')) return;
      del('/api/roles?id=' + encodeURIComponent(r.role_id)).then(function (d) {
        if (d.success) { toast('Role deleted'); roleState.active = null; renderRoleMaster(); } else toast(d.error || 'Could not delete', 'error');
      });
    });
    if ($('rmSave')) $('rmSave').addEventListener('click', function () {
      var payload = roleState.perms.map(function (p) { return { screen_id: p.screen_id, can_read: p.read ? 1 : 0, can_add: p.add ? 1 : 0, can_modify: p.modify ? 1 : 0, can_delete: p['delete'] ? 1 : 0 }; });
      post('/api/role-permissions', { role_id: r.role_id, permissions: payload }).then(function (d) {
        if (d.success) { toast(d.message || 'Saved'); roleState.dirty = false; renderRoleMaster(); if (me && me.role === r.role_name) refreshMyAccess(); }
        else toast(d.error || 'Could not save', 'error');
      });
    });
  }
  function markDirty() {
    roleState.dirty = true;
    if ($('rmDirty')) $('rmDirty').classList.remove('hidden');
    if ($('rmSave')) $('rmSave').disabled = false;
  }
  var COLS = ['read', 'add', 'modify', 'delete'];
  function drawMatrix() {
    var r = activeRole(), editable = !r.locked && canDo('role-master', 'modify');
    var html = '', lastCat = null;
    roleState.perms.forEach(function (p, i) {
      if (p.category !== lastCat) {
        lastCat = p.category;
        html += '<tr class="bg-slate-50/70"><td colspan="6" class="px-3 py-2 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">' + esc(p.category) + '</td></tr>';
      }
      var allOn = COLS.every(function (c) { return p[c]; });
      html += '<tr class="hover:bg-slate-50"><td class="p-3"><span class="inline-flex items-center gap-2 font-bold text-slate-800"><i class="fa-solid ' + esc(p.icon) + ' w-4 text-center text-emerald-600"></i>' + esc(p.screen_name) + '</span></td>' +
        COLS.map(function (c) {
          return '<td class="p-3 text-center"><input type="checkbox" class="oasis-check rm-cell" data-i="' + i + '" data-c="' + c + '"' + (p[c] ? ' checked' : '') + (editable ? '' : ' disabled') +
            ' aria-label="' + c + ' ' + esc(p.screen_name) + '"></td>';
        }).join('') +
        '<td class="p-3 text-center"><input type="checkbox" class="oasis-check rm-row" data-i="' + i + '"' + (allOn ? ' checked' : '') + (editable ? '' : ' disabled') + ' aria-label="All actions on ' + esc(p.screen_name) + '"></td></tr>';
    });
    $('rmBody').innerHTML = html;
    Array.prototype.forEach.call(document.querySelectorAll('.rm-col'), function (h) {
      h.disabled = !editable;
      h.checked = roleState.perms.length > 0 && roleState.perms.every(function (p) { return p[h.dataset.col]; });
      h.onchange = function () {
        var c = h.dataset.col, v = h.checked;
        roleState.perms.forEach(function (p) {
          p[c] = v;
          if (v && c !== 'read') p.read = true;
          if (!v && c === 'read') { p.add = p.modify = p['delete'] = false; }
        });
        markDirty(); drawMatrix();
      };
    });
    Array.prototype.forEach.call($('rmBody').querySelectorAll('.rm-cell'), function (cb) {
      cb.addEventListener('change', function () {
        var p = roleState.perms[+cb.dataset.i], c = cb.dataset.c;
        p[c] = cb.checked;
        if (cb.checked && c !== 'read') p.read = true;                          // any action needs Read
        if (!cb.checked && c === 'read') { p.add = p.modify = p['delete'] = false; } // no Read, no actions
        markDirty(); drawMatrix();
      });
    });
    Array.prototype.forEach.call($('rmBody').querySelectorAll('.rm-row'), function (cb) {
      cb.addEventListener('change', function () {
        var p = roleState.perms[+cb.dataset.i];
        COLS.forEach(function (c) { p[c] = cb.checked; });
        markDirty(); drawMatrix();
      });
    });
    if (roleState.dirty) markDirty();
  }
  function roleForm(r) {
    openModalBox(r ? 'Edit role' : 'New role', r ? '' : 'After creating the role, tick the screens it can use.',
      field('rfName', 'Role name', '<input id="rfName" required placeholder="e.g. Accountant, Principal" class="' + INPUT + '" value="' + esc(r ? r.role_name : '') + '">') +
      field('rfDesc', 'Description', '<textarea id="rfDesc" rows="3" placeholder="What this role is responsible for" class="' + INPUT + '">' + esc(r ? r.description : '') + '</textarea>'),
      function () {
        return post('/api/roles', { role_id: r ? r.role_id : '', role_name: $('rfName').value, description: $('rfDesc').value }).then(function (d) {
          if (d.success) { toast(d.message || 'Saved'); roleState.active = d.role_id; renderRoleMaster(); }
          return d;
        });
      });
  }

  // ============================================================ USER APPROVALS
  // New sign-ups wait here until someone with User Approvals (Modify) approves or rejects them.
  var apprState = { data: null, view: 'pending', busy: {} };
  function fullName(u) { return ((u.first_name || '') + ' ' + (u.last_name || '')).trim() || u.username || u.email; }
  function refreshApprovalBadge() {
    var b = $('navApprovalsBadge');
    if (!b) return;
    if (!me || !canDo('user-approvals', 'read')) { b.classList.add('hidden'); return; }
    get('/api/users/approvals').then(function (d) {
      var n = d && Array.isArray(d.pending) ? d.pending.length : 0;
      b.textContent = n > 99 ? '99+' : String(n);
      b.classList.toggle('hidden', !n);
      b.setAttribute('aria-label', n + ' sign-up' + (n === 1 ? '' : 's') + ' waiting for approval');
    }, function () {});
  }
  setInterval(function () { if (me && !document.hidden) refreshApprovalBadge(); }, 60000);
  window.refreshApprovalBadge = refreshApprovalBadge;

  function renderUserApprovals() {
    var sec = $('tab-user-approvals'); if (!sec) return;
    sec.innerHTML = header('fa-user-check', 'User Approvals',
      'People who signed up on the login screen wait here. Approve them with the right role so they can log in, or reject the sign-up. ' +
      'A parent sees their child once their email or mobile matches the mother’s or father’s details on the admission.',
      '<button type="button" id="apRefresh" class="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs flex items-center gap-2"><i class="fa-solid fa-rotate"></i><span>Refresh</span></button>') +
      '<div id="apTiles" class="grid grid-cols-3 gap-3"></div>' +
      '<div class="flex flex-wrap gap-2" role="tablist">' +
      ['pending', 'rejected', 'approved'].map(function (v) {
        return '<button type="button" role="tab" data-view="' + v + '" class="ap-view px-4 py-2 rounded-xl text-xs font-bold border" style="min-height:40px">' +
          { pending: 'Waiting', rejected: 'Rejected', approved: 'Recently approved' }[v] + '</button>';
      }).join('') + '</div>' +
      '<div id="apList" class="space-y-3"><div class="bg-white p-6 rounded-2xl border border-slate-200 text-center text-xs text-slate-400">Loading…</div></div>';
    $('apRefresh').addEventListener('click', loadApprovals);
    Array.prototype.forEach.call(sec.querySelectorAll('.ap-view'), function (b) {
      b.addEventListener('click', function () { apprState.view = b.dataset.view; drawApprovals(); });
    });
    loadApprovals();
  }
  function loadApprovals() {
    return get('/api/users/approvals').then(function (d) {
      if (!d || !Array.isArray(d.pending)) {
        apprState.data = null;
        if ($('apList')) $('apList').innerHTML = '<div class="bg-white p-6 rounded-2xl border border-rose-200 text-center text-xs text-rose-600">Could not load the sign-ups. ' +
          esc((d && (d.error || d.message)) || 'Please refresh the page.') + '</div>';
        return;
      }
      apprState.data = d;
      drawApprovals();
      var b = $('navApprovalsBadge');
      if (b) { b.textContent = String(d.pending.length); b.classList.toggle('hidden', !d.pending.length); }
    }, function () {
      if ($('apList')) $('apList').innerHTML = '<div class="bg-white p-6 rounded-2xl border border-rose-200 text-center text-xs text-rose-600">Could not reach the server. Please try again.</div>';
    });
  }
  function childLine(u, withForm) {
    if (!/parent/i.test(u.role || '') && !u.children.length) return '';
    return u.children.length
      ? '<p class="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2"><i class="fa-solid fa-child"></i> Will see: ' +
        u.children.map(function (c) { return esc(c.name) + (c.class_name ? ' (' + esc(c.class_name) + ')' : ''); }).join(', ') + '</p>'
      : '<p class="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2"><i class="fa-solid fa-circle-info"></i> No child is linked yet. ' +
        (withForm ? 'Add the parent’s mobile below, or make sure' : 'Add their mobile in User Master, or make sure') + ' their email or mobile is on the child’s admission (mother or father).</p>';
  }
  function drawApprovals() {
    var d = apprState.data, list = $('apList');
    if (!d || !list) return;
    $('apTiles').innerHTML = tile('Waiting', d.pending.length) + tile('Rejected', d.rejected.length) + tile('Approved', d.approved.length, 'recently');
    Array.prototype.forEach.call(document.querySelectorAll('#tab-user-approvals .ap-view'), function (b) {
      var on = b.dataset.view === apprState.view;
      b.className = 'ap-view px-4 py-2 rounded-xl text-xs font-bold border ' + (on ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50');
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    var canDecide = canDo('user-approvals', 'modify') || canDo('user-master', 'modify');
    var rows = d[apprState.view] || [];
    if (!rows.length) {
      list.innerHTML = '<div class="bg-white p-8 rounded-2xl border border-slate-200 text-center">' +
        '<i class="fa-solid fa-circle-check text-3xl text-emerald-500"></i><p class="text-sm font-bold text-slate-700 mt-2">' +
        { pending: 'No sign-ups are waiting.', rejected: 'No rejected sign-ups.', approved: 'No approvals yet.' }[apprState.view] + '</p>' +
        (apprState.view === 'pending' ? '<p class="text-xs text-slate-500 mt-1">When someone creates an account on the login screen, it appears here.</p>' : '') + '</div>';
      return;
    }
    list.innerHTML = rows.map(function (u) {
      var pending = apprState.view === 'pending', rejected = apprState.view === 'rejected';
      var roleOpts = d.roles.map(function (r) { return '<option' + (r.toLowerCase() === String(u.role || 'Parent').toLowerCase() ? ' selected' : '') + '>' + esc(r) + '</option>'; }).join('');
      var head = '<div class="flex items-start gap-3"><span class="w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold shrink-0">' + esc(fullName(u).charAt(0).toUpperCase()) + '</span>' +
        '<div class="min-w-0 flex-1"><div class="font-bold text-slate-900 text-sm break-words">' + esc(fullName(u)) + ' <span class="font-mono text-[11px] text-slate-400">@' + esc(u.username) + '</span></div>' +
        '<div class="text-xs text-slate-600 break-all">' + esc(u.email) + (u.mobile ? ' · ' + esc(u.mobile) : '') + '</div>' +
        '<div class="text-[11px] text-slate-400">' + (u.signed_up ? 'Signed up ' + esc(u.signed_up) : '') +
        (!pending && u.decided_at ? (u.signed_up ? ' · ' : '') + (rejected ? 'Rejected' : 'Approved') + ' ' + esc(u.decided_at) + (u.decided_by ? ' by ' + esc(u.decided_by) : '') : '') + '</div></div>' +
        (!pending ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold border ' + (rejected ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200') + '">' +
          (rejected ? 'Rejected' : esc(u.role)) + '</span>' : '') + '</div>';
      var form = (pending || rejected) && canDecide
        ? '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">' +
          '<div><label for="apRole-' + esc(u.user_id) + '" class="block text-[11px] font-bold text-slate-600 mb-1">Role</label><select id="apRole-' + esc(u.user_id) + '" class="' + INPUT + '">' + roleOpts + '</select></div>' +
          '<div><label for="apMob-' + esc(u.user_id) + '" class="block text-[11px] font-bold text-slate-600 mb-1">Mobile number (optional)</label><input id="apMob-' + esc(u.user_id) + '" type="tel" inputmode="numeric" maxlength="14" value="' + esc(u.mobile) + '" placeholder="10-digit mobile" class="' + INPUT + '"></div></div>' +
          '<div class="flex flex-wrap gap-2 justify-end">' +
          (pending ? '<button type="button" data-ap-reject="' + esc(u.user_id) + '" class="px-4 py-2 bg-amber-50 hover:bg-amber-100 text-amber-800 rounded-xl text-xs font-bold" style="min-height:40px">Reject</button>' : '') +
          '<button type="button" data-ap-approve="' + esc(u.user_id) + '" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm" style="min-height:40px"><i class="fa-solid fa-check"></i> ' +
          (rejected ? 'Approve after all' : 'Approve') + '</button></div>'
        : '';
      return '<div class="bg-white p-4 rounded-2xl border ' + (pending ? 'border-amber-200' : 'border-slate-200') + ' shadow-sm space-y-3" data-ap-card="' + esc(u.user_id) + '">' +
        head + childLine(u, !!form) + form + '</div>';
    }).join('');
    Array.prototype.forEach.call(list.querySelectorAll('[data-ap-approve]'), function (b) {
      b.addEventListener('click', function () { decideSignup(b.dataset.apApprove, true, b); });
    });
    Array.prototype.forEach.call(list.querySelectorAll('[data-ap-reject]'), function (b) {
      b.addEventListener('click', function () {
        var u = rows.find(function (x) { return x.user_id === b.dataset.apReject; });
        openModalBox('Reject this sign-up?', fullName(u) + ' (' + u.email + ') will not be able to log in. You can still approve it later from the Rejected list.',
          '<p class="text-xs text-slate-600">Reject the account <b>@' + esc(u.username) + '</b>?</p>',
          function () { return decideSignup(u.user_id, false, b); });
        if ($('oasisModalSave')) $('oasisModalSave').textContent = 'Reject';
      });
    });
  }
  function decideSignup(userId, approve, btn) {
    if (apprState.busy[userId]) return Promise.resolve({ success: true });
    apprState.busy[userId] = true;
    if (btn) btn.disabled = true;
    var body = { user_id: userId };
    if (approve) {
      body.role = ($('apRole-' + userId) || {}).value || '';
      body.mobile = (($('apMob-' + userId) || {}).value || '').trim();
    }
    return post(approve ? '/api/users/approve' : '/api/users/reject', body).then(function (d) {
      delete apprState.busy[userId];
      if (btn) btn.disabled = false;
      if (d.success) {
        var u = (apprState.data.pending.concat(apprState.data.rejected)).find(function (x) { return x.user_id === userId; }) || {};
        toast(approve ? fullName(u) + ' is approved as ' + (d.role || body.role) + ' and can log in now' : 'Sign-up rejected');
        loadApprovals();
        refreshNotificationsSoon();
        return d;
      }
      if (d._status === 409 && /no longer waiting/.test(d.error || '')) loadApprovals();
      if (approve) toast(d.error || d.message || 'Could not save', 'error');
      return d;   // a reject shows its error inside the dialog
    }, function () {
      delete apprState.busy[userId];
      if (btn) btn.disabled = false;
      toast('Could not reach the server. Please try again.', 'error');
      return { success: false, error: 'Could not reach the server. Please try again.' };
    });
  }
  function refreshNotificationsSoon() { if (typeof window.oasisRefreshNotifications === 'function') window.oasisRefreshNotifications(); }

  // ============================================================ USER MASTER
  var userState = { users: [], roles: [], q: '', role: '', status: '' };
  function renderUserMaster() {
    var sec = $('tab-user-master'); if (!sec) return;
    sec.innerHTML = header('fa-users', 'User Master', 'Everyone who can use the app, with their mobile number, email and role. A user logs in with their email or username and password, and sees only the screens and actions their role allows.',
      canDo('user-master', 'add') ? primaryBtn('umAdd', 'fa-user-plus', 'Add User') : '') +
      '<div id="umTiles" class="grid grid-cols-2 lg:grid-cols-4 gap-4"></div>' +
      '<div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"><div class="p-4 border-b border-slate-200 flex flex-col md:flex-row gap-3">' +
      '<label for="umSearch" class="sr-only">Search users</label><div class="relative w-full md:w-72"><i class="fa-solid fa-magnifying-glass absolute left-3 top-2.5 text-slate-400 text-xs"></i>' +
      '<input id="umSearch" type="search" placeholder="Search name, username, email or mobile" class="' + INPUT + ' pl-8"></div>' +
      '<label for="umRole" class="sr-only">Role</label><select id="umRole" class="' + INPUT + ' md:w-48"></select>' +
      '<label for="umStatus" class="sr-only">Status</label><select id="umStatus" class="' + INPUT + ' md:w-40"><option value="">Any status</option><option>Active</option><option>Disabled</option><option>Pending</option><option>Rejected</option></select></div>' +
      '<div class="overflow-x-auto"><table class="w-full text-left text-xs"><thead class="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px]"><tr>' +
      '<th class="p-3">Name</th><th class="p-3">Email</th><th class="p-3">Mobile</th><th class="p-3">Role</th><th class="p-3 text-center">Status</th><th class="p-3">Signs in with</th><th class="p-3 text-right">Actions</th>' +
      '</tr></thead><tbody id="umBody" class="divide-y divide-slate-100"><tr><td colspan="7" class="p-6 text-center text-slate-400">Loading…</td></tr></tbody></table></div></div>';
    if ($('umAdd')) $('umAdd').addEventListener('click', function () { userForm(null); });
    $('umSearch').value = userState.q; $('umStatus').value = userState.status;
    $('umSearch').addEventListener('input', function () { userState.q = this.value; drawUsers(); });
    $('umRole').addEventListener('change', function () { userState.role = this.value; drawUsers(); });
    $('umStatus').addEventListener('change', function () { userState.status = this.value; drawUsers(); });
    Promise.all([get('/api/users/master'), get('/api/roles')]).then(function (r) {
      userState.loaded = Array.isArray(r[0]);
      userState.users = Array.isArray(r[0]) ? r[0] : []; userState.roles = Array.isArray(r[1]) ? r[1] : [];
      drawUsers();
    }, function () {
      $('umBody').innerHTML = '<tr><td colspan="7" class="p-6 text-center text-rose-600">Could not load the users. Please refresh the page.</td></tr>';
    });
  }
  // Indian mobile numbers are shown as 10 digits (stored numbers may carry +91, 91 or a leading 0).
  function tenDigits(m) { var d = String(m || '').replace(/\D/g, ''); if (d.length === 12 && d.indexOf('91') === 0) d = d.slice(2); if (d.length === 11 && d.charAt(0) === '0') d = d.slice(1); return d; }
  function statusLabel(s) { return s === 'Approved' ? 'Active' : (s || 'Active'); }
  var STATUS_STYLE = { Active: 'bg-emerald-50 text-emerald-700 border-emerald-200', Disabled: 'bg-slate-100 text-slate-500 border-slate-200', Pending: 'bg-amber-50 text-amber-700 border-amber-200', Rejected: 'bg-rose-50 text-rose-700 border-rose-200' };
  // Only Administrators may create, change or delete Administrator accounts (the server enforces this too).
  function adminRoleName() { var r = userState.roles.find(function (x) { return x.locked; }); return r ? r.role_name : 'Administrator'; }
  function isAdminName(name) { return String(name || '').toLowerCase() === adminRoleName().toLowerCase(); }
  function meIsAdmin() { return !!me && isAdminName(me.role); }
  function drawUsers() {
    var users = userState.users;
    $('umRole').innerHTML = '<option value="">All roles</option>' + userState.roles.map(function (r) { return '<option' + (r.role_name === userState.role ? ' selected' : '') + '>' + esc(r.role_name) + '</option>'; }).join('');
    var active = users.filter(function (u) { return statusLabel(u.status) === 'Active'; }).length;
    $('umTiles').innerHTML = tile('Users', users.length) + tile('Active', active) +
      tile('Waiting for approval', users.filter(function (u) { return u.status === 'Pending'; }).length) + tile('Roles', userState.roles.length);
    var q = userState.q.toLowerCase().trim();
    var rows = users.filter(function (u) {
      return (!userState.role || (u.role || '').toLowerCase() === userState.role.toLowerCase()) &&
        (!userState.status || statusLabel(u.status) === userState.status) &&
        (!q || ((u.first_name || '') + ' ' + (u.last_name || '') + ' ' + (u.username || '') + ' ' + u.email + ' ' + (u.mobile || '')).toLowerCase().indexOf(q) !== -1);
    });
    var canEditAny = canDo('user-master', 'modify'), canDelAny = canDo('user-master', 'delete');
    if (!userState.loaded) { $('umBody').innerHTML = '<tr><td colspan="7" class="p-6 text-center text-rose-600">Could not load the users. Please refresh the page.</td></tr>'; return; }
    $('umBody').innerHTML = rows.length ? rows.map(function (u) {
      var st = statusLabel(u.status), name = ((u.first_name || '') + ' ' + (u.last_name || '')).trim() || u.email;
      var isMe = me && me.user_id === u.user_id;
      var locked = isAdminName(u.role) && !meIsAdmin();      // an admin account, and I am not an admin
      var canEdit = canEditAny && !locked, canDel = canDelAny && !locked;
      return '<tr class="hover:bg-slate-50">' +
        '<td class="p-3"><div class="flex items-center gap-2.5"><span class="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold shrink-0">' + esc(name.charAt(0).toUpperCase()) + '</span>' +
        '<div><div class="font-bold text-slate-900">' + esc(name) + (isMe ? ' <span class="text-[10px] font-bold text-emerald-700">(you)</span>' : '') + '</div><div class="font-mono text-[10px] text-slate-400">' + (u.username ? '@' + esc(u.username) : esc(u.user_id)) + '</div></div></div></td>' +
        '<td class="p-3 text-slate-700">' + esc(u.email) + '</td><td class="p-3 text-slate-600 tabular-nums">' + esc(tenDigits(u.mobile) || '—') + '</td>' +
        '<td class="p-3"><span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-teal-50 text-teal-800 border border-teal-200">' + esc(u.role || '—') + '</span></td>' +
        '<td class="p-3 text-center"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold border ' + (STATUS_STYLE[st] || STATUS_STYLE.Active) + '">' + esc(st) + '</span></td>' +
        '<td class="p-3 text-slate-500">' + (u.has_password ? 'Password' : '<span class="text-amber-700 font-semibold">No password yet</span>') + '</td>' +
        '<td class="p-3 text-right whitespace-nowrap">' +
        (canEdit && u.status === 'Pending' ? '<button type="button" data-approve="' + esc(u.user_id) + '" class="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-bold">Approve</button> ' +
          '<button type="button" data-reject="' + esc(u.user_id) + '" class="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-lg text-[11px] font-bold">Reject</button> ' : '') +
        (canEdit ? '<button type="button" data-edit="' + esc(u.user_id) + '" class="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-bold">Edit</button> ' : '') +
        (canDel && !isMe ? '<button type="button" data-del="' + esc(u.user_id) + '" class="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg text-[11px] font-bold">Delete</button>' : '') +
        '</td></tr>';
    }).join('') : '<tr><td colspan="7" class="p-6 text-center text-slate-400">No users match.</td></tr>';
    // Sign-ups waiting for approval are approved or rejected right here.
    Array.prototype.forEach.call($('umBody').querySelectorAll('[data-approve], [data-reject]'), function (b) {
      b.addEventListener('click', function () {
        var ok = !!b.dataset.approve, u = users.find(function (x) { return x.user_id === (b.dataset.approve || b.dataset.reject); });
        if (!ok && !confirm('Reject the sign-up from ' + u.email + '? They will not be able to log in.')) return;
        post(ok ? '/api/users/approve' : '/api/users/reject', { user_id: u.user_id, email: u.email }).then(function (d) {
          if (d.success) { toast(ok ? 'Approved: ' + u.email + ' can log in now' : 'Sign-up rejected'); renderUserMaster(); refreshApprovalBadge(); }
          else toast(d.error || 'Could not save', 'error');
        });
      });
    });
    Array.prototype.forEach.call($('umBody').querySelectorAll('[data-edit]'), function (b) {
      b.addEventListener('click', function () { userForm(users.find(function (u) { return u.user_id === b.dataset.edit; })); });
    });
    Array.prototype.forEach.call($('umBody').querySelectorAll('[data-del]'), function (b) {
      b.addEventListener('click', function () {
        var u = users.find(function (x) { return x.user_id === b.dataset.del; });
        if (!confirm('Delete the user ' + u.email + '? They will no longer be able to sign in.')) return;
        del('/api/users/master?id=' + encodeURIComponent(u.user_id)).then(function (d) {
          if (d.success) { toast('User deleted'); renderUserMaster(); } else toast(d.error || 'Could not delete', 'error');
        });
      });
    });
  }
  function userForm(u) {
    if (!userState.roles.length) {   // roles not loaded yet: load them first
      get('/api/roles').then(function (r) { if (Array.isArray(r) && r.length) { userState.roles = r; userForm(u); } else toast('Could not load the roles. Please refresh the page.', 'error'); });
      return;
    }
    var isMe = u && me && me.user_id === u.user_id;
    var roleOpts = userState.roles.filter(function (r) {
      return meIsAdmin() || !r.locked;                  // only Administrators can give the Administrator role
    }).map(function (r) {
      var sel = u ? (r.role_name.toLowerCase() === String(u.role || '').toLowerCase()) : r.role_name === 'Parent';
      return '<option value="' + esc(r.role_name) + '"' + (sel ? ' selected' : '') + '>' + esc(r.role_name) + ' — ' + r.screen_count + ' screen' + (r.screen_count === 1 ? '' : 's') + '</option>';
    }).join('');
    var st = u ? statusLabel(u.status) : 'Active';
    openModalBox(u ? 'Edit user' : 'Add user', 'They log in with this email (or their username) and the password set here.',
      '<div class="grid grid-cols-2 gap-3">' +
      field('ufFirst', 'First name', '<input id="ufFirst" required autocomplete="off" class="' + INPUT + '" value="' + esc(u ? u.first_name : '') + '">') +
      field('ufLast', 'Last name', '<input id="ufLast" autocomplete="off" class="' + INPUT + '" value="' + esc(u ? u.last_name : '') + '">') + '</div>' +
      field('ufMobile', 'Mobile number', '<div class="flex"><span class="px-3 py-2 text-xs border border-r-0 border-slate-200 rounded-l-xl bg-slate-50 text-slate-500">+91</span>' +
        '<input id="ufMobile" inputmode="numeric" maxlength="10" placeholder="10-digit mobile" autocomplete="off" class="' + INPUT + ' rounded-l-none" value="' + esc(u ? tenDigits(u.mobile) : '') + '"></div>') +
      field('ufEmail', 'Email', '<input id="ufEmail" type="email" required autocomplete="off" class="' + INPUT + '" value="' + esc(u ? u.email : '') + '">') +
      field('ufUsername', 'Username', '<input id="ufUsername" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="30" placeholder="' +
        (u ? '' : 'Leave blank to use the part of the email before @') + '" class="' + INPUT + '" value="' + esc(u ? u.username || '' : '') + '">') +
      field('ufPassword', u ? 'New password' : 'Password', '<input id="ufPassword" type="password" autocomplete="new-password" minlength="8" placeholder="' +
        (u ? (u.has_password ? 'Leave blank to keep the current password' : 'No password yet: set one (8+ characters)') : 'At least 8 characters') + '" class="' + INPUT + '"' + (u ? '' : ' required') + '>') +
      field('ufRole', 'Role', '<select id="ufRole" class="' + INPUT + '"' + (isMe ? ' disabled' : '') + '>' + roleOpts + '</select>' +
        (isMe ? '<p class="text-[11px] text-slate-500 mt-1">You cannot change your own role.</p>' : '')) +
      field('ufStatus', 'Status', '<select id="ufStatus" class="' + INPUT + '"' + (isMe ? ' disabled' : '') + '>' +
        (u && (st === 'Pending' || st === 'Rejected') ? '<option value="' + st + '" selected>' + (st === 'Pending' ? 'Waiting for approval' : 'Rejected') + '</option>' : '') +
        '<option value="Active"' + (st === 'Active' ? ' selected' : '') + '>Active</option><option value="Disabled"' + (st === 'Disabled' ? ' selected' : '') + '>Disabled</option></select>' +
        (u && (st === 'Pending' || st === 'Rejected') ? '<p class="text-[11px] text-amber-700 mt-1">Choose Active to approve this account.</p>' : '')),
      function () {
        var mob = $('ufMobile').value.replace(/\D/g, '');
        if (mob && mob.length !== 10) return { success: false, error: 'Mobile number must be 10 digits.' };
        var pw = $('ufPassword').value || '';
        var uname = ($('ufUsername').value || '').trim();
        if (uname && !/^[A-Za-z0-9._-]{3,30}$/.test(uname)) return { success: false, error: 'Username must be 3 to 30 characters: letters, numbers, dot, dash or underscore.' };
        if ((!u || pw) && pw.length < 8) return { success: false, error: u ? 'The new password must be at least 8 characters (or leave it blank).' : 'Set a password of at least 8 characters.' };
        return post('/api/users/master', {
          user_id: u ? u.user_id : '', first_name: $('ufFirst').value, last_name: $('ufLast').value, mobile: mob,
          email: $('ufEmail').value, username: uname, role: $('ufRole').value,
          status: { Active: 'Approved', Disabled: 'Disabled', Pending: 'Pending', Rejected: 'Rejected' }[$('ufStatus').value] || 'Approved', password: pw
        }).then(function (d) { if (d.success) { toast(d.message || 'Saved'); renderUserMaster(); } return d; });
      });
  }

  function refreshMyAccess() {
    if (!me) return;
    get('/api/auth/me?user_id=' + encodeURIComponent(me.user_id)).then(function (d) {
      if (d && d.success) { setPerms(d.permissions); applyMenu(); gateSoon(); }
    });
  }

  // ============================================================ EMAIL + OTP LOGIN
  // On the server, show only the sign-in methods it can actually offer (email / SMS need their setup in server/.env).
  // An inline style is used because the tab switcher rewrites the tabs' classes.
  if (window.OASIS_SERVER_MODE) {
    get('/api/auth/methods').then(function (m) {
      if (!m || Array.isArray(m)) return;
      [['screenTabEmailOtp', m.email_otp, 'email-otp'], ['authTabEmailOtp', m.email_otp], ['screenTabOtp', m.phone_otp, 'otp'], ['authTabOtp', m.phone_otp]].forEach(function (t) {
        if ($(t[0])) $(t[0]).style.display = t[1] ? '' : 'none';
      });
      if (m.phone_channel === 'WhatsApp') {
        ['screenTabOtp', 'authTabOtp'].forEach(function (id) { if ($(id)) $(id).textContent = 'WhatsApp OTP'; });
        var lbl = $('screenFormOtp') && $('screenFormOtp').querySelector('label');
        if (lbl) lbl.textContent = 'Registered WhatsApp Number';
        var sb = $('screenFormOtp') && $('screenFormOtp').querySelector('button[onclick*="handleSendOtpScreen"]');
        if (sb) sb.textContent = 'Send code on WhatsApp';
      }
      var shown = $('screenFormEmailOtp') && !$('screenFormEmailOtp').classList.contains('hidden');
      if (typeof window.switchScreenAuthMode === 'function') {
        if (shown && !m.email_otp) window.switchScreenAuthMode($('screenFormOtp') && m.phone_otp ? 'otp' : 'login');
      }
    });
  }
  document.querySelectorAll('#screenFormOtp button[onclick*="123456"], #formOtp button[onclick*="123456"]').forEach(function (b) { b.remove(); });
  if ($('otpCodeInput')) $('otpCodeInput').setAttribute('placeholder', '••••••');

  // ---- Phone + OTP (login screen): inline messages, resend countdown, verify as soon as 6 digits are typed
  (function () {
    var form = $('screenFormOtp'), mob = $('screenOtpMobileInput'), code = $('screenOtpCodeInput'), step = $('screenOtpStepVerify');
    if (!form || !mob || !code || !step) return;
    var sendBtn = form.querySelector('button[onclick*="handleSendOtpScreen"]');
    var perr = document.createElement('p');
    perr.className = 'hidden text-xs font-semibold text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2';
    perr.setAttribute('role', 'alert');
    form.appendChild(perr);
    var again = document.createElement('button');
    again.type = 'button';
    again.className = 'w-full text-[11px] font-bold text-emerald-700 hover:underline disabled:text-slate-400 disabled:no-underline';
    step.appendChild(again);
    code.setAttribute('autocomplete', 'one-time-code'); code.setAttribute('placeholder', '••••••');
    mob.setAttribute('autocomplete', 'tel-national');
    var timer = null;
    function msg(t) { perr.textContent = t || ''; perr.classList.toggle('hidden', !t); }
    function countdown(sec) {
      clearInterval(timer);
      var left = sec;
      function tick() {
        if (left <= 0) { clearInterval(timer); again.disabled = false; again.textContent = 'Resend code'; return; }
        again.disabled = true; again.textContent = 'Resend code in ' + left + 's'; left--;
      }
      tick(); timer = setInterval(tick, 1000);
    }
    function send() {
      msg('');
      var m = (mob.value || '').replace(/\D/g, '').slice(-10);
      if (!/^[6-9]\d{9}$/.test(m)) { msg('Please enter your 10-digit mobile number.'); mob.focus(); return; }
      if (sendBtn) sendBtn.disabled = true;
      post('/api/auth/send-otp', { mobile: m }).then(function (d) {
        if (sendBtn) sendBtn.disabled = false;
        if (!d.success) { msg(d.error || d.message || 'Could not send the code.'); return; }
        $('screenOtpStatusMsg').textContent = d.message;
        step.classList.remove('hidden');
        mob.readOnly = true;
        code.value = ''; code.focus();
        countdown(30);
      }, function () { if (sendBtn) sendBtn.disabled = false; msg('Could not send the code. Please try again.'); });
    }
    function verify() {
      msg('');
      var c = (code.value || '').replace(/\D/g, '');
      if (c.length !== 6) { msg('Enter the 6-digit code.'); code.focus(); return; }
      post('/api/auth/verify-otp', { mobile: (mob.value || '').replace(/\D/g, '').slice(-10), otp: c }).then(function (d) {
        if (!d.success) { msg(d.error || d.message || 'That code did not work.'); code.select(); return; }
        clearInterval(timer);
        if (window.OasisSession) window.OasisSession.loggedIn(d);
        toast('Welcome, ' + (d.user.first_name || 'there') + '!');
        step.classList.add('hidden'); mob.readOnly = false; code.value = '';
      });
    }
    window.handleSendOtpScreen = send;
    window.handleVerifyOtpScreen = function (e) { if (e && e.preventDefault) e.preventDefault(); verify(); };
    again.addEventListener('click', send);
    mob.addEventListener('input', function () { this.value = this.value.replace(/\D/g, '').slice(0, 10); });
    mob.addEventListener('focus', function () { if (mob.readOnly) { mob.readOnly = false; step.classList.add('hidden'); clearInterval(timer); msg(''); } });
    code.addEventListener('input', function () { this.value = this.value.replace(/\D/g, '').slice(0, 6); if (this.value.length === 6) verify(); });
    form.addEventListener('submit', function (e) { e.preventDefault(); if (step.classList.contains('hidden')) send(); else verify(); });
  })();
  var emailForm = $('screenFormEmailOtp');
  var resendTimer = null;
  if (emailForm) {
    document.querySelectorAll('#screenFormEmailOtp button[onclick*="123456"], #formEmailOtp button[onclick*="123456"]').forEach(function (b) { b.remove(); });
    ['screenEmailOtpCodeInput', 'emailOtpCodeInput'].forEach(function (id) { if ($(id)) $(id).setAttribute('placeholder', '••••••'); });
    var tabBar = $('screenTabEmailOtp') ? $('screenTabEmailOtp').parentElement : null;
    if (tabBar && $('screenTabEmailOtp')) { tabBar.insertBefore($('screenTabEmailOtp'), tabBar.firstChild); $('screenTabEmailOtp').textContent = 'Email + OTP'; }
    var emailInput = $('screenEmailOtpInput'), codeInput = $('screenEmailOtpCodeInput');
    if (emailInput) { emailInput.setAttribute('autocomplete', 'email'); emailInput.setAttribute('inputmode', 'email'); }
    if (codeInput) { codeInput.setAttribute('placeholder', '••••••'); codeInput.setAttribute('inputmode', 'numeric'); codeInput.setAttribute('autocomplete', 'one-time-code'); codeInput.setAttribute('pattern', '[0-9]{6}'); }
    var err = document.createElement('p');
    err.id = 'screenEmailOtpError';
    err.className = 'hidden text-xs font-semibold text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2';
    err.setAttribute('role', 'alert');
    emailForm.appendChild(err);
    var verifyStep = $('screenEmailOtpStepVerify');
    var resend = document.createElement('button');
    resend.type = 'button'; resend.id = 'screenEmailOtpResend';
    resend.className = 'w-full text-[11px] font-bold text-emerald-700 hover:underline disabled:text-slate-400 disabled:no-underline';
    if (verifyStep) verifyStep.appendChild(resend);
    var backBtn = verifyStep ? verifyStep.querySelector('button[onclick*="screenEmailOtpStepSend"]') : null;
    if (backBtn) backBtn.addEventListener('click', function () { showErr(''); if (codeInput) codeInput.value = ''; });

    function showErr(m) { err.textContent = m || ''; err.classList.toggle('hidden', !m); }
    function startCountdown(sec) {
      clearInterval(resendTimer);
      var left = sec;
      function tick() {
        if (left <= 0) { clearInterval(resendTimer); resend.disabled = false; resend.textContent = 'Resend code'; return; }
        resend.disabled = true; resend.textContent = 'Resend code in ' + left + 's'; left--;
      }
      tick(); resendTimer = setInterval(tick, 1000);
    }
    function sendCode() {
      showErr('');
      var email = (emailInput.value || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showErr('Please enter a valid email address.'); emailInput.focus(); return; }
      var btn = emailForm.querySelector('#screenEmailOtpStepSend button');
      if (btn) btn.disabled = true;
      post('/api/auth/send-email-otp', { email: email }).then(function (d) {
        if (btn) btn.disabled = false;
        if (!d.success) { showErr(d.error || 'Could not send the code.'); return; }
        var msg = $('screenEmailOtpStatusMsg');
        if (msg) {
          msg.textContent = d.message;
          msg.className = d.delivery === 'demo' ? 'text-amber-900 font-semibold' : 'text-emerald-800 font-semibold';
          msg.parentElement.className = d.delivery === 'demo'
            ? 'bg-amber-50 p-2.5 rounded-xl border border-amber-200 text-center text-xs text-amber-900'
            : 'bg-emerald-50 p-2.5 rounded-xl border border-emerald-200 text-center text-xs';
        }
        $('screenEmailOtpStepSend').classList.add('hidden');
        verifyStep.classList.remove('hidden');
        codeInput.value = ''; codeInput.focus();
        startCountdown(30);
      }, function () { if (btn) btn.disabled = false; showErr('Could not send the code. Please try again.'); });
    }
    function verifyCode() {
      showErr('');
      var code = (codeInput.value || '').replace(/\D/g, '');
      if (code.length !== 6) { showErr('Enter the 6-digit code.'); codeInput.focus(); return; }
      post('/api/auth/verify-email-otp', { email: emailInput.value.trim(), otp: code }).then(function (d) {
        if (!d.success) { showErr(d.error || 'That code did not work.'); codeInput.select(); return; }
        clearInterval(resendTimer);
        if (window.OasisSession) window.OasisSession.loggedIn(d);
        toast('Welcome, ' + (d.user.first_name || 'there') + '!');
        verifyStep.classList.add('hidden'); $('screenEmailOtpStepSend').classList.remove('hidden'); codeInput.value = '';
      });
    }
    window.handleSendEmailOtpScreen = sendCode;
    window.handleVerifyEmailOtpScreen = function (e) { if (e && e.preventDefault) e.preventDefault(); verifyCode(); };
    resend.addEventListener('click', sendCode);
    emailForm.removeAttribute('onsubmit');
    emailForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (verifyStep && !verifyStep.classList.contains('hidden')) verifyCode(); else sendCode();
    });
    codeInput.addEventListener('input', function () {
      this.value = this.value.replace(/\D/g, '').slice(0, 6);
      if (this.value.length === 6) verifyCode();
    });
    // The sign-in card opens on the simple Login form; Email OTP stays one tap away when email is set up.
    if (typeof window.switchScreenAuthMode === 'function') window.switchScreenAuthMode('login');
  }

  // ============================================================ EMAIL DELIVERY SETTINGS
  var setup = $('tab-school-setup');
  if (setup && !window.OASIS_ANDROID_APP) {   // login codes are not used inside the Android app
    var onServer = !!window.OASIS_SERVER_MODE;
    var box = document.createElement('div');
    box.id = 'oasisEmailSettings';
    box.className = 'bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4';
    var smsRow = onServer ? '<div class="border-t border-slate-100 pt-4 space-y-2"><h4 class="font-bold text-slate-800 text-sm flex items-center gap-2"><i class="fa-solid fa-mobile-screen-button text-emerald-600"></i> <span id="smsHeading">Phone login codes (SMS / WhatsApp)</span></h4>' +
      '<p id="smsSetState" class="text-xs text-slate-500"></p>' +
      '<p class="text-xs text-slate-500 max-w-2xl">Codes are texted to the mobile number saved for each user in User Master, through the service set in <code class="px-1 bg-slate-100 rounded">server/.env</code> (WhatsApp, Fast2SMS, 2Factor or Twilio).</p>' +
      '<div class="flex flex-wrap gap-2"><input id="smsTestTo" type="tel" inputmode="numeric" maxlength="10" placeholder="10-digit mobile for a test message" class="' + INPUT + ' max-w-xs">' +
      '<button type="button" id="smsTest" class="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold">Send test message</button></div></div>' : '';
    var testRow = '<input id="ejTestTo" type="email" placeholder="Send test to (e.g. another staff email)" class="' + INPUT + ' max-w-xs">' +
      '<button type="button" id="ejTest" class="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold">Send test email</button>';
    box.innerHTML = '<div><h3 class="font-extrabold text-slate-800 text-base flex items-center gap-2"><i class="fa-solid fa-envelope-circle-check text-emerald-600"></i> Email delivery for login codes</h3>' +
      '<p id="emailSetState" class="text-xs text-slate-500 mt-1"></p></div>' +
      (onServer
        ? '<p class="text-xs text-slate-500 max-w-2xl">Login codes are made on the Oasis server and emailed from the school Gmail to the address saved for each user in User Master. ' +
          'The Gmail address and app password are set in the server’s <code class="px-1 bg-slate-100 rounded">server/.env</code> file, not here.</p>' +
          '<div class="flex flex-wrap gap-2">' + testRow + '</div>'
        : '<p class="text-xs text-slate-500 max-w-2xl">Login codes are emailed through <strong>EmailJS</strong> (free for up to 200 emails a month). Create an account at emailjs.com, connect the school Gmail as an Email Service, and make an Email Template whose “To email” is <code class="px-1 bg-slate-100 rounded">{{to_email}}</code> and whose message includes <code class="px-1 bg-slate-100 rounded">{{otp_code}}</code>. Then paste the three values below.</p>' +
          '<div class="grid grid-cols-1 md:grid-cols-3 gap-3">' +
          field('ejService', 'Service ID', '<input id="ejService" placeholder="service_xxxxxx" class="' + INPUT + ' font-mono">') +
          field('ejTemplate', 'Template ID', '<input id="ejTemplate" placeholder="template_xxxxxx" class="' + INPUT + ' font-mono">') +
          field('ejKey', 'Public key', '<input id="ejKey" placeholder="Public key from Account › General" class="' + INPUT + ' font-mono">') + '</div>' +
          '<div class="flex flex-wrap gap-2"><button type="button" id="ejSave" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm">Save email settings</button>' + testRow + '</div>') +
      '<p class="text-[11px] text-slate-500">Tip: send the test to an address other than the school Gmail and check it arrives in that inbox.</p>' + smsRow;
    setup.appendChild(box);
    if ($('smsTest')) $('smsTest').addEventListener('click', function () {
      toast('Sending…', 'info');
      post('/api/settings/test-sms', { mobile: ($('smsTestTo').value || '').trim() }).then(function (d) { toast(d.success ? d.message : (d.error || 'Sending failed'), d.success ? 'ok' : 'error'); });
    });
    function loadEmailSettings() {
      get('/api/settings').then(function (s) {
        if (!s || Array.isArray(s)) return;
        if (!onServer) { $('ejService').value = s.emailjs_service_id || ''; $('ejTemplate').value = s.emailjs_template_id || ''; $('ejKey').value = s.emailjs_public_key || ''; }
        $('emailSetState').innerHTML = s.email_ready
          ? '<span class="font-bold text-emerald-700">Set up: codes are emailed to users' + (s.email_from ? ' from ' + esc(s.email_from) : '') + '.</span>'
          : '<span class="font-bold text-amber-700">Not set up yet: Email + OTP sign-in is unavailable until this is completed (password and M-PIN sign-in still work).</span>';
        if ($('smsHeading') && s.phone_channel) $('smsHeading').textContent = s.phone_channel + ' for phone login codes';
        if ($('smsSetState')) $('smsSetState').innerHTML = s.sms_ready
          ? (s.sms_provider === 'console'
            ? '<span class="font-bold text-amber-700">Test mode: codes are shown in the server’s Terminal window, not texted.</span>'
            : '<span class="font-bold text-emerald-700">Set up: codes are sent ' + (s.sms_provider === 'whatsapp' ? 'on WhatsApp' : 'by SMS through ' + esc(s.sms_provider)) + '.</span>')
          : '<span class="font-bold text-amber-700">Not set up yet: Phone + OTP sign-in is unavailable until ' + esc(s.phone_channel || 'SMS') + ' is set up in server/.env.</span>';
      });
    }
    if ($('ejSave')) $('ejSave').addEventListener('click', function () {
      post('/api/settings', { emailjs_service_id: $('ejService').value, emailjs_template_id: $('ejTemplate').value, emailjs_public_key: $('ejKey').value })
        .then(function (d) { if (d.success) { toast('Email settings saved'); loadEmailSettings(); } else toast(d.error || 'Could not save', 'error'); });
    });
    $('ejTest').addEventListener('click', function () {
      toast('Sending…', 'info');
      post('/api/settings/test-email', { email: ($('ejTestTo').value || '').trim() }).then(function (d) { toast(d.success ? d.message : (d.error || 'Sending failed'), d.success ? 'ok' : 'error'); });
    });
    var origSwitch2 = window.switchTab;
    window.switchTab = function (t) { origSwitch2(t); if (t === 'school-setup' && canDo('school-setup', 'read')) loadEmailSettings(); };
  }
  // ------------------------------------------------------------ office inbox (Contact Us)
  // Enquiries from the website and "Fee paid by UPI" messages from parents, for roles that can change Contact Us.
  (function () {
    var tab = $('tab-contact');
    if (!tab) return;
    var box = document.createElement('div');
    box.id = 'oasisInbox';
    box.className = 'bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3 rbac-hide';
    box.innerHTML = '<div class="flex items-center justify-between gap-3"><h3 class="font-extrabold text-slate-800 text-base flex items-center gap-2">' +
      '<i class="fa-solid fa-inbox text-emerald-600"></i> Messages for the office</h3>' +
      '<button type="button" id="inboxRefresh" class="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-xs font-bold text-slate-700" style="min-height:40px">Refresh</button></div>' +
      '<p class="text-xs text-slate-500">Enquiries from the website, and UPI payments parents say they have made. Check the bank before recording a payment.</p>' +
      '<div id="inboxList" class="space-y-2"></div>';
    tab.insertBefore(box, tab.firstElementChild ? tab.firstElementChild.nextSibling : null);
    var UPI = /^Fee paid by UPI for (.+?) \(([^)]+)\)\. Amount: Rs ([\d.]+)\. UPI reference \(UTR\): ([A-Za-z0-9]+)/;
    function load() {
      var show = canDo('contact', 'modify');
      box.classList.toggle('rbac-hide', !show);
      if (!show) return;
      $('inboxList').innerHTML = '<p class="text-xs text-slate-400">Loading…</p>';
      Promise.all([get('/api/contact'), canDo('payments', 'read') ? get('/api/payments') : Promise.resolve({})]).then(function (res) {
        var rows = Array.isArray(res[0]) ? res[0].slice(0, 100) : [];
        var done = {}; // UPI reference -> receipt number, for payments already recorded
        ((res[1] && res[1].payments) || []).forEach(function (p) {
          var m = /\(Txn: ([^)]+)\)/.exec(p.remarks || '');
          if (m) done[m[1].replace(/\s+/g, '')] = p.receipt_no;
        });
        if (!rows.length) { $('inboxList').innerHTML = '<p class="text-xs text-slate-400">No messages yet.</p>'; return; }
        $('inboxList').innerHTML = rows.map(function (m, i) {
          var pay = UPI.exec(m.message || '');
          var phone = String(m.phone || '').replace(/[^\d+]/g, '');
          return '<div class="border rounded-xl p-3 text-xs space-y-1 ' + (pay && !done[pay[4]] ? 'border-amber-300 bg-amber-50' : 'border-slate-200') + '">' +
            '<div class="flex flex-wrap items-center justify-between gap-2"><b class="text-slate-800">' + esc(m.subject || 'Enquiry') + '</b>' +
            '<span class="text-slate-400">' + esc(m.created_at || '') + '</span></div>' +
            '<div class="text-slate-700">' + esc(m.name || '') + (phone ? ' · <a class="text-emerald-700 font-bold" href="tel:' + esc(phone) + '">' + esc(m.phone) + '</a>' : '') +
            (m.email ? ' · <a class="text-emerald-700" href="mailto:' + esc(m.email) + '">' + esc(m.email) + '</a>' : '') + '</div>' +
            '<p class="text-slate-600 whitespace-pre-wrap">' + esc(m.message || '') + '</p>' +
            (pay && done[pay[4]] ? '<p class="font-bold text-emerald-700"><i class="fa-solid fa-circle-check"></i> Recorded: receipt ' + esc(done[pay[4]]) + '</p>' :
             pay && canDo('payments', 'add') ? '<button type="button" class="inbox-record px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold" style="min-height:40px" data-i="' + i + '">' +
              '<i class="fa-solid fa-check"></i> Checked in bank: record this payment</button>' : '') +
            '</div>';
        }).join('');
        Array.prototype.forEach.call(document.querySelectorAll('#inboxList .inbox-record'), function (b) {
          b.addEventListener('click', function () {
            var pay = UPI.exec(rows[+b.getAttribute('data-i')].message || '');
            if (!pay || typeof window.openRecordPaymentModal !== 'function') return;
            Promise.resolve(window.openRecordPaymentModal(pay[2], parseFloat(pay[3]))).then(function () {
              if ($('payRef')) $('payRef').value = pay[4];
              if ($('payRemarks')) $('payRemarks').value = 'UPI payment sent by parent';
            });
          });
        });
      });
    }
    $('inboxRefresh').addEventListener('click', load);
    var prevSwitch = window.switchTab;
    window.switchTab = function (t) { prevSwitch(t); if (t === 'contact') load(); };
  })();
})();
