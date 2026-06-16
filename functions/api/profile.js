// functions/api/profile.js
// PUT /api/profile  -> update the logged-in user's nickname/bio/photo
//   JSON body:      { nickname, bio }
//   multipart body: nickname, bio, photo (file) -> uploads to R2

import { json, corsHeaders, requireUser } from './_helpers.js';

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

    if (nickname && nickname.length < 3) {
      return json({ ok: false, error: 'Nickname must be at least 3 characters' }, 400);
    }

    let photoUrl = null;
    if (photoFile && typeof photoFile === 'object' && photoFile.arrayBuffer) {
      const ext = (photoFile.name && photoFile.name.includes('.')) ? photoFile.name.split('.').pop() : 'jpg';
      const key = `avatars/${user.id}/${Date.now()}.${ext}`;
      await env.MY_BUCKET.put(key, await photoFile.arrayBuffer(), {
        httpMetadata: { contentType: photoFile.type || 'image/jpeg' },
      });
      photoUrl = `/api/media/${encodeURIComponent(key)}`;
      await env.DB.prepare(`UPDATE users SET photo_url = ? WHERE id = ?`).bind(photoUrl, user.id).run();
    }

    if (nickname) {
      await env.DB.prepare(`UPDATE users SET nickname = ?, bio = ? WHERE id = ?`)
        .bind(nickname, bio, user.id).run();
      await env.DB.prepare(`UPDATE channels SET nickname = ? WHERE owner_id = ?`)
        .bind(nickname, user.id).run();
    } else if (bio) {
      await env.DB.prepare(`UPDATE users SET bio = ? WHERE id = ?`).bind(bio, user.id).run();
    }

    return json({ ok: true, nickname: nickname || user.nickname, bio: bio, photo_url: photoUrl });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
  }
