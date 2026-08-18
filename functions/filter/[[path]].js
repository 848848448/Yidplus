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
