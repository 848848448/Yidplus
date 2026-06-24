// functions/api/profile.js
// PUT /api/profile -> update bio/photo only (nickname is LOCKED after registration)
// Admin can update nickname via admin panel
import { json, corsHeaders, requireUser, isSuperOrOwner } from './_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestPut(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const contentType = request.headers.get('content-type') || '';
    let nickname = '', bio = '', photoFile = null;

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      nickname  = (form.get('nickname') || '').toString().trim();
      bio       = (form.get('bio') || '').toString().trim();
      photoFile = form.get('photo');
    } else {
      const body = await request.json();
      nickname = (body.nickname || '').trim();
      bio      = (body.bio || '').trim();
    }

    // Nickname is LOCKED — only admins/owners can change it
    if (nickname && nickname !== user.nickname) {
      const isAdmin = isSuperOrOwner(user, env.OWNER_EMAIL);
      if (!isAdmin) {
        return json({ ok: false, error: 'Nickname cannot be changed after registration. Contact an admin.' }, 403);
      }
      // Validate uniqueness
      const taken = await env.DB.prepare('SELECT id FROM users WHERE nickname = ? AND id != ?').bind(nickname, user.id).first();
      if (taken) return json({ ok: false, error: 'Nickname already taken' }, 409);
      if (nickname.length < 3) return json({ ok: false, error: 'Nickname must be at least 3 characters' }, 400);
      if (!/^[a-zA-Z0-9_\u0590-\u05FF]+$/.test(nickname)) {
        return json({ ok: false, error: 'Nickname can only contain letters, numbers and underscores' }, 400);
      }
      await env.DB.prepare('UPDATE users SET nickname = ? WHERE id = ?').bind(nickname, user.id).run();
      await env.DB.prepare('UPDATE channels SET nickname = ? WHERE owner_id = ?').bind(nickname, user.id).run();
    }

    // Photo upload (anyone can change their photo)
    let photoUrl = null;
    if (photoFile && typeof photoFile === 'object' && photoFile.arrayBuffer) {
      const ext = (photoFile.name || 'jpg').split('.').pop();
      const key = `avatars/${user.id}/${Date.now()}.${ext}`;
      await env.MY_BUCKET.put(key, await photoFile.arrayBuffer(), {
        httpMetadata: { contentType: photoFile.type || 'image/jpeg' },
      });
      photoUrl = `/api/media/${encodeURIComponent(key)}`;
      await env.DB.prepare('UPDATE users SET photo_url = ? WHERE id = ?').bind(photoUrl, user.id).run();
    }

    // Bio update (anyone can change their bio)
    if (bio !== undefined && bio !== null) {
      await env.DB.prepare('UPDATE users SET bio = ? WHERE id = ?').bind(bio, user.id).run();
    }

    return json({ ok: true, nickname: nickname || user.nickname, bio, photo_url: photoUrl });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
        }
