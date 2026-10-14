// Shared privacy checks for content, deep links and comments. Errors deny access.
import { isAdminRole } from './_helpers.js';
const legacyColumn = e => /no such column.*hidden/i.test(String(e && e.message));
export async function channelContentVisible(env, ownerId, user) {
  if (!ownerId) return false;
  try {
    const channel = await env.DB.prepare('SELECT privacy FROM channels WHERE owner_id=?').bind(ownerId).first();
    if (!channel || channel.privacy !== 'followers_only') return true;
    if (user && (user.id === ownerId || isAdminRole(user, env.OWNER_EMAIL))) return true;
    return !!(user && await env.DB.prepare('SELECT 1 FROM channel_followers WHERE channel_owner_id=? AND follower_id=?').bind(ownerId,user.id).first());
  } catch { return false; }
}
export async function shortVisible(env, id, user) {
  try {
    let row;
    try { row = await env.DB.prepare('SELECT id,owner_id,hidden FROM shorts WHERE id=?').bind(id).first(); }
    catch (e) { if (!legacyColumn(e)) return false; row=await env.DB.prepare('SELECT id,owner_id FROM shorts WHERE id=?').bind(id).first(); }
    if (!row || row.hidden) return false;
    if (user && await env.DB.prepare('SELECT 1 FROM user_blocks WHERE blocker_id=? AND blocked_id=?').bind(user.id,row.owner_id).first()) return false;
    return await channelContentVisible(env,row.owner_id,user);
  } catch { return false; }
}

// One privacy query for a whole feed, not one round trip per author.
export async function filterChannelContent(env, rows, user, ownerField='owner_id') {
  if (!rows.length || (user && isAdminRole(user,env.OWNER_EMAIL))) return rows;
  const owners=[...new Set(rows.map(row=>row[ownerField]).filter(Boolean))];
  if (!owners.length) return [];
  try {
    const marks=owners.map(()=>'?').join(',');
    const result=await env.DB.prepare(`SELECT c.owner_id FROM channels c
      WHERE c.privacy='followers_only' AND c.owner_id IN (${marks})
      AND c.owner_id!=? AND NOT EXISTS(SELECT 1 FROM channel_followers f WHERE f.channel_owner_id=c.owner_id AND f.follower_id=?)`).bind(...owners,user?user.id:'',user?user.id:'').all();
    const denied=new Set((result.results||[]).map(row=>row.owner_id));
    return rows.filter(row=>row[ownerField] && !denied.has(row[ownerField]));
  } catch { return []; }
}
