// filter.yidplus.com - Kosher Filter System API
// Handles: profiles, apps, users, requests

const OWNER_EMAIL = "avrumy5872877@gmail.com";

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace('/filter/', '').replace(/^\//, '');
  const method = request.method;

  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (method === 'OPTIONS') {
    return new Response(null, { headers: cors });
  }

  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });

  // ── SERVE ADMIN HTML ──────────────────────────────────
  if (path === "" || path === "admin") {
    const HTML = "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n<title>KosherGuard \u2014 Filter Management</title>\n<link href=\"https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap\" rel=\"stylesheet\">\n<style>\n*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }\n\n:root {\n  --bg: #0a0f1e;\n  --surface: #111827;\n  --surface2: #1a2236;\n  --border: rgba(255,255,255,0.07);\n  --accent: #6366f1;\n  --accent2: #818cf8;\n  --green: #10b981;\n  --red: #ef4444;\n  --yellow: #f59e0b;\n  --text: #f1f5f9;\n  --muted: #64748b;\n  --card-shadow: 0 4px 24px rgba(0,0,0,0.4);\n}\n\nbody {\n  font-family: 'Inter', sans-serif;\n  background: var(--bg);\n  color: var(--text);\n  min-height: 100vh;\n  font-size: 14px;\n}\n\n/* \u2500\u2500 SIDEBAR \u2500\u2500 */\n.layout { display: flex; min-height: 100vh; }\n\n.sidebar {\n  width: 220px;\n  background: var(--surface);\n  border-right: 1px solid var(--border);\n  display: flex;\n  flex-direction: column;\n  position: fixed;\n  top: 0; left: 0; bottom: 0;\n  z-index: 100;\n}\n\n.logo {\n  padding: 24px 20px;\n  border-bottom: 1px solid var(--border);\n}\n.logo-mark {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n}\n.logo-icon {\n  width: 36px; height: 36px;\n  background: linear-gradient(135deg, var(--accent), #a855f7);\n  border-radius: 10px;\n  display: flex; align-items: center; justify-content: center;\n  font-size: 18px;\n}\n.logo-text { font-weight: 700; font-size: 15px; letter-spacing: -0.3px; }\n.logo-sub { font-size: 11px; color: var(--muted); margin-top: 2px; }\n\nnav { padding: 12px 10px; flex: 1; }\n.nav-label { font-size: 10px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; padding: 10px 10px 6px; }\n\n.nav-item {\n  display: flex; align-items: center; gap: 10px;\n  padding: 9px 12px;\n  border-radius: 8px;\n  cursor: pointer;\n  color: var(--muted);\n  font-weight: 500;\n  font-size: 13.5px;\n  transition: all 0.15s;\n  margin-bottom: 2px;\n}\n.nav-item:hover { background: var(--surface2); color: var(--text); }\n.nav-item.active { background: rgba(99,102,241,0.15); color: var(--accent2); }\n.nav-item .icon { font-size: 16px; width: 20px; text-align: center; }\n.nav-badge {\n  margin-left: auto;\n  background: var(--red);\n  color: white;\n  font-size: 10px;\n  font-weight: 700;\n  padding: 2px 6px;\n  border-radius: 10px;\n  min-width: 18px;\n  text-align: center;\n}\n\n/* \u2500\u2500 MAIN \u2500\u2500 */\n.main {\n  margin-left: 220px;\n  flex: 1;\n  display: flex;\n  flex-direction: column;\n  min-height: 100vh;\n}\n\n.topbar {\n  background: var(--surface);\n  border-bottom: 1px solid var(--border);\n  padding: 16px 28px;\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  position: sticky; top: 0; z-index: 50;\n}\n.topbar h1 { font-size: 18px; font-weight: 600; letter-spacing: -0.3px; }\n.topbar-actions { display: flex; gap: 10px; align-items: center; }\n\n.content { padding: 28px; flex: 1; }\n\n/* \u2500\u2500 STATS \u2500\u2500 */\n.stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 20px; }\n.stat {\n  background: var(--surface);\n  border: 1px solid var(--border);\n  border-radius: 10px;\n  padding: 12px 14px;\n  display: flex;\n  align-items: center;\n  gap: 12px;\n}\n.stat-icon { font-size: 18px; }\n.stat-num { font-size: 20px; font-weight: 700; letter-spacing: -0.5px; line-height: 1; }\n.stat-label { font-size: 11px; color: var(--muted); margin-top: 2px; font-weight: 500; }\n\n/* \u2500\u2500 PANELS \u2500\u2500 */\n.panel { display: none; }\n.panel.active { display: block; }\n\n/* \u2500\u2500 CARD \u2500\u2500 */\n.card {\n  background: var(--surface);\n  border: 1px solid var(--border);\n  border-radius: 14px;\n  overflow: hidden;\n}\n.card-header {\n  padding: 18px 22px;\n  border-bottom: 1px solid var(--border);\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n}\n.card-header h2 { font-size: 15px; font-weight: 600; }\n.card-body { padding: 22px; }\n\n/* \u2500\u2500 TABLE \u2500\u2500 */\n.table-wrap { overflow-x: auto; }\ntable { width: 100%; border-collapse: collapse; }\nth {\n  padding: 10px 16px;\n  text-align: left;\n  font-size: 11px;\n  font-weight: 600;\n  color: var(--muted);\n  text-transform: uppercase;\n  letter-spacing: 0.8px;\n  border-bottom: 1px solid var(--border);\n}\ntd {\n  padding: 13px 16px;\n  border-bottom: 1px solid var(--border);\n  font-size: 13.5px;\n}\ntr:last-child td { border-bottom: none; }\ntr:hover td { background: rgba(255,255,255,0.02); }\n\n/* \u2500\u2500 BADGE \u2500\u2500 */\n.badge {\n  display: inline-flex; align-items: center; gap: 5px;\n  padding: 3px 10px;\n  border-radius: 20px;\n  font-size: 11px;\n  font-weight: 600;\n  letter-spacing: 0.3px;\n}\n.badge-green { background: rgba(16,185,129,0.15); color: #34d399; }\n.badge-red { background: rgba(239,68,68,0.15); color: #f87171; }\n.badge-yellow { background: rgba(245,158,11,0.15); color: #fbbf24; }\n.badge-purple { background: rgba(99,102,241,0.15); color: var(--accent2); }\n.badge-blue { background: rgba(59,130,246,0.15); color: #60a5fa; }\n\n/* \u2500\u2500 BUTTONS \u2500\u2500 */\n.btn {\n  display: inline-flex; align-items: center; gap: 6px;\n  padding: 8px 16px;\n  border-radius: 8px;\n  border: none;\n  cursor: pointer;\n  font-size: 13px;\n  font-weight: 600;\n  transition: all 0.15s;\n  font-family: 'Inter', sans-serif;\n}\n.btn-primary { background: var(--accent); color: white; }\n.btn-primary:hover { background: #4f46e5; transform: translateY(-1px); }\n.btn-ghost { background: var(--surface2); color: var(--text); border: 1px solid var(--border); }\n.btn-ghost:hover { background: rgba(255,255,255,0.08); }\n.btn-danger { background: rgba(239,68,68,0.15); color: #f87171; }\n.btn-danger:hover { background: rgba(239,68,68,0.25); }\n.btn-success { background: rgba(16,185,129,0.15); color: #34d399; }\n.btn-success:hover { background: rgba(16,185,129,0.25); }\n.btn-sm { padding: 5px 10px; font-size: 12px; }\n.btn-icon { padding: 7px; }\n\n/* \u2500\u2500 EMPTY STATE \u2500\u2500 */\n.empty {\n  text-align: center;\n  padding: 60px 20px;\n  color: var(--muted);\n}\n.empty-icon { font-size: 40px; margin-bottom: 12px; opacity: 0.5; }\n.empty h3 { font-size: 15px; font-weight: 600; color: var(--text); margin-bottom: 6px; }\n.empty p { font-size: 13px; }\n\n/* \u2500\u2500 MODAL \u2500\u2500 */\n.overlay {\n  display: none;\n  position: fixed; inset: 0;\n  background: rgba(0,0,0,0.7);\n  backdrop-filter: blur(4px);\n  z-index: 200;\n  align-items: center; justify-content: center;\n}\n.overlay.open { display: flex; }\n.modal {\n  background: var(--surface);\n  border: 1px solid var(--border);\n  border-radius: 16px;\n  width: 90%; max-width: 460px;\n  max-height: 90vh;\n  overflow-y: auto;\n  box-shadow: var(--card-shadow);\n}\n.modal-header {\n  padding: 20px 24px;\n  border-bottom: 1px solid var(--border);\n  display: flex; align-items: center; justify-content: space-between;\n}\n.modal-header h3 { font-size: 15px; font-weight: 600; }\n.modal-body { padding: 24px; }\n.modal-footer {\n  padding: 16px 24px;\n  border-top: 1px solid var(--border);\n  display: flex; justify-content: flex-end; gap: 10px;\n}\n\n/* \u2500\u2500 FORM \u2500\u2500 */\n.field { margin-bottom: 18px; }\n.field label { display: block; font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 7px; }\n.field input, .field select, .field textarea {\n  width: 100%;\n  background: var(--bg);\n  border: 1px solid var(--border);\n  border-radius: 8px;\n  padding: 10px 14px;\n  color: var(--text);\n  font-family: 'Inter', sans-serif;\n  font-size: 14px;\n  transition: border-color 0.15s;\n}\n.field input:focus, .field select:focus {\n  outline: none;\n  border-color: var(--accent);\n  box-shadow: 0 0 0 3px rgba(99,102,241,0.12);\n}\n.field select option { background: var(--surface); }\n\n/* \u2500\u2500 FILTER BAR \u2500\u2500 */\n.filter-bar {\n  display: flex; gap: 10px; align-items: center;\n  margin-bottom: 18px;\n}\n.filter-bar select {\n  background: var(--surface);\n  border: 1px solid var(--border);\n  border-radius: 8px;\n  padding: 8px 12px;\n  color: var(--text);\n  font-family: 'Inter', sans-serif;\n  font-size: 13px;\n}\n\n/* \u2500\u2500 TOAST \u2500\u2500 */\n.toast {\n  position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%) translateY(80px);\n  background: var(--surface2);\n  border: 1px solid var(--border);\n  color: var(--text);\n  padding: 12px 20px;\n  border-radius: 10px;\n  font-size: 13px; font-weight: 500;\n  z-index: 999;\n  transition: transform 0.3s cubic-bezier(.34,1.56,.64,1);\n  white-space: nowrap;\n  box-shadow: var(--card-shadow);\n}\n.toast.show { transform: translateX(-50%) translateY(0); }\n\n/* \u2500\u2500 QUICK ACTIONS \u2500\u2500 */\n.quick-actions { display: flex; flex-direction: column; gap: 8px; }\n.quick-action {\n  background: var(--surface2);\n  border: 1px solid var(--border);\n  border-radius: 10px;\n  padding: 12px 16px;\n  cursor: pointer;\n  transition: all 0.15s;\n  display: flex;\n  align-items: center;\n  gap: 12px;\n}\n.quick-action:hover { border-color: var(--accent); }\n.quick-action .qa-icon { font-size: 18px; }\n.quick-action .qa-title { font-size: 13px; font-weight: 600; }\n.quick-action .qa-desc { font-size: 11px; color: var(--muted); margin-top: 1px; }\n\n/* \u2500\u2500 MOBILE \u2500\u2500 */\n@media (max-width: 768px) {\n  .sidebar { width: 60px; }\n  .sidebar .logo-text, .sidebar .logo-sub, .sidebar .nav-label, .sidebar .nav-item span { display: none; }\n  .nav-item { justify-content: center; padding: 12px; }\n  .main { margin-left: 60px; }\n  .stats { grid-template-columns: repeat(2, 1fr); }\n  .content { padding: 16px; }\n}\n</style>\n</head>\n<body>\n\n<div class=\"layout\">\n\n<!-- SIDEBAR -->\n<aside class=\"sidebar\">\n  <div class=\"logo\">\n    <div class=\"logo-mark\">\n      <div class=\"logo-icon\">\ud83d\udee1\ufe0f</div>\n      <div>\n        <div class=\"logo-text\">KosherGuard</div>\n        <div class=\"logo-sub\">Filter Manager</div>\n      </div>\n    </div>\n  </div>\n  <nav>\n    <div class=\"nav-label\">Overview</div>\n    <div class=\"nav-item active\" onclick=\"showPanel('dashboard')\">\n      <span class=\"icon\">\ud83d\udcca</span><span>Dashboard</span>\n    </div>\n    <div class=\"nav-label\">Manage</div>\n    <div class=\"nav-item\" onclick=\"showPanel('profiles')\">\n      <span class=\"icon\">\ud83d\udccb</span><span>Filter Profiles</span>\n    </div>\n    <div class=\"nav-item\" onclick=\"showPanel('apps')\">\n      <span class=\"icon\">\ud83d\udcf1</span><span>Apps</span>\n    </div>\n    <div class=\"nav-item\" onclick=\"showPanel('websites')\">\n      <span class=\"icon\">\ud83c\udf10</span><span>Websites</span>\n    </div>\n    <div class=\"nav-item\" onclick=\"showPanel('users')\">\n      <span class=\"icon\">\ud83d\udc64</span><span>Users</span>\n    </div>\n    <div class=\"nav-label\">Activity</div>\n    <div class=\"nav-item\" onclick=\"showPanel('requests')\" id=\"nav-requests\">\n      <span class=\"icon\">\ud83d\udce9</span><span>Requests</span>\n      <span class=\"nav-badge\" id=\"badge-count\" style=\"display:none\">0</span>\n    </div>\n  </nav>\n</aside>\n\n<!-- MAIN -->\n<main class=\"main\">\n\n  <!-- DASHBOARD -->\n  <div class=\"panel active\" id=\"panel-dashboard\">\n    <div class=\"topbar\">\n      <h1>Dashboard</h1>\n      <div class=\"topbar-actions\">\n        <button class=\"btn btn-primary\" onclick=\"showPanel('profiles');openModal('modal-profile')\">+ New Profile</button>\n      </div>\n    </div>\n    <div class=\"content\">\n      <div class=\"stats\">\n        <div class=\"stat\">\n          <div class=\"stat-icon\">\ud83d\udccb</div>\n          <div><div class=\"stat-num\" id=\"s-profiles\">0</div><div class=\"stat-label\">Profiles</div></div>\n        </div>\n        <div class=\"stat\">\n          <div class=\"stat-icon\">\ud83d\udc64</div>\n          <div><div class=\"stat-num\" id=\"s-users\">0</div><div class=\"stat-label\">Users</div></div>\n        </div>\n        <div class=\"stat\">\n          <div class=\"stat-icon\">\ud83d\udcf1</div>\n          <div><div class=\"stat-num\" id=\"s-apps\">0</div><div class=\"stat-label\">Apps</div></div>\n        </div>\n        <div class=\"stat\">\n          <div class=\"stat-icon\">\ud83d\udce9</div>\n          <div><div class=\"stat-num\" id=\"s-requests\">0</div><div class=\"stat-label\">Pending</div></div>\n        </div>\n      </div>\n      <div style=\"margin-bottom:20px;\">\n        <div class=\"card-header\" style=\"background:var(--surface);border-radius:14px 14px 0 0;border:1px solid var(--border);border-bottom:none;\">\n          <h2>Quick Actions</h2>\n        </div>\n        <div style=\"background:var(--surface);border:1px solid var(--border);border-top:none;border-radius:0 0 14px 14px;padding:20px;\">\n          <div class=\"quick-actions\">\n            <div class=\"quick-action\" onclick=\"showPanel('profiles');openModal('modal-profile')\">\n              <div class=\"qa-icon\">\u2795</div>\n              <div><div class=\"qa-title\">New Filter Profile</div><div class=\"qa-desc\">Create a custom filter set</div></div>\n            </div>\n            <div class=\"quick-action\" onclick=\"showPanel('users');openModal('modal-user')\">\n              <div class=\"qa-icon\">\ud83d\udc64</div>\n              <div><div class=\"qa-title\">Add User</div><div class=\"qa-desc\">Assign a profile to a user</div></div>\n            </div>\n            <div class=\"quick-action\" onclick=\"showPanel('requests')\">\n              <div class=\"qa-icon\">\ud83d\udce9</div>\n              <div><div class=\"qa-title\">Review Requests</div><div class=\"qa-desc\">Approve or reject app requests</div></div>\n            </div>\n          </div>\n        </div>\n      </div>\n    </div>\n  </div>\n\n  <!-- PROFILES -->\n  <div class=\"panel\" id=\"panel-profiles\">\n    <div class=\"topbar\">\n      <h1>Filter Profiles</h1>\n      <button class=\"btn btn-primary\" onclick=\"openModal('modal-profile')\">+ New Profile</button>\n    </div>\n    <div class=\"content\">\n      <div class=\"card\">\n        <div class=\"card-body table-wrap\">\n          <table id=\"profiles-table\">\n            <thead><tr><th>Name</th><th>Level</th><th>Description</th><th>Created</th><th></th></tr></thead>\n            <tbody id=\"profiles-body\"><tr><td colspan=\"5\"><div class=\"empty\"><div class=\"empty-icon\">\ud83d\udccb</div><h3>No profiles yet</h3><p>Create your first filter profile</p></div></td></tr></tbody>\n          </table>\n        </div>\n      </div>\n    </div>\n  </div>\n\n  <!-- APPS -->\n  <div class=\"panel\" id=\"panel-apps\">\n    <div class=\"topbar\">\n      <h1>App Management</h1>\n      <button class=\"btn btn-primary\" onclick=\"openModal('modal-app')\">+ Add App</button>\n    </div>\n    <div class=\"content\">\n      <div class=\"filter-bar\">\n        <select id=\"apps-filter\" onchange=\"loadApps()\">\n          <option value=\"\">All Profiles</option>\n        </select>\n      </div>\n      <div class=\"card\">\n        <div class=\"card-body table-wrap\">\n          <table>\n            <thead><tr><th>App Name</th><th>Package</th><th>Profile</th><th>Status</th><th></th></tr></thead>\n            <tbody id=\"apps-body\"><tr><td colspan=\"5\"><div class=\"empty\"><div class=\"empty-icon\">\ud83d\udcf1</div><h3>No apps yet</h3><p>Add apps to manage them</p></div></td></tr></tbody>\n          </table>\n        </div>\n      </div>\n    </div>\n  </div>\n\n  <!-- WEBSITES -->\n  <div class=\"panel\" id=\"panel-websites\">\n    <div class=\"topbar\">\n      <h1>Website Blocking</h1>\n      <button class=\"btn btn-primary\" onclick=\"openModal('modal-website')\">+ Block Site</button>\n    </div>\n    <div class=\"content\">\n      <div class=\"filter-bar\">\n        <select id=\"sites-filter\" onchange=\"loadWebsites()\">\n          <option value=\"\">All Profiles</option>\n        </select>\n      </div>\n      <div class=\"card\">\n        <div class=\"card-body table-wrap\">\n          <table>\n            <thead><tr><th>Domain</th><th>Profile</th><th>Status</th><th></th></tr></thead>\n            <tbody id=\"sites-body\"><tr><td colspan=\"4\"><div class=\"empty\"><div class=\"empty-icon\">\ud83c\udf10</div><h3>No sites blocked</h3><p>Add domains to block</p></div></td></tr></tbody>\n          </table>\n        </div>\n      </div>\n    </div>\n  </div>\n\n  <!-- USERS -->\n  <div class=\"panel\" id=\"panel-users\">\n    <div class=\"topbar\">\n      <h1>Users</h1>\n      <button class=\"btn btn-primary\" onclick=\"openModal('modal-user')\">+ Add User</button>\n    </div>\n    <div class=\"content\">\n      <div class=\"card\">\n        <div class=\"card-body table-wrap\">\n          <table>\n            <thead><tr><th>Name</th><th>Phone</th><th>Profile</th><th>Device ID</th><th></th></tr></thead>\n            <tbody id=\"users-body\"><tr><td colspan=\"5\"><div class=\"empty\"><div class=\"empty-icon\">\ud83d\udc64</div><h3>No users yet</h3><p>Add users to assign profiles</p></div></td></tr></tbody>\n          </table>\n        </div>\n      </div>\n    </div>\n  </div>\n\n  <!-- REQUESTS -->\n  <div class=\"panel\" id=\"panel-requests\">\n    <div class=\"topbar\"><h1>App Requests</h1></div>\n    <div class=\"content\">\n      <div class=\"card\">\n        <div class=\"card-body table-wrap\">\n          <table>\n            <thead><tr><th>App</th><th>User</th><th>Package</th><th>Reason</th><th>Status</th><th></th></tr></thead>\n            <tbody id=\"requests-body\"><tr><td colspan=\"6\"><div class=\"empty\"><div class=\"empty-icon\">\ud83d\udce9</div><h3>No requests</h3><p>User requests will appear here</p></div></td></tr></tbody>\n          </table>\n        </div>\n      </div>\n    </div>\n  </div>\n\n</main>\n</div>\n\n<!-- MODALS -->\n<div class=\"overlay\" id=\"modal-profile\">\n  <div class=\"modal\">\n    <div class=\"modal-header\">\n      <h3>New Filter Profile</h3>\n      <button class=\"btn btn-ghost btn-sm btn-icon\" onclick=\"closeModal('modal-profile')\">\u2715</button>\n    </div>\n    <div class=\"modal-body\">\n      <div class=\"field\"><label>Profile Name</label><input id=\"p-name\" placeholder=\"e.g. Kids, Strict, Basic...\"></div>\n      <div class=\"field\"><label>Description</label><input id=\"p-desc\" placeholder=\"Short description...\"></div>\n      <div class=\"field\"><label>Level</label>\n        <select id=\"p-level\">\n          <option value=\"basic\">Basic</option>\n          <option value=\"strict\">Strict</option>\n          <option value=\"kids\">Kids</option>\n          <option value=\"custom\">Custom</option>\n        </select>\n      </div>\n    </div>\n    <div class=\"modal-footer\">\n      <button class=\"btn btn-ghost\" onclick=\"closeModal('modal-profile')\">Cancel</button>\n      <button class=\"btn btn-primary\" onclick=\"createProfile()\">Create Profile</button>\n    </div>\n  </div>\n</div>\n\n<div class=\"overlay\" id=\"modal-app\">\n  <div class=\"modal\">\n    <div class=\"modal-header\">\n      <h3>Add App</h3>\n      <button class=\"btn btn-ghost btn-sm btn-icon\" onclick=\"closeModal('modal-app')\">\u2715</button>\n    </div>\n    <div class=\"modal-body\">\n      <div class=\"field\"><label>Profile</label><select id=\"a-profile\"></select></div>\n      <div class=\"field\"><label>App Name</label><input id=\"a-name\" placeholder=\"e.g. WhatsApp\"></div>\n      <div class=\"field\"><label>Package Name</label><input id=\"a-pkg\" placeholder=\"e.g. com.whatsapp\"></div>\n      <div class=\"field\"><label>Status</label>\n        <select id=\"a-status\">\n          <option value=\"allowed\">\u2705 Allowed</option>\n          <option value=\"blocked\">\ud83d\udeab Blocked</option>\n        </select>\n      </div>\n    </div>\n    <div class=\"modal-footer\">\n      <button class=\"btn btn-ghost\" onclick=\"closeModal('modal-app')\">Cancel</button>\n      <button class=\"btn btn-primary\" onclick=\"createApp()\">Add App</button>\n    </div>\n  </div>\n</div>\n\n<div class=\"overlay\" id=\"modal-website\">\n  <div class=\"modal\">\n    <div class=\"modal-header\">\n      <h3>Block Website</h3>\n      <button class=\"btn btn-ghost btn-sm btn-icon\" onclick=\"closeModal('modal-website')\">\u2715</button>\n    </div>\n    <div class=\"modal-body\">\n      <div class=\"field\"><label>Profile</label><select id=\"w-profile\"></select></div>\n      <div class=\"field\"><label>Domain</label><input id=\"w-domain\" placeholder=\"e.g. youtube.com\"></div>\n      <div class=\"field\"><label>Status</label>\n        <select id=\"w-status\">\n          <option value=\"blocked\">\ud83d\udeab Blocked</option>\n          <option value=\"allowed\">\u2705 Allowed</option>\n        </select>\n      </div>\n    </div>\n    <div class=\"modal-footer\">\n      <button class=\"btn btn-ghost\" onclick=\"closeModal('modal-website')\">Cancel</button>\n      <button class=\"btn btn-primary\" onclick=\"createWebsite()\">Add Domain</button>\n    </div>\n  </div>\n</div>\n\n<div class=\"overlay\" id=\"modal-user\">\n  <div class=\"modal\">\n    <div class=\"modal-header\">\n      <h3>Add User</h3>\n      <button class=\"btn btn-ghost btn-sm btn-icon\" onclick=\"closeModal('modal-user')\">\u2715</button>\n    </div>\n    <div class=\"modal-body\">\n      <div class=\"field\"><label>Full Name</label><input id=\"u-name\" placeholder=\"Full name\"></div>\n      <div class=\"field\"><label>Phone</label><input id=\"u-phone\" placeholder=\"+1...\"></div>\n      <div class=\"field\"><label>Filter Profile</label><select id=\"u-profile\"></select></div>\n      <div class=\"field\"><label>Device ID (optional)</label><input id=\"u-device\" placeholder=\"Device identifier\"></div>\n    </div>\n    <div class=\"modal-footer\">\n      <button class=\"btn btn-ghost\" onclick=\"closeModal('modal-user')\">Cancel</button>\n      <button class=\"btn btn-primary\" onclick=\"createUser()\">Add User</button>\n    </div>\n  </div>\n</div>\n\n<div class=\"toast\" id=\"toast\"></div>\n\n<script>\nconst API = 'https://yidplus.com/filter';\nlet allProfiles = [];\n\n// \u2500\u2500 NAV \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nfunction showPanel(id) {\n  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));\n  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));\n  document.getElementById('panel-' + id).classList.add('active');\n  document.querySelectorAll('.nav-item').forEach(n => {\n    if (n.getAttribute('onclick') && n.getAttribute('onclick').includes(\"'\" + id + \"'\")) {\n      n.classList.add('active');\n    }\n  });\n  const loaders = { profiles: loadProfiles, apps: loadApps, websites: loadWebsites, users: loadUsers, requests: loadRequests, dashboard: loadDashboard };\n  if (loaders[id]) loaders[id]();\n}\n\n// \u2500\u2500 MODAL \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nfunction openModal(id) { document.getElementById(id).classList.add('open'); fillProfileSelects(); }\nfunction closeModal(id) { document.getElementById(id).classList.remove('open'); }\n\n// \u2500\u2500 TOAST \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nfunction toast(msg) {\n  const t = document.getElementById('toast');\n  t.textContent = msg;\n  t.classList.add('show');\n  setTimeout(() => t.classList.remove('show'), 3000);\n}\n\n// \u2500\u2500 API \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nasync function api(path, method = 'GET', body = null) {\n  const opts = { method, headers: { 'Content-Type': 'application/json' } };\n  if (body) opts.body = JSON.stringify(body);\n  const res = await fetch(API + '/' + path, opts);\n  return res.json();\n}\n\n// \u2500\u2500 HELPERS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nfunction levelBadge(level) {\n  const map = { basic: 'badge-blue', strict: 'badge-red', kids: 'badge-green', custom: 'badge-purple' };\n  return `<span class=\"badge ${map[level] || 'badge-blue'}\">${level}</span>`;\n}\nfunction statusBadge(s) {\n  if (s === 'allowed') return `<span class=\"badge badge-green\">\u2713 Allowed</span>`;\n  if (s === 'blocked') return `<span class=\"badge badge-red\">\u2715 Blocked</span>`;\n  if (s === 'pending') return `<span class=\"badge badge-yellow\">\u23f3 Pending</span>`;\n  if (s === 'approved') return `<span class=\"badge badge-green\">\u2713 Approved</span>`;\n  if (s === 'rejected') return `<span class=\"badge badge-red\">\u2715 Rejected</span>`;\n  return `<span class=\"badge\">${s}</span>`;\n}\nfunction fmt(dt) { return dt ? new Date(dt).toLocaleDateString() : '\u2014'; }\n\nasync function fillProfileSelects() {\n  allProfiles = await api('profiles');\n  const opts = allProfiles.map(p => `<option value=\"${p.id}\">${p.name}</option>`).join('');\n  ['a-profile','w-profile','u-profile'].forEach(id => {\n    const el = document.getElementById(id);\n    if (el) el.innerHTML = opts || '<option value=\"\">No profiles yet</option>';\n  });\n  ['apps-filter','sites-filter'].forEach(id => {\n    const el = document.getElementById(id);\n    if (el) el.innerHTML = '<option value=\"\">All Profiles</option>' + opts;\n  });\n}\n\n// \u2500\u2500 DASHBOARD \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nasync function loadDashboard() {\n  await fetch(API + '/init');\n  const [p, u, a, r] = await Promise.all([api('profiles'), api('users'), api('apps'), api('requests')]);\n  document.getElementById('s-profiles').textContent = p.length ?? 0;\n  document.getElementById('s-users').textContent = u.length ?? 0;\n  document.getElementById('s-apps').textContent = a.length ?? 0;\n  const pending = (r || []).filter(x => x.status === 'pending').length;\n  document.getElementById('s-requests').textContent = pending;\n  const badge = document.getElementById('badge-count');\n  if (pending > 0) { badge.textContent = pending; badge.style.display = ''; }\n  else { badge.style.display = 'none'; }\n}\n\n// \u2500\u2500 PROFILES \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nasync function loadProfiles() {\n  const data = await api('profiles');\n  allProfiles = data;\n  const body = document.getElementById('profiles-body');\n  if (!data.length) {\n    body.innerHTML = '<tr><td colspan=\"5\"><div class=\"empty\"><div class=\"empty-icon\">\ud83d\udccb</div><h3>No profiles yet</h3><p>Create your first filter profile</p></div></td></tr>';\n    return;\n  }\n  body.innerHTML = data.map(p => `\n    <tr>\n      <td><strong>${p.name}</strong></td>\n      <td>${levelBadge(p.level)}</td>\n      <td style=\"color:var(--muted)\">${p.description || '\u2014'}</td>\n      <td style=\"color:var(--muted)\">${fmt(p.created_at)}</td>\n      <td><button class=\"btn btn-danger btn-sm\" onclick=\"deleteProfile(${p.id})\">Delete</button></td>\n    </tr>\n  `).join('');\n}\n\nasync function createProfile() {\n  const name = document.getElementById('p-name').value.trim();\n  if (!name) return toast('\u26a0\ufe0f Enter a name');\n  await api('profiles', 'POST', { name, description: document.getElementById('p-desc').value, level: document.getElementById('p-level').value });\n  closeModal('modal-profile');\n  toast('\u2705 Profile created');\n  loadProfiles();\n  document.getElementById('p-name').value = '';\n  document.getElementById('p-desc').value = '';\n}\n\nasync function deleteProfile(id) {\n  if (!confirm('Delete this profile?')) return;\n  await api('profiles/' + id, 'DELETE');\n  toast('\ud83d\uddd1\ufe0f Deleted');\n  loadProfiles();\n}\n\n// \u2500\u2500 APPS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nasync function loadApps() {\n  const pid = document.getElementById('apps-filter')?.value;\n  const data = await api(pid ? `apps?profile_id=${pid}` : 'apps');\n  const body = document.getElementById('apps-body');\n  if (!data.length) {\n    body.innerHTML = '<tr><td colspan=\"5\"><div class=\"empty\"><div class=\"empty-icon\">\ud83d\udcf1</div><h3>No apps yet</h3><p>Add apps to manage them</p></div></td></tr>';\n    return;\n  }\n  const profile = (id) => allProfiles.find(p => p.id == id)?.name || '\u2014';\n  body.innerHTML = data.map(a => `\n    <tr>\n      <td><strong>${a.app_name}</strong></td>\n      <td style=\"color:var(--muted);font-size:12px\">${a.package_name}</td>\n      <td>${profile(a.profile_id)}</td>\n      <td>${statusBadge(a.status)}</td>\n      <td style=\"display:flex;gap:6px\">\n        <button class=\"btn btn-ghost btn-sm\" onclick=\"toggleApp(${a.id},'${a.status}','${a.app_name}','${a.package_name}')\">\n          ${a.status === 'allowed' ? 'Block' : 'Allow'}\n        </button>\n        <button class=\"btn btn-danger btn-sm\" onclick=\"deleteApp(${a.id})\">\u2715</button>\n      </td>\n    </tr>\n  `).join('');\n}\n\nasync function createApp() {\n  const name = document.getElementById('a-name').value.trim();\n  const pkg = document.getElementById('a-pkg').value.trim();\n  if (!name || !pkg) return toast('\u26a0\ufe0f Fill all fields');\n  await api('apps', 'POST', { profile_id: document.getElementById('a-profile').value, app_name: name, package_name: pkg, status: document.getElementById('a-status').value });\n  closeModal('modal-app');\n  toast('\u2705 App added');\n  loadApps();\n}\n\nasync function deleteApp(id) {\n  await api('apps/' + id, 'DELETE');\n  toast('\ud83d\uddd1\ufe0f Removed');\n  loadApps();\n}\n\nasync function toggleApp(id, status, name, pkg) {\n  await api('apps/' + id, 'PUT', { app_name: name, package_name: pkg, status: status === 'allowed' ? 'blocked' : 'allowed' });\n  toast('\u2705 Updated');\n  loadApps();\n}\n\n// \u2500\u2500 WEBSITES \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nasync function loadWebsites() {\n  const pid = document.getElementById('sites-filter')?.value;\n  const data = await api(pid ? `websites?profile_id=${pid}` : 'websites');\n  const body = document.getElementById('sites-body');\n  if (!data.length) {\n    body.innerHTML = '<tr><td colspan=\"4\"><div class=\"empty\"><div class=\"empty-icon\">\ud83c\udf10</div><h3>No sites blocked</h3><p>Add domains to block</p></div></td></tr>';\n    return;\n  }\n  const profile = (id) => allProfiles.find(p => p.id == id)?.name || '\u2014';\n  body.innerHTML = data.map(s => `\n    <tr>\n      <td><strong>${s.domain}</strong></td>\n      <td>${profile(s.profile_id)}</td>\n      <td>${statusBadge(s.status)}</td>\n      <td><button class=\"btn btn-danger btn-sm\" onclick=\"deleteSite(${s.id})\">\u2715</button></td>\n    </tr>\n  `).join('');\n}\n\nasync function createWebsite() {\n  const domain = document.getElementById('w-domain').value.trim();\n  if (!domain) return toast('\u26a0\ufe0f Enter a domain');\n  await api('websites', 'POST', { profile_id: document.getElementById('w-profile').value, domain, status: document.getElementById('w-status').value });\n  closeModal('modal-website');\n  toast('\u2705 Domain added');\n  loadWebsites();\n}\n\nasync function deleteSite(id) {\n  await api('websites/' + id, 'DELETE');\n  toast('\ud83d\uddd1\ufe0f Removed');\n  loadWebsites();\n}\n\n// \u2500\u2500 USERS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nasync function loadUsers() {\n  const data = await api('users');\n  const body = document.getElementById('users-body');\n  if (!data.length) {\n    body.innerHTML = '<tr><td colspan=\"5\"><div class=\"empty\"><div class=\"empty-icon\">\ud83d\udc64</div><h3>No users yet</h3><p>Add users to assign profiles</p></div></td></tr>';\n    return;\n  }\n  body.innerHTML = data.map(u => `\n    <tr>\n      <td><strong>${u.name}</strong></td>\n      <td style=\"color:var(--muted)\">${u.phone || '\u2014'}</td>\n      <td><span class=\"badge badge-purple\">${u.profile_name || 'No profile'}</span></td>\n      <td style=\"color:var(--muted);font-size:12px\">${u.device_id || '\u2014'}</td>\n      <td><button class=\"btn btn-danger btn-sm\" onclick=\"deleteUser(${u.id})\">\u2715</button></td>\n    </tr>\n  `).join('');\n}\n\nasync function createUser() {\n  const name = document.getElementById('u-name').value.trim();\n  if (!name) return toast('\u26a0\ufe0f Enter a name');\n  await api('users', 'POST', { name, phone: document.getElementById('u-phone').value, profile_id: document.getElementById('u-profile').value, device_id: document.getElementById('u-device').value });\n  closeModal('modal-user');\n  toast('\u2705 User added');\n  loadUsers();\n}\n\nasync function deleteUser(id) {\n  if (!confirm('Delete this user?')) return;\n  await api('users/' + id, 'DELETE');\n  toast('\ud83d\uddd1\ufe0f Deleted');\n  loadUsers();\n}\n\n// \u2500\u2500 REQUESTS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nasync function loadRequests() {\n  const data = await api('requests');\n  const body = document.getElementById('requests-body');\n  if (!data.length) {\n    body.innerHTML = '<tr><td colspan=\"6\"><div class=\"empty\"><div class=\"empty-icon\">\ud83d\udce9</div><h3>No requests</h3><p>User requests will appear here</p></div></td></tr>';\n    return;\n  }\n  body.innerHTML = data.map(r => `\n    <tr>\n      <td><strong>${r.app_name}</strong></td>\n      <td>${r.user_name || '\u2014'}</td>\n      <td style=\"color:var(--muted);font-size:12px\">${r.package_name || '\u2014'}</td>\n      <td style=\"color:var(--muted)\">${r.reason || '\u2014'}</td>\n      <td>${statusBadge(r.status)}</td>\n      <td>${r.status === 'pending' ? `\n        <div style=\"display:flex;gap:6px\">\n          <button class=\"btn btn-success btn-sm\" onclick=\"handleReq(${r.id},'approved')\">Approve</button>\n          <button class=\"btn btn-danger btn-sm\" onclick=\"handleReq(${r.id},'rejected')\">Reject</button>\n        </div>` : ''}\n      </td>\n    </tr>\n  `).join('');\n}\n\nasync function handleReq(id, status) {\n  await api('requests/' + id, 'PUT', { status });\n  toast(status === 'approved' ? '\u2705 Approved' : '\u274c Rejected');\n  loadRequests();\n  loadDashboard();\n}\n\n// \u2500\u2500 INIT \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nasync function init() {\n  await fetch(API + '/init');\n  await fillProfileSelects();\n  loadDashboard();\n}\n\ninit();\n</script>\n</body>\n</html>\n";
    return new Response(HTML, {
      headers: { "Content-Type": "text/html;charset=UTF-8" }
    });
  }

  // ── INIT DATABASE ──────────────────────────────────────
  if (path === 'init') {
    await env.DB.exec(`
      CREATE TABLE IF NOT EXISTS filter_profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        level TEXT DEFAULT 'basic',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS filter_apps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER,
        app_name TEXT NOT NULL,
        package_name TEXT NOT NULL,
        app_icon TEXT,
        status TEXT DEFAULT 'allowed',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (profile_id) REFERENCES filter_profiles(id)
      );

      CREATE TABLE IF NOT EXISTS filter_websites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER,
        domain TEXT NOT NULL,
        status TEXT DEFAULT 'blocked',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (profile_id) REFERENCES filter_profiles(id)
      );

      CREATE TABLE IF NOT EXISTS filter_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        profile_id INTEGER,
        device_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (profile_id) REFERENCES filter_profiles(id)
      );

      CREATE TABLE IF NOT EXISTS filter_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        app_name TEXT NOT NULL,
        package_name TEXT,
        reason TEXT,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES filter_users(id)
      );
    `);
    return json({ ok: true, message: 'Database initialized' });
  }

  // ── PROFILES ───────────────────────────────────────────
  if (path === 'profiles') {
    if (method === 'GET') {
      const { results } = await env.DB.prepare(
        'SELECT * FROM filter_profiles ORDER BY created_at DESC'
      ).all();
      return json(results);
    }
    if (method === 'POST') {
      const body = await request.json();
      const { name, description, level } = body;
      const result = await env.DB.prepare(
        'INSERT INTO filter_profiles (name, description, level) VALUES (?, ?, ?)'
      ).bind(name, description || '', level || 'basic').run();
      return json({ ok: true, id: result.meta.last_row_id });
    }
  }

  if (path.startsWith('profiles/') && path.split('/').length === 2) {
    const id = path.split('/')[1];
    if (method === 'DELETE') {
      await env.DB.prepare('DELETE FROM filter_profiles WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }
    if (method === 'PUT') {
      const body = await request.json();
      const { name, description, level } = body;
      await env.DB.prepare(
        'UPDATE filter_profiles SET name=?, description=?, level=? WHERE id=?'
      ).bind(name, description, level, id).run();
      return json({ ok: true });
    }
  }

  // ── APPS ───────────────────────────────────────────────
  if (path === 'apps') {
    if (method === 'GET') {
      const profileId = url.searchParams.get('profile_id');
      const query = profileId
        ? 'SELECT * FROM filter_apps WHERE profile_id = ? ORDER BY app_name'
        : 'SELECT * FROM filter_apps ORDER BY app_name';
      const stmt = profileId
        ? env.DB.prepare(query).bind(profileId)
        : env.DB.prepare(query);
      const { results } = await stmt.all();
      return json(results);
    }
    if (method === 'POST') {
      const body = await request.json();
      const { profile_id, app_name, package_name, app_icon, status } = body;
      const result = await env.DB.prepare(
        'INSERT INTO filter_apps (profile_id, app_name, package_name, app_icon, status) VALUES (?, ?, ?, ?, ?)'
      ).bind(profile_id, app_name, package_name, app_icon || '', status || 'allowed').run();
      return json({ ok: true, id: result.meta.last_row_id });
    }
  }

  if (path.startsWith('apps/') && path.split('/').length === 2) {
    const id = path.split('/')[1];
    if (method === 'DELETE') {
      await env.DB.prepare('DELETE FROM filter_apps WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }
    if (method === 'PUT') {
      const body = await request.json();
      const { app_name, package_name, status } = body;
      await env.DB.prepare(
        'UPDATE filter_apps SET app_name=?, package_name=?, status=? WHERE id=?'
      ).bind(app_name, package_name, status, id).run();
      return json({ ok: true });
    }
  }

  // ── WEBSITES ───────────────────────────────────────────
  if (path === 'websites') {
    if (method === 'GET') {
      const profileId = url.searchParams.get('profile_id');
      const query = profileId
        ? 'SELECT * FROM filter_websites WHERE profile_id = ? ORDER BY domain'
        : 'SELECT * FROM filter_websites ORDER BY domain';
      const stmt = profileId
        ? env.DB.prepare(query).bind(profileId)
        : env.DB.prepare(query);
      const { results } = await stmt.all();
      return json(results);
    }
    if (method === 'POST') {
      const body = await request.json();
      const { profile_id, domain, status } = body;
      const result = await env.DB.prepare(
        'INSERT INTO filter_websites (profile_id, domain, status) VALUES (?, ?, ?)'
      ).bind(profile_id, domain, status || 'blocked').run();
      return json({ ok: true, id: result.meta.last_row_id });
    }
  }

  if (path.startsWith('websites/') && path.split('/').length === 2) {
    const id = path.split('/')[1];
    if (method === 'DELETE') {
      await env.DB.prepare('DELETE FROM filter_websites WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }
  }

  // ── USERS ──────────────────────────────────────────────
  if (path === 'users') {
    if (method === 'GET') {
      const { results } = await env.DB.prepare(
        `SELECT u.*, p.name as profile_name 
         FROM filter_users u 
         LEFT JOIN filter_profiles p ON u.profile_id = p.id 
         ORDER BY u.created_at DESC`
      ).all();
      return json(results);
    }
    if (method === 'POST') {
      const body = await request.json();
      const { name, email, phone, profile_id, device_id } = body;
      const result = await env.DB.prepare(
        'INSERT INTO filter_users (name, email, phone, profile_id, device_id) VALUES (?, ?, ?, ?, ?)'
      ).bind(name, email || '', phone || '', profile_id, device_id || '').run();
      return json({ ok: true, id: result.meta.last_row_id });
    }
  }

  if (path.startsWith('users/') && path.split('/').length === 2) {
    const id = path.split('/')[1];
    if (method === 'DELETE') {
      await env.DB.prepare('DELETE FROM filter_users WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }
    if (method === 'PUT') {
      const body = await request.json();
      const { name, email, phone, profile_id } = body;
      await env.DB.prepare(
        'UPDATE filter_users SET name=?, email=?, phone=?, profile_id=? WHERE id=?'
      ).bind(name, email, phone, profile_id, id).run();
      return json({ ok: true });
    }
  }

  // ── REQUESTS ───────────────────────────────────────────
  if (path === 'requests') {
    if (method === 'GET') {
      const { results } = await env.DB.prepare(
        `SELECT r.*, u.name as user_name 
         FROM filter_requests r 
         LEFT JOIN filter_users u ON r.user_id = u.id 
         ORDER BY r.created_at DESC`
      ).all();
      return json(results);
    }
    if (method === 'POST') {
      const body = await request.json();
      const { user_id, app_name, package_name, reason } = body;
      const result = await env.DB.prepare(
        'INSERT INTO filter_requests (user_id, app_name, package_name, reason) VALUES (?, ?, ?, ?)'
      ).bind(user_id, app_name, package_name || '', reason || '').run();
      return json({ ok: true, id: result.meta.last_row_id });
    }
  }

  if (path.startsWith('requests/') && path.split('/').length === 2) {
    const id = path.split('/')[1];
    if (method === 'PUT') {
      const body = await request.json();
      const { status } = body;
      await env.DB.prepare(
        'UPDATE filter_requests SET status=? WHERE id=?'
      ).bind(status, id).run();
      return json({ ok: true });
    }
  }

  // ── USER PROFILE LOOKUP (for device) ──────────────────
  if (path.startsWith('device/')) {
    const deviceId = path.split('/')[1];
    const user = await env.DB.prepare(
      'SELECT * FROM filter_users WHERE device_id = ?'
    ).bind(deviceId).first();
    if (!user) return json({ error: 'Device not found' }, 404);

    const { results: apps } = await env.DB.prepare(
      'SELECT * FROM filter_apps WHERE profile_id = ? AND status = "allowed"'
    ).bind(user.profile_id).all();

    const { results: blocked } = await env.DB.prepare(
      'SELECT * FROM filter_websites WHERE profile_id = ? AND status = "blocked"'
    ).bind(user.profile_id).all();

    return json({ user, allowed_apps: apps, blocked_websites: blocked });
  }

  return json({ error: 'Not found' }, 404);
}

export async function onRequest(context) {
  return handleRequest(context.request, context.env);
}
