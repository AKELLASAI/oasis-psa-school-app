/*
 * Oasis Pre School — in-browser server.
 * A port of server.py: every /api/... endpoint runs here against a real SQLite
 * database (sql.js), using the same SQL. Nothing needs to be installed or started.
 * Records are saved in this browser (IndexedDB, falling back to localStorage).
 */
(function () {
  'use strict';

  var DEMO_OTP = '123456';
  var OTP_TTL_MS = 10 * 60 * 1000;
  var IDB_NAME = 'oasis-preschool-db';
  var IDB_STORE = 'files';
  var IDB_KEY = 'oasis_preschool.db';
  var LS_KEY = 'oasis_preschool_db_b64';

  var SQL = null;   // sql.js module
  var db = null;    // open database
  var OTP_CACHE = {};
  var EMAIL_OTP_CACHE = {};

  // ---------------------------------------------------------------- helpers
  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2);
  }
  function nowStr() {
    var d = new Date();
    return todayStr() + ' ' + pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2) + ':' + pad(d.getSeconds(), 2);
  }
  function str(v) { return v === undefined || v === null ? '' : String(v); }
  function num(v, dflt) { var n = parseFloat(v); return isNaN(n) ? (dflt || 0) : n; }
  function int(v, dflt) { var n = parseInt(v, 10); return isNaN(n) ? (dflt || 0) : n; }
  function rand(max) { return Math.floor(Math.random() * max); }

  function all(sql, params) {
    var stmt = db.prepare(sql);
    try {
      if (params) stmt.bind(params.map(function (p) { return p === undefined ? null : (typeof p === 'boolean' ? (p ? 1 : 0) : p); }));
      var rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally { stmt.free(); }
  }
  function one(sql, params) { return all(sql, params)[0] || null; }
  function run(sql, params) {
    db.run(sql, (params || []).map(function (p) { return p === undefined ? null : (typeof p === 'boolean' ? (p ? 1 : 0) : p); }));
  }
  function scalar(sql, params) {
    var r = one(sql, params);
    if (!r) return null;
    var k = Object.keys(r)[0];
    return r[k];
  }

  function publicUser(u) {
    if (!u) return null;
    var d = Object.assign({}, u);
    delete d.password; delete d.mpin;
    return d;
  }
  function permissionsFor(role) {
    var r = one('SELECT role_id FROM roles WHERE LOWER(role_name) = LOWER(?)', [normRole(role)]);
    if (!r) return [];
    return all('SELECT rp.screen_id, s.screen_name, s.category, rp.can_read, rp.can_add, rp.can_modify, rp.can_delete ' +
      'FROM role_permissions rp JOIN screens s ON rp.screen_id = s.screen_id WHERE rp.role_id = ?', [r.role_id]);
  }
  function otpOk(cache, key, otp) {
    var info = cache[key];
    return !!info && info.otp === String(otp || '').trim() && Date.now() - info.created_at < OTP_TTL_MS;
  }
  function statusBlock(u, field) {
    var st = u.status || 'Approved';
    var o = { success: false };
    if (st === 'Pending') { o[field] = 'Your account is pending Admin approval. Please contact school administration.'; return [403, o]; }
    if (st === 'Rejected') { o[field] = 'Your account registration was rejected by Admin.'; return [403, o]; }
    if (st === 'Disabled') { o[field] = 'This account has been disabled. Please contact the school office.'; return [403, o]; }
    return null;
  }

  // Staff table stores full_name/category/status; the screens use name/role/is_active.
  function roleFromCategory(cat) { return /non/i.test(cat || '') ? 'Non-Teaching' : 'Teaching'; }
  function staffView(s) {
    return Object.assign({}, s, {
      name: s.full_name, role: roleFromCategory(s.category), is_active: (s.status || 'Active') === 'Active' ? 1 : 0,
      date_of_joining: s.joining_date
    });
  }

  // ------------------------------------------------ screens, roles & access
  // Every screen in the app, in menu order. screen_id is the screen's own id in the page.
  var APP_SCREENS = [
    ['summary', 'Summary', 'Dashboard', 'fa-chart-pie', 'School totals: students, fees collected, dues, expenses'],
    ['charts', 'Charts Dashboard', 'Dashboard', 'fa-chart-line', 'Charts for admissions, fee collection, expenses and van use'],
    ['admissions', 'Admissions Summary', 'Academics & Students', 'fa-id-card', 'Student roster and new admissions'],
    ['attendance', 'Attendance', 'Academics & Students', 'fa-calendar-check', 'Daily student attendance and monthly calendar'],
    ['homework', 'Homework Assignments', 'Academics & Students', 'fa-book-open', 'Homework and worksheets posted for each class'],
    ['report-cards', 'Student Report Cards', 'Academics & Students', 'fa-graduation-cap', 'Upload, view and download report cards'],
    ['van', 'Van Students Details', 'Academics & Students', 'fa-van-shuttle', 'Van routes, pickup points and van fees'],
    ['payments', 'Payment Details', 'Finance & Fees', 'fa-receipt', 'Fee summaries, payments and receipts'],
    ['fee-structure', 'Fee Structure', 'Finance & Fees', 'fa-file-invoice-dollar', 'Fee components for each class'],
    ['student-fee-attachment', 'Student Fee Attachments', 'Finance & Fees', 'fa-paperclip', 'Assign fee packages and attach documents'],
    ['expenses', 'Expenses Tracker', 'Finance & Fees', 'fa-wallet', 'School expenses by category'],
    ['google-sheet', 'Oasis Master Google Sheet', 'Finance & Fees', 'fa-file-excel', 'The school’s Google Sheet'],
    ['holidays', 'Holiday Schedule', 'Community & School', 'fa-umbrella-beach', 'School holiday calendar'],
    ['parent-compose', 'Parent Portal', 'Community & School', 'fa-mobile-screen-button', 'What a parent sees about their child'],
    ['gallery', 'Photo Gallery', 'Community & School', 'fa-images', 'Event and campus photos'],
    ['contact', 'Contact Us', 'Community & School', 'fa-address-book', 'School contact details and enquiry form'],
    ['staff-payroll', 'Staff, Attendance & Payroll', 'Master Setup', 'fa-users-gear', 'Staff directory and staff attendance'],
    ['payroll', 'Payroll & Salaries', 'Master Setup', 'fa-money-check-dollar', 'Staff salaries, bank details and monthly salary payouts'],
    ['teacher-leaves', 'Teacher & Staff Leaves', 'Master Setup', 'fa-calendar-minus', 'Leave applications and yearly quotas'],
    ['school-setup', 'School Profile & Branding', 'Master Setup', 'fa-palette', 'School details, logo, colours, email delivery and backups'],
    ['classes-setup', 'Manage Classes', 'Master Setup', 'fa-school', 'Class master'],
    ['sections-setup', 'Manage Sections', 'Master Setup', 'fa-shapes', 'Sections within each class'],
    ['fee-types-setup', 'Fee Types Setup', 'Master Setup', 'fa-tags', 'Fee type master'],
    ['screen-master', 'Screen Master', 'Security & Access', 'fa-desktop', 'Register of every screen in the app'],
    ['role-master', 'Role Master', 'Security & Access', 'fa-user-shield', 'Roles and their Read / Add / Modify / Delete access per screen'],
    ['user-master', 'User Master', 'Security & Access', 'fa-users', 'Users, their contact details and role'],
    ['user-approvals', 'User Approvals', 'Security & Access', 'fa-user-check', 'New sign-ups waiting for the school office to approve or reject']
  ];
  var APP_SCREEN_IDS = APP_SCREENS.map(function (s) { return s[0]; });
  var ADMIN_ROLE = 'ROL001';
  // Old registry ids → the screen they now belong to (permissions are merged).
  var OLD_SCREEN_MAP = {
    reports: ['report-cards'], 'parent-portal': ['parent-compose'], 'fee-attachments': ['student-fee-attachment'],
    settings: ['school-setup', 'google-sheet'], classes: ['classes-setup'], sections: ['sections-setup'], 'fee-types': ['fee-types-setup'],
    'screens-master': ['screen-master'], 'role-master': ['role-master'], 'user-master': ['user-master'], 'user-approvals': ['user-master'],
    'teacher-attendance': ['staff-payroll'], 'leave-config': ['teacher-leaves'], summary: ['summary', 'charts'], payments: ['payments', 'fee-structure'],
    'van-gps': ['van'], 'whatsapp-logs': [], 'audit-screen-1': []
  };

  function normRole(r) {
    r = str(r).trim();
    if (!r) return 'Parent';
    if (/^admin(istrator)?$/i.test(r)) return 'Administrator';
    var m = one('SELECT role_name FROM roles WHERE LOWER(role_name) = LOWER(?)', [r]);
    return m ? m.role_name : r;
  }
  function roleIdOf(roleName) {
    var r = one('SELECT role_id FROM roles WHERE LOWER(role_name) = LOWER(?)', [normRole(roleName)]);
    return r ? r.role_id : null;
  }

  function migrateRbac() {
    run('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT)');
    run('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)');
    var done = one("SELECT value FROM app_meta WHERE key = 'rbac_version'");
    if (!done || done.value !== '2') {
      var roles = all('SELECT role_id FROM roles');
      var old = all('SELECT * FROM role_permissions');
      var merged = {}; // role|screen -> perms
      function merge(role, sid, p) {
        var k = role + '|' + sid, m = merged[k] || (merged[k] = { r: 0, a: 0, m: 0, d: 0 });
        m.r |= p.can_read ? 1 : 0; m.a |= p.can_add ? 1 : 0; m.m |= p.can_modify ? 1 : 0; m.d |= p.can_delete ? 1 : 0;
      }
      old.forEach(function (p) {
        var targets = OLD_SCREEN_MAP.hasOwnProperty(p.screen_id) ? OLD_SCREEN_MAP[p.screen_id] : [p.screen_id];
        targets.forEach(function (t) { merge(p.role_id, t, p); });
      });
      Object.keys(OLD_SCREEN_MAP).forEach(function (id) {
        if (APP_SCREEN_IDS.indexOf(id) === -1) { run('DELETE FROM screens WHERE screen_id = ?', [id]); run('DELETE FROM role_permissions WHERE screen_id = ?', [id]); }
      });
      Object.keys(merged).forEach(function (k) {
        var parts = k.split('|'), m = merged[k];
        run('INSERT OR REPLACE INTO role_permissions (role_id, screen_id, can_read, can_add, can_modify, can_delete) VALUES (?, ?, ?, ?, ?, ?)', [parts[0], parts[1], m.r, m.a, m.m, m.d]);
      });
      roles.forEach(function (r) {
        APP_SCREEN_IDS.forEach(function (sid) {
          run('INSERT OR IGNORE INTO role_permissions (role_id, screen_id, can_read, can_add, can_modify, can_delete) VALUES (?, ?, 0, 0, 0, 0)', [r.role_id, sid]);
        });
      });
      run("UPDATE users SET role = 'Administrator' WHERE LOWER(role) IN ('admin', 'administrator')");
      run("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('rbac_version', '2')");
    }
    // Payroll & Salaries became its own screen: a role gets it only where it had both Staff and Expenses access.
    if (!one("SELECT value FROM app_meta WHERE key = 'payroll_screen'")) {
      all('SELECT role_id FROM roles').forEach(function (r) {
        var a = one("SELECT * FROM role_permissions WHERE role_id = ? AND screen_id = 'staff-payroll'", [r.role_id]) || {};
        var b = one("SELECT * FROM role_permissions WHERE role_id = ? AND screen_id = 'expenses'", [r.role_id]) || {};
        function both(k) { return a[k] && b[k] ? 1 : 0; }
        run("INSERT OR REPLACE INTO role_permissions (role_id, screen_id, can_read, can_add, can_modify, can_delete) VALUES (?, 'payroll', ?, ?, ?, ?)",
          [r.role_id, both('can_read'), both('can_add'), both('can_modify'), both('can_delete')]);
      });
      run("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('payroll_screen', '1')");
    }
    // Built-in screens always exist with their current names; the Administrator role keeps full access.
    APP_SCREENS.forEach(function (s) {
      var ex = one('SELECT screen_id FROM screens WHERE screen_id = ?', [s[0]]);
      if (ex) run('UPDATE screens SET screen_name = ?, category = ? WHERE screen_id = ?', [s[1], s[2], s[0]]);
      else run('INSERT INTO screens (screen_id, screen_name, category, description) VALUES (?, ?, ?, ?)', [s[0], s[1], s[2], s[4]]);
      run('INSERT OR REPLACE INTO role_permissions (role_id, screen_id, can_read, can_add, can_modify, can_delete) VALUES (?, ?, 1, 1, 1, 1)', [ADMIN_ROLE, s[0]]);
    });
    run("UPDATE roles SET role_name = 'Administrator' WHERE role_id = ?", [ADMIN_ROLE]);
    // User Approvals (sign-ups waiting for the school office) is its own screen. The first time, every role that
    // could open User Master gets it too (approve / reject needs Modify there).
    if (!one("SELECT value FROM app_meta WHERE key = 'user_approvals_screen'")) {
      all('SELECT role_id FROM roles').forEach(function (r) {
        if (r.role_id === ADMIN_ROLE) return;
        var p = one("SELECT * FROM role_permissions WHERE role_id = ? AND screen_id = 'user-master'", [r.role_id]) || {};
        var m = p.can_modify ? 1 : 0;
        run("INSERT OR REPLACE INTO role_permissions (role_id, screen_id, can_read, can_add, can_modify, can_delete) VALUES (?, 'user-approvals', ?, 0, ?, 0)",
          [r.role_id, (m || p.can_read) ? 1 : 0, m]);
      });
      run("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('user_approvals_screen', '1')");
    }
  }

  // ---- Removing sample data (keeps setup: classes, sections, fee setup, roles, screens, real accounts) ----
  var SAMPLE_TABLES = ['students', 'van_students', 'academic_fees_summary', 'fee_payments', 'attendance', 'homework', 'expenses',
    'report_cards', 'teacher_leaves', 'staff', 'staff_payroll', 'teacher_attendance', 'contact_enquiries', 'whatsapp_logs',
    'van_routes_gps', 'email_otps', 'gallery'];
  var DEMO_ACCOUNTS = ['admin@oasis.com', 'admin_audit@oasis.com', 'newparent@oasis.com', 'parent@oasis.com',
    'ramesh@oasis.com', 'sharma@oasis.com', 'ammmo#gmail.com'];
  function cleanSampleData() {
    SAMPLE_TABLES.forEach(function (t) { run('DELETE FROM ' + t); });
    DEMO_ACCOUNTS.forEach(function (e) { run('DELETE FROM users WHERE LOWER(email) = LOWER(?)', [e]); });
    run("DELETE FROM fee_types WHERE LOWER(fee_name) LIKE 'audit%'");
    run("DELETE FROM holidays WHERE LOWER(holiday_name) LIKE 'audit%'");
    run('DELETE FROM holidays WHERE id NOT IN (SELECT MIN(id) FROM holidays GROUP BY LOWER(holiday_name), start_date, end_date)');
    run("DELETE FROM sqlite_sequence WHERE name IN ('" + SAMPLE_TABLES.join("','") + "')");
    var sd = one('SELECT * FROM school_details WHERE id = 1');
    if (sd && !sd.email && !sd.phone && !sd.address) {
      run("UPDATE school_details SET school_name = 'OASIS PRE SCHOOL Academy', tagline = 'Growing roots to flying wings', email = 'oasispsa@gmail.com', " +
        "phone = '8374520722, 8374520766', address = 'Kurmannapalem, Visakhapatnam, Andhra Pradesh 530046' WHERE id = 1");
    }
    run("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('sample_cleaned', ?)", [nowStr()]);
  }
  function sampleCleaned() { var r = one("SELECT value FROM app_meta WHERE key = 'sample_cleaned'"); return !!r; }

  // Who is signed in (set by the login endpoints, cleared by logout).
  var session = { userId: null };
  function currentUser() { return session.userId ? one('SELECT * FROM users WHERE user_id = ?', [session.userId]) : null; }
  function signIn(u) {
    session.userId = u.user_id;
    return { success: true, user: publicUser(u), permissions: permissionsFor(u.role) };
  }
  function permMap(u) {
    var map = {};
    if (!u) return map;
    permissionsFor(u.role).forEach(function (p) { map[p.screen_id] = p; });
    return map;
  }
  var ACTION_COL = { read: 'can_read', add: 'can_add', modify: 'can_modify', 'delete': 'can_delete' };
  var ACTION_WORD = { read: 'open', add: 'add records in', modify: 'change records in', 'delete': 'delete records in' };
  function can(u, screens, action) {
    if (!u) return false;
    if (roleIdOf(u.role) === ADMIN_ROLE) return true;
    var m = permMap(u);
    return [].concat(screens).some(function (s) { return m[s] && m[s][ACTION_COL[action]]; });
  }
  function screenName(id) { var s = one('SELECT screen_name FROM screens WHERE screen_id = ?', [id]); return s ? s.screen_name : id; }

  // [screen(s), action] needed for each endpoint. Reads are only guarded where the data is sensitive.
  function exists(sql, v) { return v !== undefined && v !== null && v !== '' && !!one(sql, [v]); }
  var RULES = {
    'GET /api/staff': [['staff-payroll', 'teacher-leaves'], 'read'], 'GET /api/payroll': ['payroll', 'read'],
    'GET /api/staff-attendance': ['staff-payroll', 'read'], 'GET /api/expenses': ['expenses', 'read'],
    'GET /api/users/master': [['user-master', 'role-master'], 'read'], 'GET /api/users': ['user-master', 'read'],
    'GET /api/roles': [['role-master', 'user-master', 'screen-master'], 'read'], 'GET /api/role-permissions': [['role-master', 'screen-master'], 'read'],
    'GET /api/screens': [['screen-master', 'role-master'], 'read'], 'GET /api/contact': ['contact', 'modify'],
    'GET /api/whatsapp/logs': ['contact', 'modify'], 'GET /api/settings': ['school-setup', 'read'],
    'POST /api/admissions': ['admissions', function (d) { return exists('SELECT 1 AS x FROM students WHERE stud_id = ?', d.stud_id) ? 'modify' : 'add'; }],
    'POST /api/students': ['admissions', function (d) { return exists('SELECT 1 AS x FROM students WHERE stud_id = ?', d.stud_id) ? 'modify' : 'add'; }],
    'GET /api/payments': [['payments', 'fee-structure', 'student-fee-attachment', 'parent-compose'], 'read'],
    'POST /api/payments': ['payments', 'add'], // only the school office records money received
    'POST /api/assign-fee': ['student-fee-attachment', 'add'], 'POST /api/expenses': ['expenses', 'add'],
    'POST /api/attendance': ['attendance', 'add'], 'POST /api/homework': ['homework', 'add'],
    'POST /api/holidays': ['holidays', 'add'], 'DELETE /api/holidays': ['holidays', 'delete'],
    'POST /api/gallery': ['gallery', 'add'], 'POST /api/report-cards': ['report-cards', 'add'], 'DELETE /api/report-cards': ['report-cards', 'delete'],
    'POST /api/school-details': ['school-setup', 'modify'], 'POST /api/settings': ['school-setup', 'modify'],
    'POST /api/clean-sample-data': ['school-setup', 'delete'],
    'POST /api/classes': ['classes-setup', function (d) { return exists('SELECT 1 AS x FROM classes WHERE class_id = ?', d.class_id) ? 'modify' : 'add'; }],
    'DELETE /api/classes': ['classes-setup', 'delete'],
    'POST /api/sections': ['sections-setup', function (d) { return d.section_id ? 'modify' : 'add'; }], 'DELETE /api/sections': ['sections-setup', 'delete'],
    'POST /api/fee-types': ['fee-types-setup', function (d) { return d.fee_type_id ? 'modify' : 'add'; }], 'DELETE /api/fee-types': ['fee-types-setup', 'delete'],
    'POST /api/teacher-leaves': ['teacher-leaves', 'add'], 'POST /api/teacher-leaves/status': ['teacher-leaves', 'modify'],
    'DELETE /api/teacher-leaves': ['teacher-leaves', 'delete'], 'POST /api/leaves/config': ['teacher-leaves', 'modify'], 'DELETE /api/leaves/config': ['teacher-leaves', 'delete'],
    'POST /api/staff': ['staff-payroll', function (d) { return exists('SELECT 1 AS x FROM staff WHERE staff_id = ?', d.staff_id) ? 'modify' : 'add'; }],
    'DELETE /api/staff': ['staff-payroll', 'delete'], 'POST /api/payroll': ['payroll', 'add'], 'DELETE /api/payroll': ['payroll', 'delete'],
    'POST /api/staff-attendance': ['staff-payroll', 'add'], 'POST /api/teacher-attendance': ['staff-payroll', 'add'],
    'POST /api/van/gps': ['van', 'modify'], 'POST /api/whatsapp/send': ['contact', 'add'],
    'POST /api/screens': ['screen-master', function (d) { return exists('SELECT 1 AS x FROM screens WHERE screen_id = ?', str(d.screen_id).toLowerCase()) ? 'modify' : 'add'; }],
    'DELETE /api/screens': ['screen-master', 'delete'],
    'POST /api/roles': ['role-master', function (d) { return exists('SELECT 1 AS x FROM roles WHERE role_id = ?', d.role_id) ? 'modify' : 'add'; }],
    'DELETE /api/roles': ['role-master', 'delete'], 'POST /api/role-permissions': ['role-master', 'modify'],
    'POST /api/users/master': ['user-master', function (d) { return exists('SELECT 1 AS x FROM users WHERE user_id = ?', d.user_id) ? 'modify' : 'add'; }],
    'DELETE /api/users/master': ['user-master', 'delete'],
    'GET /api/users/approvals': [['user-approvals', 'user-master'], 'read'],
    'POST /api/users/approve': [['user-approvals', 'user-master'], 'modify'], 'POST /api/users/reject': [['user-approvals', 'user-master'], 'modify']
  };
  var EMPTY_READ = { 'GET /api/expenses': { list: [], by_category: [] }, 'GET /api/payments': { summaries: [], payments: [] } };
  function guard(key, data) {
    var rule = RULES[key];
    if (!rule) return null;
    var u = currentUser();
    if (!u) return [401, key.indexOf('GET') === 0 ? (EMPTY_READ[key] || []) : { success: false, error: 'Please log in first.', message: 'Please log in first.' }];
    var action = typeof rule[1] === 'function' ? rule[1](data || {}, u) : rule[1];
    if (can(u, rule[0], action)) return null;
    if (key.indexOf('GET') === 0) return [403, EMPTY_READ[key] || []];
    var msg = 'Your role (' + u.role + ') is not allowed to ' + ACTION_WORD[action] + ' ' + screenName([].concat(rule[0])[0]) + '.';
    return [403, { success: false, error: msg, message: msg }];
  }

  // ---------------------------------------------------------------- routes
  var GET = {}, POST = {}, DEL = {};

  GET['/api/auth/me'] = function (q) {
    var u = one('SELECT * FROM users WHERE user_id = ?', [q.user_id || '']);
    if (!u || (u.status || 'Approved') !== 'Approved') { session.userId = null; return [401, { success: false }]; }
    return signIn(u);
  };

  GET['/api/summary'] = function () {
    var fin = one('SELECT SUM(paid_amount + due_amount) AS f, SUM(paid_amount) AS p, SUM(due_amount) AS d FROM academic_fees_summary');
    var paid = fin.p || 0, exp = scalar('SELECT SUM(amount) FROM expenses') || 0;
    return {
      total_students: scalar('SELECT COUNT(*) FROM students'),
      admissions_by_year: all('SELECT academic_year, COUNT(*) as cnt FROM students GROUP BY academic_year'),
      class_breakdown: all('SELECT c.class_name, COUNT(s.stud_id) as student_count FROM classes c LEFT JOIN students s ON c.class_id = s.standard GROUP BY c.class_id'),
      total_fees: fin.f || 0, total_paid: paid, total_dues: fin.d || 0, total_expenses: exp,
      net_balance: paid - exp,
      van_students_count: scalar('SELECT COUNT(*) FROM van_students')
    };
  };

  GET['/api/admissions'] = GET['/api/students'] = function () {
    return all('SELECT s.*, c.class_name FROM students s LEFT JOIN classes c ON s.standard = c.class_id ORDER BY s.stud_id DESC');
  };

  GET['/api/van-students'] = function () {
    return all('SELECT v.*, s.first_name, s.last_name, s.standard, s.m_contact, s.f_contact, c.class_name FROM van_students v ' +
      'JOIN students s ON v.stud_id = s.stud_id LEFT JOIN classes c ON s.standard = c.class_id');
  };

  GET['/api/payments'] = function () {
    return {
      summaries: all('SELECT afs.*, s.first_name, s.last_name, c.class_name FROM academic_fees_summary afs ' +
        'JOIN students s ON afs.stud_id = s.stud_id LEFT JOIN classes c ON afs.class_id = c.class_id'),
      payments: all('SELECT fp.*, s.first_name, s.last_name, c.class_name FROM fee_payments fp JOIN students s ON fp.stud_id = s.stud_id ' +
        'LEFT JOIN classes c ON s.standard = c.class_id ORDER BY fp.id DESC')
    };
  };

  var FALLBACK_FEES = [
    ['2', 'Nursery', [2500, 800, 1000, 500]], ['3', 'LKG', [2800, 1000, 1000, 600]], ['4', 'UKG', [3000, 1200, 1000, 800]]
  ];
  GET['/api/fee-structure'] = function () {
    var list = all('SELECT fs.*, c.class_name, fc.fee_description FROM fee_structure fs LEFT JOIN classes c ON fs.class_id = c.class_id ' +
      'LEFT JOIN fee_components fc ON fs.fee_id = fc.fee_id ORDER BY fs.class_id ASC, fs.fee_id ASC');
    if (list.length < 5) {
      var names = [['Tuition Fee', 'Annual'], ['Books & Activity Kit', 'Annual'], ['Admission & Registration', 'One-time'], ['Term & Festival Activity Fee', 'Annual']];
      list = [];
      FALLBACK_FEES.forEach(function (c) {
        c[2].forEach(function (amt, i) {
          list.push({ academic_year: '2026-27', class_id: c[0], class_name: c[1], fee_id: String(i + 1), fee_description: names[i][0], fee_amount: amt, term: names[i][1] });
        });
      });
    }
    return list;
  };

  GET['/api/expenses'] = function () {
    return {
      list: all('SELECT * FROM expenses ORDER BY expense_date DESC'),
      by_category: all('SELECT category, SUM(amount) as total FROM expenses GROUP BY category')
    };
  };

  GET['/api/charts'] = function () {
    var fee = one('SELECT SUM(paid_amount) as paid, SUM(due_amount) as due FROM academic_fees_summary');
    return {
      class_admissions: all('SELECT c.class_name, COUNT(s.stud_id) as count FROM classes c LEFT JOIN students s ON c.class_id = s.standard GROUP BY c.class_id'),
      fee_stat: { paid: fee.paid || 0, due: fee.due || 0 },
      expense_cat: all('SELECT category, SUM(amount) as amount FROM expenses GROUP BY category'),
      van_ratio: all('SELECT van_required, COUNT(*) as count FROM students GROUP BY van_required')
    };
  };

  // Every student for the day, with their saved mark if there is one (the server showed only
  // already-marked students once anyone was marked).
  GET['/api/attendance'] = function (q) {
    var date = q.date || todayStr();
    var cls = q['class'] || 'All';
    var list = all("SELECT s.stud_id, s.first_name, s.last_name, s.standard, c.class_name, ? AS date, " +
      "COALESCE(a.status, 'Present') AS status, COALESCE(a.remarks, '') AS remarks, a.id AS id " +
      "FROM students s LEFT JOIN classes c ON s.standard = c.class_id " +
      "LEFT JOIN attendance a ON a.stud_id = s.stud_id AND a.date = ? ORDER BY s.standard, s.first_name", [date, date]);
    if (cls !== 'All') list = list.filter(function (a) { return a.class_name === cls || String(a.standard) === String(cls); });
    return list;
  };

  GET['/api/report-cards'] = function () {
    return all("SELECT rc.*, COALESCE(s.first_name, 'Student') as first_name, COALESCE(s.last_name, rc.stud_id) as last_name, " +
      "COALESCE(s.standard, '2') as standard, COALESCE(c.class_name, 'Nursery') as class_name FROM report_cards rc " +
      "LEFT JOIN students s ON rc.stud_id = s.stud_id LEFT JOIN classes c ON s.standard = c.class_id ORDER BY rc.id DESC");
  };
  GET['/api/homework'] = function () {
    return all('SELECT h.*, c.class_name FROM homework h LEFT JOIN classes c ON h.class_id = c.class_id ORDER BY h.id DESC');
  };
  GET['/api/holidays'] = function () { return all('SELECT * FROM holidays ORDER BY start_date ASC'); };
  GET['/api/gallery'] = function () { return all('SELECT * FROM gallery ORDER BY id DESC'); };
  GET['/api/school-details'] = function () {
    return one('SELECT * FROM school_details WHERE id = 1') || {
      id: 1, school_name: 'OASIS PRE SCHOOL Academy', logo_data: '', primary_color: '#065f46', secondary_color: '#0d9488',
      address: 'Kurmannapalem, Visakhapatnam - 530046', email: 'oasispsa@gmail.com', phone: '8374520722, 8374520766',
      tagline: 'Growing roots to flying wings'
    };
  };
  GET['/api/classes'] = function () { return all('SELECT * FROM classes ORDER BY class_id ASC'); };
  GET['/api/sections'] = function (q) {
    if (q.class_id) return all('SELECT sec.*, c.class_name FROM sections sec LEFT JOIN classes c ON sec.class_id = c.class_id WHERE sec.class_id = ? ORDER BY sec.section_id ASC', [q.class_id]);
    return all('SELECT sec.*, c.class_name FROM sections sec LEFT JOIN classes c ON sec.class_id = c.class_id ORDER BY sec.class_id ASC, sec.section_id ASC');
  };
  GET['/api/fee-types'] = function () { return all('SELECT * FROM fee_types ORDER BY fee_type_id ASC'); };
  // Includes status, so the approvals screen can show who is waiting.
  GET['/api/users'] = function () {
    return all("SELECT user_id, username, first_name, last_name, email, mobile, role, profile_pic, COALESCE(status, 'Approved') AS status FROM users ORDER BY rowid DESC");
  };
  GET['/api/role-permissions'] = function (q) {
    var base = 'SELECT rp.permission_id, rp.role_id, rp.screen_id, s.screen_name, s.category, rp.can_read, rp.can_add, rp.can_modify, rp.can_delete ' +
      'FROM role_permissions rp JOIN screens s ON rp.screen_id = s.screen_id ';
    if (q.role_id) return all(base + 'WHERE rp.role_id = ? ORDER BY s.category, s.screen_name', [q.role_id]);
    return all(base + 'ORDER BY rp.role_id, s.category, s.screen_name');
  };
  GET['/api/users/master'] = function () {
    return all("SELECT user_id, username, first_name, last_name, email, mobile, role, COALESCE(status, 'Approved') AS status, " +
      "CASE WHEN COALESCE(password, '') != '' THEN 1 ELSE 0 END AS has_password FROM users ORDER BY first_name COLLATE NOCASE, last_name COLLATE NOCASE");
  };
  GET['/api/student-fee-structure'] = function (q) {
    var sid = q.stud_id || '';
    var base = 'SELECT afs.*, s.first_name, s.last_name, c.class_name FROM academic_fees_summary afs ' +
      'LEFT JOIN students s ON afs.stud_id = s.stud_id LEFT JOIN classes c ON afs.class_id = c.class_id ';
    var summary = sid ? all(base + 'WHERE afs.stud_id = ?', [sid]) : all(base + 'ORDER BY afs.id DESC');
    var fees = all('SELECT fs.*, c.class_name, fc.fee_description FROM fee_structure fs LEFT JOIN classes c ON fs.class_id = c.class_id LEFT JOIN fee_components fc ON fs.fee_id = fc.fee_id');
    return { stud_id: sid, summary: summary, fee_structure: fees };
  };
  GET['/api/teacher-leaves'] = function () {
    return all('SELECT tl.*, s.full_name AS staff_name FROM teacher_leaves tl LEFT JOIN staff s ON tl.staff_id = s.staff_id ORDER BY tl.id DESC');
  };
  GET['/api/leaves/config'] = function () { return all('SELECT * FROM leave_config ORDER BY id ASC'); };
  GET['/api/whatsapp/logs'] = function () { return all('SELECT * FROM whatsapp_logs ORDER BY id DESC'); };
  GET['/api/staff'] = function () { return all('SELECT * FROM staff ORDER BY staff_id ASC').map(staffView); };
  GET['/api/staff-attendance'] = GET['/api/teacher-attendance'] = function (q) {
    var rows = q.date ? all('SELECT * FROM teacher_attendance WHERE date = ?', [q.date]) : all('SELECT * FROM teacher_attendance ORDER BY date DESC');
    rows.forEach(function (r) { r.notes = r.remarks || ''; });
    return rows;
  };
  GET['/api/payroll'] = function (q) {
    var base = 'SELECT p.*, s.full_name, s.category, s.designation, s.bank_account FROM staff_payroll p LEFT JOIN staff s ON p.staff_id = s.staff_id ';
    var rows = q.month ? all(base + 'WHERE p.month = ? ORDER BY p.id DESC', [q.month]) : all(base + 'ORDER BY p.id DESC');
    return rows.map(function (p) { return Object.assign(p, { staff_name: p.full_name || p.staff_id, staff_role: roleFromCategory(p.category) }); });
  };
  GET['/api/van/gps'] = function () { return all('SELECT * FROM van_routes_gps ORDER BY route_name'); };
  GET['/api/contact'] = function () { return all('SELECT * FROM contact_enquiries ORDER BY id DESC'); };

  // ------------------------------------------------------------------ auth
  // A password is either plain (set in this offline copy) or an scrypt hash "scrypt$<salt>$<hash>" made by the
  // Oasis server, e.g. after restoring a backup from the server. Both work here.
  function checkPassword(stored, given) {
    stored = str(stored); given = str(given).trim();
    if (!stored || !given) return Promise.resolve(false);
    if (stored.indexOf('scrypt$') !== 0) return Promise.resolve(stored === given);
    var p = stored.split('$');
    if (p.length !== 3 || !window.scrypt) return Promise.resolve(false);
    var want = b64ToBytes(p[2]);
    return window.scrypt.scrypt(new TextEncoder().encode(given), b64ToBytes(p[1]), 16384, 8, 1, want.length).then(function (got) {
      var diff = got.length ^ want.length;
      for (var i = 0; i < want.length; i++) diff |= got[i] ^ want[i];
      return diff === 0;
    }, function () { return false; });
  }
  POST['/api/auth/login'] = function (d) {
    var ident = str(d.username || d.email || d.user).trim();
    var pw = str(d.password).trim();
    var u = ident ? one('SELECT * FROM users WHERE LOWER(email) = LOWER(?) OR LOWER(username) = LOWER(?)', [ident, ident]) : null;
    var fail = [401, { success: false, message: 'Invalid username/email or password' }];
    if (!u || !pw) return fail;
    return checkPassword(u.password, pw).then(function (ok) { return ok ? (statusBlock(u, 'message') || signIn(u)) : fail; });
  };
  function cleanMobile(m) { return str(m).trim().replace(/\s/g, '').replace('+91', ''); }
  POST['/api/auth/send-otp'] = function (d) {
    var mobile = cleanMobile(d.mobile);
    if (!mobile || mobile.length < 10) return [400, { success: false, error: 'Valid 10-digit mobile number required' }];
    if (!one('SELECT user_id FROM users WHERE mobile LIKE ?', ['%' + mobile.slice(-10)])) {
      return [404, { success: false, error: 'This mobile number is not registered. Please sign up or contact the school office.' }];
    }
    OTP_CACHE[mobile] = { otp: DEMO_OTP, created_at: Date.now() };
    return { success: true, message: 'OTP sent to +91-' + mobile.slice(0, 2) + 'XXXX' + mobile.slice(-4) + ' (demo mode: use ' + DEMO_OTP + ')', mobile: mobile };
  };
  POST['/api/auth/verify-otp'] = function (d) {
    var mobile = cleanMobile(d.mobile);
    if (!otpOk(OTP_CACHE, mobile, d.otp)) return [401, { success: false, error: 'That OTP is not valid or has expired. Request a new one.' }];
    var u = one("SELECT * FROM users WHERE mobile LIKE ? ORDER BY CASE WHEN status = 'Approved' THEN 0 ELSE 1 END", ['%' + mobile.slice(-10)]);
    if (!u) return [404, { success: false, error: 'This mobile number is not registered.' }];
    var blk = statusBlock(u, 'error'); if (blk) return blk;
    delete OTP_CACHE[mobile];
    return signIn(u);
  };
  // ---- Email + OTP login ----
  // 1) the email must belong to an active user, 2) a fresh 6-digit code is created and sent,
  // 3) only that code, within 10 minutes and 5 tries, signs the user in. Codes are single-use.
  var OTP_RESEND_MS = 30 * 1000, OTP_MAX_TRIES = 5;
  // Uniform 6-digit code from the browser's secure random generator (rejection sampling avoids modulo bias).
  function newOtp() {
    var c = window.crypto || window.msCrypto;
    if (c && c.getRandomValues) {
      var a = new Uint32Array(1), limit = 4294000000; // largest multiple of 1,000,000 below 2^32
      do { c.getRandomValues(a); } while (a[0] >= limit);
      return pad(a[0] % 1000000, 6);
    }
    return pad(Math.floor(Math.random() * 1000000), 6);
  }
  function maskEmail(e) { var p = e.split('@'); return p[0].slice(0, 2) + '•••@' + p[1]; }
  function setting(k) { var r = one('SELECT value FROM app_settings WHERE key = ?', [k]); return r ? r.value : ''; }
  function emailConfig() {
    return { service_id: setting('emailjs_service_id'), template_id: setting('emailjs_template_id'), public_key: setting('emailjs_public_key') };
  }
  function sendEmail(to, name, code) {
    var c = emailConfig();
    var school = (one('SELECT school_name FROM school_details WHERE id = 1') || {}).school_name || 'Oasis Pre School';
    return realFetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service_id: c.service_id, template_id: c.template_id, user_id: c.public_key,
        template_params: { to_email: to, email: to, to_name: name || 'there', otp_code: code, passcode: code, school_name: school, valid_minutes: 10 } })
    }).then(function (r) { return r.ok ? true : r.text().then(function (t) { throw new Error(t || ('HTTP ' + r.status)); }); });
  }
  POST['/api/auth/send-email-otp'] = function (d) {
    var email = str(d.email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return [400, { success: false, error: 'Please enter a valid email address.' }];
    var u = one('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [email]);
    if (!u) return [404, { success: false, error: 'This email is not registered. Please ask the school office to add you in User Master.' }];
    var blk = statusBlock(u, 'error'); if (blk) return blk;
    var last = EMAIL_OTP_CACHE[email];
    if (last && Date.now() - last.created_at < OTP_RESEND_MS) {
      var wait = Math.ceil((OTP_RESEND_MS - (Date.now() - last.created_at)) / 1000);
      return [429, { success: false, error: 'Please wait ' + wait + ' seconds before asking for a new code.' }];
    }
    var cfg = emailConfig();
    if (!cfg.service_id || !cfg.template_id || !cfg.public_key) {
      // Never reveal the code on screen: that would let anyone sign in as any registered email.
      return [503, { success: false, error: 'Login codes cannot be emailed yet because email delivery is not set up. ' +
        'An administrator must sign in with a password or M-PIN and complete School Profile & Branding > Email delivery for login codes.' }];
    }
    var to = str(u.email).trim();           // always the address registered in User Master
    var code = newOtp();                     // fresh random code for every request
    // Invalidate any earlier code straight away; the new one is only stored once the email has gone out.
    delete EMAIL_OTP_CACHE[email];
    run('DELETE FROM email_otps WHERE LOWER(email) = LOWER(?)', [email]);
    return sendEmail(to, u.first_name, code).then(function () {
      EMAIL_OTP_CACHE[email] = { otp: code, created_at: Date.now(), tries: 0 };
      run('INSERT INTO email_otps (email, otp_code, created_at, expires_at) VALUES (?, ?, ?, ?)', [email, code, nowStr(), String(Date.now() + OTP_TTL_MS)]);
      return { success: true, delivery: 'email', email: email, message: 'We sent a 6-digit code to ' + maskEmail(to) + '. It expires in 10 minutes.' };
    }, function (err) {
      console.error('[oasis email]', err);
      return [502, { success: false, error: 'The code could not be emailed (' + String(err.message || err).slice(0, 120) + '). Check your internet connection, or the email settings in School Profile & Branding.' }];
    });
  };
  POST['/api/auth/verify-email-otp'] = function (d) {
    var email = str(d.email).trim().toLowerCase(), otp = str(d.otp).trim();
    var info = EMAIL_OTP_CACHE[email];
    if (!info) {
      var row = one('SELECT otp_code, expires_at FROM email_otps WHERE LOWER(email) = LOWER(?) ORDER BY id DESC', [email]);
      if (row) info = EMAIL_OTP_CACHE[email] = { otp: row.otp_code, created_at: +row.expires_at - OTP_TTL_MS, tries: 0 };
    }
    if (!info) return [400, { success: false, error: 'Please request a code first.' }];
    if (Date.now() - info.created_at >= OTP_TTL_MS) { delete EMAIL_OTP_CACHE[email]; run('DELETE FROM email_otps WHERE LOWER(email) = LOWER(?)', [email]); return [400, { success: false, error: 'This code has expired. Please request a new one.' }]; }
    if (!/^\d{6}$/.test(otp) || info.otp !== otp) {
      info.tries = (info.tries || 0) + 1;
      if (info.tries >= OTP_MAX_TRIES) { delete EMAIL_OTP_CACHE[email]; run('DELETE FROM email_otps WHERE LOWER(email) = LOWER(?)', [email]); return [400, { success: false, error: 'Too many wrong codes. Please request a new code.' }]; }
      return [400, { success: false, error: 'That code is not correct. ' + (OTP_MAX_TRIES - info.tries) + ' tries left.' }];
    }
    var u = one('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [email]);
    if (!u) return [404, { success: false, error: 'User account not found.' }];
    var blk = statusBlock(u, 'error'); if (blk) return blk;
    delete EMAIL_OTP_CACHE[email];
    run('DELETE FROM email_otps WHERE LOWER(email) = LOWER(?)', [email]); // single use
    return Object.assign(signIn(u), { message: 'Login successful' });
  };
  // Offline copy: no email or SMS here, so the administrator sets a new password in User Master.
  POST['/api/auth/forgot/send'] = POST['/api/auth/forgot/reset'] = function () {
    return [503, { success: false, error: 'On this device, please ask the administrator to set a new password for you in User Master.' }];
  };
  POST['/api/auth/logout'] = function () { session.userId = null; return { success: true }; };
  GET['/api/settings'] = function () {
    var c = emailConfig();
    return { emailjs_service_id: c.service_id, emailjs_template_id: c.template_id, emailjs_public_key: c.public_key, email_ready: !!(c.service_id && c.template_id && c.public_key) };
  };
  POST['/api/settings'] = function (d) {
    ['emailjs_service_id', 'emailjs_template_id', 'emailjs_public_key'].forEach(function (k) {
      if (k in d) run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [k, str(d[k]).trim()]);
    });
    return { success: true, message: 'Email settings saved.' };
  };
  POST['/api/settings/test-email'] = function (d) {
    var u = currentUser();
    if (!u || !can(u, 'school-setup', 'modify')) return [403, { success: false, error: 'Not allowed.' }];
    var to = str(d.email || u.email).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return [400, { success: false, error: 'Enter a valid email address to send the test to.' }];
    var c = emailConfig();
    if (!c.service_id || !c.template_id || !c.public_key) return [400, { success: false, error: 'Fill in all three EmailJS values and save first.' }];
    return sendEmail(to, u.first_name, '123456').then(function () { return { success: true, message: 'Test email sent to ' + to + '. It shows the sample code 123456.' }; },
      function (e) { return [502, { success: false, error: 'Sending failed: ' + String(e.message || e).slice(0, 160) }]; });
  };
  POST['/api/auth/mpin'] = function (d) {
    var mpin = str(d.mpin).trim();
    var ident = str(d.identifier || d.email || d.username).trim();
    var u = null;
    if (mpin && ident) {
      u = one('SELECT * FROM users WHERE (LOWER(email) = LOWER(?) OR LOWER(username) = LOWER(?) OR mobile LIKE ?) AND mpin = ?',
        [ident, ident, /^\d+$/.test(ident) ? '%' + ident.slice(-10) : ident, mpin]);
    }
    if (!u) return [401, { success: false, message: 'Invalid account or M-PIN' }];
    return statusBlock(u, 'message') || signIn(u);
  };
  POST['/api/auth/signup'] = function (d) {
    var email = str(d.email).trim();
    var username = str(d.username).trim() || (email ? email.split('@')[0] : '');
    var password = str(d.password);
    if (!email || email.indexOf('@') === -1 || !password) return [400, { success: false, error: 'Email and password are required' }];
    if (password.length < 8) return [400, { success: false, error: 'Password must be at least 8 characters.' }];
    if (one("SELECT 1 AS x FROM users WHERE LOWER(email) = LOWER(?) OR (? != '' AND LOWER(username) = LOWER(?))", [email, username, username])) {
      return [409, { success: false, error: 'An account with this email or username already exists. Please log in.' }];
    }
    var userId = 'UID' + Date.now();
    var role = normRole(d.role || 'Parent');
    var status = 'Pending'; // every self-registered account waits for an admin
    run('INSERT INTO users (user_id, username, first_name, last_name, email, mobile, password, mpin, profile_pic, role, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [userId, username, str(d.first_name), str(d.last_name), email, str(d.mobile), password, str(d.mpin || '1234'), str(d.profile_pic), role, status]);
    return {
      success: true, requires_approval: true, message: 'Account created successfully! Pending Admin approval before login.',
      user: { user_id: userId, username: username, first_name: str(d.first_name), last_name: str(d.last_name), email: email, mobile: str(d.mobile), role: role, profile_pic: str(d.profile_pic), status: status }
    };
  };

  // ----------------------------------------------------- users, roles, access
  POST['/api/screens'] = function (d) {
    var id = str(d.screen_id).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    var name = str(d.screen_name).trim();
    if (!id || !name) return [400, { success: false, error: 'Screen ID and Screen Name are required' }];
    var ex = one('SELECT * FROM screens WHERE screen_id = ?', [id]);
    if (ex && d.mode === 'add') return [409, { success: false, error: "A screen with ID '" + id + "' already exists." }];
    var builtin = APP_SCREEN_IDS.indexOf(id) !== -1;
    var cat = str(d.category || (ex && ex.category) || 'General').trim();
    if (builtin) { name = ex.screen_name; cat = ex.category; } // built-in names follow the app menu
    run('INSERT OR REPLACE INTO screens (screen_id, screen_name, category, description) VALUES (?, ?, ?, ?)', [id, name, cat, str(d.description).trim()]);
    all('SELECT role_id FROM roles').forEach(function (r) {
      var full = r.role_id === ADMIN_ROLE ? 1 : 0;
      run('INSERT OR IGNORE INTO role_permissions (role_id, screen_id, can_read, can_add, can_modify, can_delete) VALUES (?, ?, ?, ?, ?, ?)', [r.role_id, id, full, full, full, full]);
    });
    return { success: true, screen_id: id, message: ex ? "Screen '" + name + "' updated" : "Screen '" + name + "' registered" };
  };
  DEL['/api/screens'] = function (q) {
    if (APP_SCREEN_IDS.indexOf(q.id) !== -1) return [400, { success: false, error: 'Built-in screens are part of the app and cannot be deleted.' }];
    run('DELETE FROM screens WHERE screen_id = ?', [q.id]); run('DELETE FROM role_permissions WHERE screen_id = ?', [q.id]);
    return { success: true };
  };
  function catRank(cat) {
    for (var i = 0; i < APP_SCREENS.length; i++) if (APP_SCREENS[i][2] === cat) return i;
    return 999;
  }
  GET['/api/screens'] = function () {
    var order = {}; APP_SCREEN_IDS.forEach(function (id, i) { order[id] = i; });
    var total = scalar('SELECT COUNT(*) FROM roles') || 0;
    return all('SELECT s.screen_id, s.screen_name, s.category, s.description, ' +
      '(SELECT COUNT(*) FROM role_permissions rp WHERE rp.screen_id = s.screen_id AND rp.can_read = 1) AS roles_with_access FROM screens s')
      .map(function (s) {
        var meta = APP_SCREENS[order[s.screen_id]];
        return Object.assign(s, { builtin: meta ? 1 : 0, icon: meta ? meta[3] : 'fa-window-maximize', menu_order: meta ? order[s.screen_id] : 999, total_roles: total });
      })
      .sort(function (a, b) {
        // keep each menu group together, in menu order; custom screens go at the end of their group
        var ca = catRank(a.category), cb = catRank(b.category);
        return ca - cb || a.menu_order - b.menu_order || a.screen_name.localeCompare(b.screen_name);
      });
  };
  GET['/api/roles'] = function () {
    return all('SELECT r.role_id, r.role_name, r.description, ' +
      '(SELECT COUNT(*) FROM users u WHERE LOWER(u.role) = LOWER(r.role_name)) AS user_count, ' +
      '(SELECT COUNT(*) FROM role_permissions rp WHERE rp.role_id = r.role_id AND rp.can_read = 1) AS screen_count FROM roles r ORDER BY r.role_id')
      .map(function (r) { r.locked = r.role_id === ADMIN_ROLE ? 1 : 0; return r; });
  };
  POST['/api/roles'] = function (d) {
    var name = str(d.role_name).trim().replace(/\s+/g, ' ');
    if (!name) return [400, { success: false, error: 'Role name is required' }];
    var id = str(d.role_id).trim();
    var clash = one('SELECT role_id FROM roles WHERE LOWER(role_name) = LOWER(?)', [name]);
    if (clash && clash.role_id !== id) return [409, { success: false, error: "A role called '" + name + "' already exists." }];
    if (id === ADMIN_ROLE && name !== 'Administrator') return [400, { success: false, error: 'The Administrator role cannot be renamed.' }];
    var ex = id ? one('SELECT * FROM roles WHERE role_id = ?', [id]) : null;
    if (ex) {
      run('UPDATE roles SET role_name = ?, description = ? WHERE role_id = ?', [name, str(d.description).trim(), id]);
      if (ex.role_name !== name) run('UPDATE users SET role = ? WHERE LOWER(role) = LOWER(?)', [name, ex.role_name]);
    } else {
      var n = 1; all('SELECT role_id FROM roles').forEach(function (r) { var k = parseInt(String(r.role_id).replace(/\D/g, ''), 10); if (k >= n) n = k + 1; });
      id = 'ROL' + pad(n, 3);
      run('INSERT INTO roles (role_id, role_name, description) VALUES (?, ?, ?)', [id, name, str(d.description).trim()]);
      all('SELECT screen_id FROM screens').forEach(function (s) {
        run('INSERT OR IGNORE INTO role_permissions (role_id, screen_id, can_read, can_add, can_modify, can_delete) VALUES (?, ?, 0, 0, 0, 0)', [id, s.screen_id]);
      });
    }
    return { success: true, role_id: id, message: ex ? "Role '" + name + "' updated" : "Role '" + name + "' created. Now tick the screens it can use." };
  };
  POST['/api/role-permissions'] = function (d) {
    var id = str(d.role_id).trim();
    if (!id || !Array.isArray(d.permissions)) return [400, { success: false, error: 'role_id and permissions array required' }];
    if (id === ADMIN_ROLE) return [400, { success: false, error: 'The Administrator role always has full access and cannot be changed.' }];
    if (!one('SELECT 1 AS x FROM roles WHERE role_id = ?', [id])) return [404, { success: false, error: 'Role not found' }];
    d.permissions.forEach(function (p) {
      if (!p.screen_id) return;
      var a = p.can_add ? 1 : 0, m = p.can_modify ? 1 : 0, x = p.can_delete ? 1 : 0;
      var r = (p.can_read || a || m || x) ? 1 : 0; // any action needs Read
      run('INSERT OR REPLACE INTO role_permissions (role_id, screen_id, can_read, can_add, can_modify, can_delete) VALUES (?, ?, ?, ?, ?, ?)', [id, p.screen_id, r, a, m, x]);
    });
    return { success: true, message: 'Access saved. Users with this role get it the next time they log in.' };
  };
  // Only Administrators may create, change or delete Administrator accounts (otherwise anyone who can
  // manage users could make themselves an Administrator). At least one active Administrator always remains.
  function isAdminRole(roleName) { return roleIdOf(roleName) === ADMIN_ROLE; }
  function otherActiveAdmins(exceptId) {
    return all("SELECT user_id, role FROM users WHERE COALESCE(status, 'Approved') = 'Approved' AND user_id != ?", [exceptId])
      .filter(function (u) { return isAdminRole(u.role); }).length;
  }
  function endSessions(userId) { try { run('DELETE FROM auth_sessions WHERE user_id = ?', [userId]); } catch (e) { /* no sessions table in the offline copy */ } }
  var STATUSES = { Approved: 1, Disabled: 1, Pending: 1, Rejected: 1 };
  POST['/api/users/master'] = function (d) {
    var id = str(d.user_id).trim();
    var fn = str(d.first_name).trim(), ln = str(d.last_name).trim(), email = str(d.email).trim().toLowerCase();
    var mobile = str(d.mobile).replace(/\D/g, '');
    if (mobile.length === 12 && mobile.indexOf('91') === 0) mobile = mobile.slice(2);
    if (mobile.length === 11 && mobile.charAt(0) === '0') mobile = mobile.slice(1);
    var uname = str(d.username).trim();
    if (!fn) return [400, { success: false, error: 'First name is required' }];
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return [400, { success: false, error: 'Please enter a valid email address' }];
    if (mobile && !/^\d{10}$/.test(mobile)) return [400, { success: false, error: 'Mobile number must be 10 digits' }];
    if (uname && !/^[A-Za-z0-9._-]{3,30}$/.test(uname)) return [400, { success: false, error: 'Username must be 3 to 30 characters: letters, numbers, dot, dash or underscore.' }];
    var role = normRole(d.role);
    if (!roleIdOf(role)) return [400, { success: false, error: "Role '" + role + "' does not exist. Create it in Role Master first." }];
    var existing = id ? one('SELECT * FROM users WHERE user_id = ?', [id]) : null;
    if (id && !existing) return [404, { success: false, error: 'User not found. Please refresh the list.' }];
    var ex = one('SELECT user_id FROM users WHERE LOWER(email) = LOWER(?)', [email]);
    if (ex && ex.user_id !== id) return [409, { success: false, error: "Email '" + email + "' is already used by another user" }];
    if (uname) {
      var taken = one('SELECT user_id FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)', [uname, uname]);
      if (taken && taken.user_id !== id) return [409, { success: false, error: "The username '" + uname + "' is already taken." }];
    }
    var status = STATUSES[d.status] ? d.status : 'Approved';
    var newPw = str(d.password);
    if (newPw && newPw.length < 8) return [400, { success: false, error: 'The password must be at least 8 characters.' }];
    var me = currentUser();
    if (!me || !isAdminRole(me.role)) {
      if (isAdminRole(role) || (existing && isAdminRole(existing.role))) return [403, { success: false, error: 'Only an Administrator can create or change Administrator accounts.' }];
    }
    if (existing && me && me.user_id === id && (status !== 'Approved' || roleIdOf(role) !== roleIdOf(me.role))) {
      return [400, { success: false, error: 'You cannot disable yourself or change your own role.' }];
    }
    if (existing && isAdminRole(existing.role) && (!isAdminRole(role) || status !== 'Approved') && !otherActiveAdmins(id)) {
      return [400, { success: false, error: 'This is the last active Administrator, so it must stay an active Administrator.' }];
    }
    if (!existing && !newPw) return [400, { success: false, error: 'Set a password of at least 8 characters for the new user.' }];
    if (existing) {
      run('UPDATE users SET first_name = ?, last_name = ?, email = ?, mobile = ?, role = ?, status = ?' + (uname ? ', username = ?' : '') + ' WHERE user_id = ?',
        [fn, ln, email, mobile, role, status].concat(uname ? [uname] : []).concat([id]));
      if (newPw) {
        run('UPDATE users SET password = ? WHERE user_id = ?', [newPw, id]);
        if (!me || me.user_id !== id) endSessions(id);   // a new password signs the user out everywhere else
      }
      if (status !== 'Approved') endSessions(id);
      return { success: true, user_id: id, message: "User '" + (fn + ' ' + ln).trim() + "' updated" + (newPw ? ', with the new password' : '') };
    }
    id = 'USR-' + Date.now();
    if (!uname) {
      uname = email.split('@')[0].replace(/[^A-Za-z0-9._-]/g, '').slice(0, 30) || 'user';
      if (uname.length < 3) uname = (uname + '.user').slice(0, 30);
      while (one('SELECT 1 AS x FROM users WHERE LOWER(username) = LOWER(?)', [uname])) uname = uname.slice(0, 25) + '.' + Math.floor(1000 + Math.random() * 9000);
    }
    run("INSERT INTO users (user_id, username, first_name, last_name, email, mobile, role, password, mpin, status, profile_pic) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, '')",
      [id, uname, fn, ln, email, mobile, role, newPw, status]);
    return { success: true, user_id: id, message: "User '" + (fn + ' ' + ln).trim() + "' added. They log in with " + email + ' (or username ' + uname + ') and the password you set.' };
  };
  // Approve / reject only change sign-ups that are waiting (they cannot lock out an active account).
  // Approve or reject a sign-up. Approving can also set the role (never Administrator) and add a mobile number,
  // so a parent is linked to their child. Who decided, and when, is kept on the account.
  function decide(d, from, to) {
    var u = d.user_id ? one('SELECT * FROM users WHERE user_id = ?', [str(d.user_id)]) : one('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [str(d.email).trim()]);
    if (!u) return [404, { success: false, error: 'User not found. Please refresh the list.' }];
    if (from.indexOf(u.status || 'Approved') === -1) {
      return [409, { success: false, error: 'This account is no longer waiting for approval (someone may have just decided it). The list has been refreshed.' }];
    }
    var me = currentUser(), by = me ? str(me.username || me.email) : '', role = u.role;
    if (to === 'Approved') {
      if (str(d.role).trim()) {
        role = normRole(d.role);
        if (!roleIdOf(role)) return [400, { success: false, error: 'That role does not exist any more. Please refresh the page.' }];
      }
      if (roleIdOf(role) === ADMIN_ROLE) {
        return [400, { success: false, error: 'A sign-up cannot be approved as Administrator. Approve it with another role; an Administrator can change the role later in User Master.' }];
      }
      var mob = str(d.mobile).replace(/\D/g, '');
      if (mob.length === 12 && mob.indexOf('91') === 0) mob = mob.slice(2);
      if (mob.length === 11 && mob.charAt(0) === '0') mob = mob.slice(1);
      if (mob && !/^[6-9]\d{9}$/.test(mob)) return [400, { success: false, error: 'Please enter a valid 10-digit mobile number, or leave it empty.' }];
      if (mob && all("SELECT user_id, mobile FROM users WHERE user_id != ? AND mobile IS NOT NULL AND mobile != ''", [u.user_id]).some(function (x) {
        var t = str(x.mobile).replace(/\D/g, ''); return t.slice(-10) === mob;
      })) return [409, { success: false, error: 'This mobile number is already on another account. Each account needs its own number.' }];
      run('UPDATE users SET status = ?, role = ?, mobile = ?, status_changed_at = ?, status_changed_by = ? WHERE user_id = ?',
        ['Approved', role, mob || str(u.mobile), nowStr(), by, u.user_id]);
      notifyApproved(u);
    } else {
      run('UPDATE users SET status = ?, status_changed_at = ?, status_changed_by = ? WHERE user_id = ?', [to, nowStr(), by, u.user_id]);
      endSessions(u.user_id);
    }
    return { success: true, user_id: u.user_id, status: to, role: role };
  }
  // Tell the person by email when their account is approved (only when email is set up on the server).
  function notifyApproved(u) {
    try {
      if (typeof ctx === 'undefined' || !ctx || typeof ctx.mailReady !== 'function' || !ctx.mailReady()) return;
      var to = str(u.email).trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return;
      var school = (one('SELECT school_name FROM school_details WHERE id = 1') || {}).school_name || 'Oasis Pre School';
      var name = str(u.first_name || u.username) || 'there';
      Promise.resolve(ctx.sendMail({
        to: to, subject: 'Your ' + school + ' account is approved',
        text: 'Hello ' + name + ',\n\nYour account has been approved. You can now log in with your username (' + str(u.username) + ') or this email, and your password.\n\n' + school,
        html: '<div style="font-family:Arial,sans-serif;font-size:15px;color:#1e293b"><p>Hello ' + name.replace(/[<>&"]/g, '') + ',</p>' +
          '<p>Your account has been approved. You can now log in with your username (<b>' + str(u.username).replace(/[<>&"]/g, '') + '</b>) or this email, and your password.</p>' +
          '<p style="color:#64748b">' + school.replace(/[<>&"]/g, '') + '</p></div>'
      })).catch(function (e) { console.error('[oasis approval email]', e && e.message || e); });
    } catch (e) { /* the approval itself is already saved */ }
  }
  POST['/api/users/approve'] = function (d) { return decide(d, ['Pending', 'Rejected'], 'Approved'); };
  POST['/api/users/reject'] = function (d) { return decide(d, ['Pending'], 'Rejected'); };
  POST['/api/users/profile-pic'] = function (d) {
    run('UPDATE users SET profile_pic = ? WHERE LOWER(email) = LOWER(?)', [str(d.profile_pic), str(d.email)]);
    return { success: true, message: 'Profile picture updated successfully' };
  };

  // ------------------------------------------------------- students & fees
  // Admission numbers run in a series per academic year: ADM-2026-001, ADM-2026-002, ...
  function nextAdmissionNo(year) {
    var prefix = 'ADM-' + String(year || '2026').slice(0, 4) + '-';
    var max = 0;
    all('SELECT stud_id FROM students WHERE stud_id LIKE ?', [prefix + '%']).forEach(function (r) {
      var n = parseInt(String(r.stud_id).slice(prefix.length), 10);
      if (n > max) max = n;
    });
    return prefix + pad(max + 1, 3);
  }
  // The van driver comes from Staff (designation "Driver"); Route 2 gets the second driver when there is one.
  function vanDriver(route) {
    var d = all("SELECT full_name, phone FROM staff WHERE (LOWER(COALESCE(designation, '')) LIKE '%driver%' OR LOWER(COALESCE(category, '')) LIKE '%driver%') " +
      "AND COALESCE(status, 'Active') = 'Active' ORDER BY staff_id");
    if (!d.length) return { name: '', phone: '' };
    var r = d[/route\s*2/i.test(str(route)) && d[1] ? 1 : 0];
    return { name: str(r.full_name), phone: str(r.phone) };
  }
  POST['/api/admissions'] = POST['/api/students'] = function (d) {
    var year = d.academic_year || '2026-27', std = str(d.standard || '2');
    var sid = str(d.stud_id).trim() || nextAdmissionNo(year);
    var vanReq = d.van_required && d.van_required !== '0' ? 1 : 0;
    if (!str(d.first_name).trim()) return [400, { success: false, error: 'First name is required' }];
    run('INSERT OR REPLACE INTO students (stud_id, academic_year, first_name, last_name, dob, age, standard, gender, m_name, m_contact, m_email, f_name, f_contact, f_email, g_name, g_contact, address, street_name, area, pincode, van_required, van_route, van_pickup_point) ' +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', ?, ?, ?, ?, ?, ?, ?)",
      [sid, year, str(d.first_name), str(d.last_name), str(d.dob), int(d.age, 3), std, d.gender || 'Male', str(d.m_name), str(d.m_contact), str(d.m_email),
        str(d.f_name), str(d.f_contact), str(d.f_email), str(d.address), str(d.street_name), str(d.area), str(d.pincode), vanReq, str(d.van_route), str(d.van_pickup_point)]);
    // Fee package: the class's fee structure total, or the server's standard amounts.
    var fsTotal = scalar('SELECT SUM(fee_amount) FROM fee_structure WHERE class_id = ?', [std]) || 0;
    var tot = fsTotal > 0 ? fsTotal : (std === '2' ? 3500 : (std === '3' ? 4500 : 6000));
    var disc = num(d.disc_amount), fin = Math.max(0, tot - disc);
    run('INSERT INTO academic_fees_summary (academic_year, class_id, stud_id, total_amount, disc_amount, final_amount, paid_amount, due_amount) VALUES (?, ?, ?, ?, ?, ?, 0, ?)',
      [year, std, sid, tot, disc, fin, fin]);
    if (vanReq) {
      var drv = vanDriver(d.van_route);
      run('INSERT OR REPLACE INTO van_students (stud_id, route_name, pickup_point, drop_time, van_fee, van_fee_status, driver_name, driver_phone) VALUES (?, ?, ?, ?, 1200, ?, ?, ?)',
        [sid, str(d.van_route) || 'Unassigned', str(d.van_pickup_point) || '-', '03:30 PM', 'Pending', drv.name, drv.phone]);
    }
    return { success: true, stud_id: sid };
  };

  // A payment goes to the oldest year that still has dues (the server added it to every year's row).
  POST['/api/payments'] = function (d) {
    var sid = str(d.stud_id), amt = num(d.amount_paid || d.amount);
    var s = one('SELECT s.*, c.class_name FROM students s LEFT JOIN classes c ON s.standard = c.class_id WHERE s.stud_id = ?', [sid]);
    if (!s) return [404, { success: false, message: 'Student not found' }];
    if (amt <= 0) return [400, { success: false, message: 'Enter a valid amount' }];
    var target = one('SELECT * FROM academic_fees_summary WHERE stud_id = ? AND due_amount > 0 ORDER BY academic_year ASC, id ASC', [sid]) ||
      one('SELECT * FROM academic_fees_summary WHERE stud_id = ? ORDER BY academic_year DESC, id DESC', [sid]);
    if (!target) {
      run('INSERT INTO academic_fees_summary (academic_year, class_id, stud_id, total_amount, disc_amount, final_amount, paid_amount, due_amount) VALUES (?, ?, ?, ?, 0, ?, 0, ?)',
        [s.academic_year || '2026-27', s.standard, sid, amt, amt, amt]);
      target = one('SELECT * FROM academic_fees_summary WHERE stud_id = ? ORDER BY id DESC', [sid]);
    }
    var finalAmt = target.final_amount != null ? target.final_amount : (num(target.total_amount) - num(target.disc_amount));
    var newPaid = num(target.paid_amount) + amt;
    run('UPDATE academic_fees_summary SET paid_amount = ?, due_amount = ? WHERE id = ?', [newPaid, Math.max(0, finalAmt - newPaid), target.id]);
    var mode = d.payment_mode || 'UPI', date = d.payment_date || d.date || todayStr(), remarks = d.remarks || 'Online Fee Payment';
    var txn = d.txn_id || 'TXN-' + pad(rand(100000000), 8);
    var next = (scalar('SELECT MAX(id) FROM fee_payments') || 0) + 1;
    var receipt = 'REC-' + pad(1000 + next, 4);
    run('INSERT INTO fee_payments (stud_id, academic_year, amount_paid, payment_date, payment_mode, receipt_no, remarks) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [sid, target.academic_year, amt, date, mode, receipt, remarks + ' (Txn: ' + txn + ')']);
    var due = scalar('SELECT SUM(due_amount) FROM academic_fees_summary WHERE stud_id = ?', [sid]) || 0;
    return {
      success: true, receipt_no: receipt, txn_id: txn, stud_id: sid, student_name: (s.first_name + ' ' + (s.last_name || '')).trim() || sid,
      class_name: s.class_name || 'N/A', amount_paid: amt, paid_amount: newPaid, due_amount: due, payment_mode: mode, payment_date: date, remarks: remarks
    };
  };
  POST['/api/assign-fee'] = function (d) {
    if (!one('SELECT 1 AS x FROM students WHERE stud_id = ?', [str(d.stud_id)])) return [400, { success: false, error: 'Please select a student' }];
    var total = d.total_amount !== undefined ? num(d.total_amount) : num(d.term_fee) + num(d.tuition_fee) + num(d.van_fee);
    if (!total && d.fee_amount) total = num(d.fee_amount);
    var disc = num(d.disc_amount), fin = Math.max(0, total - disc);
    run('INSERT INTO academic_fees_summary (stud_id, academic_year, class_id, total_amount, disc_amount, final_amount, paid_amount, due_amount, attachment_data, attachment_name) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)',
      [str(d.stud_id), d.academic_year || '2026-27', str(d.class_id || '2'), total, disc, fin, fin, str(d.attachment_data), str(d.attachment_name)]);
    return { success: true };
  };

  POST['/api/expenses'] = function (d) {
    if (!str(d.title).trim() || num(d.amount) <= 0) return [400, { success: false, error: 'Title and a valid amount are required' }];
    run('INSERT INTO expenses (title, category, amount, expense_date, payment_method, remarks) VALUES (?, ?, ?, ?, ?, ?)',
      [str(d.title), d.category || 'Miscellaneous', num(d.amount), d.expense_date || todayStr(), d.payment_method || 'Cash', str(d.remarks)]);
    return { success: true };
  };
  POST['/api/attendance'] = function (d) {
    var date = d.date || todayStr();
    (d.records || []).forEach(function (r) {
      run('INSERT OR REPLACE INTO attendance (date, stud_id, status, remarks) VALUES (?, ?, ?, ?)', [date, r.stud_id, r.status || 'Present', str(r.remarks)]);
    });
    return { success: true };
  };
  POST['/api/homework'] = function (d) {
    if (!str(d.title).trim()) return [400, { success: false, error: 'Title is required' }];
    run('INSERT INTO homework (class_id, subject, title, content, due_date, image_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [str(d.class_id || '2'), d.subject || 'General', str(d.title), str(d.content), str(d.due_date), str(d.image_url), d.created_at || todayStr()]);
    return { success: true };
  };
  POST['/api/holidays'] = function (d) {
    var start = d.start_date || d.date || todayStr();
    run('INSERT INTO holidays (holiday_name, start_date, end_date, description) VALUES (?, ?, ?, ?)',
      [d.holiday_name || d.name || 'School Holiday', start, d.end_date || start, str(d.description)]);
    return { success: true };
  };
  // The upload form sends img_url; the server only read image_url, so photos were saved blank.
  POST['/api/gallery'] = function (d) {
    var url = str(d.image_url || d.img_url).trim();
    if (!url) return [400, { success: false, error: 'Please give the photo link' }];
    run('INSERT INTO gallery (title, category, image_url, upload_date) VALUES (?, ?, ?, ?)', [str(d.title), d.category || 'General', url, d.upload_date || todayStr()]);
    return { success: true };
  };
  POST['/api/report-cards'] = function (d) {
    if (!str(d.file_data)) return [400, { success: false, error: 'Please attach the report card file' }];
    run('INSERT INTO report_cards (stud_id, academic_year, term_title, file_name, file_data, uploaded_at) VALUES (?, ?, ?, ?, ?, ?)',
      [str(d.stud_id), d.academic_year || '2026-27', d.term_title || 'Term 1 Progress Report Card', d.file_name || 'report_card.pdf', str(d.file_data), d.uploaded_at || todayStr()]);
    return { success: true };
  };
  POST['/api/contact'] = function (d) {
    run('INSERT INTO contact_enquiries (name, email, phone, subject, message, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [str(d.name), str(d.email), str(d.phone), d.subject || 'General Inquiry', str(d.message), todayStr()]);
    return { success: true, message: 'Thank you, ' + (str(d.name) || 'there') + '! Your message has been saved for the school office.' };
  };
  POST['/api/school-details'] = function (d) {
    run('INSERT INTO school_details (id, school_name, logo_data, primary_color, secondary_color, address, email, phone, tagline) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT(id) DO UPDATE SET school_name=excluded.school_name, logo_data=excluded.logo_data, primary_color=excluded.primary_color, ' +
      'secondary_color=excluded.secondary_color, address=excluded.address, email=excluded.email, phone=excluded.phone, tagline=excluded.tagline',
      [d.school_name || 'OASIS PRE SCHOOL Academy', str(d.logo_data), d.primary_color || '#065f46', d.secondary_color || '#0d9488', str(d.address), str(d.email), str(d.phone), str(d.tagline)]);
    return { success: true, message: 'School details updated successfully' };
  };
  POST['/api/classes'] = function (d) {
    var order = d.display_order !== undefined && d.display_order !== '' ? int(d.display_order, 1) : 1;
    var id = str(d.class_id).trim() || String(order + 1);
    if (!str(d.class_name).trim()) return [400, { success: false, error: 'Class name is required' }];
    run('INSERT INTO classes (class_id, class_name, display_order, description) VALUES (?, ?, ?, ?) ON CONFLICT(class_id) DO UPDATE SET ' +
      'class_name=excluded.class_name, display_order=excluded.display_order, description=excluded.description', [id, str(d.class_name), order, str(d.description)]);
    return { success: true };
  };
  POST['/api/sections'] = function (d) {
    if (!str(d.section_name).trim()) return [400, { success: false, error: 'Section name is required' }];
    var vals = [str(d.class_id || '2'), str(d.section_name), int(d.capacity, 25), str(d.room_no), str(d.class_teacher)];
    if (d.section_id) run('UPDATE sections SET class_id=?, section_name=?, capacity=?, room_no=?, class_teacher=? WHERE section_id=?', vals.concat([d.section_id]));
    else run('INSERT INTO sections (class_id, section_name, capacity, room_no, class_teacher) VALUES (?, ?, ?, ?, ?)', vals);
    return { success: true };
  };
  POST['/api/fee-types'] = function (d) {
    if (!str(d.fee_name).trim()) return [400, { success: false, error: 'Fee name is required' }];
    var vals = [str(d.fee_name), str(d.fee_code).toUpperCase().replace(/ /g, '_'), d.frequency || 'Annual', num(d.default_amount), str(d.description), int(d.is_mandatory === undefined ? 1 : d.is_mandatory, 1)];
    if (d.fee_type_id) run('UPDATE fee_types SET fee_name=?, fee_code=?, frequency=?, default_amount=?, description=?, is_mandatory=? WHERE fee_type_id=?', vals.concat([d.fee_type_id]));
    else run('INSERT INTO fee_types (fee_name, fee_code, frequency, default_amount, description, is_mandatory) VALUES (?, ?, ?, ?, ?, ?)', vals);
    return { success: true };
  };

  // ----------------------------------------------------------------- staff
  POST['/api/teacher-leaves'] = function (d) {
    if (!d.staff_id || !d.start_date) return [400, { success: false, error: 'Staff member and dates are required' }];
    run("INSERT INTO teacher_leaves (staff_id, leave_type, start_date, end_date, total_days, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'Pending', ?)",
      [d.staff_id, d.leave_type, d.start_date, d.end_date || d.start_date, int(d.total_days, 1), str(d.reason), todayStr()]);
    return { success: true };
  };
  POST['/api/teacher-leaves/status'] = function (d) {
    run('UPDATE teacher_leaves SET status = ? WHERE id = ?', [d.status || 'Approved', d.leave_id || d.id]);
    return { success: true };
  };
  POST['/api/leaves/config'] = function (d) {
    if (!str(d.leave_code).trim()) return [400, { success: false, error: 'Leave code is required' }];
    run('INSERT INTO leave_config (leave_code, leave_name, yearly_quota) VALUES (?, ?, ?) ON CONFLICT(leave_code) DO UPDATE SET leave_name=excluded.leave_name, yearly_quota=excluded.yearly_quota',
      [str(d.leave_code).trim().toUpperCase(), str(d.leave_name), int(d.yearly_quota, 10)]);
    return { success: true };
  };
  POST['/api/van/gps'] = function (d) {
    run('INSERT INTO van_routes_gps (route_name, gps_lat, gps_lng, speed_kmh, eta_mins, last_updated) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(route_name) DO UPDATE SET ' +
      'gps_lat=excluded.gps_lat, gps_lng=excluded.gps_lng, speed_kmh=excluded.speed_kmh, eta_mins=excluded.eta_mins, last_updated=excluded.last_updated',
      [d.route_name || 'Route 1', num(d.gps_lat), num(d.gps_lng), num(d.speed_kmh), int(d.eta_mins, 0), nowStr()]);
    return { success: true };
  };
  POST['/api/whatsapp/send'] = function (d) {
    run("INSERT INTO whatsapp_logs (phone, name, template, message, sent_at, status) VALUES (?, ?, ?, ?, ?, 'Logged')",
      [str(d.phone), str(d.name), d.template || 'generic', str(d.message), nowStr()]);
    return { success: true };
  };
  // Accepts the screen's name/role/is_active as well as the table's own column names.
  POST['/api/staff'] = function (d) {
    var id = str(d.staff_id).trim() || 'STF-' + pad(100 + (scalar('SELECT COUNT(*) FROM staff') || 0) + 1, 3);
    var name = str(d.full_name || d.name).trim();
    if (!name) return [400, { success: false, error: 'Staff name is required' }];
    var category = d.category || (d.role === 'Non-Teaching' ? 'Non-Teaching Staff' : 'Teaching Staff');
    var status = d.status || (d.is_active === 0 || d.is_active === '0' ? 'Inactive' : 'Active');
    run('INSERT INTO staff (staff_id, full_name, category, designation, department, phone, email, joining_date, status, base_salary, bank_account) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT(staff_id) DO UPDATE SET full_name=excluded.full_name, category=excluded.category, designation=excluded.designation, department=excluded.department, ' +
      'phone=excluded.phone, email=excluded.email, status=excluded.status, base_salary=excluded.base_salary, bank_account=excluded.bank_account',
      [id, name, category, d.designation || 'Teacher', str(d.department), str(d.phone), str(d.email), d.joining_date || d.date_of_joining || todayStr(), status,
        num(d.base_salary, 0), str(d.bank_account)]);
    return { success: true, staff_id: id };
  };
  POST['/api/payroll'] = function (d) {
    if (!d.staff_id || !d.month) return [400, { success: false, error: 'Staff member and month are required' }];
    var base = num(d.base_salary), allow = num(d.allowances), ded = num(d.deductions);
    run("INSERT INTO staff_payroll (staff_id, month, base_salary, allowances, deductions, net_salary, payment_mode, payment_date, status, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Paid', ?)",
      [d.staff_id, d.month, base, allow, ded, d.net_salary !== undefined ? num(d.net_salary) : base + allow - ded, d.payment_mode || 'Bank Transfer', d.payment_date || todayStr(), d.remarks || 'Monthly Salary Payment']);
    return { success: true };
  };
  POST['/api/staff-attendance'] = POST['/api/teacher-attendance'] = function (d) {
    var list = Array.isArray(d) ? d : (d.attendance || []);
    list.forEach(function (it) {
      if (!it.staff_id) return;
      run('INSERT INTO teacher_attendance (date, staff_id, status, remarks) VALUES (?, ?, ?, ?) ON CONFLICT(date, staff_id) DO UPDATE SET status=excluded.status, remarks=excluded.remarks',
        [it.date || (!Array.isArray(d) && d.date) || todayStr(), it.staff_id, it.status || 'Present', str(it.notes || it.remarks)]);
    });
    return { success: true };
  };

  POST['/api/clean-sample-data'] = function () {
    cleanSampleData();
    return { success: true, message: 'Sample data removed. Classes, sections, fee setup, roles and real accounts were kept.' };
  };

  // ---------------------------------------------------------------- deletes
  function delBy(table, col) { return function (q) { if (q.id) run('DELETE FROM ' + table + ' WHERE ' + col + ' = ?', [q.id]); return { success: true }; }; }
  DEL['/api/report-cards'] = delBy('report_cards', 'id');
  DEL['/api/classes'] = delBy('classes', 'class_id');
  DEL['/api/sections'] = delBy('sections', 'section_id');
  DEL['/api/fee-types'] = delBy('fee_types', 'fee_type_id');
  DEL['/api/teacher-leaves'] = delBy('teacher_leaves', 'id');
  DEL['/api/leaves/config'] = delBy('leave_config', 'id');
  DEL['/api/staff'] = delBy('staff', 'staff_id');
  DEL['/api/payroll'] = delBy('staff_payroll', 'id');
  DEL['/api/holidays'] = delBy('holidays', 'id');
  DEL['/api/roles'] = function (q) {
    var r = one('SELECT * FROM roles WHERE role_id = ?', [q.id]);
    if (!r) return [404, { success: false, error: 'Role not found' }];
    if (r.role_id === ADMIN_ROLE) return [400, { success: false, error: 'The Administrator role cannot be deleted.' }];
    var n = scalar('SELECT COUNT(*) FROM users WHERE LOWER(role) = LOWER(?)', [r.role_name]);
    if (n) return [400, { success: false, error: n + ' user(s) still have the role ' + r.role_name + '. Move them to another role in User Master first.' }];
    run('DELETE FROM roles WHERE role_id = ?', [q.id]); run('DELETE FROM role_permissions WHERE role_id = ?', [q.id]);
    return { success: true };
  };
  DEL['/api/users/master'] = function (q) {
    if (session.userId && q.id === session.userId) return [400, { success: false, error: 'You cannot delete the account you are signed in with.' }];
    var u = one('SELECT * FROM users WHERE user_id = ?', [q.id]);
    if (!u) return [404, { success: false, error: 'User not found' }];
    var me = currentUser();
    if (isAdminRole(u.role) && (!me || !isAdminRole(me.role))) return [403, { success: false, error: 'Only an Administrator can delete an Administrator account.' }];
    if (roleIdOf(u.role) === ADMIN_ROLE && scalar("SELECT COUNT(*) FROM users WHERE LOWER(role) = 'administrator' AND COALESCE(status,'Approved') = 'Approved'") <= 1) {
      return [400, { success: false, error: 'This is the last active Administrator and cannot be deleted.' }];
    }
    run('DELETE FROM users WHERE user_id = ?', [q.id]);
    endSessions(q.id);
    return { success: true };
  };

  // --------------------------------------------------------------- storage
  function openIdb() {
    return new Promise(function (resolve) {
      try {
        var req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = function () { req.result.createObjectStore(IDB_STORE); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
        req.onblocked = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
  }
  var idb = null;
  function idbGet() {
    return new Promise(function (resolve) {
      if (!idb) return resolve(null);
      try {
        var r = idb.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(IDB_KEY);
        r.onsuccess = function () { resolve(r.result || null); };
        r.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
  }
  var BEFORE_CLEAN_KEY = 'oasis_preschool.before-clean.db';
  function idbPutKey(key, bytes) {
    return new Promise(function (resolve) {
      if (!idb) return resolve(false);
      try { var tx = idb.transaction(IDB_STORE, 'readwrite'); tx.objectStore(IDB_STORE).put(bytes, key); tx.oncomplete = function () { resolve(true); }; tx.onerror = function () { resolve(false); }; }
      catch (e) { resolve(false); }
    });
  }
  function idbGetKey(key) {
    return new Promise(function (resolve) {
      if (!idb) return resolve(null);
      try { var r = idb.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key); r.onsuccess = function () { resolve(r.result || null); }; r.onerror = function () { resolve(null); }; }
      catch (e) { resolve(null); }
    });
  }
  function idbPut(bytes) {
    return new Promise(function (resolve) {
      if (!idb) return resolve(false);
      try {
        var tx = idb.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(bytes, IDB_KEY);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { resolve(false); };
      } catch (e) { resolve(false); }
    });
  }
  function b64ToBytes(b64) {
    var bin = atob(b64), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function bytesToB64(bytes) {
    var s = '', CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(s);
  }
  var saveWarned = false;
  function save() {
    var bytes = db.export();
    return idbPut(bytes).then(function (ok) {
      if (ok) return;
      try { localStorage.setItem(LS_KEY, bytesToB64(bytes)); }
      catch (e) {
        if (!saveWarned) { saveWarned = true; alert('This browser is not letting Oasis save changes. Please open the app in Chrome or Safari (not a private window).'); }
      }
    });
  }

  // ------------------------------------------------ money & salary privacy (added before going live)
  // School-wide money totals need Payments / Expenses access; salaries and bank details need the Payroll screen.
  var SALARY_FIELDS = ['base_salary', 'bank_account'];
  (function () {
    var sum = GET['/api/summary'];
    GET['/api/summary'] = function (q) {
      var u = currentUser(), out = sum(q), fees = can(u, 'payments', 'read'), exp = can(u, 'expenses', 'read');
      if (!fees) { out.total_fees = null; out.total_paid = null; out.total_dues = null; }
      if (!exp) out.total_expenses = null;
      if (!fees || !exp) out.net_balance = null;
      return out;
    };
    var charts = GET['/api/charts'];
    GET['/api/charts'] = function (q) {
      var u = currentUser(), out = charts(q);
      if (!can(u, 'payments', 'read')) out.fee_stat = null;
      if (!can(u, 'expenses', 'read')) out.expense_cat = null;
      return out;
    };
    var staffList = GET['/api/staff'];
    GET['/api/staff'] = function (q) {
      var rows = staffList(q);
      if (can(currentUser(), 'payroll', 'read')) return rows;
      return rows.map(function (s) { s = Object.assign({}, s); SALARY_FIELDS.forEach(function (f) { delete s[f]; }); return s; });
    };
    var staffSave = POST['/api/staff'];
    POST['/api/staff'] = function (d) {
      var u = currentUser(), old = d && d.staff_id ? one('SELECT base_salary, bank_account FROM staff WHERE staff_id = ?', [d.staff_id]) : null;
      if (!can(u, 'payroll', old ? 'modify' : 'add')) {
        d = Object.assign({}, d);
        SALARY_FIELDS.forEach(function (f) { d[f] = old ? old[f] : (f === 'base_salary' ? 0 : ''); });
      }
      return staffSave(d);
    };
    // The school's UPI ID is kept in School Profile (shown to parents on the payment screen).
    var sdGet = GET['/api/school-details'];
    GET['/api/school-details'] = function (q) {
      var out = Object.assign({ upi_id: '', upi_name: '' }, sdGet(q));
      out.upi_id = str(out.upi_id); out.upi_name = str(out.upi_name);
      return out;
    };
    var sdPost = POST['/api/school-details'];
    POST['/api/school-details'] = function (d) {
      var upi = d.upi_id === undefined ? null : str(d.upi_id).trim().toLowerCase();
      if (upi && !/^[a-z0-9.\-_]{2,256}@[a-z][a-z0-9]{1,63}$/.test(upi)) {
        return [400, { success: false, error: 'The UPI ID does not look right. It should look like schoolname@okicici.', message: 'The UPI ID does not look right. It should look like schoolname@okicici.' }];
      }
      var out = sdPost(d);
      if (upi !== null) run('UPDATE school_details SET upi_id = ?, upi_name = ? WHERE id = 1', [upi, str(d.upi_name).trim().slice(0, 60)]);
      return out;
    };
    // The public enquiry form: keep messages a sensible size, and slow down anyone sending many.
    var contact = POST['/api/contact'];
    POST['/api/contact'] = function (d) {
      if (typeof tooMany === 'function' && !currentUser()) { // visitors who are not signed in
        if (tooMany('contact-ip:' + session.ip, 10, 60 * 60 * 1000)) return [429, { success: false, error: 'Too many messages. Please try again in an hour.', message: 'Too many messages. Please try again in an hour.' }];
        hit('contact-ip:' + session.ip);
      }
      d = d || {};
      if (!str(d.name).trim() || !str(d.message).trim()) return [400, { success: false, error: 'Please enter your name and a message.', message: 'Please enter your name and a message.' }];
      return contact({ name: str(d.name).slice(0, 120), email: str(d.email).slice(0, 160), phone: str(d.phone).slice(0, 20),
        subject: str(d.subject || 'General Inquiry').slice(0, 120), message: str(d.message).slice(0, 2000) });
    };
  })();

  // Sign-ups for the User Approvals screen: waiting, rejected, and recently approved accounts, with the children a
  // parent account will see (matched by the mother's / father's mobile or email on the admission record).
  function signedUpAt(u) {
    if (u.created_at) return str(u.created_at);
    var m = /^UID(\d{13})$/.exec(str(u.user_id));
    if (!m) return '';
    var d = new Date(+m[1]);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2) + ' ' + pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2);
  }
  function childrenOf(u, kids) {
    var mob = str(u.mobile).replace(/\D/g, '').slice(-10), email = str(u.email).trim().toLowerCase();
    return kids.filter(function (s) {
      var mm = str(s.m_contact).replace(/\D/g, '').slice(-10), ff = str(s.f_contact).replace(/\D/g, '').slice(-10);
      return (mob.length === 10 && (mm === mob || ff === mob)) ||
        (email && (str(s.m_email).trim().toLowerCase() === email || str(s.f_email).trim().toLowerCase() === email));
    }).map(function (s) { return { stud_id: s.stud_id, name: (str(s.first_name) + ' ' + str(s.last_name)).trim(), class_name: str(s.class_name) }; });
  }
  GET['/api/users/approvals'] = function () {
    var kids = all('SELECT s.stud_id, s.first_name, s.last_name, s.m_contact, s.f_contact, s.m_email, s.f_email, c.class_name FROM students s LEFT JOIN classes c ON s.standard = c.class_id');
    var rows = all("SELECT user_id, username, first_name, last_name, email, mobile, role, COALESCE(status, 'Approved') AS status, created_at, status_changed_at, status_changed_by FROM users");
    function view(u) {
      return { user_id: u.user_id, username: str(u.username), first_name: str(u.first_name), last_name: str(u.last_name), email: str(u.email),
        mobile: str(u.mobile).replace(/\D/g, '').slice(-10), role: str(u.role), status: u.status, signed_up: signedUpAt(u),
        decided_at: str(u.status_changed_at), decided_by: str(u.status_changed_by), children: childrenOf(u, kids) };
    }
    function newest(a, b) { return (b.decided_at || b.signed_up).localeCompare(a.decided_at || a.signed_up); }
    return {
      pending: rows.filter(function (u) { return u.status === 'Pending'; }).map(view).sort(function (a, b) { return a.signed_up.localeCompare(b.signed_up); }),
      rejected: rows.filter(function (u) { return u.status === 'Rejected'; }).map(view).sort(newest),
      approved: rows.filter(function (u) { return u.status === 'Approved' && u.status_changed_at; }).map(view).sort(newest).slice(0, 20),
      roles: all('SELECT role_id, role_name FROM roles ORDER BY role_name').filter(function (r) { return r.role_id !== ADMIN_ROLE; }).map(function (r) { return r.role_name; })
    };
  };
  (function () { // remember when each sign-up was made
    var signup = POST['/api/auth/signup'];
    POST['/api/auth/signup'] = function (d) {
      if (/[<>"'`\\\s]/.test(str(d && d.email).trim())) return [400, { success: false, error: 'Please enter a valid email address.' }];
      var out = signup(d);
      if (out && out.success && out.user && out.user.user_id) run('UPDATE users SET created_at = ? WHERE user_id = ?', [nowStr(), out.user.user_id]);
      return out;
    };
  })();

  function migrate() {
    var uCols = all("PRAGMA table_info('users')").map(function (c) { return c.name; });
    ['created_at', 'status_changed_at', 'status_changed_by'].forEach(function (c) {
      if (uCols.indexOf(c) === -1) run('ALTER TABLE users ADD COLUMN ' + c + " TEXT DEFAULT ''");
    });
    // One-time tidy-ups of set-up data (each runs once, so later changes by the school are kept).
    function once(key, fn) { if (!one('SELECT value FROM app_meta WHERE key = ?', [key])) { fn(); run('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', [key, nowStr()]); } }
    run('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT)');
    once('fix_leave_types', function () {
      run("DELETE FROM leave_config WHERE UPPER(leave_code) LIKE 'AUDIT%'");
      if (!one('SELECT 1 AS x FROM leave_config')) {
        [['CL', 'Casual Leave', 12], ['SL', 'Sick Leave', 12], ['EL', 'Earned / Annual Leave', 15], ['ML', 'Maternity Leave', 182]].forEach(function (l) {
          run('INSERT INTO leave_config (leave_code, leave_name, yearly_quota) VALUES (?, ?, ?)', l);
        });
      }
    });
    once('fix_van_drivers', function () { // made-up driver names from older versions
      all("SELECT stud_id, route_name FROM van_students WHERE (driver_name = 'Ramesh Kumar' AND driver_phone = '9876543210') OR (driver_name = 'Suresh Verma' AND driver_phone = '9876543211')").forEach(function (v) {
        var drv = vanDriver(v.route_name);
        run('UPDATE van_students SET driver_name = ?, driver_phone = ? WHERE stud_id = ?', [drv.name, drv.phone, v.stud_id]);
      });
    });
    once('fix_class_order', function () {
      var cls = all('SELECT class_id, class_name, display_order FROM classes ORDER BY class_id');
      var orders = {}; cls.forEach(function (c) { orders[c.display_order] = 1; });
      if (cls.length < 2 || Object.keys(orders).length > 1) return;
      function rank(n) {
        n = String(n || '').toLowerCase();
        return /play|pre.?nur|toddler/.test(n) ? 1 : /nursery/.test(n) ? 2 : /lkg|jr|junior/.test(n) ? 3 : /ukg|sr|senior/.test(n) ? 4 : /day.?care/.test(n) ? 6 : 5;
      }
      cls.slice().sort(function (a, b) { return rank(a.class_name) - rank(b.class_name) || String(a.class_id).localeCompare(String(b.class_id), undefined, { numeric: true }); })
        .forEach(function (c, i) { run('UPDATE classes SET display_order = ? WHERE class_id = ?', [i + 1, c.class_id]); });
    });
    var sdCols = all("PRAGMA table_info('school_details')").map(function (c) { return c.name; });
    if (sdCols.indexOf('upi_id') === -1) run("ALTER TABLE school_details ADD COLUMN upi_id TEXT DEFAULT ''");
    if (sdCols.indexOf('upi_name') === -1) run("ALTER TABLE school_details ADD COLUMN upi_name TEXT DEFAULT ''");
    var cols = all("PRAGMA table_info('staff')").map(function (c) { return c.name; });
    if (cols.indexOf('department') === -1) run("ALTER TABLE staff ADD COLUMN department TEXT DEFAULT ''");
  }

  var ready = (async function boot() {
    SQL = await window.initSqlJs({ locateFile: function (f) { return 'vendor/' + f; } });
    idb = await openIdb();
    var bytes = await idbGet();
    if (!bytes) { try { var ls = localStorage.getItem(LS_KEY); if (ls) bytes = b64ToBytes(ls); } catch (e) {} }
    var fresh = !bytes;
    if (fresh) bytes = b64ToBytes(window.OASIS_SEED_DB);
    db = new SQL.Database(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    run('PRAGMA foreign_keys = OFF');
    migrate();
    migrateRbac();
    if (!sampleCleaned()) {
      if (!fresh) await idbPutKey(BEFORE_CLEAN_KEY, db.export()); // copy of the data from before the clean-up
      run('BEGIN'); try { cleanSampleData(); run('COMMIT'); } catch (e) { run('ROLLBACK'); throw e; }
      fresh = true;
    }
    if (fresh) await save();
  })();

  // ------------------------------------------------------------ dispatcher
  function respond(status, obj) {
    return new Response(JSON.stringify(obj), { status: status, headers: { 'Content-Type': 'application/json' } });
  }
  var queue = Promise.resolve();
  function handle(method, url, bodyText) {
    var table = method === 'GET' ? GET : method === 'POST' ? POST : method === 'DELETE' ? DEL : null;
    var path = url.pathname.replace(/\/+$/, '');
    var fn = table && table[path];
    if (method === 'OPTIONS') return respond(200, { success: true });
    if (!fn) return respond(404, { success: false, error: 'Endpoint not found: ' + method + ' ' + path });
    var q = {};
    url.searchParams.forEach(function (v, k) { if (!(k in q)) q[k] = v; });
    var data = {};
    if (bodyText) { try { data = JSON.parse(bodyText); } catch (e) { data = {}; } }
    var out;
    try {
      var denied = guard(method + ' ' + path, method === 'POST' ? data : q);
      if (denied) out = denied;
      else if (method === 'GET') out = fn(q);
      else { run('BEGIN'); try { out = fn(method === 'POST' ? data : q, q); run('COMMIT'); } catch (e) { try { run('ROLLBACK'); } catch (e2) {} throw e; } }
    } catch (e) {
      console.error('[oasis api]', method, path, e);
      return respond(500, { success: false, error: String(e && e.message || e) });
    }
    return Promise.resolve(out).then(function (o) {
      var status = 200;
      if (Array.isArray(o) && o.length === 2 && typeof o[0] === 'number') { status = o[0]; o = o[1]; }
      var res = respond(status, o === undefined ? { success: true } : o);
      if (method === 'GET') return res;
      return save().then(function () { return res; }); // saved before the page hears back
    });
  }

  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  function apiUrl(input) {
    var raw = typeof input === 'string' ? input : (input && input.url) || String(input);
    var u;
    try { u = new URL(raw, location.href); } catch (e) { return null; }
    if (u.pathname.indexOf('/api/') !== 0) return null;
    if (u.protocol !== 'file:' && u.origin !== location.origin) return null;
    return u;
  }
  window.fetch = function (input, init) {
    var url = apiUrl(input);
    if (!url) return realFetch(input, init);
    init = init || {};
    var method = String(init.method || (input && input.method) || 'GET').toUpperCase();
    var body = init.body;
    var job = queue.then(function () { return ready; }).then(function () {
      if (body == null && input && typeof input === 'object' && input.text && method !== 'GET') return input.text();
      return body == null ? '' : String(body);
    }).then(function (text) { return handle(method, url, text); });
    queue = job.catch(function () {});
    return job;
  };

  window.OasisDB = {
    ready: ready,
    exportFile: function () { return ready.then(function () { return db.export(); }); },
    importFile: function (bytes) {
      return ready.then(function () {
        var test = new SQL.Database(bytes);
        test.exec('SELECT COUNT(*) FROM students'); // throws if this is not an Oasis database
        db.close(); db = test; migrate(); migrateRbac(); session.userId = null; return save();
      });
    },
    beforeCleanFile: function () { return ready.then(function () { return idbGetKey(BEFORE_CLEAN_KEY); }); },
    reset: function () {
      return ready.then(function () {
        db.close(); db = new SQL.Database(b64ToBytes(window.OASIS_SEED_DB)); migrate(); migrateRbac(); session.userId = null; return save();
      });
    }
  };
})();
